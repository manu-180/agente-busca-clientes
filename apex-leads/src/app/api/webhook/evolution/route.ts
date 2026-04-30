import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt, buildUserMessageWithLeadContext } from '@/lib/prompts'
import {
  clienteYaMandoAlgoNoAutomatico,
  esAutoReplyCortoNegocio,
  esPlantillaRespuestaOutboundAuto,
  pareceMensajeAutomaticoNegocio,
  RESPUESTA_BUSINESS_CLOSED,
  RESPUESTA_FAMILY_RELAY,
  RESPUESTA_GATEKEEPER,
  RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
  RESPUESTA_SUSPICION,
  RESPUESTA_WRONG_TARGET,
} from '@/lib/outbound-auto-reply'
import { decidirRespuestaConversacional } from '@/lib/response-decision'
import { obtenerConfigConversacional } from '@/lib/conversation-config'
import { registrarEventoConversacional } from '@/lib/conversation-events'
import {
  auditarCoherenciaRubro,
  detectarBocetoBombing,
  fallbackPostBocetoBombing,
  fallbackSeguroPorVertical,
  instruccionRegeneracion,
  sanitizarRespuestaModelo,
} from '@/lib/response-guardrails'
import { detectarVertical, sanitizarApexInfoPorVertical } from '@/lib/verticales'
import { ANTHROPIC_CHAT_MODEL } from '@/lib/anthropic-model'
import { extraerContenidoNuevo } from '@/lib/echo-detection'
import {
  stripContinuationViolations,
  validateContinuationMessage,
} from '@/lib/message-guards'
import { enviarMensajeEvolution } from '@/lib/evolution'
import { markConnected, markDisconnected } from '@/lib/sender-pool'
import { fetchPhoneNumber } from '@/lib/evolution-instance'
import { normalizarTelefonoArg, soloDigitos, variantesTelefonoMismaLinea } from '@/lib/phone'
import { debePersistirBocetoAceptado } from '@/lib/boceto-aceptacion'
import { MENSAJE_COMPROMISO_BOCETO_24H } from '@/lib/mensaje-boceto-24h'
import { estaEnVentanaPrimerContacto, getHoraArgentina } from '@/lib/first-contact-window'

// maxDuration = 30s → da margen para el background tras devolver 200
export const maxDuration = 30

const VENTANA_RESPUESTA_MANUAL_MS = 5 * 60 * 1000
const DEBOUNCE_MS = 4000
const LOCK_TTL_MS = 35_000
const FALLBACK_CUANDO_CLAUDE_FALLA = 'Gracias por tu mensaje. Te respondemos a la brevedad.'

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

// ─── Evolution API payload types ──────────────────────────────────────────────

interface EvolutionMessageKey {
  remoteJid: string
  fromMe: boolean
  id: string
}

interface EvolutionMessageContent {
  conversation?: string
  extendedTextMessage?: { text?: string }
  imageMessage?: { caption?: string; mimetype?: string }
  audioMessage?: { mimetype?: string; ptt?: boolean }
  videoMessage?: { caption?: string }
  documentMessage?: { title?: string }
}

interface EvolutionMessageData {
  key: EvolutionMessageKey
  message?: EvolutionMessageContent
  messageType?: string
  messageTimestamp?: number
  pushName?: string
}

interface EvolutionStatusUpdate {
  key: EvolutionMessageKey
  update: { status?: number }
}

interface EvolutionConnectionUpdate {
  /** Estado actual de la sesión Multi-Device. */
  state?: 'open' | 'close' | 'connecting' | string
  /**
   * Status code emitido por Baileys cuando la conexión cae:
   *   401 → device_removed (cuenta eliminada en el celular).
   *   409 → conflict (otra sesión Multi-Device tomó el lugar).
   *   408 → timeout.
   *   500 → unavailable.
   */
  statusReason?: number
  /** A veces viene como `lastDisconnect.error.output.statusCode`. */
  lastDisconnect?: {
    error?: { output?: { statusCode?: number } }
  }
  /** Algunos builds de Evolution emiten el estado bajo `connection`. */
  connection?: 'open' | 'close' | 'connecting' | string
  /** Número que quedó vinculado (en `state=open`). */
  wuid?: string
}

