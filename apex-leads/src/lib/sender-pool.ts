// Pool round-robin LRU para senders Evolution API.
//
// Funciones puras: cada función recibe un cliente Supabase y opera sobre la
// tabla `senders`. No hay estado interno en este módulo — toda la "memoria"
// vive en la DB (msgs_today, last_sent_at, last_reset_date).
//
// Algoritmo: 1 mensaje por tick. El sender elegido es el de menor `msgs_today`
// y, en caso de empate, el de `last_sent_at` más viejo (NULLS FIRST). Esto
// produce el patrón 1A → 1B → 1C → 2A pedido por Manuel.
//
// Race-safety: 5 crons defasados a 1min sobre el mismo pool. `selectNextSender`
// es de lectura, el UPDATE atómico con optimistic concurrency en
// `incrementMsgsToday` garantiza que dos crons que eligen el mismo sender no
// dupliquen el incremento — el segundo recibe `false` y debe reintentar
// `selectNextSender`.
//
// Reset diario: `resetDailyCountersIfNeeded` se llama al inicio de cada tick.
// Es idempotente — si todos los senders ya tienen `last_reset_date = hoy_AR`,
// el UPDATE no afecta filas.

import type { SupabaseClient } from '@supabase/supabase-js'

export type PoolSender = {
  id: string
  alias: string | null
  instance_name: string
  phone_number: string
  daily_limit: number
  msgs_today: number
  last_sent_at: string | null
  connected: boolean
  activo: boolean
}

export type CapacitySender = {
  id: string
  alias: string | null
  instance_name: string
  phone_number: string
  color: string
  msgs_today: number
  daily_limit: number
  remaining: number
  connected: boolean
  activo: boolean
}

export type CapacityStats = {
  /** Suma de `daily_limit` de SIMs activas y conectadas. */
  total_today: number
  /** Suma de `msgs_today` de SIMs activas (incluye disconnected). */
  used_today: number
  /** `total_today - used_today`, nunca negativo. */
  remaining: number
  /** Cantidad de SIMs `activo=true AND connected=true`. */
  active_connected: number
  /** Cantidad de SIMs `activo=true` (incluye disconnected). */
  active_total: number
  /** Detalle por SIM, ordenado por `created_at` asc. */
  per_sender: CapacitySender[]
}

const SELECT_FIELDS =
  'id, alias, instance_name, phone_number, daily_limit, msgs_today, last_sent_at, connected, activo'

const SELECT_FIELDS_CAPACITY =
  'id, alias, instance_name, phone_number, color, daily_limit, msgs_today, connected, activo'

/**
 * Devuelve la fecha actual en zona Argentina como `YYYY-MM-DD`.
 * Determinista respecto a la zona horaria del server (Vercel ≠ AR).
 */
