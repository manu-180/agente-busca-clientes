import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeEvolution } from '@/lib/evolution'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

const SELECT_CONV = `
  id, lead_id, telefono, mensaje, rol, tipo_mensaje,
  timestamp, leido, manual, es_followup,
  sender:sender_id (id, alias, color, provider, phone_number)
` as const

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje, lead_id, sender_id } = body

  if (!telefono || !mensaje) {
    return NextResponse.json({ error: 'Faltan telefono o mensaje' }, { status: 400 })
  }

  if (isTelefonoHardBlocked(telefono)) {
    return NextResponse.json({ error: 'Teléfono en lista de bloqueo' }, { status: 403 })
  }

  const supabase = createSupabaseServer()

  // ─── Resolver sender con prioridad estricta ──────────────────────────────
  // 1. sender_id explícito del body (enviado por la UI)
  // 2. sender_id anclado en el lead
  // 3. Último mensaje del CLIENTE con sender_id no nulo
  let resolvedSenderId: string | null = sender_id ?? null

  if (!resolvedSenderId && lead_id) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('sender_id')
      .eq('id', lead_id)
      .maybeSingle()
    resolvedSenderId = (leadRow?.sender_id as string | null) ?? null
  }

  if (!resolvedSenderId && lead_id) {
    const { data: ultimaConvCliente } = await supabase
      .from('conversaciones')
      .select('sender_id')
      .eq('lead_id', lead_id)
      .eq('rol', 'cliente')
      .not('sender_id', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedSenderId = (ultimaConvCliente?.sender_id as string | null) ?? null
  }

  const { data: senderData } = resolvedSenderId
    ? await supabase.from('senders').select('*').eq('id', resolvedSenderId).single()
    : { data: null }

  const instanceName = senderData?.instance_name as string | undefined
  if (!instanceName) {
    return NextResponse.json({ error: 'No se encontró una instancia Evolution API para este sender' }, { status: 400 })
  }

  try {
    await enviarMensajeEvolution(telefono, mensaje, instanceName)

    let conversacion: Record<string, unknown> | null = null
    if (lead_id) {
      const { data: insertada, error: insertError } = await supabase
        .from('conversaciones')
        .insert({
          lead_id,
          telefono,
          mensaje,
          rol: 'agente',
          tipo_mensaje: 'texto',
          manual: true,
          sender_id: resolvedSenderId ?? null,
        })
        .select(SELECT_CONV)
        .single()

      if (insertError) {
        console.error('[API] Error guardando mensaje manual:', insertError.message)
        return NextResponse.json({ error: `Mensaje enviado pero no guardado en DB: ${insertError.message}` }, { status: 500 })
      }

      conversacion = insertada as Record<string, unknown>
    }

    return NextResponse.json({ ok: true, conversacion })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[API] Error enviando mensaje:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
