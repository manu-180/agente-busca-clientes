import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServer()

  // Traer todas las conversaciones con sus leads
  const { data: conversaciones, error: convError } = await supabase
    .from('conversaciones')
    .select('*')
    .order('timestamp', { ascending: true })

  if (convError) return NextResponse.json({ error: convError.message }, { status: 500 })

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('*')

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })

  // Agrupar por lead
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
      }
    }
    grupos[conv.lead_id].mensajes.push(conv)
    grupos[conv.lead_id].ultimo_mensaje = conv.mensaje
    grupos[conv.lead_id].ultimo_timestamp = conv.timestamp
    if (!conv.leido && conv.rol === 'cliente') {
      grupos[conv.lead_id].no_leidos++
    }
  }

  // Ordenar por último mensaje (más reciente primero)
  const gruposArray = Object.values(grupos).sort(
    (a: any, b: any) => new Date(b.ultimo_timestamp).getTime() - new Date(a.ultimo_timestamp).getTime()
  )

  return NextResponse.json({ grupos: gruposArray })
}
