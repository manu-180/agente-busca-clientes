import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()

  // Importante: con .order(asc).limit(N) PostgREST devuelve los N mensajes más *antiguos*.
  // Pasado ~N filas en la tabla, los envíos nuevos quedan fuera y el inbox deja de actualizarse.
  const { data: conversacionesRecientes, error: convError } = await supabase
    .from('conversaciones')
    .select(`
      id, lead_id, telefono, mensaje, rol, tipo_mensaje,
      timestamp, leido, manual,
      sender:sender_id (id, alias, color, provider, phone_number)
    `)
    .order('timestamp', { ascending: false })
    .limit(10000)

  const conversaciones = [...(conversacionesRecientes ?? [])].reverse()

  if (convError) return NextResponse.json({ error: convError.message }, { status: 500 })

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
