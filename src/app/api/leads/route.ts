import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ejecutarConTablaLeads } from '@/lib/leads-table'

export const dynamic = 'force-dynamic'

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

  const telefonoNorm = body.telefono ? body.telefono.replace(/\D/g, '') : ''

  // Dedup: no reinsertar si ya existe en leads o en conversaciones
  if (telefonoNorm) {
    const [{ data: leadExist }, { data: convExist }] = await Promise.all([
      supabase.from('leads_apex_next').select('id').eq('telefono', telefonoNorm).maybeSingle(),
      supabase.from('conversaciones').select('id').eq('telefono', telefonoNorm).limit(1).maybeSingle(),
    ])
    if (leadExist || convExist) {
      return NextResponse.json({ error: 'Lead ya existente', duplicado: true }, { status: 409 })
    }
  }

  const { data, error } = await ejecutarConTablaLeads((tabla) =>
    supabase
      .from(tabla)
      .insert({
        nombre: body.nombre,
        rubro: body.rubro,
        zona: body.zona || 'Buenos Aires',
        telefono: telefonoNorm || body.telefono,
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

  const leadRow = data as { id: string } | null
  const mensajeInicial = typeof body.mensaje_inicial === 'string' ? body.mensaje_inicial.trim() : ''
  if (leadRow?.id && mensajeInicial && body.telefono) {
    await supabase.from('conversaciones').insert({
      lead_id: leadRow.id,
      telefono: String(body.telefono),
      mensaje: mensajeInicial,
      rol: 'agente',
      tipo_mensaje: 'texto',
      manual: false,
    })
  }

  return NextResponse.json({ lead: data })
}

// PATCH - actualizar estado u otros campos
export async function PATCH(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const ALLOWED_PATCH_FIELDS = new Set([
    'nombre', 'rubro', 'zona', 'telefono', 'instagram', 'descripcion',
    'mensaje_inicial', 'estado', 'origen', 'agente_activo', 'conversacion_cerrada',
    'conversacion_cerrada_at', 'notas',
  ])
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([k]) => ALLOWED_PATCH_FIELDS.has(k))
  )

  const { data, error } = await ejecutarConTablaLeads((tabla) =>
    supabase.from(tabla).update(safeUpdates).eq('id', id).select().single()
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lead: data })
}
