import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { connectInstance, restartInstance } from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: sender, error } = await supabase
    .from('senders')
    .select('id, instance_name, provider')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sender) return NextResponse.json({ error: 'sender no encontrado' }, { status: 404 })
  if (sender.provider !== 'evolution' || !sender.instance_name) {
    return NextResponse.json({ error: 'sender no es evolution o sin instance_name' }, { status: 400 })
  }

  try {
    let qr = await connectInstance(sender.instance_name)
    if (!qr.base64) {
      // Reintento: a veces Evolution devuelve { count: 0 } sin QR. Restart y volver a pedir.
      try {
        await restartInstance(sender.instance_name)
      } catch {
        // ignore — algunas versiones devuelven 404 si no hay sesión todavía
      }
      qr = await connectInstance(sender.instance_name)
    }

    await supabase
      .from('senders')
      .update({ qr_requested_at: new Date().toISOString() })
      .eq('id', sender.id)

    return NextResponse.json({ base64: qr.base64, code: qr.code })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/senders/:id/qr] error', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