interface EvolutionWebhookPayload {
  event: string
  instance: string
  data:
    | EvolutionMessageData
    | EvolutionStatusUpdate
    | EvolutionStatusUpdate[]
    | EvolutionConnectionUpdate
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPhoneFromJid(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '').replace(/^\+/, '')
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

function extractMessageText(msg: EvolutionMessageContent | undefined): string {
  if (!msg) return ''
  if (msg.conversation) return msg.conversation
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text
  if (msg.imageMessage?.caption) return msg.imageMessage.caption
  if (msg.videoMessage?.caption) return msg.videoMessage.caption
  return ''
}

function detectarTipoMensaje(messageType: string | undefined): 'texto' | 'audio' | 'imagen' | 'otro' {
  switch (messageType) {
    case 'conversation':
    case 'extendedTextMessage':
      return 'texto'
    case 'audioMessage':
      return 'audio'
    case 'imageMessage':
      return 'imagen'
    default:
      return messageType ? 'otro' : 'texto'
  }
}

async function enviarEvolutionYGuardar(
  supabase: ReturnType<typeof createSupabaseServer>,
  telefono: string,
  leadId: string,
  texto: string,
  instanceName: string,
  senderId?: string | null
) {
  const result = await enviarMensajeEvolution(telefono, texto, instanceName, { skipBlockCheck: true })
  await supabase.from('conversaciones').insert({
    lead_id: leadId,
    telefono,
    mensaje: texto,
    rol: 'agente',
    tipo_mensaje: 'texto',
    manual: false,
    sender_id: senderId ?? null,
    twilio_message_sid: result.messageId,
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

async function registrarErrorWebhook(
  supabase: ReturnType<typeof createSupabaseServer>,
  leadId: string,
  telefono: string,
  etapa: string,
  error: unknown
) {
  const msg = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '').slice(0, 800) : ''
  console.error(`[Evolution Webhook] ERROR en etapa "${etapa}":`, msg, stack)
  try {
    await registrarEventoConversacional({
      leadId,
      telefono,
      eventName: 'webhook_error',
      decisionAction: 'no_reply',
      decisionReason: 'empty',
      confidence: 0,
      metadata: { etapa, error: msg, stack },
    })
  } catch {
    // no bloquear si falla el log
  }
}

// ─── Parámetros para el procesamiento en background ───────────────────────────
interface BgParams {
  telefono: string
  instanceName: string
  mensaje: string
  tipoMensaje: 'texto' | 'audio' | 'imagen' | 'otro'
  leadId: string
  leadOrigen: string
  leadAgentActivo: boolean
  senderId: string | null
  miMsgTimestamp: string | undefined
}

// ─── Procesamiento pesado en background ───────────────────────────────────────
async function procesarEnBackground(p: BgParams): Promise<void> {
  const supabase = createSupabaseServer()

  if (p.tipoMensaje !== 'texto') {
    console.log('[BG] Media distinto de texto → sin respuesta automática')
    return
  }

  // ── 1. Verificar agente global ──
  const { data: configAgente } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'agente_activo')
    .single()

  const agenteGlobalOn = configAgente?.valor === 'true'
  const agenteLeadOn = p.leadAgentActivo

  if (!agenteGlobalOn || !agenteLeadOn) {
    console.log(`[BG] Agente desactivado → global=${agenteGlobalOn} lead=${agenteLeadOn}`)
    return
  }

  // Bloquear auto-respuesta fuera de ventana horaria (9-18h ART)
  if (!estaEnVentanaPrimerContacto()) {
    console.log(`[BG] Fuera de ventana horaria (hora AR=${getHoraArgentina()}) → sin auto-respuesta`)
    return
  }

  // ── 2. ¿Hubo respuesta manual reciente? ──
  const desdeManual = new Date(Date.now() - VENTANA_RESPUESTA_MANUAL_MS).toISOString()
  const { data: recienteManual } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('lead_id', p.leadId)
    .eq('rol', 'agente')
    .eq('manual', true)
    .gte('timestamp', desdeManual)
    .limit(1)
    .maybeSingle()

  if (recienteManual) {
    console.log('[BG] Respuesta manual reciente → no intervenimos')
    return
  }

  // ── 3. Debounce: esperar y verificar si llegó otro mensaje ──
  await new Promise<void>(resolve => setTimeout(resolve, DEBOUNCE_MS))

  if (p.miMsgTimestamp) {
    const { data: msgPosterior } = await supabase
      .from('conversaciones')
      .select('id')
      .eq('lead_id', p.leadId)
      .eq('rol', 'cliente')
      .gt('timestamp', p.miMsgTimestamp)
      .limit(1)
      .maybeSingle()

    if (msgPosterior) {
      console.log('[BG] Llegó mensaje posterior durante debounce → dejamos al siguiente')
      return
    }
  }

  // ── 4. Lock para evitar respuestas dobles ──
  const lockAdquirido = await adquirirLock(supabase, p.leadId)
  if (!lockAdquirido) {
    console.warn('[BG] Lock no disponible para lead', p.leadId, '— skipping (posible race con cron)')
    registrarEventoConversacional({
      leadId: p.leadId,
      telefono: p.telefono,
      eventName: 'webhook_lock_bloqueado',
      decisionAction: 'no_reply',
      decisionReason: 'lock_no_disponible',
      confidence: 1,
      metadata: { mensaje: p.mensaje.slice(0, 100) },
    }).catch(() => {})
    return
  }

  try {
    await procesarConLock(supabase, p)
  } catch (error) {
    await registrarErrorWebhook(supabase, p.leadId, p.telefono, 'procesarConLock', error)
    try {
      await enviarEvolutionYGuardar(
        supabase,
        p.telefono,
        p.leadId,
        FALLBACK_CUANDO_CLAUDE_FALLA,
        p.instanceName,
        p.senderId
      )
      await registrarEventoConversacional({
        leadId: p.leadId,
        telefono: p.telefono,
        eventName: 'fallback_message_sent',
        decisionAction: 'full_reply',
        decisionReason: 'default_full_reply',
        confidence: 0,
        metadata: { motivo: 'claude_error_fallback' },
      })
    } catch (fallbackErr) {
      console.error('[BG] Falló incluso el fallback:', fallbackErr)
    }
  } finally {
    await liberarLock(supabase, p.leadId)
  }
}

async function procesarConLock(
  supabase: ReturnType<typeof createSupabaseServer>,
  p: BgParams
): Promise<void> {
  const { data: ultimoAgenteMensaje } = await supabase
    .from('conversaciones')
    .select('timestamp')
    .eq('lead_id', p.leadId)
    .eq('rol', 'agente')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  const desdeUltimoAgente = ultimoAgenteMensaje?.timestamp ?? '1970-01-01T00:00:00.000Z'

  const { data: pendientes } = await supabase
    .from('conversaciones')
    .select('mensaje')
    .eq('lead_id', p.leadId)
    .eq('rol', 'cliente')
    .eq('tipo_mensaje', 'texto')
    .gt('timestamp', desdeUltimoAgente)
    .order('timestamp', { ascending: true })

  const mensajeCombinado =
    (pendientes ?? [])
      .map(m => m.mensaje)
      .filter(Boolean)
      .join('\n') || p.mensaje

  const { data: historialRows } = await supabase
    .from('conversaciones')
    .select('rol, mensaje, timestamp')
    .eq('lead_id', p.leadId)
    .order('timestamp', { ascending: true })
    .limit(60)

  const filasHistorial = historialRows ?? []

  // ── Blindaje: outbound sin mensaje humano real ──
  const outboundSinHumanoReal =
    p.leadOrigen === 'outbound' && !clienteYaMandoAlgoNoAutomatico(filasHistorial)

  if (outboundSinHumanoReal) {
    const mensajesAgente = filasHistorial.filter(h => h.rol === 'agente')
    const mensajesAgentePitch = mensajesAgente.filter(
      h => !esPlantillaRespuestaOutboundAuto(h.mensaje as string | null | undefined)
    )

    console.log(
      `[BG] outboundSinHumanoReal → pitches=${mensajesAgentePitch.length} agente_msgs=${mensajesAgente.length}`
    )

    if (mensajesAgentePitch.length >= 2) {
      await registrarEventoConversacional({
        leadId: p.leadId,
        telefono: p.telefono,
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
      return
    }

    const esAutoCliente =
      pareceMensajeAutomaticoNegocio(mensajeCombinado) || esAutoReplyCortoNegocio(mensajeCombinado)

    console.log(`[BG] esAutoCliente=${esAutoCliente} mensaje="${mensajeCombinado.slice(0, 80)}"`)

    if (esAutoCliente) {
      const yaMandoRespuestaFija = mensajesAgente.some(m =>
        esPlantillaRespuestaOutboundAuto(m.mensaje as string | null | undefined)
      )
      if (yaMandoRespuestaFija) {
        console.log('[BG] Ya mandó respuesta fija → skip')
        return
      }
      await enviarEvolutionYGuardar(
        supabase,
        p.telefono,
        p.leadId,
        RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
        p.instanceName,
        p.senderId
      )
      await registrarEventoConversacional({
        leadId: p.leadId,
        telefono: p.telefono,
        eventName: 'outbound_auto_business_reply_early',
        decisionAction: 'full_reply',
        decisionReason: 'default_full_reply',
        confidence: 1,
        metadata: { source: 'evolution_webhook_bg' },
      })
      return
    }
  }

  // ── Motor de decisión ──
  const configConversacional = await obtenerConfigConversacional()
  const historialParaDecision = filasHistorial.map(h => ({
    rol: h.rol as 'agente' | 'cliente',
    mensaje: h.mensaje,
  }))
  const decision = decidirRespuestaConversacional({
    message: mensajeCombinado,
    history: historialParaDecision,
    config: configConversacional,
  })

  console.log(
    `[BG] Decision → action=${decision.action} reason=${decision.reason} confidence=${decision.confidence}`
  )

  await registrarEventoConversacional({
    leadId: p.leadId,
    telefono: p.telefono,
    eventName: decision.eventName,
    decisionAction: decision.action,
    decisionReason: decision.reason,
    confidence: decision.confidence,
    metadata: { origen: p.leadOrigen, tipo_mensaje: p.tipoMensaje },
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
      .eq('id', p.leadId)
    return
  }

  if (decision.closeConversation) {
    await supabase
      .from('leads')
      .update({
        conversacion_cerrada: true,
        conversacion_cerrada_at: new Date().toISOString(),
      })
      .eq('id', p.leadId)
  }

  // Override: auto-reply de negocio outbound que llegó después de la decisión
  const comboAutoCliente =
    pareceMensajeAutomaticoNegocio(mensajeCombinado) || esAutoReplyCortoNegocio(mensajeCombinado)
  if (
    p.leadOrigen === 'outbound' &&
    !clienteYaMandoAlgoNoAutomatico(filasHistorial) &&
    comboAutoCliente &&
    !decision.disableAgent &&
    !decision.closeConversation &&
    decision.action === 'no_reply'
  ) {
    const mensajesAgenteLista = filasHistorial.filter(h => h.rol === 'agente')
    const yaMandoPlantilla = mensajesAgenteLista.some(m =>
      esPlantillaRespuestaOutboundAuto(m.mensaje as string | null | undefined)
    )
    if (!yaMandoPlantilla) {
      await enviarEvolutionYGuardar(
        supabase,
        p.telefono,
        p.leadId,
        RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
        p.instanceName,
        p.senderId
      )
      await registrarEventoConversacional({
        leadId: p.leadId,
        telefono: p.telefono,
        eventName: 'outbound_auto_business_reply_decision_override',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        metadata: { source: 'evolution_webhook_bg', prev_action: 'no_reply' },
      })
      return
    }
  }

  if (decision.action === 'no_reply' || decision.action === 'close_conversation') return

  if (decision.action === 'micro_ack') {
    const microAck = 'Gracias por el mensaje. Si querés, te paso el siguiente paso en 1 línea.'
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, microAck, p.instanceName, p.senderId)
    return
  }

  if (decision.action === 'handoff_human') {
    const ahora = new Date().toISOString()
    await enviarEvolutionYGuardar(
      supabase,
      p.telefono,
      p.leadId,
      MENSAJE_COMPROMISO_BOCETO_24H,
      p.instanceName,
      p.senderId
    )
    await supabase
      .from('leads')
      .update({ boceto_prometido_24h: true, boceto_prometido_24h_at: ahora })
      .eq('id', p.leadId)
    await registrarEventoConversacional({
      leadId: p.leadId,
      telefono: p.telefono,
      eventName: 'handoff_human_sent',
      decisionAction: 'handoff_human',
      decisionReason: decision.reason,
      confidence: decision.confidence,
      metadata: { source: 'evolution_webhook_bg', boceto_24h: true },
    })
    return
  }

  if (decision.action === 'gatekeeper_relay') {
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, RESPUESTA_GATEKEEPER, p.instanceName, p.senderId)
    return
  }

  if (decision.action === 'apologize_wrong_target') {
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, RESPUESTA_WRONG_TARGET, p.instanceName, p.senderId)
    return
  }

  if (decision.action === 'apologize_business_closed') {
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, RESPUESTA_BUSINESS_CLOSED, p.instanceName, p.senderId)
    return
  }

  if (decision.action === 'family_relay') {
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, RESPUESTA_FAMILY_RELAY, p.instanceName, p.senderId)
    return
  }

