import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { variantesTelefonoMismaLinea } from '@/lib/phone'

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
 * Fallback: si lead_id devuelve pocos mensajes (caso de leads duplicados donde
 * los mensajes anteriores quedaron bajo otro lead_id), busca por todas las
 * variantes del teléfono para recuperar el hilo completo.
 * El threshold es 3 para cubrir hilos cortos reales + casos de split por lead_id.
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

  // Fallback por teléfono: si el lead tiene pocos mensajes bajo su lead_id,
  // puede significar que el historial anterior quedó bajo un lead_id distinto
  // (lead duplicado o re-creado). Buscamos por TODAS las variantes del teléfono.
  if (mensajesPorId.length <= 3) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('telefono')
      .eq('id', leadId)
      .single()

    if (leadRow?.telefono) {
      const variantes = variantesTelefonoMismaLinea(leadRow.telefono)

      const { data: byTel, error: telErr } = await supabase
        .from('conversaciones')
        .select(SELECT_CONV)
        .in('telefono', variantes)
        .order('timestamp', { ascending: false })
        .range(0, MAX_MENSAJES_POR_HILO - 1)

      if (!telErr && byTel && byTel.length > mensajesPorId.length) {
        console.warn(
          `[messages] Fallback telefono: lead_id=${leadId} → ${mensajesPorId.length} msgs, ` +
          `variantes=${variantes.join('|')} → ${byTel.length} msgs. ` +
          `Posible lead duplicado detectado.`
        )
        return NextResponse.json({ mensajes: [...byTel].reverse() })
      }
    }
  }

  return NextResponse.json({ mensajes: mensajesPorId.reverse() })
}
