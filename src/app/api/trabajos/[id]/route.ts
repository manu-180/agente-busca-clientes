import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { nombre, cliente, descripcion, tipo, valor_cuota, moneda, total_cuotas, fecha_inicio, activo } = body

  // Fetch current trabajo to detect changes
  const { data: current } = await supabase
    .from('trabajos')
    .select('*, cuotas(*)')
    .eq('id', params.id)
    .single()

  const { data, error } = await supabase
    .from('trabajos')
    .update({ nombre, cliente, descripcion, tipo, valor_cuota, moneda, total_cuotas: tipo === 'indefinido' ? null : total_cuotas, fecha_inicio, activo })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sync cuotas when tipo or total_cuotas changed
  if (tipo === 'cuotas' && current) {
    const existingCuotas: any[] = (current.cuotas ?? []).sort((a: any, b: any) => a.numero_cuota - b.numero_cuota)
    const oldCount = existingCuotas.length
    const newCount = total_cuotas ?? 0

    if (newCount > oldCount) {
      // Add missing cuotas
      const inicio = new Date(fecha_inicio)
      const toInsert = Array.from({ length: newCount - oldCount }, (_, i) => {
        const fecha = new Date(inicio)
        fecha.setMonth(fecha.getMonth() + oldCount + i)
        return {
          trabajo_id: params.id,
          numero_cuota: oldCount + i + 1,
          valor: valor_cuota,
          fecha_vencimiento: fecha.toISOString().split('T')[0],
        }
      })
      await supabase.from('cuotas').insert(toInsert)
    } else if (newCount < oldCount) {
      // Remove excess cuotas from the end (prefer unpaid ones)
      const toDelete = existingCuotas.slice(newCount).map((c: any) => c.id)
      if (toDelete.length > 0) {
        await supabase.from('cuotas').delete().in('id', toDelete)
      }
    }

    // Update valor of all cuotas if valor_cuota changed
    if (current.valor_cuota !== valor_cuota) {
      await supabase
        .from('cuotas')
        .update({ valor: valor_cuota })
        .eq('trabajo_id', params.id)
        .eq('pagado', false)
    }
  }

  return NextResponse.json({ trabajo: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()

  const { error } = await supabase.from('trabajos').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
