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
      await enviarVideoWassenger(telefono, videoUrl)
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[API] Error enviando mensaje:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
