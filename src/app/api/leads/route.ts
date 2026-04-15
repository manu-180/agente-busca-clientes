import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ejecutarConTablaLeads } from '@/lib/leads-table'

// GET - listar leads
export async function GET() {
  const supabase = createSupabaseServer()
  const { data, error } = await ejecutarConTablaLeads((tabla) =>
    supabase.from(tabla).select('*').order('created_at', { ascending: false })
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ leads: data })
}

// POST - crear lead
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()

  const { data, error } = await ejecutarConTablaLeads((tabla) =>
    supabase
      .from(tabla)
      .insert({
        nombre: body.nombre,
        rubro: body.rubro,
        zona: body.zona || 'Buenos Aires',
        telefono: body.telefono,
        instagram: body.instagram || null,
        descripcion: body.descripcion || '',
        mensaje_inicial: body.mensaje_inicial || '',
        estado: body.estado || 'pendiente',
        origen: body.origen || 'outbound',
      })
      .select()
      .single()
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lead: data })
}

// PATCH - actualizar estado u otros campos
export async function PATCH(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const { data, error } = await ejecutarConTablaLeads((tabla) =>
    supabase.from(tabla).update(updates).eq('id', id).select().single()
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lead: data })
}
