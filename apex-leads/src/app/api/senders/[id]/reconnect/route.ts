import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { connectInstance, logoutInstance } from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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
    // Logout primero para limpiar el estado Baileys viejo.
    // Sin esto, Evolution puede tener múltiples conexiones Baileys activas
    // que se pisan entre sí generando código 440 (connectionReplaced) en loop.
    try {
      await logoutInstance(sender.instance_name)
    } catch (err) {
      console.warn('[reconnect] logout fallo (ignorado):', err)
    }
    // Pausa breve para que Evolution termine de limpiar antes de pedir QR.
    await new Promise(r => setTimeout(r, 1500))
    const qr = await connectInstance(sender.instance_name)

    await supabase
      .from('senders')
      .update({
        connected: false,
        qr_requested_at: new Date().toISOString(),
      })
      .eq('id', sender.id)

    return NextResponse.json({ base64: qr.base64, code: qr.code })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/senders/:id/reconnect] error', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
