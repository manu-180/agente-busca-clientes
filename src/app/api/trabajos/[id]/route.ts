import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { nombre, cliente, descripcion, tipo, valor_cuota, moneda, total_cuotas, fecha_inicio, activo } = body

  const { data, error } = await supabase
    .from('trabajos')
    .update({ nombre, cliente, descripcion, tipo, valor_cuota, moneda, total_cuotas, fecha_inicio, activo })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ trabajo: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()

  const { error } = await supabase.from('trabajos').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