  if (decision.action === 'explain_source') {
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, RESPUESTA_SUSPICION, p.instanceName, p.senderId)
    return
  }

  if (decision.action === 'confirm_close') {
    const closeMsg = 'Genial. Te escribe alguien del equipo a la brevedad para coordinar los detalles.'
    const ultAgent = [...filasHistorial].reverse().find(h => h.rol === 'agente')?.mensaje
    const marcarBoceto = debePersistirBocetoAceptado(decision.eventName, ultAgent)
    const ahora = new Date().toISOString()
    await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, closeMsg, p.instanceName, p.senderId)
    await supabase
      .from('leads')
      .update({
        estado: 'interesado',
        conversacion_cerrada: true,
        conversacion_cerrada_at: ahora,
        ...(marcarBoceto ? { boceto_aceptado: true, boceto_aceptado_at: ahora } : {}),
      })
      .eq('id', p.leadId)
    return
  }

  // ── Claude (full_reply) ──
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

  const [{ data: apexInfo }, { data: demosActivos }] = await Promise.all([
    supabase.from('apex_info').select('categoria, titulo, contenido').eq('activo', true),
    supabase.from('demos_rubro').select('url, strong_keywords').eq('active', true),
  ])

  const { data: leadActualizado } = await supabase
    .from('leads')
    .select('*')
    .eq('id', p.leadId)
    .single()

  const rubroLead = String(leadActualizado?.rubro ?? '')
  const descripcionLead = leadActualizado?.descripcion as string | null | undefined
  const nombreLead = String(leadActualizado?.nombre ?? '')
  const zonaLead = String(leadActualizado?.zona ?? '')
  const mensajeInicialLead = leadActualizado?.mensaje_inicial as string | null | undefined
  const isClosingState = leadActualizado?.conversacion_cerrada === true

  const verticalLead = detectarVertical(rubroLead, descripcionLead)

  const rubroNorm = rubroLead.toLowerCase()
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
    console.log('[BG] Eco detectado y sin contenido nuevo → skip')
    return
  }
  const mensajeEfectivo = resultadoEco.eraEco ? resultadoEco.texto : mensajeCombinado

  const contextoLead = {
    nombre: nombreLead,
    rubro: rubroLead,
    zona: zonaLead,
    descripcion: descripcionLead,
    mensajeInicial: mensajeInicialLead,
  }

  const systemPrompt = buildAgentPrompt(
    p.leadOrigen as 'outbound' | 'inbound',
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

  const response = await client.messages.create({
    model: ANTHROPIC_CHAT_MODEL,
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
          .eq('id', p.leadId)
      } else if (input.reason === 'goodbye') {
        await supabase
          .from('leads')
          .update({
            conversacion_cerrada: true,
            conversacion_cerrada_at: new Date().toISOString(),
          })
          .eq('id', p.leadId)
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
    chequeo = auditarCoherenciaRubro(respuestaRaw, rubroLead, descripcionLead)

    if (chequeo.texto && chequeo.intrusa) {
      const regenInstruccion = instruccionRegeneracion({
        verticalLead: chequeo.verticalLead,
        intrusa: chequeo.intrusa,
        textoAnterior: chequeo.texto,
        rubroLiteral: rubroLead,
        nombre: nombreLead,
      })

      try {
        const retry = await client.messages.create({
          model: ANTHROPIC_CHAT_MODEL,
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            ...mensajesCompletos,
            { role: 'assistant', content: chequeo.texto },
            { role: 'user', content: regenInstruccion },
          ],
        })
        const retryRaw = retry.content[0].type === 'text' ? retry.content[0].text : ''
        const retryChequeo = auditarCoherenciaRubro(retryRaw, rubroLead, descripcionLead)
        chequeo = retryChequeo.ok
          ? retryChequeo
          : {
              texto: fallbackSeguroPorVertical(chequeo.verticalLead, nombreLead),
              verticalLead: chequeo.verticalLead,
              intrusa: null,
              ok: true,
            }
      } catch {
        chequeo = {
          texto: fallbackSeguroPorVertical(chequeo.verticalLead, nombreLead),
          verticalLead: chequeo.verticalLead,
          intrusa: null,
          ok: true,
        }
      }
    }
  }

  if (!dealClosedByTool) {
    const bocetoCheck = detectarBocetoBombing(chequeo.texto, mensajeEfectivo)
    if (bocetoCheck.esBocetoBombing && bocetoCheck.marcadorUsuario) {
      console.warn('[BG] Boceto-bombing detectado → fallback.')
      await registrarEventoConversacional({
        leadId: p.leadId,
        telefono: p.telefono,
        eventName: 'boceto_bombing_intercepted',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        metadata: {
          source: 'evolution_webhook_bg',
          marcadorPitch: bocetoCheck.marcadorPitch,
          marcadorUsuario: bocetoCheck.marcadorUsuario,
        },
      })
      chequeo = {
        texto: fallbackPostBocetoBombing(bocetoCheck.marcadorUsuario),
        verticalLead: chequeo.verticalLead,
        intrusa: null,
        ok: true,
      }
    }
  }

  let respuesta = sanitizarRespuestaModelo(chequeo.texto)

  if (!respuesta) {
    console.log('[BG] Respuesta vacía tras guardrails → no enviamos')
    return
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

  await enviarEvolutionYGuardar(supabase, p.telefono, p.leadId, respuesta, p.instanceName, p.senderId)
  await registrarEventoConversacional({
    leadId: p.leadId,
    telefono: p.telefono,
    eventName: 'full_reply_sent',
    decisionAction: 'full_reply',
    decisionReason: decision.reason,
    confidence: decision.confidence,
    metadata: { length: respuesta.length, from_background: true },
  })

  console.log(`[BG] Respuesta enviada OK (${respuesta.length} chars) al lead ${p.leadId}`)
}

// ─── Handler principal ─────────────────────────────────────────────────────────
//
// CRÍTICO: este handler DEBE responder 200 lo más rápido posible (idealmente
// < 200 ms) y delegar todo el trabajo a `waitUntil`. Si tardamos > 10 s,
// Evolution interpreta "cliente caído" y mata la sesión Baileys ↔ WhatsApp,
// que fue exactamente la causa de la desconexión al primer envío de SIM 2.
//
// Garantías:
// - Siempre devolvemos 200 (incluso ante errores de auth o parse): un 5xx
//   gatilla retry storm en Evolution que también puede romper la sesión.
// - Auth failures se loguean pero no rechazan: confiamos en que sin payload
//   válido, el procesamiento BG no hace nada.
// - Todo el trabajo (lookup lead, insert msg, decisión, envío respuesta) corre
//   en `waitUntil` con catch global.
export async function POST(req: NextRequest) {
  // Auth: si falla, log + 200 silencioso (NO 401 — evita retry storm).
  const apiKey = req.headers.get('apikey') ?? ''
  if (process.env.NODE_ENV === 'production') {
    const expectedKey = process.env.EVOLUTION_API_KEY ?? ''
    if (!expectedKey || apiKey !== expectedKey) {
      console.warn('[Evolution Webhook] API key inválida — descartando payload')
      return NextResponse.json({ ok: true })
    }
  }

  let payload: EvolutionWebhookPayload
  try {
    payload = (await req.json()) as EvolutionWebhookPayload
  } catch {
    return NextResponse.json({ ok: true })
  }

  const { event, instance: instanceName, data } = payload

  // ── Despachar todo a background con waitUntil ──
  // El handler retorna 200 INMEDIATAMENTE y Vercel mantiene la lambda viva
  // hasta que termine el promise pasado a waitUntil (hasta maxDuration).
  if (event === 'messages.update') {
    const updates = Array.isArray(data)
      ? (data as EvolutionStatusUpdate[])
      : [data as EvolutionStatusUpdate]
    waitUntil(
      handleStatusUpdates(updates).catch(err =>
        console.error('[Evolution Webhook] handleStatusUpdates error:', err)
      )
    )
    return NextResponse.json({ ok: true })
  }

  if (
    event === 'connection.update' ||
    event === 'connection_update' ||
    event === 'CONNECTION_UPDATE'
  ) {
    waitUntil(
      handleConnectionUpdate(instanceName, data as EvolutionConnectionUpdate).catch(err =>
        console.error('[Evolution Webhook] handleConnectionUpdate error:', err)
      )
    )
    return NextResponse.json({ ok: true })
  }

  // Solo procesar messages.upsert
  if (event !== 'messages.upsert') {
    return NextResponse.json({ ok: true })
  }

  const msgData = data as EvolutionMessageData
  const { key, message, messageType } = msgData

  // Filtros baratos sync (no DB): ecos, grupos, JID inválido.
  if (key.fromMe) return NextResponse.json({ ok: true })
  const remoteJid = key.remoteJid ?? ''
  if (isGroupJid(remoteJid)) return NextResponse.json({ ok: true })
  const telefono = extractPhoneFromJid(remoteJid)
  if (!telefono) return NextResponse.json({ ok: true })

  const mensaje = extractMessageText(message)
  const tipoMensaje = detectarTipoMensaje(messageType)

  // Resto del trabajo (DB lookups, insert, decisión, envío respuesta) → BG.
  waitUntil(
    procesarMensajeEntrante({
      telefono,
      instanceName,
      mensaje,
      tipoMensaje,
      messageId: key.id,
    }).catch(err =>
      console.error('[Evolution Webhook] procesarMensajeEntrante error:', err)
    )
  )

  return NextResponse.json({ ok: true })
}

// ─── Procesamiento del mensaje entrante (todo en background) ──────────────────
interface ProcesarEntranteParams {
  telefono: string
  instanceName: string
  mensaje: string
  tipoMensaje: 'texto' | 'audio' | 'imagen' | 'otro'
  messageId: string
}

async function procesarMensajeEntrante(p: ProcesarEntranteParams): Promise<void> {
  const { telefono, instanceName, mensaje, tipoMensaje, messageId } = p

  console.log(
    `[Evolution Webhook BG] From: ${telefono} Instance: ${instanceName} Body: ${mensaje.slice(0, 80)}`
  )

  const supabase = createSupabaseServer()

  // Lookup sender por instance_name
  const { data: senderData } = await supabase
    .from('senders')
    .select('id, alias, phone_number, activo, instance_name')
    .eq('provider', 'evolution')
    .eq('instance_name', instanceName)
    .maybeSingle()

  const senderId = senderData?.id ?? null

  // Buscar lead
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
    console.error('[Evolution] No se pudo crear/encontrar lead')
    return
  }

  // Anclar sender al lead si corresponde
  if (senderId && !lead.sender_id) {
    await supabase.from('leads').update({ sender_id: senderId }).eq('id', lead.id)
    lead = { ...lead, sender_id: senderId }
  }

  // ── Guardar mensaje entrante en DB ──
  const mensajeGuardado = tipoMensaje !== 'texto'
    ? `[${tipoMensaje.toUpperCase()}] ${mensaje}`
    : mensaje

  const { data: insertadoMsg } = await supabase
    .from('conversaciones')
    .insert({
      lead_id: lead.id,
      telefono,
      mensaje: mensajeGuardado,
      rol: 'cliente',
      tipo_mensaje: tipoMensaje,
      leido: false,
      sender_id: senderId,
      media_url: null,
      twilio_message_sid: messageId,
    })
    .select('id, timestamp')
    .single()

  const miMsgTimestamp = (insertadoMsg as { timestamp?: string } | null)?.timestamp

  if (lead.estado === 'contactado' || lead.estado === 'pendiente') {
    await supabase.from('leads').update({ estado: 'respondio' }).eq('id', lead.id)
  }

  // ── Procesamiento conversacional + envío respuesta en background ──
  // Todo este bloque ya corre dentro del waitUntil del handler POST, así que
  // simplemente lo encadenamos aquí (no hace falta otro waitUntil anidado).
  const bgParams: BgParams = {
    telefono,
    instanceName,
    mensaje,
    tipoMensaje,
    leadId: lead.id,
    leadOrigen: lead.origen ?? 'outbound',
    leadAgentActivo: !!lead.agente_activo,
    senderId,
    miMsgTimestamp,
  }

  await procesarEnBackground(bgParams)
}

