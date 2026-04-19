import { NextRequest, NextResponse } from 'next/server'
import { enviarMensajeAgente } from '@/lib/agente'
import { enviarVideoWassengerConReintentos } from '@/lib/wassenger'

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
    let videoResult: { ok: boolean; intentos: number; error?: string } | null = null

    if (videoUrl) {
      videoResult = await enviarVideoWassengerConReintentos(telefono, videoUrl)
      if (videoResult.ok) {
        console.log(
          `[API] Video enviado a ${telefono} (intentos: ${videoResult.intentos})`
        )
      } else {
        console.error(
          `[API] Video falló tras ${videoResult.intentos} intentos:`,
          videoResult.error
        )
      }
    } else {
      console.warn('[API] VIDEO_PAGINA_URL no configurada, omitiendo video')
    }

    return NextResponse.json({ ok: true, video: videoResult })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[API] Error enviando mensaje:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
