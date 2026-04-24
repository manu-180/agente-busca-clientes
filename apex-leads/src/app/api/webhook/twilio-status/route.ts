import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Recibe callbacks de Twilio cuando el status de un mensaje cambia.
// Twilio envía form-urlencoded (POST) con: MessageSid, MessageStatus, ErrorCode, To, From, etc.
// Solo procesamos estados terminales de fallo: 'undelivered' y 'failed'.
// Siempre retorna HTTP 200 para evitar que Twilio reintente indefinidamente.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const params = new URLSearchParams(body)

    const messageSid = params.get('MessageSid') ?? ''
    const messageStatus = params.get('MessageStatus') ?? ''
    const errorCode = params.get('ErrorCode') ?? ''

    // Ignorar estados intermedios o exitosos (sent, delivered, read)
    if (messageStatus !== 'undelivered' && messageStatus !== 'failed') {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 })
    }

    if (!messageSid) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 })
    }

    const sup = createSupabaseServer()

    // Buscar conversación por SID para obtener el lead asociado
    const { data: conv } = await sup
      .from('conversaciones')
      .select('id, lead_id')
      .eq('twilio_message_sid', messageSid)
      .maybeSingle()

    if (!conv?.lead_id) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 })
    }

    const leadId = conv.lead_id

    if (errorCode === '63024') {
      // Número no tiene WhatsApp — descartar definitivamente
      await sup.from('leads').update({
        estado: 'descartado',
        primer_envio_error: 'no_es_whatsapp',
      }).eq('id', leadId)

    } else if (errorCode === '63016') {
      // Rate limit de Meta — resetear a pendiente para que el próximo tick lo reintente
      const { data: lead } = await sup
        .from('leads')
        .select('primer_envio_intentos')
        .eq('id', leadId)
        .maybeSingle()

      await sup.from('leads').update({
        mensaje_enviado: false,
        estado: 'pendiente',
        primer_envio_intentos: (lead?.primer_envio_intentos ?? 0) + 1,
        primer_envio_error: 'rate_limit_meta',
        procesando_hasta: null,
      }).eq('id', leadId)

    } else if (errorCode === '63018') {
      // Fuera de ventana de sesión de 24h — descartar
      await sup.from('leads').update({
        estado: 'descartado',
        primer_envio_error: 'fuera_ventana_sesion',
      }).eq('id', leadId)

    } else {
      // Otros errores — incrementar contador y dejar en cola para reintento manual
      const { data: lead } = await sup
        .from('leads')
        .select('primer_envio_intentos')
        .eq('id', leadId)
        .maybeSingle()

      await sup.from('leads').update({
        primer_envio_intentos: (lead?.primer_envio_intentos ?? 0) + 1,
        primer_envio_error: `twilio_${errorCode || 'unknown'}`,
        procesando_hasta: null,
      }).eq('id', leadId)
    }

    console.log(
      `[webhook twilio-status] sid=${messageSid} status=${messageStatus} errorCode=${errorCode} lead=${leadId}`
    )

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook twilio-status] Error procesando callback:', msg)
    return NextResponse.json({ ok: true }, { status: 200 })
  }
}
