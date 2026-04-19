import { NextRequest, NextResponse } from 'next/server'
import { enviarMensajeAgente } from '@/lib/agente'
import { enviarVideoWassenger } from '@/lib/wassenger'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje, lead_id } = body

  if (!telefono || !mensaje) {
    return NextResponse.json({ error: 'Faltan telefono o mensaje' }, { status: 400 })
  }

  try {
    const result = await enviarMensajeAgente({
      telefono,
      mensaje,
      lead_id,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const videoUrl = process.env.VIDEO_PAGINA_URL
    if (videoUrl) {
      try {
        await enviarVideoWassenger(telefono, videoUrl)
        console.log('[API] Video enviado a:', telefono)
      } catch (videoError: any) {
        console.error('[API] Error enviando video:', videoError.message)
      }
    } else {
      console.warn('[API] VIDEO_PAGINA_URL no configurada, omitiendo video')
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[API] Error enviando mensaje:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
