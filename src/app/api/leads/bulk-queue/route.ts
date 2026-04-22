import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { esErrorDuplicadoLead, esErrorOnConflictSinIndice } from '@/lib/db-errors'
import { normalizarTelefonoArg, soloDigitos, variantesTelefonoMismaLinea } from '@/lib/phone'

const LEADS_TABLE = 'leads'
const CHUNK_IN = 200
const CHUNK_INSERT = 40

interface LeadInput {
  nombre: string
  rubro: string
  zona?: string
  telefono: string
  descripcion?: string
}

type FilaInsert = {
  nombre: string
  rubro: string
  zona: string
  telefono: string
  descripcion: string
  instagram: null
  mensaje_inicial: string
  estado: 'pendiente'
  origen: 'outbound'
  agente_activo: true
  mensaje_enviado: false
  video_enviado: false
  primer_envio_intentos: 0
}

function normalizarTelefono(telefono: string): string {
  return normalizarTelefonoArg(soloDigitos(telefono))
}

function partes<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

async function insertarBloqueConFallback(
  supabase: ReturnType<typeof createSupabaseServer>,
  filas: FilaInsert[]
): Promise<{ agregados: number; duplicados: number; fatal: string | null }> {
  if (filas.length === 0) return { agregados: 0, duplicados: 0, fatal: null }

  const { data, error } = await supabase.from(LEADS_TABLE).insert(filas).select('id')
  if (!error) {
    return { agregados: data?.length ?? 0, duplicados: 0, fatal: null }
  }

  let agregados = 0
  let duplicados = 0
  for (const fila of filas) {
    const { error: e } = await supabase.from(LEADS_TABLE).insert(fila).select('id')
    if (!e) {
      agregados += 1
      continue
    }
    if (esErrorDuplicadoLead(e) || esErrorOnConflictSinIndice(e)) {
      duplicados += 1
      continue
    }
    return { agregados, duplicados, fatal: e.message }
  }
  return { agregados, duplicados, fatal: null }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const leadsIn = Array.isArray(body?.leads) ? (body.leads as LeadInput[]) : []

    if (leadsIn.length === 0) {
      return NextResponse.json({ error: 'Lista vacía' }, { status: 400 })
    }

    const supabase = createSupabaseServer()

    const telefonos = leadsIn
      .map(l => normalizarTelefono(l.telefono || ''))
      .filter(Boolean)

    if (telefonos.length === 0) {
      return NextResponse.json({ error: 'Ningún teléfono válido' }, { status: 400 })
    }

    const telefonosClave = Array.from(
      new Set(telefonos.reduce<string[]>((acc, t) => acc.concat(variantesTelefonoMismaLinea(t)), []))
    )

    const telefonosExistentes = new Set<string>()

    for (const clave of partes(telefonosClave, CHUNK_IN)) {
      const [resLeads, resApex, resConvs] = await Promise.all([
        supabase.from(LEADS_TABLE).select('telefono').in('telefono', clave),
        supabase.from('leads_apex_next').select('telefono').in('telefono', clave),
        supabase.from('conversaciones').select('telefono').in('telefono', clave),
      ])

      for (const row of resLeads.data ?? []) {
        const t = normalizarTelefonoArg(String((row as { telefono?: string }).telefono ?? ''))
        if (t) telefonosExistentes.add(t)
      }
      if (!resApex.error) {
        for (const row of resApex.data ?? []) {
          const t = normalizarTelefonoArg(String((row as { telefono?: string }).telefono ?? ''))
          if (t) telefonosExistentes.add(t)
        }
      }
      for (const row of resConvs.data ?? []) {
        const t = normalizarTelefonoArg(String((row as { telefono?: string }).telefono ?? ''))
        if (t) telefonosExistentes.add(t)
      }
    }

    const vistosEnRequest = new Set<string>()
    const filas: FilaInsert[] = []
    for (const l of leadsIn) {
      const t = normalizarTelefono(l.telefono || '')
      if (!t) continue
      if (telefonosExistentes.has(t)) continue
      if (vistosEnRequest.has(t)) continue
      vistosEnRequest.add(t)
      filas.push({
        nombre: String(l.nombre ?? 'Negocio sin nombre').slice(0, 255),
        rubro: String(l.rubro ?? 'Por definir').slice(0, 100),
        zona: String(l.zona ?? 'Por definir').slice(0, 200),
        telefono: t,
        descripcion: String(l.descripcion ?? '').slice(0, 2000),
        instagram: null,
        mensaje_inicial: '',
        estado: 'pendiente',
        origen: 'outbound',
        agente_activo: true,
        mensaje_enviado: false,
        video_enviado: false,
        primer_envio_intentos: 0,
      })
    }

    if (filas.length === 0) {
      return NextResponse.json({
        ok: true,
        agregados: 0,
        duplicados: leadsIn.length,
        mensaje: 'Todos los leads ya existían',
      })
    }

    let agregadosTotal = 0

    for (const bloque of partes(filas, CHUNK_INSERT)) {
      const { agregados, fatal } = await insertarBloqueConFallback(supabase, bloque)
      if (fatal) {
        return NextResponse.json({ error: fatal }, { status: 500 })
      }
      agregadosTotal += agregados
    }

    const duplicados = leadsIn.length - agregadosTotal

    return NextResponse.json({
      ok: true,
      agregados: agregadosTotal,
      duplicados,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
