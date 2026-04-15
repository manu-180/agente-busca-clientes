import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { generarRespuestaAgente, enviarMensajeAgente } from '@/lib/agente'

export async function POST(req: NextRequest) {
  let body
  try {
    body = await req.json()
  } catch (error) {
    console.error('Error parsing request body:', error)
    return NextResponse.json({ ok: true, skipped: true })
  }

  console.log('[Wassenger Webhook] Body received:', body)
  const supabase = createSupabaseServer()

  // Wassenger envía diferentes eventos
  const event = body.event
  
  // Solo procesar mensajes recibidos
  if (event !== 'message:in:new' && event !== 'message:received') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const data = body.data || body
  const telefono = data.fromNumber || data.phone || data.from
  const mensaje = data.body || data.message || data.text || ''
  const tipoOriginal = data.type || 'chat'

  if (!telefono || !mensaje) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Limpiar teléfono (sacar @c.us si viene)
  const telefonoLimpio = telefono.replace('@c.us', '').replace('+', '')

  // Determinar tipo de mensaje
  let tipoMensaje: 'texto' | 'audio' | 'imagen' | 'otro' = 'texto'
  if (tipoOriginal === 'ptt' || tipoOriginal === 'audio') tipoMensaje = 'audio'
  else if (tipoOriginal === 'image') tipoMensaje = 'imagen'
  else if (tipoOriginal !== 'chat') tipoMensaje = 'otro'

  // Buscar lead existente por teléfono
  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('telefono', telefonoLimpio)
    .single()

  // Si no existe, crear como inbound
  if (!lead) {
    const { data: nuevoLead } = await supabase
      .from('leads')
      .insert({
        nombre: `Lead ${telefonoLimpio.slice(-4)}`,
        rubro: 'Por definir',
        zona: 'Por definir',
        telefono: telefonoLimpio,
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

  // Guardar mensaje del cliente
  await supabase.from('conversaciones').insert({
    lead_id: lead.id,
    telefono: telefonoLimpio,
    mensaje: tipoMensaje !== 'texto' ? `[${tipoMensaje.toUpperCase()}] ${mensaje}` : mensaje,
    rol: 'cliente',
    tipo_mensaje: tipoMensaje,
    leido: false,
  })

  // Actualizar estado del lead si estaba en contactado
  if (lead.estado === 'contactado' || lead.estado === 'pendiente') {
    await supabase
      .from('leads')
      .update({ estado: 'respondio' })
      .eq('id', lead.id)
  }

  // Verificar si el agente está activo (global y para este lead)
  const { data: configAgente } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'agente_activo')
    .single()

  if (configAgente?.valor !== 'true' || !lead.agente_activo) {
    return NextResponse.json({ ok: true, agente: false })
  }

  // Si es audio/imagen, el agente no puede procesar
  if (tipoMensaje !== 'texto') {
    const respAudio = 'Disculpá, no puedo escuchar audios ni ver imágenes por acá. ¿Me lo podés escribir en texto?'

    console.log('[Wassenger] Enviando respuesta por audio/imagen recibido')
    await enviarMensajeAgente({
      telefono: telefonoLimpio,
      mensaje: respAudio,
      lead_id: lead.id,
    })

    return NextResponse.json({ ok: true, agente: true, tipo: 'audio_fallback' })
  }

  // Si el lead dijo que no le interesa, no responder
  const noInteresa = ['no me interesa', 'no gracias', 'no quiero', 'dejá de escribir', 'no molestes']
  if (noInteresa.some(phrase => mensaje.toLowerCase().includes(phrase))) {
    await supabase
      .from('leads')
      .update({ estado: 'no_interesado', agente_activo: false })
      .eq('id', lead.id)
    return NextResponse.json({ ok: true, agente: false, motivo: 'no_interesado' })
  }

  // Llamar al agente para generar respuesta
  try {
    console.log('[Wassenger] Generando respuesta del agente...')
    const { respuesta } = await generarRespuestaAgente({
      telefono: telefonoLimpio,
      mensaje_nuevo: mensaje,
      lead_id: lead.id,
    })

    if (respuesta) {
      console.log('[Wassenger] Agente generó respuesta, enviando...')
      await enviarMensajeAgente({
        telefono: telefonoLimpio,
        mensaje: respuesta,
        lead_id: lead.id,
      })
    }

    return NextResponse.json({ ok: true, agente: true })
  } catch (error) {
    console.error('[Wassenger] Error en agente:', error)
    return NextResponse.json({ ok: true, agente: false, error: 'agente_error' })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
