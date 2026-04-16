import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt } from '@/lib/prompts'
import {
  pareceMensajeAutomaticoNegocio,
  RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
} from '@/lib/outbound-auto-reply'

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
    } catch (e) {
      console.error('Wassenger audio fallback:', e)
      return NextResponse.json({ ok: false, error: 'wassenger_error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, agente: true, tipo: 'audio_fallback' })
  }

  const noInteresa = ['no me interesa', 'no gracias', 'no quiero', 'dejá de escribir', 'no molestes']
  if (noInteresa.some(phrase => mensaje.toLowerCase().includes(phrase))) {
    await supabase
      .from('leads')
      .update({ estado: 'no_interesado', agente_activo: false })
      .eq('id', lead.id)
    return NextResponse.json({ ok: true, agente: false, motivo: 'no_interesado' })
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

    const apexInfoTexto = (apexInfo ?? [])
      .map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`)
      .join('\n\n')

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
      return NextResponse.json({ ok: true, agente: true, tipo: 'outbound_auto_negocio' })
    }

    const historialTexto = filasHistorial
      .map(h => `[${h.rol === 'agente' ? 'APEX' : 'CLIENTE'}] ${h.mensaje}`)
      .join('\n')

    const systemPrompt = buildAgentPrompt(
      lead.origen as 'outbound' | 'inbound',
      apexInfoTexto,
      historialTexto
    )

    const client = new Anthropic({ apiKey: anthropicKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: mensajeCombinado }],
    })

    const respuesta =
      response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    if (!respuesta) {
      return NextResponse.json({ ok: true, agente: true, vacio: true })
    }

    console.log('[Wassenger] Agente generó respuesta, enviando...')
    await enviarWassengerYGuardar(supabase, telefono, lead.id, respuesta)

    return NextResponse.json({ ok: true, agente: true })
  } catch (error) {
    console.error('[Wassenger] Error en agente / Wassenger:', error)
    return NextResponse.json({ ok: true, agente: false, error: 'agente_error' })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
