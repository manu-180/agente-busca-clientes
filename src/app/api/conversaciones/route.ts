import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

type Sb = ReturnType<typeof createSupabaseServer>

export const dynamic = 'force-dynamic'

const SELECT_CABEZA = `
  id, lead_id, telefono, mensaje, rol, tipo_mensaje,
  timestamp, leido, manual, es_followup, media_url,
  sender:sender_id (id, alias, color, provider, phone_number)
` as const

/** Máximo de IDs por request para no superar el límite de URL de Kong (~8 KB). */
const CHUNK_IDS = 50

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Cuenta mensajes no leídos del cliente, chunkeando leadIds para no superar el límite de URL. */
async function contarNoLeidosPorLead(supabase: Sb, leadIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  if (leadIds.length === 0) return m

  const resultados = await Promise.all(
    chunkArray(leadIds, CHUNK_IDS).map((chunk) =>
      supabase
        .from('conversaciones')
        .select('lead_id')
        .in('lead_id', chunk)
        .eq('leido', false)
        .eq('rol', 'cliente')
        .limit(10_000)
    )
  )

  for (const { data, error } of resultados) {
    if (error || !data) continue
    for (const row of data) {
      if (row.lead_id) m.set(row.lead_id, (m.get(row.lead_id) ?? 0) + 1)
    }
  }
  return m
}

/** Trae el primer rol por lead, chunkeando para no superar el límite de URL. */
async function obtenerPrimerRol(
  supabase: Sb,
  leadIds: string[]
): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (leadIds.length === 0) return m

  const resultados = await Promise.all(
    chunkArray(leadIds, CHUNK_IDS).map((chunk) =>
      supabase
        .from('conversaciones_primera_por_lead')
        .select('lead_id, rol')
        .in('lead_id', chunk)
    )
  )

  for (const { data, error } of resultados) {
    if (error || !data) continue
    for (const r of data as { lead_id: string | null; rol: string }[]) {
      if (r.lead_id) m.set(r.lead_id, String(r.rol))
    }
  }
  return m
}

/**
 * Carga filas de `leads` solo para los ids necesarios. Evita el techo de PostgREST
 * (~1000 filas) que hacía que `.range(0, 9999)` devolviera un subconjunto arbitrario
 * y el inbox descartara conversaciones con `if (!lead) return null`.
 */
async function fetchLeadsByIds(supabase: Sb, leadIds: string[]) {
  const unique = Array.from(new Set(leadIds))
  if (unique.length === 0) {
    return { data: [] as Record<string, unknown>[], error: null as string | null }
  }
  // Incluimos el sender anclado al lead para que el inbox siempre use el canal correcto.
  const SELECT_LEAD = '*, sender:sender_id (id, alias, color, provider, phone_number)' as const
  const resultados = await Promise.all(
    chunkArray(unique, CHUNK_IDS).map((chunk) =>
      supabase.from('leads').select(SELECT_LEAD).in('id', chunk)
    )
  )
  const rows: Record<string, unknown>[] = []
  for (const { data, error } of resultados) {
    if (error) return { data: [] as Record<string, unknown>[], error: error.message }
    if (data?.length) rows.push(...(data as Record<string, unknown>[]))
  }
  return { data: rows, error: null as string | null }
}