// ── Manejo de status updates ───────────────────────────────────────────────────
// Evolution API status codes: 0=ERROR, 1=PENDING, 2=SERVER_ACK, 3=DELIVERY_ACK, 4=READ, 5=PLAYED
async function handleStatusUpdates(updates: EvolutionStatusUpdate[]) {
  const supabase = createSupabaseServer()

  for (const update of updates) {
    if (!update.key.fromMe) continue
    const status = update.update?.status
    if (status !== 0) continue  // solo procesar errores

    const messageId = update.key.id
    if (!messageId) continue

    const { data: conv } = await supabase
      .from('conversaciones')
      .select('id, lead_id')
      .eq('twilio_message_sid', messageId)
      .maybeSingle()

    if (!conv?.lead_id) continue

    await supabase.from('leads').update({
      primer_envio_error: 'evolution_delivery_error',
    }).eq('id', conv.lead_id)

    console.log(`[Evolution Status] messageId=${messageId} status=ERROR lead=${conv.lead_id}`)
  }
}

// ── Manejo de cambios de estado de la sesión Multi-Device ─────────────────────
// Evolution emite `connection.update` cada vez que la sesión Baileys cambia
// de estado. Es la fuente de verdad MÁS RÁPIDA para detectar caídas — antes
// de que el cron health-check corra, antes de que un envío falle.
//
// Mapeo de statusReason (códigos Baileys):
//   401 → device_removed: la cuenta fue eliminada en el celular principal.
//          La sesión Multi-Device está muerta. Hay que rescaneer QR.
//   409 → conflict: otra sesión Multi-Device tomó el lugar (ej: WhatsApp Web).
//   408 → timeout: red caída entre Evolution y WhatsApp.
//   500 → unavailable: problema interno de WhatsApp.
//   restart_required → necesita reinicio manual.
const STATUS_REASON_MAP: Record<number, string> = {
  401: 'device_removed',
  408: 'timeout',
  409: 'conflict',
  500: 'unavailable',
  503: 'service_unavailable',
}

