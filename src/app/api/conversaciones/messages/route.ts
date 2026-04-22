import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const SELECT_CONV = `
  id, lead_id, telefono, mensaje, rol, tipo_mensaje,
  timestamp, leido, manual, es_followup,
  sender:sender_id (id, alias, color, provider, phone_number)
` as const

const MAX_MENSAJES_POR_HILO = 5000

/**
 * Historial de un lead (un solo hilo). El listado del inbox no carga esto
 * para no explotar memoria en /api/conversaciones.
 *
 * Fallback: si lead_id devuelve 0 mensajes (caso de leads duplicados donde
 * los mensajes antiguos quedaron asociados a otro lead_id), busca por telefono.
 */
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get('lead_id')
  if (!leadId) {
    return NextResponse.json({ error: 'lead_id requerido' }, { status: 400 })
  }

  const supabase = createSupabaseServer()
  const { data, error } = await supabase
    .from('conversaciones')
    .select(SELECT_CONV)
    .eq('lead_id', leadId)
    // Traemos los últimos N y luego invertimos para no "cortar" mensajes nuevos
    // cuando el hilo supera MAX_MENSAJES_POR_HILO.
    .order('timestamp', { ascending: false })
    .range(0, MAX_MENSAJES_POR_HILO - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const mensajesPorId = data ?? []

  // Fallback por teléfono: cuando lead_id devuelve 0 ó 1 mensaje (solo el inbox
  // cabeza), puede significar que mensajes anteriores están bajo un lead_id distinto
  // (lead duplicado). Buscamos por teléfono para recuperar el hilo completo.
  if (mensajesPorId.length <= 1) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('telefono')
      .eq('id', leadId)
      .single()

    if (leadRow?.telefono) {
      const { data: byTel, error: telErr } = await supabase
        .from('conversaciones')
        .select(SELECT_CONV)
        .eq('telefono', leadRow.telefono)
        .order('timestamp', { ascending: false })
        .range(0, MAX_MENSAJES_POR_HILO - 1)

      if (!telErr && byTel && byTel.length > mensajesPorId.length) {
        console.warn(
          `[messages] Fallback telefono: lead_id=${leadId} → ${mensajesPorId.length} msgs, ` +
          `telefono=${leadRow.telefono} → ${byTel.length} msgs. ` +
          `Posible lead duplicado detectado.`
        )
        return NextResponse.json({ mensajes: [...byTel].reverse() })
      }
    }
  }

  return NextResponse.json({ mensajes: mensajesPorId.reverse() })
}
