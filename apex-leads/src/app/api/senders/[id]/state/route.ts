import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { fetchPhoneNumber, getInstanceState } from '@/lib/evolution-instance'
import { markConnected, markDisconnected } from '@/lib/sender-pool'

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
      // Usamos markConnected (no un update raw) para resetear disconnected_at,
      // disconnection_reason y consecutive_send_failures. Sin esto, el sender
      // quedaba con consecutive_send_failures viejo y al primer error volvía a
      // marcarse disconnected aunque acabábamos de reconectar.
      const fetched = await fetchPhoneNumber(sender.instance_name).catch(() => null)
      if (fetched) phoneNumber = fetched
      await markConnected(supabase, sender.id, { phoneNumber })
    } else if (state === 'close' && sender.connected) {
      // markDisconnected es idempotente: preserva disconnected_at original si
      // ya estaba disconnected.
      await markDisconnected(supabase, sender.id, 'state_poll_close')
    }

    return NextResponse.json({ state, phone_number: phoneNumber })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/senders/:id/state] error', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
