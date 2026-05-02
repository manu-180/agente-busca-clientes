import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { fetchPhoneNumber, getInstanceState } from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: sender, error } = await supabase
    .from('senders')
    .select('id, instance_name, provider, connected, phone_number')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sender) return NextResponse.json({ error: 'sender no encontrado' }, { status: 404 })
  if (sender.provider !== 'evolution' || !sender.instance_name) {
    return NextResponse.json({ error: 'sender no es evolution o sin instance_name' }, { status: 400 })
  }

  try {
    const state = await getInstanceState(sender.instance_name)

    let phoneNumber: string | null = sender.phone_number ?? null

    if (state === 'open' && !sender.connected) {
      const fetched = await fetchPhoneNumber(sender.instance_name).catch(() => null)
      if (fetched) phoneNumber = fetched
      await supabase
        .from('senders')
        .update({
          connected: true,
          connected_at: new Date().toISOString(),
          ...(phoneNumber ? { phone_number: phoneNumber } : {}),
        })
        .eq('id', sender.id)
    } else if (state === 'close' && sender.connected) {
      await supabase
        .from('senders')
        .update({
          connected: false,
          disconnected_at: new Date().toISOString(),
          disconnection_reason: 'state_poll_close',
        })
        .eq('id', sender.id)
    }

    return NextResponse.json({ state, phone_number: phoneNumber })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/senders/:id/state] error', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
