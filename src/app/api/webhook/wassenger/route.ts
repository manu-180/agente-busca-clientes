import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt, buildUserMessageWithLeadContext } from '@/lib/prompts'
import {
  pareceMensajeAutomaticoNegocio,
  RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
  RESPUESTA_GATEKEEPER,
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
import { extraerContenidoNuevo } from '@/lib/echo-detection'
import {
  stripContinuationViolations,
  validateContinuationMessage,
} from '@/lib/message-guards'

export const maxDuration = 30

// Tool que termina la conversación por protocolo (stop_reason: "tool_use")
// evita que el modelo agregue preguntas de seguimiento después del cierre
const END_CONVERSATION_TOOL: Anthropic.Tool = {
  name: 'end_conversation',
  description:
    'Call this when the customer clearly agreed to move forward, said goodbye, or the conversation is naturally over. Provide only the immediate next step or a brief closing line.',
  input_schema: {
    type: 'object',
    properties: {
      final_message: {
        type: 'string',
        description: 'Final message to send. Maximum 15 words. Just the next step or a simple goodbye.',
      },
      reason: {
        type: 'string',
        enum: ['deal_closed', 'goodbye', 'no_interest'],
        description: 'Why the conversation is ending.',
      },
    },
    required: ['final_message', 'reason'],
  },
}

const OWNER_PHONE = '5491124843094'
const VENTANA_RESPUESTA_MANUAL_MS = 5 * 60 * 1000
// Fix B: debounce subido de 3.5s → 6s para dar más margen a mensajes rápidos consecutivos
const DEBOUNCE_MS = 6000
// Fix A: el lock expira en 25s (margen sobre maxDuration=30s)
const LOCK_TTL_MS = 25_000

const WASSENGER_MESSAGES_URL = 'https://api.wassenger.com/v1/messages'

async function enviarWassengerYGuardar(
  supabase: ReturnType<typeof createSupabaseServer>,
  telefono: string,
  leadId: string,
  texto: string,
  senderId?: string | null
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
    sender_id: senderId ?? null,
  })
}

/**
 * Fix A — Adquirir lock por conversación.
 * Usa un UPDATE condicional en Supabase (atómico a nivel de fila en PostgreSQL).
 * Si dos webhooks del mismo lead corren en paralelo, solo uno adquiere el lock.
 * Requiere columna `procesando_hasta TIMESTAMPTZ` en tabla `leads`.
 */
async function adquirirLock(
  supabase: ReturnType<typeof createSupabaseServer>,
  leadId: string
): Promise<boolean> {
  const ahora = new Date().toISOString()
  const expiracion = new Date(Date.now() + LOCK_TTL_MS).toISOString()

  const { data } = await supabase
    .from('leads')
    .update({ procesando_hasta: expiracion })
    .eq('id', leadId)
    .or(`procesando_hasta.is.null,procesando_hasta.lt.${ahora}`)
    .select('id')
    .maybeSingle()

  return data !== null
}

