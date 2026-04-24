import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()

  const { data, error } = await supabase
    .from('trabajos')
    .select('*, cuotas(*)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const trabajos = (data ?? []).map((t: any) => ({
    ...t,
    cuotas: (t.cuotas ?? []).sort((a: any, b: any) => a.numero_cuota - b.numero_cuota),
  }))

  return NextResponse.json({ trabajos })
}

export async function POST(req: Request) {
  const supabase = createSupabaseServer()
  const body = await req.json()

  const { nombre, cliente, descripcion, tipo, valor_cuota, moneda, total_cuotas, fecha_inicio } = body

  const { data: trabajo, error } = await supabase
    .from('trabajos')
    .insert({ nombre, cliente, descripcion, tipo, valor_cuota, moneda, total_cuotas: tipo === 'indefinido' ? null : total_cuotas, fecha_inicio })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-generate cuotas for fixed-installment contracts
  if (tipo === 'cuotas' && total_cuotas > 0) {
    const inicio = new Date(fecha_inicio)
    const cuotasToInsert = Array.from({ length: total_cuotas }, (_, i) => {
      const fecha = new Date(inicio)
      fecha.setMonth(fecha.getMonth() + i)
      return {
        trabajo_id: trabajo.id,
        numero_cuota: i + 1,
        valor: valor_cuota,
        fecha_vencimiento: fecha.toISOString().split('T')[0],
      }
    })
    await supabase.from('cuotas').insert(cuotasToInsert)
  }

  return NextResponse.json({ trabajo }, { status: 201 })
}
