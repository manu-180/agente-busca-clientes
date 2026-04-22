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

  return NextResponse.json({ mensajes: [...(data ?? [])].reverse() })
}
