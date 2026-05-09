import { createSupabaseServer } from '@/lib/supabase-server'
import {
  PLACES_FREE_MONTHLY_QUOTA,
  PlacesKey,
  currentMonthLabelPT,
  getConfiguredPlacesKeys,
} from './keys'

export interface KeyMonthUsage {
  label: string
  used: number
  quota: number
  exhausted: boolean
  last_used_at: string | null
  last_error: string | null
  last_error_at: string | null
}

export interface KeyStatus {
  label: string
  configured: boolean
  suffix: string | null
  used: number
  quota: number
  exhausted: boolean
  active: boolean // la "próxima" que rotaría — gauge a usar ahora
  last_used_at: string | null
  last_error: string | null
  last_error_at: string | null
}

export interface SelectedKey {
  key: PlacesKey
  used: number
}

/** Lee el uso de TODAS las keys configuradas para el mes actual. */
export async function getUsageForMonth(month: string): Promise<Map<string, KeyMonthUsage>> {
  const supabase = createSupabaseServer()
  const { data, error } = await supabase
    .from('places_api_key_usage')
    .select('key_label,requests_used,monthly_quota,last_used_at,last_error,last_error_at')
    .eq('month_yyyymm', month)

  const map = new Map<string, KeyMonthUsage>()
  if (error) {
    console.error('[places.quota] No se pudo leer places_api_key_usage:', error.message)
    return map
  }

  for (const row of data ?? []) {
    const used = Number(row.requests_used ?? 0)
    const quota = Number(row.monthly_quota ?? PLACES_FREE_MONTHLY_QUOTA)
    map.set(String(row.key_label), {
      label: String(row.key_label),
      used,
      quota,
      exhausted: used >= quota,
      last_used_at: row.last_used_at ? String(row.last_used_at) : null,
      last_error: row.last_error ? String(row.last_error) : null,
      last_error_at: row.last_error_at ? String(row.last_error_at) : null,
    })
  }
  return map
}

/**
 * Construye el snapshot público para la UI: todas las keys configuradas (más
 * los slots vacíos típicos para que el usuario vea cómo agregar la siguiente)
 * con su uso del mes actual y cuál sería la próxima a rotar.
 *
 * Expone únicamente el sufijo de cada key (4 chars), nunca el valor entero.
 */
export async function getKeysStatusForUi(): Promise<{ month: string; keys: KeyStatus[] }> {
  const month = currentMonthLabelPT()
  const configured = getConfiguredPlacesKeys()
  const usage = await getUsageForMonth(month)

  // Mostramos siempre al menos 3 slots (la #1 + dos siguientes vacíos), para
  // que el usuario sepa que puede sumar _2 y _3 con poner la env var.
  const minSlots = 3
  const totalSlots = Math.max(minSlots, configured.length + 1)

  // Determinar cuál es la "activa" = la próxima en rotación.
  let activeLabel: string | null = null
  for (const k of configured) {
    const u = usage.get(k.label)
    const used = u?.used ?? 0
    if (used < k.quota) {
      activeLabel = k.label
      break
    }
  }

  const out: KeyStatus[] = []
  for (let i = 0; i < totalSlots; i++) {
    const label = i === 0 ? 'GOOGLE_PLACES_API_KEY' : `GOOGLE_PLACES_API_KEY_${i + 1}`
    const cfg = configured.find((k) => k.label === label)
    const u = usage.get(label)
    const used = u?.used ?? 0
    const quota = cfg?.quota ?? PLACES_FREE_MONTHLY_QUOTA
    out.push({
      label,
      configured: Boolean(cfg),
      suffix: cfg?.suffix ?? null,
      used,
      quota,
      exhausted: Boolean(cfg) && used >= quota,
      active: Boolean(cfg) && label === activeLabel,
      last_used_at: u?.last_used_at ?? null,
      last_error: u?.last_error ?? null,
      last_error_at: u?.last_error_at ?? null,
    })
  }

  return { month, keys: out }
}

/**
 * Selecciona la primera key con cupo disponible este mes. La elección es
 * "best-effort" — la decisión final atómica la hace `consumeQuota()` vía RPC.
 * Devuelve null si no hay ninguna key configurada o todas están agotadas.
 */
export async function pickAvailableKey(): Promise<SelectedKey | null> {
  const keys = getConfiguredPlacesKeys()
  if (keys.length === 0) return null

  const usage = await getUsageForMonth(currentMonthLabelPT())
  for (const k of keys) {
    const used = usage.get(k.label)?.used ?? 0
    if (used < k.quota) return { key: k, used }
  }
  return null
}

/**
 * Incrementa de forma atómica el contador de la key. Devuelve el nuevo valor
 * (>=1) o null si la key ya estaba agotada en este mes.
 */
export async function consumeQuota(key: PlacesKey): Promise<number | null> {
  const supabase = createSupabaseServer()
  const month = currentMonthLabelPT()
  const { data, error } = await supabase.rpc('consume_places_quota', {
    p_label: key.label,
    p_month: month,
    p_quota: key.quota,
  })
  if (error) {
    console.error('[places.quota] consume_places_quota falló:', error.message)
    return null
  }
  if (data == null) return null
  return Number(data)
}

/** Anota un error contra la key (no consume cuota). Best-effort. */
export async function annotateKeyError(key: PlacesKey, message: string): Promise<void> {
  const supabase = createSupabaseServer()
  const month = currentMonthLabelPT()
  const truncated = message.length > 500 ? message.slice(0, 500) : message
  const { error } = await supabase.rpc('mark_places_quota_error', {
    p_label: key.label,
    p_month: month,
    p_quota: key.quota,
    p_error: truncated,
  })
  if (error) {
    console.error('[places.quota] mark_places_quota_error falló:', error.message)
  }
}
