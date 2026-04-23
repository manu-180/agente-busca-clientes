import Anthropic from '@anthropic-ai/sdk'
import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt, buildUserMessageWithLeadContext } from '@/lib/prompts'
import {
  clienteYaMandoAlgoNoAutomatico,
  esAutoReplyCortoNegocio,
  esPlantillaRespuestaOutboundAuto,
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
import { extraerContenidoNuevo } from '@/lib/echo-detection'
import {
  stripContinuationViolations,
  validateContinuationMessage,
} from '@/lib/message-guards'
import { enviarMensajeTwilio } from '@/lib/twilio'
import { normalizarTelefonoArg, soloDigitos, variantesTelefonoMismaLinea } from '@/lib/phone'
import { debePersistirBocetoAceptado } from '@/lib/boceto-aceptacion'

export const maxDuration = 30

// Twilio espera TwiML (XML) como respuesta, no JSON.
// Devolvemos <Response/> vacío — el mensaje real se envía por la REST API.
function twimlOk() {
  return new Response('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

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

const VENTANA_RESPUESTA_MANUAL_MS = 5 * 60 * 1000
const DEBOUNCE_MS = 6000
const LOCK_TTL_MS = 35_000

async function enviarTwilioYGuardar(
  supabase: ReturnType<typeof createSupabaseServer>,
  telefono: string,
  leadId: string,
  texto: string,
  senderPhone?: string,
  senderId?: string | null
) {
  await enviarMensajeTwilio(telefono, texto, senderPhone, { skipBlockCheck: true })

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

function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const sortedKeys = Object.keys(params).sort()
  const paramString = sortedKeys.map(k => k + params[k]).join('')
  const hmac = createHmac('sha1', authToken).update(url + paramString).digest('base64')
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch (error) {
    console.error('[Twilio Webhook] Error parsing form data:', error)
    return twimlOk()
  }

  if (process.env.NODE_ENV === 'production') {
    const twilioSignature = req.headers.get('x-twilio-signature') ?? ''
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''
    const url = req.url
    const params: Record<string, string> = {}
    form.forEach((value, key) => { params[key] = String(value) })
    if (!twilioSignature || !verifyTwilioSignature(authToken, twilioSignature, url, params)) {
      return new Response('<Response/>', { status: 403, headers: { 'Content-Type': 'text/xml' } })
    }
  }

  const rawFrom = form.get('From') as string | null
  const rawTo = form.get('To') as string | null
  const mensaje = (form.get('Body') as string | null) ?? ''
  const numMedia = parseInt((form.get('NumMedia') as string | null) ?? '0', 10)
  const mediaContentType = (form.get('MediaContentType0') as string | null) ?? ''
  const mediaUrl0 = (form.get('MediaUrl0') as string | null)?.trim() ?? ''

  // Twilio format: "whatsapp:+5491124843094" → "5491124843094"
  // Ambos se normalizan sin "+": así el lookup en senders siempre coincide
  // independientemente de si phone_number en DB tiene o no el prefijo "+".
  const telefono = rawFrom?.replace('whatsapp:', '').replace(/^\+/, '') ?? ''
  const nuestroNumero = rawTo?.replace('whatsapp:', '').replace(/^\+/, '') ?? process.env.TWILIO_WHATSAPP_NUMBER!

  console.log('[Twilio Webhook] From:', telefono, 'To:', nuestroNumero, 'Body:', mensaje.slice(0, 80))

  if (!telefono) {
    return twimlOk()
  }

  const supabase = createSupabaseServer()

  // Lookup sender — también usamos para filtrar mensajes propios
  const { data: senderData } = await supabase
    .from('senders')
    .select('id, alias, phone_number, activo')
    .eq('provider', 'twilio')
    .eq('phone_number', nuestroNumero)
    .maybeSingle()

  const senderId = senderData?.id ?? null
  const senderPhone = senderData?.phone_number ?? nuestroNumero

  // Solo ignorar eco real (mismo remitente y destino en dígitos) — no bloquear
  // campañas de prueba entre dos líneas WABA distintas registradas en senders.
  const fromD = soloDigitos(telefono)
  const toD = soloDigitos(nuestroNumero)
  if (fromD && toD && fromD === toD) {
    console.log('[Twilio Webhook] Ignorado — From y To idénticos (eco):', fromD)
    return twimlOk()
  }

  // Detectar tipo de mensaje
  let tipoMensaje: 'texto' | 'audio' | 'imagen' | 'otro' = 'texto'
  if (numMedia > 0) {
    if (mediaContentType.startsWith('audio/') || mediaContentType === 'audio/ogg') {
      tipoMensaje = 'audio'
    } else if (mediaContentType.startsWith('image/')) {
      tipoMensaje = 'imagen'
    } else {
      tipoMensaje = 'otro'
    }
  }

  const telsMismaLinea = variantesTelefonoMismaLinea(telefono)
  const { data: candsMismaLinea } = await supabase
    .from('leads')
    .select('*')
    .in('telefono', telsMismaLinea)

  let lead = candsMismaLinea?.length
    ? [...candsMismaLinea].sort((a, b) => {
        if (a.mensaje_enviado && !b.mensaje_enviado) return -1
        if (!a.mensaje_enviado && b.mensaje_enviado) return 1
        if (a.origen === 'outbound' && b.origen !== 'outbound') return -1
        if (a.origen !== 'outbound' && b.origen === 'outbound') return 1
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })[0]
    : null

  if (!lead) {
    const origenDetectado = pareceMensajeAutomaticoNegocio(mensaje) ? 'outbound' : 'inbound'
    const telefonoCanonica = normalizarTelefonoArg(telefono)
    const { data: nuevoLead } = await supabase
      .from('leads')
      .insert({
        nombre: `Lead ${telefono.slice(-4)}`,
        rubro: 'Por definir',
        zona: 'Por definir',
        telefono: telefonoCanonica,
        descripcion:
          origenDetectado === 'outbound'
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
    console.error('[Twilio] No se pudo crear/encontrar lead')
    return twimlOk()
  }

  // Anclar el sender al lead si todavía no tiene uno asignado.
  // Esto garantiza que todas las respuestas futuras salgan por el mismo canal.
  if (senderId && !lead.sender_id) {
    await supabase.from('leads').update({ sender_id: senderId }).eq('id', lead.id)
    lead = { ...lead, sender_id: senderId }
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
      media_url: numMedia > 0 && mediaUrl0 ? mediaUrl0 : null,
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
    return twimlOk()
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
    return twimlOk()
  }

  // Imagen/audio: se muestran en Inbox (media_url + proxy). No respondemos con el agente
  // (evita alucinar sin visión) ni enviamos un fallback automático al cliente.
  if (tipoMensaje !== 'texto') {
    return twimlOk()
  }

  // Debounce 6s para agrupar mensajes consecutivos
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
      return twimlOk()
    }
  }

  const lockAdquirido = await adquirirLock(supabase, lead.id)
  if (!lockAdquirido) {
    console.log('[Twilio] Lock no disponible para lead', lead.id, '— skipping')
    return twimlOk()
  }

  try {
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

    const { data: historialRows } = await supabase
      .from('conversaciones')
      .select('rol, mensaje, timestamp')
      .eq('lead_id', lead.id)
      .order('timestamp', { ascending: true })
      .limit(60)

    const filasHistorial = historialRows ?? []

    // Outbound sin mensaje "humano" real: un solo mensaje nuestro extra (plantilla + 1 respuesta).
    // Evita 5–10 pitches LLM cuando WA Business manda burbujas con "?" o menús en trozos.
    const outboundSinHumanoReal =
      lead.origen === 'outbound' && !clienteYaMandoAlgoNoAutomatico(filasHistorial)

    if (outboundSinHumanoReal) {
      const mensajesAgente = filasHistorial.filter(h => h.rol === 'agente')
      const mensajesAgentePitch = mensajesAgente.filter(
        h => !esPlantillaRespuestaOutboundAuto(h.mensaje as string | null | undefined)
      )
      if (mensajesAgentePitch.length >= 2) {
        await registrarEventoConversacional({
          leadId: lead.id,
          telefono,
          eventName: 'outbound_cap_sin_humano',
          decisionAction: 'no_reply',
          decisionReason: 'default_full_reply',
          confidence: 1,
          metadata: {
            motivo: 'max_mensajes_agente_sin_cliente_real',
            n_agente: mensajesAgente.length,
            n_pitch: mensajesAgentePitch.length,
          },
        })
        return twimlOk()
      }

      const esAutoCliente =
        pareceMensajeAutomaticoNegocio(mensajeCombinado) || esAutoReplyCortoNegocio(mensajeCombinado)
      if (esAutoCliente) {
        const yaMandoRespuestaFija = mensajesAgente.some(m =>
          esPlantillaRespuestaOutboundAuto(m.mensaje as string | null | undefined)
        )
        if (yaMandoRespuestaFija) {
          return twimlOk()
        }
        try {
          await enviarTwilioYGuardar(
            supabase,
            telefono,
            lead.id,
            RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
            senderPhone,
            senderId
          )
          await registrarEventoConversacional({
            leadId: lead.id,
            telefono,
            eventName: 'outbound_auto_business_reply_early',
            decisionAction: 'full_reply',
            decisionReason: 'default_full_reply',
            confidence: 1,
            metadata: { source: 'twilio_webhook_pre_decision' },
          })
        } catch (e) {
          console.error('[Twilio] outbound auto early error:', e)
        }
        return twimlOk()
      }
    }

    const configConversacional = await obtenerConfigConversacional()
    // Incluir agente+cliente: isCommitToProposal necesita el último mensaje del agente.
    const historialParaDecision = filasHistorial.map(h => ({
      rol: h.rol as 'agente' | 'cliente',
      mensaje: h.mensaje,
    }))
    const decision = decidirRespuestaConversacional({
      message: mensajeCombinado,
      history: historialParaDecision,
      config: configConversacional,
    })

    await registrarEventoConversacional({
      leadId: lead.id,
      telefono,
      eventName: decision.eventName,
      decisionAction: decision.action,
      decisionReason: decision.reason,
      confidence: decision.confidence,
      metadata: { origen: lead.origen, tipo_mensaje: tipoMensaje },
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
      return twimlOk()
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

    const comboAutoCliente =
      pareceMensajeAutomaticoNegocio(mensajeCombinado) || esAutoReplyCortoNegocio(mensajeCombinado)
    if (
      lead.origen === 'outbound' &&
      !clienteYaMandoAlgoNoAutomatico(filasHistorial) &&
      comboAutoCliente &&
      !decision.disableAgent &&
      !decision.closeConversation &&
      decision.action === 'no_reply'
    ) {
      const mensajesAgenteLista = filasHistorial.filter(h => h.rol === 'agente')
      const yaMandoPlantillaTwilio = mensajesAgenteLista.some(m =>
        esPlantillaRespuestaOutboundAuto(m.mensaje as string | null | undefined)
      )
      if (!yaMandoPlantillaTwilio) {
        try {
          await enviarTwilioYGuardar(
            supabase,
            telefono,
            lead.id,
            RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
            senderPhone,
            senderId
          )
          await registrarEventoConversacional({
            leadId: lead.id,
            telefono,
            eventName: 'outbound_auto_business_reply_decision_override',
            decisionAction: 'full_reply',
            decisionReason: decision.reason,
            confidence: decision.confidence,
            metadata: { source: 'twilio_webhook', prev_action: 'no_reply' },
          })
        } catch (e) {
          console.error('[Twilio] outbound auto override error:', e)
        }
        return twimlOk()
      }
    }

    if (decision.action === 'no_reply' || decision.action === 'close_conversation') {
      return twimlOk()
    }

    if (decision.action === 'micro_ack') {
      const microAck = 'Gracias por el mensaje. Si querés, te paso el siguiente paso en 1 línea.'
      try {
        await enviarTwilioYGuardar(supabase, telefono, lead.id, microAck, senderPhone, senderId)
      } catch (e) {
        console.error('[Twilio] micro_ack error:', e)
      }
      return twimlOk()
    }

    if (decision.action === 'handoff_human') {
      const handoffMsg =
        'Perfecto. Te deriva una persona del equipo de APEX para seguir esto con vos. Si querés, te toman el caso por acá.'
      try {
        await enviarTwilioYGuardar(supabase, telefono, lead.id, handoffMsg, senderPhone, senderId)
      } catch (e) {
        console.error('[Twilio] handoff error:', e)
      }
      return twimlOk()
    }

    if (decision.action === 'confirm_close') {
      const closeMsg = 'Genial. Te escribe alguien del equipo a la brevedad para coordinar los detalles.'
      const ultAgent = [...filasHistorial].reverse().find(h => h.rol === 'agente')?.mensaje
      const marcarBoceto = debePersistirBocetoAceptado(decision.eventName, ultAgent)
      const ahora = new Date().toISOString()
      try {
        await enviarTwilioYGuardar(supabase, telefono, lead.id, closeMsg, senderPhone, senderId)
        await supabase
          .from('leads')
          .update({
            estado: 'interesado',
            conversacion_cerrada: true,
            conversacion_cerrada_at: ahora,
            ...(marcarBoceto
              ? { boceto_aceptado: true, boceto_aceptado_at: ahora }
              : {}),
          })
          .eq('id', lead.id)
      } catch (e) {
        console.error('[Twilio] confirm_close error:', e)
      }
      return twimlOk()
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      console.error('[Twilio] Falta ANTHROPIC_API_KEY')
      return twimlOk()
    }

    const [{ data: apexInfo }, { data: demosActivos }] = await Promise.all([
      supabase.from('apex_info').select('categoria, titulo, contenido').eq('activo', true),
      supabase.from('demos_rubro').select('url, strong_keywords').eq('active', true),
    ])

    const verticalLead = detectarVertical(
      String(lead.rubro ?? ''),
      lead.descripcion as string | null | undefined
    )

    // Buscar demo que matchee el rubro del lead
    const rubroNorm = String(lead.rubro ?? '').toLowerCase()
    const demoMatch = (demosActivos ?? []).find(d =>
      (d.strong_keywords as string[]).some(kw => rubroNorm.includes(kw.toLowerCase().trim()))
    )
    const demoBloque = demoMatch
      ? `[DEMO] Demo de sitio web para mostrar al cliente\nURL: ${demoMatch.url}\nUsá esta URL cuando el cliente quiera ver un ejemplo o pida la demo. Mostrala de forma natural, sin forzar.`
      : ''

    const apexInfoTextoRaw = [
      ...(apexInfo ?? []).map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`),
      ...(demoBloque ? [demoBloque] : []),
    ].join('\n\n')

    const apexInfoSanitizado = sanitizarApexInfoPorVertical(apexInfoTextoRaw, verticalLead)
    const apexInfoTexto = apexInfoSanitizado.texto

    const ultimosMensajesAgente = filasHistorial
      .filter(h => h.rol === 'agente')
      .slice(-3)
      .reverse()
      .map(h => h.mensaje)
      .filter(Boolean) as string[]

    const resultadoEco = extraerContenidoNuevo(mensajeCombinado, ultimosMensajesAgente)
    if (resultadoEco.eraEco && !resultadoEco.texto) {
      return twimlOk()
    }
    const mensajeEfectivo = resultadoEco.eraEco ? resultadoEco.texto : mensajeCombinado

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
      '',
      contextoLead
    )
    const userContent = buildUserMessageWithLeadContext(mensajeEfectivo, contextoLead)

    const historialPrevio = filasHistorial.filter(h => {
      if (h.rol === 'cliente' && h.timestamp > desdeUltimoAgente) return false
      return true
    })

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

    while (mensajesHistorial.length > 0 && mensajesHistorial[0].role === 'assistant') {
      mensajesHistorial.shift()
    }

    const mensajesCompletos: Anthropic.MessageParam[] = [
      ...mensajesHistorial,
      { role: 'user', content: userContent },
    ]

    const client = new Anthropic({ apiKey: anthropicKey })

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

    if (isClosingState && !dealClosedByTool && respuestaRaw.includes('?')) {
      respuestaRaw = 'Cualquier cosa por acá estamos.'
    }

    let chequeo: ReturnType<typeof auditarCoherenciaRubro>

    if (dealClosedByTool) {
      chequeo = { texto: respuestaRaw, verticalLead: 'generico' as const, intrusa: null, ok: true }
    } else {
      chequeo = auditarCoherenciaRubro(
        respuestaRaw,
        String(lead.rubro ?? ''),
        lead.descripcion as string | null | undefined
      )

      if (chequeo.texto && chequeo.intrusa) {
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
          chequeo = retryChequeo.ok
            ? retryChequeo
            : {
                texto: fallbackSeguroPorVertical(chequeo.verticalLead, String(lead.nombre ?? '')),
                verticalLead: chequeo.verticalLead,
                intrusa: null,
                ok: true,
              }
        } catch {
          chequeo = {
            texto: fallbackSeguroPorVertical(chequeo.verticalLead, String(lead.nombre ?? '')),
            verticalLead: chequeo.verticalLead,
            intrusa: null,
            ok: true,
          }
        }
      }
    }

    let respuesta = sanitizarRespuestaModelo(chequeo.texto)

    if (!respuesta) {
      return twimlOk()
    }

    if (!dealClosedByTool) {
      const huboMensajeAgentePrevio = filasHistorial.some(h => h.rol === 'agente')
      if (huboMensajeAgentePrevio) {
        const guard = validateContinuationMessage(respuesta)
        if (!guard.ok) {
          const reparado = stripContinuationViolations(respuesta)
          if (reparado) respuesta = reparado
        }
      }
    }

    await enviarTwilioYGuardar(supabase, telefono, lead.id, respuesta, senderPhone, senderId)
    await registrarEventoConversacional({
      leadId: lead.id,
      telefono,
      eventName: 'full_reply_sent',
      decisionAction: 'full_reply',
      decisionReason: decision.reason,
      confidence: decision.confidence,
      metadata: { length: respuesta.length },
    })

    return twimlOk()
  } catch (error) {
    console.error('[Twilio] Error en agente:', error)
    return twimlOk()
  } finally {
    await liberarLock(supabase, lead.id)
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
