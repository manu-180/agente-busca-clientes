import { createSupabaseServer } from '@/lib/supabase-server'
import type { DecisionConfig } from '@/lib/response-decision'

function toBoolean(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  return value === 'true'
}

// Estos 3 flags se leían de `configuracion` en CADA mensaje. Cambian rara vez
// (toggles manuales del admin), así que los cacheamos en memoria con TTL corto.
// Un cambio de flag propaga en <= CONFIG_TTL_MS.
const CONFIG_TTL_MS = Number(process.env.CONV_CONFIG_TTL_MS ?? 60_000)
let configCache: { value: DecisionConfig; expiresAt: number } | null = null

export async function obtenerConfigConversacional(): Promise<DecisionConfig> {
  const now = Date.now()
  if (configCache && now < configCache.expiresAt) return configCache.value

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

  const value: DecisionConfig = {
    decisionEngineEnabled: toBoolean(map.get('decision_engine_enabled'), true),
    emojiNoReplyEnabled: toBoolean(map.get('emoji_no_reply_enabled'), true),
    conversationAutoCloseEnabled: toBoolean(map.get('conversation_auto_close_enabled'), true),
  }
  configCache = { value, expiresAt: now + CONFIG_TTL_MS }
  return value
}