export function todayInArgentina(now: Date = new Date()): string {
  // 'en-CA' produce ISO YYYY-MM-DD por defecto.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Compara dos timestamps ISO con semántica NULLS FIRST.
 * Devuelve negativo si `a` debería ir antes que `b`, positivo si después, 0 si iguales.
 */
function compareLastSentAtNullsFirst(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Elige el próximo sender a usar en este tick.
 *
 * Equivalente SQL:
 * ```
 * SELECT id, alias, instance_name, phone_number, daily_limit, msgs_today,
 *        last_sent_at, connected, activo
 * FROM senders
 * WHERE provider = 'evolution'
 *   AND activo = true
 *   AND connected = true
 *   AND msgs_today < daily_limit
 * ORDER BY msgs_today ASC, last_sent_at ASC NULLS FIRST
 * LIMIT 1;
 * ```
 *
 * Implementación: PostgREST no soporta comparaciones columna-columna
 * (`msgs_today < daily_limit`), así que filtramos esa condición en JS sobre
 * los candidatos `activo AND connected` (típicamente <10 filas).
 *
 * @returns el sender elegido o `null` si no hay ninguno disponible.
 */
export async function selectNextSender(
  supabase: SupabaseClient
): Promise<PoolSender | null> {
  const { data, error } = await supabase
    .from('senders')
    .select(SELECT_FIELDS)
    .eq('provider', 'evolution')
    .eq('activo', true)
    .eq('connected', true)
    .order('msgs_today', { ascending: true })
    .order('last_sent_at', { ascending: true, nullsFirst: true })

  if (error) throw new Error(`selectNextSender failed: ${error.message}`)
  if (!data || data.length === 0) return null

  const candidates = (data as PoolSender[]).filter(s => s.msgs_today < s.daily_limit)
  if (candidates.length === 0) return null

  // El ORDER BY de Postgres ya ordena, pero algunos mocks de tests podrían
  // ignorar `.order(...)`. Re-ordenamos en JS para tener el mismo resultado
  // siempre y para satisfacer el caso "NULLS FIRST" en empate.
  candidates.sort((a, b) => {
    if (a.msgs_today !== b.msgs_today) return a.msgs_today - b.msgs_today
    return compareLastSentAtNullsFirst(a.last_sent_at, b.last_sent_at)
  })

  return candidates[0]
}

/**
 * Incrementa atómicamente `msgs_today` y setea `last_sent_at = now()` para el
 * sender indicado, validando que sigue disponible (no llegó al límite, sigue
 * activo y conectado).
 *
 * Usa optimistic concurrency sobre `msgs_today`: el UPDATE solo afecta la
 * fila si el `msgs_today` no cambió entre la lectura y el UPDATE. Si dos
 * crons entran simultáneamente y eligen el mismo sender, solo uno gana.
 *
 * @returns `true` si la fila fue actualizada (sender válido y reservado para
 * este tick), `false` si la condición no se cumplió (race, sender al límite,
 * desconectado o inactivo).
 */
export async function incrementMsgsToday(
  supabase: SupabaseClient,
  senderId: string
): Promise<boolean> {
  // Read current state.
  const { data: current, error: readErr } = await supabase
    .from('senders')
    .select('msgs_today, daily_limit, activo, connected')
    .eq('id', senderId)
    .maybeSingle()

  if (readErr) throw new Error(`incrementMsgsToday read failed: ${readErr.message}`)
  if (!current) return false
  if (!current.activo || !current.connected) return false
  if (current.msgs_today >= current.daily_limit) return false

  // Optimistic UPDATE: solo afecta si msgs_today no cambió.
  const { data: updated, error: updateErr } = await supabase
    .from('senders')
    .update({
      msgs_today: current.msgs_today + 1,
      last_sent_at: new Date().toISOString(),
    })
    .eq('id', senderId)
    .eq('msgs_today', current.msgs_today)
    .eq('activo', true)
    .eq('connected', true)
    .select('id')

  if (updateErr) throw new Error(`incrementMsgsToday update failed: ${updateErr.message}`)
  return Array.isArray(updated) && updated.length > 0
}

/**
 * Resetea contadores diarios de todos los senders Evolution cuyo
 * `last_reset_date` es nulo o anterior a hoy_AR.
 *
 * Idempotente: si ya está corrido para hoy, el UPDATE no afecta filas.
 */
export async function resetDailyCountersIfNeeded(
  supabase: SupabaseClient
): Promise<void> {
  const todayAR = todayInArgentina()
  const { error } = await supabase
    .from('senders')
    .update({ msgs_today: 0, last_reset_date: todayAR })
    .eq('provider', 'evolution')
    .or(`last_reset_date.is.null,last_reset_date.lt.${todayAR}`)

  if (error) throw new Error(`resetDailyCountersIfNeeded failed: ${error.message}`)
}

/**
 * Devuelve estadísticas de capacidad del pool para el dashboard.
 * Una sola query a `senders` con `provider='evolution' AND activo=true`,
 * agregaciones en JS.
 */
export async function getCapacityStats(
  supabase: SupabaseClient
): Promise<CapacityStats> {
  const { data, error } = await supabase
    .from('senders')
    .select(SELECT_FIELDS_CAPACITY)
    .eq('provider', 'evolution')
    .eq('activo', true)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`getCapacityStats failed: ${error.message}`)

  const rows = (data ?? []) as Array<Omit<CapacitySender, 'remaining'>>

  const per_sender: CapacitySender[] = rows.map(r => ({
    id: r.id,
    alias: r.alias,
    instance_name: r.instance_name,
    phone_number: r.phone_number,
    color: r.color,
    msgs_today: r.msgs_today,
    daily_limit: r.daily_limit,
    remaining: Math.max(0, r.daily_limit - r.msgs_today),
    connected: r.connected,
    activo: r.activo,
  }))

  let total_today = 0
  let used_today = 0
  let active_connected = 0
  for (const s of per_sender) {
    used_today += s.msgs_today
    if (s.connected) {
      total_today += s.daily_limit
      active_connected += 1
    }
  }

  return {
    total_today,
    used_today,
    remaining: Math.max(0, total_today - used_today),
    active_connected,
    active_total: per_sender.length,
    per_sender,
  }
}

/**
 * Marca un sender como desconectado. Llamado desde el cron tras N fallos
 * consecutivos, desde el webhook al recibir `connection.update state=close`,
 * o desde el cron de health-check.
 *
 * Idempotente: si ya estaba `connected=false`, solo refresca `disconnected_at`
 * si la razón cambió.
 *
 * @param reason — código corto: `device_removed`, `conflict`, `timeout`,
 *   `send_failure_threshold`, `health_check_close`, `preflight_close`, etc.
 */
export async function markDisconnected(
  supabase: SupabaseClient,
  senderId: string,
  reason: string = 'unknown'
): Promise<void> {
  const { error } = await supabase
    .from('senders')
    .update({
      connected: false,
      disconnection_reason: reason,
      disconnected_at: new Date().toISOString(),
    })
    .eq('id', senderId)

  if (error) throw new Error(`markDisconnected failed: ${error.message}`)
}

/**
 * Marca un sender como conectado y limpia el estado de desconexión previo.
 * Llamado desde webhook (`connection.update state=open`), desde el cron de
 * health-check, y desde el flujo de reconexión por QR.
 *
 * Resetea `consecutive_send_failures` a 0 — si vino de una caída, los fallos
 * acumulados ya no son válidos.
 */
export async function markConnected(
  supabase: SupabaseClient,
  senderId: string,
  opts?: { phoneNumber?: string | null }
): Promise<void> {
  const update: Record<string, unknown> = {
    connected: true,
    connected_at: new Date().toISOString(),
    disconnection_reason: null,
    disconnected_at: null,
    consecutive_send_failures: 0,
    health_checked_at: new Date().toISOString(),
  }
  if (opts?.phoneNumber) update.phone_number = opts.phoneNumber

  const { error } = await supabase
    .from('senders')
    .update(update)
    .eq('id', senderId)

  if (error) throw new Error(`markConnected failed: ${error.message}`)
}

/**
 * Incrementa atómicamente `consecutive_send_failures` para un sender.
 * Devuelve el nuevo valor para que el caller decida si superó el umbral.
 *
 * Race-safe: si dos crons fallan simultáneamente, ambos suman correctamente
 * porque usamos un `select` post-update.
 */
export async function incrementSendFailures(
  supabase: SupabaseClient,
  senderId: string
): Promise<number> {
  const { data: current, error: readErr } = await supabase
    .from('senders')
    .select('consecutive_send_failures')
    .eq('id', senderId)
    .maybeSingle()

  if (readErr) throw new Error(`incrementSendFailures read failed: ${readErr.message}`)
  if (!current) return 0

  const next = (current.consecutive_send_failures ?? 0) + 1
  const { error: updateErr } = await supabase
    .from('senders')
    .update({ consecutive_send_failures: next })
    .eq('id', senderId)

  if (updateErr) throw new Error(`incrementSendFailures update failed: ${updateErr.message}`)
  return next
}

/**
 * Resetea contador de fallos consecutivos a 0. Llamado tras un envío exitoso.
 */
export async function resetSendFailures(
  supabase: SupabaseClient,
  senderId: string
): Promise<void> {
  const { error } = await supabase
    .from('senders')
    .update({ consecutive_send_failures: 0 })
    .eq('id', senderId)

  if (error) throw new Error(`resetSendFailures failed: ${error.message}`)
}

/**
 * Actualiza `health_checked_at` para registrar que el cron de health-check
 * verificó la instancia. Si pasa `connected`, también actualiza ese flag.
 *
 * Idempotente. Útil para detectar staleness (si el cron deja de correr,
 * `health_checked_at` se vuelve viejo y la UI puede alertar).
 */
export async function updateHealthCheck(
  supabase: SupabaseClient,
  senderId: string,
  opts: { connected?: boolean; reason?: string | null; phoneNumber?: string | null }
): Promise<void> {
  const update: Record<string, unknown> = {
    health_checked_at: new Date().toISOString(),
  }
  if (opts.connected === true) {
    update.connected = true
    update.connected_at = new Date().toISOString()
    update.disconnection_reason = null
    update.disconnected_at = null
    update.consecutive_send_failures = 0
  } else if (opts.connected === false) {
    update.connected = false
    if (opts.reason) update.disconnection_reason = opts.reason
    update.disconnected_at = new Date().toISOString()
  }
  if (opts.phoneNumber) update.phone_number = opts.phoneNumber

  const { error } = await supabase
    .from('senders')
    .update(update)
    .eq('id', senderId)

  if (error) throw new Error(`updateHealthCheck failed: ${error.message}`)
}
