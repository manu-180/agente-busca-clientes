import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

/**
 * Sirve el binario del adjunto asociado a un mensaje.
 * Con Evolution API, la media se almacena como URL del servidor de Evolution.
 * URLs de Twilio legacy (api.twilio.com) ya no son accesibles — retornan 410.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  }

  const supabase = createSupabaseServer()
  const { data: row, error } = await supabase
    .from('conversaciones')
    .select('id, media_url, tipo_mensaje')
    .eq('id', id)
    .maybeSingle()

  if (error || !row?.media_url || typeof row.media_url !== 'string') {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  }

  const mediaUrl = row.media_url.trim()

  // URLs de Twilio legacy — ya no accesibles tras la migración
  if (mediaUrl.startsWith('https://api.twilio.com/')) {
    return NextResponse.json({ error: 'Media legacy de Twilio no disponible' }, { status: 410 })
  }

  // Media de Evolution API — proxy con apikey
  const evolutionUrl = process.env.EVOLUTION_API_URL ?? ''
  const evolutionKey = process.env.EVOLUTION_API_KEY ?? ''
  if (evolutionUrl && mediaUrl.startsWith(evolutionUrl)) {
    if (!evolutionKey) {
      return NextResponse.json({ error: 'Evolution API no configurada' }, { status: 500 })
    }
    const upstream = await fetch(mediaUrl, {
      headers: { apikey: evolutionKey },
      redirect: 'follow',
    })
    if (!upstream.ok) {
      return new NextResponse(null, { status: 502 })
    }
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const buf = await upstream.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
    })
  }

  return NextResponse.json({ error: 'Origen de media no permitido' }, { status: 400 })
}
