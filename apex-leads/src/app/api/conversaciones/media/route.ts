import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const TWILIO_API = 'https://api.twilio.com/'

/**
 * Sirve el binario del adjunto Twilio asociado a un mensaje (Basic Auth solo en servidor).
 * El cliente usa src="/api/conversaciones/media?id=<uuid>".
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
  if (!mediaUrl.startsWith(TWILIO_API)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 400 })
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio no configurado' }, { status: 500 })
  }

  const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const upstream = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${basic}` },
    redirect: 'follow',
  })

  if (!upstream.ok) {
    return new NextResponse(null, { status: 502 })
  }

  const contentType =
    upstream.headers.get('content-type') ?? 'application/octet-stream'
  const buf = await upstream.arrayBuffer()

  return new NextResponse(buf, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