export async function GET() {
  const supabase = createSupabaseServer()

  const { data: cabezas, error: viewError } = await supabase
    .from('conversaciones_ultima_por_lead')
    .select(SELECT_CABEZA)
    .order('timestamp', { ascending: false })
    .range(0, 19_999)

  if (viewError) {
    console.warn(
      '[conversaciones] Vista conversaciones_ultima_por_lead: usar supabase-migration-missing-schema.sql 1g. Detalle:',
      viewError.message
    )
    const { data: recientes, error: convError } = await supabase
      .from('conversaciones')
      .select(SELECT_CABEZA)
      .order('timestamp', { ascending: false })
      .limit(10_000)
    if (convError) return NextResponse.json({ error: convError.message }, { status: 500 })
    const filas = [...(recientes ?? [])].reverse()
    const idsFromConvs = Array.from(
      new Set(filas.map((c) => c.lead_id).filter((id): id is string => id != null))
    )
    const { data: leadRows, error: leErr } = await fetchLeadsByIds(supabase, idsFromConvs)
    if (leErr) return NextResponse.json({ error: leErr }, { status: 500 })
    const lmap = new Map(leadRows.map((l) => [l.id as string, l]))
    const g: Record<string, any> = {}
    for (const conv of filas) {
      if (!conv.lead_id) continue
      if (!g[conv.lead_id]) {
        const lead = lmap.get(conv.lead_id)
        if (!lead) continue
        g[conv.lead_id] = {
          lead,
          mensajes: [] as any[],
          ultimo_mensaje: '',
          ultimo_timestamp: '',
          no_leidos: 0,
          // Inicializar con el sender anclado al lead si existe.
          sender: (lead as any).sender ?? null,
          inicio_rol: null,
        }
      }
      const row = g[conv.lead_id]
      if (!row) continue
      row.mensajes.push(conv)
      row.ultimo_mensaje = conv.mensaje
      row.ultimo_timestamp = conv.timestamp
      // Solo sobreescribir con el sender del mensaje si el lead no tiene sender propio.
      if (conv.sender && !(row.lead as any).sender) row.sender = conv.sender
      if (!conv.leido && conv.rol === 'cliente') row.no_leidos++
    }
    const arr = Object.values(g).sort((a: any, b: any) => {
      const aU = a.no_leidos > 0
      const bU = b.no_leidos > 0
      if (aU !== bU) return aU ? -1 : 1
      if (aU && bU && a.no_leidos !== b.no_leidos) return b.no_leidos - a.no_leidos
      return new Date(b.ultimo_timestamp).getTime() - new Date(a.ultimo_timestamp).getTime()
    })
    return NextResponse.json({ grupos: arr })
  }

  const listaCabezas = cabezas ?? []
  const leadIds = listaCabezas.map((c) => c.lead_id).filter((id): id is string => id != null)
  if (leadIds.length === 0) {
    return NextResponse.json({ grupos: [] })
  }

  const [noLeidosMap, inicioRol] = await Promise.all([
    contarNoLeidosPorLead(supabase, leadIds),
    obtenerPrimerRol(supabase, leadIds),
  ])

  const { data: leadRows, error: leadsError } = await fetchLeadsByIds(supabase, leadIds)
  if (leadsError) return NextResponse.json({ error: leadsError }, { status: 500 })
  const leadsMap = new Map(leadRows.map((l) => [l.id as string, l]))

  const gruposArray = listaCabezas
    .map((cabeza) => {
      if (!cabeza.lead_id) return null
      const lead = leadsMap.get(cabeza.lead_id)
      if (!lead) return null
      return {
        lead,
        /** Solo el último en el listado; el hilo completo: GET /api/conversaciones/messages?lead_id= */
        mensajes: [cabeza],
        ultimo_mensaje: cabeza.mensaje,
        ultimo_timestamp: cabeza.timestamp,
        no_leidos: noLeidosMap.get(cabeza.lead_id) ?? 0,
        // Prioridad: sender anclado en el lead > sender del último mensaje.
        // Esto garantiza que el inbox siempre envíe por el canal correcto.
        sender: (lead as any).sender ?? cabeza.sender ?? null,
        inicio_rol: inicioRol.get(cabeza.lead_id) ?? null,
      }
    })
    .filter((g) => g != null) as any[]

  gruposArray.sort((a, b) => {
    const aUn = a.no_leidos > 0
    const bUn = b.no_leidos > 0
    if (aUn !== bUn) return aUn ? -1 : 1
    if (aUn && bUn && a.no_leidos !== b.no_leidos) return b.no_leidos - a.no_leidos
    return new Date(b.ultimo_timestamp).getTime() - new Date(a.ultimo_timestamp).getTime()
  })

  return NextResponse.json({ grupos: gruposArray })
}

export async function PATCH(request: Request) {
  const supabase = createSupabaseServer()
  const body = await request.json()

  let query = supabase
    .from('conversaciones')
    .update({ leido: true })
    .eq('leido', false)
    .eq('rol', 'cliente')

  if (!body.all) {
    if (!body.lead_id) return NextResponse.json({ error: 'lead_id requerido' }, { status: 400 })
    query = query.eq('lead_id', body.lead_id)
  }

  const { error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