async function liberarLock(
  supabase: ReturnType<typeof createSupabaseServer>,
  leadId: string
): Promise<void> {
  await supabase.from('leads').update({ procesando_hasta: null }).eq('id', leadId)
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

  const { data: senderWassenger } = await supabase
    .from('senders')
    .select('id')
    .eq('provider', 'wassenger')
    .eq('activo', true)
    .limit(1)
    .maybeSingle()

  const senderId = senderWassenger?.id ?? null

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
    // Si el primer mensaje que llega parece un auto-reply de negocio, es porque
    // Manuel inició la conversación desde su programa de leads y esto es la respuesta
    // automática del contacto. Marcarlo como outbound para que el agente lo trate correctamente.
    const origenDetectado = pareceMensajeAutomaticoNegocio(mensaje) ? 'outbound' : 'inbound'
    const { data: nuevoLead } = await supabase
      .from('leads')
      .insert({
        nombre: `Lead ${telefono.slice(-4)}`,
        rubro: 'Por definir',
        zona: 'Por definir',
        telefono,
        descripcion: origenDetectado === 'outbound'
          ? 'Lead outbound — auto-reply de negocio detectado'
          : 'Lead entrante desde WhatsApp',
        mensaje_inicial: '',
        estado: 'respondio',
        origen: origenDetectado,
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
      sender_id: senderId,
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
      await enviarWassengerYGuardar(supabase, telefono, lead.id, respAudio, senderId)
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

  // Fix B: debounce de 6s para agrupar mensajes consecutivos del mismo usuario
  await new Promise<void>(resolve => setTimeout(resolve, DEBOUNCE_MS))

  // Si llegó un mensaje más nuevo durante el debounce, ese webhook se encarga
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
      return NextResponse.json({ ok: true, skipped: true, motivo: 'debounce' })
    }
  }

  // Fix A: adquirir lock antes de llamar a Claude
  // Evita que retries de Wassenger o webhooks paralelos generen respuestas duplicadas
  const lockAdquirido = await adquirirLock(supabase, lead.id)
  if (!lockAdquirido) {
    console.log('[Wassenger] Lock no disponible para lead', lead.id, '— skipping')
    return NextResponse.json({ ok: true, skipped: true, motivo: 'procesando_lock' })
  }

  try {
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
        await enviarWassengerYGuardar(supabase, telefono, lead.id, microAck, senderId)
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
        await enviarWassengerYGuardar(supabase, telefono, lead.id, handoffMsg, senderId)
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

    if (decision.action === 'confirm_close') {
      const closeMsg = 'Genial. Te escribe alguien del equipo a la brevedad para coordinar los detalles.'
      try {
        await enviarWassengerYGuardar(supabase, telefono, lead.id, closeMsg, senderId)
        await supabase
          .from('leads')
          .update({
            estado: 'interesado',
            conversacion_cerrada: true,
            conversacion_cerrada_at: new Date().toISOString(),
          })
          .eq('id', lead.id)
        await registrarEventoConversacional({
          leadId: lead.id,
          telefono,
          eventName: 'confirm_close_sent',
          decisionAction: decision.action,
          decisionReason: decision.reason,
          confidence: decision.confidence,
        })
      } catch (e) {
        console.error('Wassenger confirm_close error:', e)
        return NextResponse.json({ ok: false, error: 'wassenger_error' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, agente: true, tipo: 'confirm_close' })
    }

    if (decision.action === 'gatekeeper_relay') {
      try {
        await enviarWassengerYGuardar(supabase, telefono, lead.id, RESPUESTA_GATEKEEPER, senderId)
        await registrarEventoConversacional({
          leadId: lead.id,
          telefono,
          eventName: 'gatekeeper_relay_sent',
          decisionAction: decision.action,
          decisionReason: decision.reason,
          confidence: decision.confidence,
        })
      } catch (e) {
        console.error('Wassenger gatekeeper_relay error:', e)
        return NextResponse.json({ ok: false, error: 'wassenger_error' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, agente: true, tipo: 'gatekeeper_relay' })
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      console.error('Falta ANTHROPIC_API_KEY')
      return NextResponse.json({ ok: false, error: 'config' }, { status: 500 })
    }

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

    // Fix F: cargar historial para construir el array messages[] de la API de Claude
    const { data: historial } = await supabase
      .from('conversaciones')
      .select('rol, mensaje, timestamp')
      .eq('lead_id', lead.id)
      .order('timestamp', { ascending: true })
      .limit(40)

    const filasHistorial = historial ?? []

    // Detectar respuesta automática del negocio (WhatsApp Business) en outbound temprano
    const cantidadMensajesAgente = filasHistorial.filter(h => h.rol === 'agente').length
    const esAutoMensajeNegocio =
      lead.origen === 'outbound' &&
      cantidadMensajesAgente <= 1 &&
      pareceMensajeAutomaticoNegocio(mensajeCombinado)

    if (esAutoMensajeNegocio) {
      console.log('[Wassenger] Outbound: mensaje del cliente parece respuesta automática del negocio')
      await enviarWassengerYGuardar(supabase, telefono, lead.id, RESPUESTA_OUTBOUND_TRAS_AUTOMATICO, senderId)
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

    // Fix C: detectar eco (el cliente pegó texto del bot con algo nuevo al final)
    const ultimosMensajesAgente = filasHistorial
      .filter(h => h.rol === 'agente')
      .slice(-3)
      .reverse()
      .map(h => h.mensaje)
      .filter(Boolean) as string[]

    const resultadoEco = extraerContenidoNuevo(mensajeCombinado, ultimosMensajesAgente)
    if (resultadoEco.eraEco) {
      console.log('[Wassenger] Eco detectado. Texto extraído:', resultadoEco.texto || '(vacío)')
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono,
        eventName: 'echo_detected',
        decisionAction: 'full_reply',
        decisionReason: 'echo_stripped',
        confidence: 0.9,
        metadata: { textoCrudo: mensajeCombinado.slice(0, 100) },
      })
      if (!resultadoEco.texto) {
        // El cliente solo pegó el texto del bot sin agregar nada — no responder
        return NextResponse.json({ ok: true, skipped: true, motivo: 'eco_sin_contenido_nuevo' })
      }
    }
    const mensajeEfectivo = resultadoEco.eraEco ? resultadoEco.texto : mensajeCombinado

    const contextoLead = {
      nombre: String(lead.nombre ?? ''),
      rubro: String(lead.rubro ?? ''),
      zona: String(lead.zona ?? ''),
      descripcion: lead.descripcion as string | null | undefined,
      mensajeInicial: lead.mensaje_inicial as string | null | undefined,
    }

    // Fix F: system prompt SIN historial en texto — el historial va como messages[]
    const systemPrompt = buildAgentPrompt(
      lead.origen as 'outbound' | 'inbound',
      apexInfoTexto,
      '', // historial vacío → no se inyecta en el system prompt
      contextoLead
    )

    const userContent = buildUserMessageWithLeadContext(mensajeEfectivo, contextoLead)

    // Fix F: construir array messages[] con el historial real de la conversación
    // Excluir los mensajes pendientes del turno actual (ya están en userContent)
    const historialPrevio = filasHistorial.filter(h => {
      if (h.rol === 'cliente' && h.timestamp > desdeUltimoAgente) return false
      return true
    })

    // Convertir a formato Anthropic, fusionando mensajes consecutivos del mismo rol
    const mensajesHistorial: Anthropic.MessageParam[] = []
    for (const h of historialPrevio) {
      const role: 'user' | 'assistant' = h.rol === 'agente' ? 'assistant' : 'user'
      const last = mensajesHistorial[mensajesHistorial.length - 1]
      if (last && last.role === role) {
        last.content = (last.content as string) + '\n' + h.mensaje
      } else {
        mensajesHistorial.push({ role, content: h.mensaje as string })
      }
    }

    // La API de Claude requiere que el primer mensaje sea 'user'
    while (mensajesHistorial.length > 0 && mensajesHistorial[0].role === 'assistant') {
      mensajesHistorial.shift()
    }

    // Agregar el mensaje actual del cliente como último turno
    const mensajesCompletos: Anthropic.MessageParam[] = [
      ...mensajesHistorial,
      { role: 'user', content: userContent },
    ]

    const client = new Anthropic({ apiKey: anthropicKey })

    // En estado de conversación cerrada: parámetros más restrictivos para evitar over-engagement
    const isClosingState = lead.conversacion_cerrada === true
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: isClosingState ? 60 : 500,
      ...(isClosingState && { temperature: 0.2 }),
      system: systemPrompt,
      messages: mensajesCompletos,
      tools: [END_CONVERSATION_TOOL],
      tool_choice: { type: 'auto' },
    })

    // Extraer la respuesta considerando el caso de tool_use (end_conversation)
    let respuestaRaw: string
    let dealClosedByTool = false

    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      )
      if (toolUse?.name === 'end_conversation') {
        const input = toolUse.input as { final_message: string; reason: string }
        respuestaRaw = input.final_message ?? ''
        dealClosedByTool = true
        if (input.reason === 'deal_closed') {
          await supabase
            .from('leads')
            .update({
              estado: 'cerrado',
              conversacion_cerrada: true,
              conversacion_cerrada_at: new Date().toISOString(),
            })
            .eq('id', lead.id)
        } else if (input.reason === 'goodbye') {
          await supabase
            .from('leads')
            .update({
              conversacion_cerrada: true,
              conversacion_cerrada_at: new Date().toISOString(),
            })
            .eq('id', lead.id)
        }
      } else {
        respuestaRaw = ''
      }
    } else {
      respuestaRaw = response.content[0]?.type === 'text' ? response.content[0].text : ''
    }

    // Guardrail post-generación: si está en estado de cierre y el modelo igual preguntó algo,
    // reemplazar con template estático para no reabrir la conversación
    if (isClosingState && !dealClosedByTool && respuestaRaw.includes('?')) {
      respuestaRaw = 'Cualquier cosa por acá estamos.'
    }

    let chequeo: ReturnType<typeof auditarCoherenciaRubro>

    if (dealClosedByTool) {
      // Mensajes de cierre por tool: confiar en el modelo, solo sanitizar
      chequeo = { texto: respuestaRaw, verticalLead: 'generico' as const, intrusa: null, ok: true }
    } else {
      chequeo = auditarCoherenciaRubro(
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
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            ...mensajesCompletos,
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
    } // end else (not dealClosedByTool)

    let respuesta = sanitizarRespuestaModelo(chequeo.texto)

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

    // Continuation guard: si hay mensajes previos del agente, este NO es el primer
    // contacto; prohibir re-presentación / saludo. Si el modelo dejó pasar uno, intentar
    // repararlo sacando la primera oración. Si no se puede reparar, loguear y enviar
    // igual para no romper el flujo (el problema se mitigará con las iteraciones
    // futuras del prompt).
    if (!dealClosedByTool) {
      const huboMensajeAgentePrevio = filasHistorial.some(h => h.rol === 'agente')
      if (huboMensajeAgentePrevio) {
        const guard = validateContinuationMessage(respuesta)
        if (!guard.ok) {
          const reparado = stripContinuationViolations(respuesta)
          await registrarEventoConversacional({
            leadId: lead.id,
            telefono,
            eventName: reparado ? 'continuation_guard_stripped' : 'continuation_guard_failed',
            decisionAction: 'full_reply',
            decisionReason: decision.reason,
            confidence: decision.confidence,
            metadata: {
              violations: guard.violations.map(v => v.rule),
              originalLength: respuesta.length,
              repairedLength: reparado?.length ?? 0,
            },
          })
          if (reparado) {
            respuesta = reparado
            console.warn(
              '[Wassenger] Continuation guard disparó — mensaje reparado:',
              guard.violations.map(v => v.rule).join(',')
            )
          } else {
            console.error(
              '[Wassenger] Continuation guard disparó — no se pudo reparar; enviando original:',
              guard.violations.map(v => v.rule).join(',')
            )
          }
        }
      }
    }

    console.log('[Wassenger] Agente generó respuesta, enviando...')
    await enviarWassengerYGuardar(supabase, telefono, lead.id, respuesta, senderId)
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
  } finally {
    // Fix A: liberar el lock siempre, haya habido error o no
    await liberarLock(supabase, lead.id)
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