function reasonFromStatusCode(code: number | null | undefined): string {
  if (code == null) return 'unknown'
  return STATUS_REASON_MAP[code] ?? `code_${code}`
}

async function handleConnectionUpdate(
  instanceName: string,
  payload: EvolutionConnectionUpdate
) {
  const supabase = createSupabaseServer()

  // Resolver state — algunas versiones lo envían como `state`, otras como `connection`.
  const rawState = payload?.state ?? payload?.connection ?? 'unknown'
  const state = String(rawState).toLowerCase()

  // Resolver statusReason — puede venir flat o anidado en lastDisconnect.
  const statusCode =
    payload?.statusReason ??
    payload?.lastDisconnect?.error?.output?.statusCode ??
    null

  console.log(
    `[Evolution Webhook] connection.update instance=${instanceName} state=${state} statusCode=${statusCode}`
  )

  // Buscar el sender correspondiente.
  const { data: sender } = await supabase
    .from('senders')
    .select('id, alias, instance_name, connected, phone_number')
    .eq('provider', 'evolution')
    .eq('instance_name', instanceName)
    .maybeSingle()

  if (!sender) {
    // Instancia huérfana (no registrada como sender). Solo logueamos.
    console.warn(`[Evolution Webhook] connection.update para instancia desconocida: ${instanceName}`)
    return
  }

  if (state === 'open') {
    // La sesión se vinculó (escaneo de QR exitoso o reconexión automática).
    // Intentamos resolver el número si todavía no lo tenemos.
    let phone: string | null = sender.phone_number ?? null
    if (!phone) {
      try {
        phone = await fetchPhoneNumber(instanceName)
      } catch (err) {
        console.warn('[Evolution Webhook] fetchPhoneNumber falló (no bloquea):', err)
      }
    }
    await markConnected(supabase, sender.id, { phoneNumber: phone })
    console.log(`[Evolution Webhook] sender ${sender.alias ?? instanceName} → connected`)
    return
  }

  if (state === 'close') {
    const reason = reasonFromStatusCode(statusCode)
    await markDisconnected(supabase, sender.id, reason)
    console.error(
      `[Evolution Webhook] sender ${sender.alias ?? instanceName} → disconnected (reason=${reason}, code=${statusCode})`
    )
    return
  }

  // state === 'connecting' o cualquier otro: no tocamos DB. La instancia está
  // en transición. Si termina en `close`, recibiremos otro `connection.update`.
  console.log(`[Evolution Webhook] sender ${sender.alias ?? instanceName} → state=${state} (sin cambios en DB)`)
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
