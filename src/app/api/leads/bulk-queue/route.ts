import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

const LEADS_TABLE = 'leads_apex_next'

interface LeadInput {
  nombre: string
  rubro: string
  zona?: string
  telefono: string
  descripcion?: string
}

function normalizarTelefono(telefono: string): string {
  return telefono.replace(/\D/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const leadsIn = Array.isArray(body?.leads) ? (body.leads as LeadInput[]) : []

    if (leadsIn.length === 0) {
      return NextResponse.json({ error: 'Lista vacía' }, { status: 400 })
    }

    const supabase = createSupabaseServer()

    // Dedup por teléfono contra la base (por las dudas)
    const telefonos = leadsIn
      .map(l => normalizarTelefono(l.telefono || ''))
      .filter(Boolean)

    if (telefonos.length === 0) {
      return NextResponse.json({ error: 'Ningún teléfono válido' }, { status: 400 })
    }

    const { data: existentes } = await supabase
      .from(LEADS_TABLE)
      .select('telefono')
      .in('telefono', telefonos)

    const telefonosExistentes = new Set(
      (existentes ?? [])
        .map(e => normalizarTelefono(String(e.telefono ?? '')))
        .filter(Boolean)
    )

    // Dedup dentro de la misma request también
    const vistosEnRequest = new Set<string>()
    const filas = leadsIn
      .map(l => ({
        nombre: String(l.nombre ?? 'Negocio sin nombre').slice(0, 255),
        rubro: String(l.rubro ?? 'Por definir').slice(0, 100),
        zona: String(l.zona ?? 'Por definir').slice(0, 200),
        telefono: normalizarTelefono(l.telefono || ''),
        descripcion: String(l.descripcion ?? '').slice(0, 2000),
        instagram: null,
        mensaje_inicial: '',
        estado: 'pendiente' as const,
        origen: 'outbound' as const,
        agente_activo: true,
        mensaje_enviado: false,
        video_enviado: false,
        primer_envio_intentos: 0,
      }))
      .filter(f => {
        if (!f.telefono) return false
        if (telefonosExistentes.has(f.telefono)) return false
        if (vistosEnRequest.has(f.telefono)) return false
        vistosEnRequest.add(f.telefono)
        return true
      })

    if (filas.length === 0) {
      return NextResponse.json({
        ok: true,
        agregados: 0,
        duplicados: leadsIn.length,
        mensaje: 'Todos los leads ya existían',
      })
    }

    const { data: insertados, error } = await supabase
      .from(LEADS_TABLE)
      .insert(filas)
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      agregados: insertados?.length ?? 0,
      duplicados: leadsIn.length - (insertados?.length ?? 0),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
