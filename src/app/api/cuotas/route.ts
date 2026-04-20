import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { trabajo_id, numero_cuota, valor, fecha_vencimiento, notas } = body

  const { data, error } = await supabase
    .from('cuotas')
    .insert({ trabajo_id, numero_cuota, valor, fecha_vencimiento, notas })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cuota: data }, { status: 201 })
}
