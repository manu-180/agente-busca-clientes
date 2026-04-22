import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

type Sb = ReturnType<typeof createSupabaseServer>

export const dynamic = 'force-dynamic'

const SELECT_CONV = `
  id, lead_id, telefono, mensaje, rol, tipo_mensaje,
  timestamp, leido, manual, es_followup,
  sender:sender_id (id, alias, color, provider, phone_number)
` as const

/** Carga filas con fallback si la vista 1g aún no está aplicada en Supabase. */
async function cargarFilasConversacion(supabase: Sb) {
  // PostgREST limita a 1000 filas por defecto: sin .range/.limit explícito se recorta.
  const { data: cabezas, error: viewError } = await supabase
    .from('conversaciones_ultima_por_lead')
    .select(SELECT_CONV)
    .order('timestamp', { ascending: false })
    .range(0, 19999)

  if (viewError) {
    console.warn(
      '[conversaciones] Vista conversaciones_ultima_por_lead no disponible; usar supabase-migration-missing-schema.sql 1g. Detalle:',
      viewError.message
    )
    const { data: conversacionesRecientes, error: convError } = await supabase
      .from('conversaciones')
      .select(SELECT_CONV)
      .order('timestamp', { ascending: false })
      .limit(10000)
    if (convError) return { error: convError.message, filas: [] }
    return { error: null, filas: [...(conversacionesRecientes ?? [])].reverse() }
  }

  const leadIds = (cabezas ?? [])
    .map((c) => c.lead_id)
    .filter((id): id is string => id != null)

  if (leadIds.length === 0) {
    return { error: null, filas: [] }
  }

  // Misma regla: .order(asc) sin paginar = solo las 1000 filas *más viejas* → el inbox
  // quedaba “congelado” en el pasado y los de hoy caían del otro lado del corte.
  const PAGE = 10_000
  const acum: any[] = []
  for (let from = 0; from < 2_000_000; from += PAGE) {
    const { data: chunk, error: convError } = await supabase
      .from('conversaciones')
      .select(SELECT_CONV)
      .in('lead_id', leadIds)
      .order('timestamp', { ascending: true })
      .range(from, from + PAGE - 1)

    if (convError) return { error: convError.message, filas: [] }
    if (!chunk?.length) break
    acum.push(...chunk)
    if (chunk.length < PAGE) break
  }

  return { error: null, filas: acum }
}

export async function GET() {
  const supabase = createSupabaseServer()

  const { error: loadError, filas: conversaciones } = await cargarFilasConversacion(supabase)
  if (loadError) return NextResponse.json({ error: loadError }, { status: 500 })

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('*')

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })

  const leadsMap = new Map(leads?.map(l => [l.id, l]) ?? [])
  const grupos: Record<string, any> = {}

  for (const conv of conversaciones ?? []) {
    if (!conv.lead_id) continue
    if (!grupos[conv.lead_id]) {
      const lead = leadsMap.get(conv.lead_id)
      if (!lead) continue
      grupos[conv.lead_id] = {
        lead,
        mensajes: [],
        ultimo_mensaje: '',
        ultimo_timestamp: '',
        no_leidos: 0,
        sender: null,
      }
    }
    grupos[conv.lead_id].mensajes.push(conv)
    grupos[conv.lead_id].ultimo_mensaje = conv.mensaje
    grupos[conv.lead_id].ultimo_timestamp = conv.timestamp
    // El sender del grupo es el del último mensaje con sender
    if (conv.sender) {
      grupos[conv.lead_id].sender = conv.sender
    }
    if (!conv.leido && conv.rol === 'cliente') {
      grupos[conv.lead_id].no_leidos++
    }
  }

  const gruposArray = Object.values(grupos).sort((a: any, b: any) => {
    const aUn = a.no_leidos > 0
    const bUn = b.no_leidos > 0
    if (aUn !== bUn) return aUn ? -1 : 1
    if (aUn && bUn && a.no_leidos !== b.no_leidos) {
      return b.no_leidos - a.no_leidos
    }
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
