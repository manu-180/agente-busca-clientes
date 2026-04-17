import { createSupabaseServer } from '@/lib/supabase-server'
import type { DecisionConfig } from '@/lib/response-decision'

function toBoolean(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  return value === 'true'
}

export async function obtenerConfigConversacional(): Promise<DecisionConfig> {
  const supabase = createSupabaseServer()
  const { data } = await supabase
    .from('configuracion')
    .select('clave, valor')
    .in('clave', [
      'decision_engine_enabled',
      'emoji_no_reply_enabled',
      'conversation_auto_close_enabled',
    ])

  const map = new Map((data ?? []).map(row => [row.clave, row.valor]))

  return {
    decisionEngineEnabled: toBoolean(map.get('decision_engine_enabled'), true),
    emojiNoReplyEnabled: toBoolean(map.get('emoji_no_reply_enabled'), true),
    conversationAutoCloseEnabled: toBoolean(map.get('conversation_auto_close_enabled'), true),
  }
}
