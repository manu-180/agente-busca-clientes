import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

const LEADS_TABLES = ['leads', 'leads_apex_next'] as const

async function ejecutarConTablaLeads<T>(
  callback: (tabla: (typeof LEADS_TABLES)[number]) => Promise<{ data: T | null; error: { message: string } | null }>
) {
  for (const tabla of LEADS_TABLES) {
    const resultado = await callback(tabla)

    if (!resultado.error) return resultado

    const tablaNoExiste =
      resultado.error.message.includes("Could not find the table 'public.leads'") ||
      resultado.error.message.includes("Could not find the table 'public.leads_apex_next'")

    if (!tablaNoExiste) return resultado
  }

  return { data: null, error: { message: 'No existe la tabla de leads esperada en Supabase.' } }
}

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
