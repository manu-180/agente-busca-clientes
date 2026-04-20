import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { valor, fecha_vencimiento, pagado, fecha_pago, notas } = body

  const update: Record<string, unknown> = { valor, fecha_vencimiento, pagado, notas }
  if (pagado && fecha_pago) update.fecha_pago = fecha_pago
  if (pagado && !fecha_pago) update.fecha_pago = new Date().toISOString().split('T')[0]
  if (!pagado) update.fecha_pago = null

  const { data, error } = await supabase
    .from('cuotas')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cuota: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()

  const { error } = await supabase.from('cuotas').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
