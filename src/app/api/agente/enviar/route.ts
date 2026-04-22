import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeTwilio } from '@/lib/twilio'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje, lead_id, sender_id } = body

  if (!telefono || !mensaje) {
    return NextResponse.json({ error: 'Faltan telefono o mensaje' }, { status: 400 })
  }

  if (isTelefonoHardBlocked(telefono)) {
    return NextResponse.json({ error: 'Teléfono en lista de bloqueo' }, { status: 403 })
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
    await enviarMensajeTwilio(telefono, mensaje, senderData?.phone_number)

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

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[API] Error enviando mensaje:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
