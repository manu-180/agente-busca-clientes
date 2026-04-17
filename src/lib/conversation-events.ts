import { createSupabaseServer } from '@/lib/supabase-server'

interface EventoConversacional {
  leadId: string
  telefono: string
  eventName: string
  decisionAction?: string
  decisionReason?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export async function registrarEventoConversacional(evento: EventoConversacional): Promise<void> {
  const supabase = createSupabaseServer()
  const { error } = await supabase.from('conversational_events').insert({
    lead_id: evento.leadId,
    telefono: evento.telefono,
    event_name: evento.eventName,
    decision_action: evento.decisionAction ?? null,
    decision_reason: evento.decisionReason ?? null,
    confidence: evento.confidence ?? null,
    metadata: evento.metadata ?? {},
  })

  if (error) {
    // No bloquear el flujo de mensajería si falla la telemetría.
    console.warn('[EVENTOS] No se pudo registrar evento conversacional:', error.message)
  }
}
