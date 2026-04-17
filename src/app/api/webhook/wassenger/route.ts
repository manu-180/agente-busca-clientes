import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt, buildUserMessageWithLeadContext } from '@/lib/prompts'
import {
  pareceMensajeAutomaticoNegocio,
  RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
} from '@/lib/outbound-auto-reply'
import { decidirRespuestaConversacional } from '@/lib/response-decision'
import { obtenerConfigConversacional } from '@/lib/conversation-config'
import { registrarEventoConversacional } from '@/lib/conversation-events'
import {
  auditarCoherenciaRubro,
  fallbackSeguroPorVertical,
  instruccionRegeneracion,
  sanitizarRespuestaModelo,
} from '@/lib/response-guardrails'
import { detectarVertical, sanitizarApexInfoPorVertical } from '@/lib/verticales'

export const maxDuration = 30

const OWNER_PHONE = '5491124842720'
const VENTANA_RESPUESTA_MANUAL_MS = 5 * 60 * 1000
const DEBOUNCE_MS = 3500

const WASSENGER_MESSAGES_URL = 'https://api.wassenger.com/v1/messages'

async function enviarWassengerYGuardar(
  supabase: ReturnType<typeof createSupabaseServer>,
  telefono: string,
  leadId: string,
  texto: string
) {
  const apiKey = process.env.WASSENGER_API_KEY
  if (!apiKey) {
    throw new Error('Falta WASSENGER_API_KEY')
  }

  const res = await fetch(WASSENGER_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Token: apiKey,
    },
    body: JSON.stringify({
      phone: telefono,
      message: texto,
      device: process.env.WASSENGER_DEVICE_ID,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Wassenger error: ${res.status} - ${err}`)
  }

  await supabase.from('conversaciones').insert({
    lead_id: leadId,
    telefono,
    mensaje: texto,
    rol: 'agente',
    tipo_mensaje: 'texto',
    manual: false,
  })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch (error) {
    console.error('Error parsing request body:', error)
    return NextResponse.json({ ok: true, skipped: true })
  }

  console.log('[Wassenger Webhook] Body received:', body)

  const evento = body.event as string | undefined

  if (evento !== 'message:in:new') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const data = (body.data ?? {}) as Record<string, unknown>
  const rawPhone = data.fromNumber as string | undefined
  const mensaje = (data.body ?? data.message ?? data.text ?? '') as string
  const tipoOriginal = (data.type ?? 'chat') as string

  const telefono = rawPhone?.replace(/^\+/, '').replace('@c.us', '') ?? ''

  if (!telefono || !mensaje) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  if (telefono.includes(OWNER_PHONE)) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'mensaje_propio' })
  }

  const supabase = createSupabaseServer()

  let tipoMensaje: 'texto' | 'audio' | 'imagen' | 'otro' = 'texto'
  if (tipoOriginal === 'ptt' || tipoOriginal === 'audio') tipoMensaje = 'audio'
  else if (tipoOriginal === 'image') tipoMensaje = 'imagen'
  else if (tipoOriginal !== 'chat' && tipoOriginal !== 'text') tipoMensaje = 'otro'

  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('telefono', telefono)
    .single()

  if (!lead) {
    const { data: nuevoLead } = await supabase
      .from('leads')
      .insert({
        nombre: `Lead ${telefono.slice(-4)}`,
        rubro: 'Por definir',
        zona: 'Por definir',
        telefono,
        descripcion: 'Lead entrante desde WhatsApp',
        mensaje_inicial: '',
        estado: 'respondio',
        origen: 'inbound',
        agente_activo: true,
      })
      .select()
      .single()
    lead = nuevoLead
  }

  if (!lead) {
    return NextResponse.json({ error: 'No se pudo crear/encontrar lead' }, { status: 500 })
  }

  const { data: insertadoMsg } = await supabase
    .from('conversaciones')
    .insert({
      lead_id: lead.id,
      telefono,
      mensaje: tipoMensaje !== 'texto' ? `[${tipoMensaje.toUpperCase()}] ${mensaje}` : mensaje,
      rol: 'cliente',
      tipo_mensaje: tipoMensaje,
      leido: false,
    })
    .select('id, timestamp')
    .single()

  const miMsgTimestamp = (insertadoMsg as { timestamp?: string } | null)?.timestamp

  if (lead.estado === 'contactado' || lead.estado === 'pendiente') {
    await supabase.from('leads').update({ estado: 'respondio' }).eq('id', lead.id)
  }

  const { data: configAgente } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'agente_activo')
    .single()

  const agenteGlobalOn = configAgente?.valor === 'true'
  const agenteLeadOn = !!lead.agente_activo

  if (!agenteGlobalOn || !agenteLeadOn) {
    return NextResponse.json({ ok: true, agente: false })
  }

  const desdeManual = new Date(Date.now() - VENTANA_RESPUESTA_MANUAL_MS).toISOString()
  const { data: recienteManual } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('rol', 'agente')
    .eq('manual', true)
    .gte('timestamp', desdeManual)
    .limit(1)
    .maybeSingle()

  if (recienteManual) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      motivo: 'dueño_respondió_reciente',
    })
  }

  if (tipoMensaje !== 'texto') {
    const respAudio =
      'Disculpá, no puedo escuchar audios ni ver imágenes por acá. ¿Me lo podés escribir en texto?'
    console.log('[Wassenger] Enviando respuesta por audio/imagen recibido')
    try {
      await enviarWassengerYGuardar(supabase, telefono, lead.id, respAudio)
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'non_text_fallback_sent',
        decisionAction: 'full_reply',
        decisionReason: 'default_full_reply',
        confidence: 1,
      })
    } catch (e) {
      console.error('Wassenger audio fallback:', e)
      return NextResponse.json({ ok: false, error: 'wassenger_error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, agente: true, tipo: 'audio_fallback' })
  }

  // Debounce: esperar para agrupar mensajes consecutivos del mismo contacto
  await new Promise<void>(resolve => setTimeout(resolve, DEBOUNCE_MS))

  if (miMsgTimestamp) {
    const { data: msgPosterior } = await supabase
      .from('conversaciones')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('rol', 'cliente')
      .gt('timestamp', miMsgTimestamp)
      .limit(1)
      .maybeSingle()

    if (msgPosterior) {
      // Llegó un mensaje más nuevo; ese webhook se encargará de responder
      return NextResponse.json({ ok: true, skipped: true, motivo: 'debounce' })
    }
  }

  // Combinar todos los mensajes de texto sin respuesta en uno solo
  const { data: ultimoAgenteMensaje } = await supabase
    .from('conversaciones')
    .select('timestamp')
    .eq('lead_id', lead.id)
    .eq('rol', 'agente')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  const desdeUltimoAgente = ultimoAgenteMensaje?.timestamp ?? '1970-01-01T00:00:00.000Z'

  const { data: pendientes } = await supabase
    .from('conversaciones')
    .select('mensaje')
    .eq('lead_id', lead.id)
    .eq('rol', 'cliente')
    .eq('tipo_mensaje', 'texto')
    .gt('timestamp', desdeUltimoAgente)
    .order('timestamp', { ascending: true })

  const mensajeCombinado =
    (pendientes ?? [])
      .map(m => m.mensaje)
      .filter(Boolean)
      .join('\n') || mensaje

  const configConversacional = await obtenerConfigConversacional()
  const decision = decidirRespuestaConversacional({
    message: mensajeCombinado,
    history: (pendientes ?? []).map(item => ({ rol: 'cliente', mensaje: item.mensaje })),
    config: configConversacional,
  })

  await registrarEventoConversacional({
    leadId: lead.id,
    telefono,
    eventName: decision.eventName,
    decisionAction: decision.action,
    decisionReason: decision.reason,
    confidence: decision.confidence,
    metadata: {
      origen: lead.origen,
      tipo_mensaje: tipoMensaje,
    },
  })

  if (decision.disableAgent) {
    await supabase
      .from('leads')
      .update({
        estado: 'no_interesado',
        agente_activo: false,
        conversacion_cerrada: true,
        conversacion_cerrada_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
    return NextResponse.json({ ok: true, agente: false, motivo: 'no_interesado' })
  }

  if (decision.closeConversation) {
    await supabase
      .from('leads')
      .update({
        conversacion_cerrada: true,
        conversacion_cerrada_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
  } else if (lead.conversacion_cerrada) {
    await supabase
      .from('leads')
      .update({ conversacion_cerrada: false, conversacion_cerrada_at: null })
      .eq('id', lead.id)
  }

  if (decision.action === 'no_reply' || decision.action === 'close_conversation') {
    return NextResponse.json({ ok: true, skipped: true, motivo: decision.reason })
  }

  if (decision.action === 'micro_ack') {
    const microAck = 'Gracias por el mensaje. Si querés, te paso el siguiente paso en 1 línea.'
    try {
      await enviarWassengerYGuardar(supabase, telefono, lead.id, microAck)
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'micro_ack_sent',
        decisionAction: decision.action,
        decisionReason: decision.reason,
        confidence: decision.confidence,
      })
    } catch (e) {
      console.error('Wassenger micro ack error:', e)
      return NextResponse.json({ ok: false, error: 'wassenger_error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, agente: true, tipo: 'micro_ack' })
  }

  if (decision.action === 'handoff_human') {
    const handoffMsg =
      'Perfecto. Te deriva una persona del equipo de APEX para seguir esto con vos. Si querés, te toman el caso por acá.'
    try {
      await enviarWassengerYGuardar(supabase, telefono, lead.id, handoffMsg)
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'handoff_human_sent',
        decisionAction: decision.action,
        decisionReason: decision.reason,
        confidence: decision.confidence,
      })
    } catch (e) {
      console.error('Wassenger handoff error:', e)
      return NextResponse.json({ ok: false, error: 'wassenger_error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, agente: true, tipo: 'handoff_human' })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    console.error('Falta ANTHROPIC_API_KEY')
    return NextResponse.json({ ok: false, error: 'config' }, { status: 500 })
  }

  try {
    console.log('[Wassenger] Generando respuesta del agente...')

    const { data: apexInfo } = await supabase
      .from('apex_info')
      .select('categoria, titulo, contenido')
      .eq('activo', true)

    const apexInfoTextoRaw = (apexInfo ?? [])
      .map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`)
      .join('\n\n')

    const verticalLead = detectarVertical(
      String(lead.rubro ?? ''),
      lead.descripcion as string | null | undefined
    )
    const apexInfoSanitizado = sanitizarApexInfoPorVertical(apexInfoTextoRaw, verticalLead)
    const apexInfoTexto = apexInfoSanitizado.texto
    if (apexInfoSanitizado.removidas.length) {
      console.log(
        '[Wassenger] apex_info filtrado por vertical',
        verticalLead,
        '→ removidas:',
        apexInfoSanitizado.removidas
      )
    }

    const { data: historial } = await supabase
      .from('conversaciones')
      .select('rol, mensaje, timestamp')
      .eq('lead_id', lead.id)
      .order('timestamp', { ascending: true })
      .limit(20)

    const filasHistorial = historial ?? []

    // Detectar respuesta automática del negocio (WhatsApp Business) en outbound temprano
    const cantidadMensajesAgente = filasHistorial.filter(h => h.rol === 'agente').length
    const esAutoMensajeNegocio =
      lead.origen === 'outbound' &&
      cantidadMensajesAgente <= 1 &&
      pareceMensajeAutomaticoNegocio(mensajeCombinado)

    if (esAutoMensajeNegocio) {
      console.log('[Wassenger] Outbound: mensaje del cliente parece respuesta automática del negocio')
      await enviarWassengerYGuardar(supabase, telefono, lead.id, RESPUESTA_OUTBOUND_TRAS_AUTOMATICO)
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'outbound_auto_business_reply',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
      })
      return NextResponse.json({ ok: true, agente: true, tipo: 'outbound_auto_negocio' })
    }

    const historialTexto = filasHistorial
      .map(h => `[${h.rol === 'agente' ? 'APEX' : 'CLIENTE'}] ${h.mensaje}`)
      .join('\n')

    const contextoLead = {
      nombre: String(lead.nombre ?? ''),
      rubro: String(lead.rubro ?? ''),
      zona: String(lead.zona ?? ''),
      descripcion: lead.descripcion as string | null | undefined,
      mensajeInicial: lead.mensaje_inicial as string | null | undefined,
    }

    const systemPrompt = buildAgentPrompt(
      lead.origen as 'outbound' | 'inbound',
      apexInfoTexto,
      historialTexto,
      contextoLead
    )

    const userContent = buildUserMessageWithLeadContext(mensajeCombinado, contextoLead)

    const client = new Anthropic({ apiKey: anthropicKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    })

    const respuestaRaw = response.content[0].type === 'text' ? response.content[0].text : ''
    let chequeo = auditarCoherenciaRubro(
      respuestaRaw,
      String(lead.rubro ?? ''),
      lead.descripcion as string | null | undefined
    )

    if (chequeo.texto && chequeo.intrusa) {
      console.warn(
        '[Wassenger] Mezcla de vertical detectada → regenerando.',
        'lead:',
        chequeo.verticalLead,
        'intrusa:',
        chequeo.intrusa
      )
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'rubro_mismatch_detected',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        metadata: {
          source: 'webhook',
          verticalLead: chequeo.verticalLead,
          intrusa: chequeo.intrusa,
        },
      })

      const regenInstruccion = instruccionRegeneracion({
        verticalLead: chequeo.verticalLead,
        intrusa: chequeo.intrusa,
        textoAnterior: chequeo.texto,
        rubroLiteral: String(lead.rubro ?? ''),
        nombre: String(lead.nombre ?? ''),
      })

      try {
        const retry = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userContent },
            { role: 'assistant', content: chequeo.texto },
            { role: 'user', content: regenInstruccion },
          ],
        })
        const retryRaw = retry.content[0].type === 'text' ? retry.content[0].text : ''
        const retryChequeo = auditarCoherenciaRubro(
          retryRaw,
          String(lead.rubro ?? ''),
          lead.descripcion as string | null | undefined
        )
        if (retryChequeo.texto && retryChequeo.ok) {
          chequeo = retryChequeo
        } else {
          await registrarEventoConversacional({
            leadId: lead.id,
            telefono,
            eventName: 'rubro_regen_failed_fallback',
            decisionAction: 'full_reply',
            decisionReason: decision.reason,
            confidence: decision.confidence,
            metadata: {
              source: 'webhook',
              verticalLead: chequeo.verticalLead,
              intrusaOriginal: retryChequeo.intrusa,
            },
          })
          chequeo = {
            texto: fallbackSeguroPorVertical(chequeo.verticalLead, String(lead.nombre ?? '')),
            verticalLead: chequeo.verticalLead,
            intrusa: null,
            ok: true,
          }
        }
      } catch (e) {
        console.error('[Wassenger] Error regenerando:', e)
        chequeo = {
          texto: fallbackSeguroPorVertical(chequeo.verticalLead, String(lead.nombre ?? '')),
          verticalLead: chequeo.verticalLead,
          intrusa: null,
          ok: true,
        }
      }
    }

    const respuesta = sanitizarRespuestaModelo(chequeo.texto)

    if (!respuesta) {
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'llm_blocked_guardrail',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
      })
      return NextResponse.json({ ok: true, agente: true, vacio: true })
    }

    console.log('[Wassenger] Agente generó respuesta, enviando...')
    await enviarWassengerYGuardar(supabase, telefono, lead.id, respuesta)
    await registrarEventoConversacional({
      leadId: lead.id,
      telefono,
      eventName: 'full_reply_sent',
      decisionAction: 'full_reply',
      decisionReason: decision.reason,
      confidence: decision.confidence,
      metadata: {
        length: respuesta.length,
      },
    })

    return NextResponse.json({ ok: true, agente: true })
  } catch (error) {
    console.error('[Wassenger] Error en agente / Wassenger:', error)
    return NextResponse.json({ ok: true, agente: false, error: 'agente_error' })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
