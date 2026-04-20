import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeTwilio } from '@/lib/twilio'
import { enviarMensajeWassenger, enviarVideoWassengerConReintentos } from '@/lib/wassenger'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje, lead_id, sender_id } = body

  if (!telefono || !mensaje) {
    return NextResponse.json({ error: 'Faltan telefono o mensaje' }, { status: 400 })
  }

  const supabase = createSupabaseServer()

  // Resolver sender_id: viene del body o se busca en el historial del lead
  let resolvedSenderId: string | null = sender_id ?? null

  if (!resolvedSenderId && lead_id) {
    const { data: ultimaConv } = await supabase
      .from('conversaciones')
      .select('sender_id')
      .eq('lead_id', lead_id)
      .not('sender_id', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedSenderId = ultimaConv?.sender_id ?? null
  }

  const { data: senderData } = resolvedSenderId
    ? await supabase.from('senders').select('*').eq('id', resolvedSenderId).single()
    : { data: null }

  try {
    if (senderData?.provider === 'twilio') {
      await enviarMensajeTwilio(telefono, mensaje, senderData.phone_number)
    } else {
      await enviarMensajeWassenger(telefono, mensaje)
    }

    if (lead_id) {
      await supabase.from('conversaciones').insert({
        lead_id,
        telefono,
        mensaje,
        rol: 'agente',
        tipo_mensaje: 'texto',
        manual: true,
        sender_id: resolvedSenderId ?? null,
      })
    }

    // Video solo aplica para Wassenger (legacy behavior)
    let videoResult: { ok: boolean; intentos: number; error?: string } | null = null
    if (!senderData || senderData.provider === 'wassenger') {
      const videoUrl = process.env.VIDEO_PAGINA_URL
      if (videoUrl) {
        videoResult = await enviarVideoWassengerConReintentos(telefono, videoUrl)
        if (videoResult.ok) {
          console.log(`[API] Video enviado a ${telefono} (intentos: ${videoResult.intentos})`)
        } else {
          console.error(`[API] Video falló tras ${videoResult.intentos} intentos:`, videoResult.error)
        }
      }
    }

    return NextResponse.json({ ok: true, video: videoResult })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[API] Error enviando mensaje:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
