// Lifecycle de senders Evolution: detección de baneo, warming ramp y promoción
// automática de reserva. Complementa a `sender-pool.ts` (la selección round-robin).
//
// Mismo contrato que sender-pool.ts: funciones puras que reciben un cliente
// Supabase y operan sobre la tabla `senders`. No hay estado de módulo — toda la
// memoria vive en la DB (status, warmup_started_at, daily_limit, banned_at, ...).
//
// Máquina de estados (columna `senders.status`, ver migración
// 20260615130000_sender-lifecycle.sql):
//
//   reserve  → vinculado y conectado, esperando turno (capacidad de reserva).
//   warming  → chip nuevo en ramp-up; daily_limit sube gradual por días.
//   active   → chip maduro, en el pool a tope.
//   banned   → WhatsApp lo baneó (device_removed/code_403). Terminal.
//   archived → retirado a mano. Terminal.
//
// Race-safety: igual que sender-pool.ts, los UPDATE que dependen del estado
// previo usan optimistic concurrency (filtran por el valor leído). Si dos ticks
// concurrentes intentan la misma transición, solo uno afecta la fila; el otro
// recibe `false`/`null` y no duplica el efecto.
//
// NOTA Fase 1: la INTEGRACIÓN de estas funciones (enganchar markBanned en el
// webhook/cron, integrar `status` en selectNextSender) es Fase 2. Este módulo
// solo provee las piezas puras y testeadas.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Razones de desconexión que significan baneo real de WhatsApp (terminal).
 * `device_removed` (401: cuenta eliminada del celular) y `code_403` (prohibido)
 * son los dos códigos que en el diagnóstico del pool real correspondieron a
 * baneos de WhatsApp — NO se recuperan con restartInstance.
 */
export const BAN_REASONS: ReadonlySet<string> = new Set(['device_removed', 'code_403'])

/** Estados terminales: no se reintenta reconectar ni entran al pool. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['banned', 'archived'])

/** Sender promovido desde reserva/warming (proyección mínima). */
export type PromotedSender = {
  id: string
  alias: string | null
  instance_name: string
  status: string
  warmup_started_at: string | null
  daily_limit_target: number
}

/** Resumen de un tick de warming (cuántos senders se recalcularon/graduaron). */
export type WarmingTickSummary = {
  /** Senders en status='warming' procesados en este tick. */
  procesados: number
  /** Senders cuyo daily_limit cambió (se actualizó el ramp). */
  actualizados: number
  /** Senders que completaron el ramp y pasaron a status='active'. */
  graduados: number
}

const PROMOTE_FIELDS = 'id, alias, instance_name, status, warmup_started_at, daily_limit_target'

/**
 * Clasifica una razón de desconexión como baneo terminal o caída temporal.
 *
 * - `'banned'`    → la razón está en BAN_REASONS (device_removed/code_403):
 *                   sacar del pool y NO reintentar revivir.
 * - `'temporary'` → cualquier otra cosa (incl. null): caída recuperable
 *                   (preflight_close, timeout, health_check_close, etc.).
 *
 * Pura y sin DB: testeable directo.
 */
export function classifyDisconnection(reason: string | null): 'banned' | 'temporary' {
  if (reason !== null && BAN_REASONS.has(reason)) return 'banned'
  return 'temporary'
}

/**
 * Cantidad de días enteros transcurridos entre dos fechas (UTC, por día de
 * calendario aproximado vía milisegundos). La zona horaria es irrelevante para
 * el ramp: solo importa cuántos días pasó el chip en warming, no la hora exacta.
 *
 * Clampa a 0 si `now` es anterior a `start` (relojes desfasados / fecha futura).
 */
function diasTranscurridos(start: Date, now: Date): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000
  const delta = now.getTime() - start.getTime()
  if (delta <= 0) return 0
  return Math.floor(delta / MS_POR_DIA)
}

/**
 * daily_limit efectivo de un chip en warming, según los días que lleva.
 *
 * Ramp determinista (días transcurridos desde `warmupStartedAt`):
 *   día 0-1   → 5
 *   día 2-3   → 10
 *   día 4-6   → 15
 *   día 7-9   → 20
 *   día 10-13 → 25
 *   día 14+   → target
 *
 * El resultado SIEMPRE se capea a `target` (si target es bajo, ej. 15, el ramp
 * nunca lo supera y "completa" antes de llegar al tramo de 25).
 *
 * `warmupStartedAt = null` se trata como día 0 (chip recién puesto en warming).
 *
 * Pura y sin DB: testeable directo. `now` inyectable para tests.
 */
export function warmingDailyLimit(
  warmupStartedAt: string | null,
  target: number,
  now: Date = new Date()
): number {
  const dias = warmupStartedAt === null ? 0 : diasTranscurridos(new Date(warmupStartedAt), now)

  let base: number
  if (dias <= 1) base = 5
  else if (dias <= 3) base = 10
  else if (dias <= 6) base = 15
  else if (dias <= 9) base = 20
  else if (dias <= 13) base = 25
  else base = target

  return Math.min(base, target)
}

/**
 * `true` cuando el warming ramp ya alcanzó `target` para este chip.
 *
 * Se cumple cuando el límite calculado iguala (o supera) el target — lo que pasa
 * a partir del día 14 con un target normal, o antes si el target es bajo y el
 * ramp lo capeó. Una vez completo, `tickWarming` lo gradúa a status='active'.
 *
 * Pura y sin DB.
 */
export function isWarmupComplete(
  warmupStartedAt: string | null,
  target: number,
  now: Date = new Date()
): boolean {
  return warmingDailyLimit(warmupStartedAt, target, now) >= target
}

/**
 * Marca un sender como baneado (terminal) de forma ATÓMICA. Setea
 * status='banned', banned_at=now, ban_reason=reason, activo=false, connected=false,
 * pero SOLO si no estaba ya 'banned' (optimistic guard `.neq('status','banned')`).
 *
 * Llamarlo cuando el webhook detecta una razón de baneo
 * (classifyDisconnection === 'banned'): saca el número del pool y corta el ciclo de
 * auto-restart (el health-check ya excluye status banned).
 *
 * @returns `true` solo si ESTE call hizo la transición (no estaba banned y ahora
 * sí); `false` si ya estaba banned o el sender no existe. El caller usa el boolean
 * para promover/alertar UNA sola vez — sin esto, connection.update repetidos o dos
 * webhooks concurrentes para el mismo chip dispararían doble-promote y spam de
 * alertas (la lectura-previa-del-status no es atómica respecto al UPDATE).
 */
export async function markBanned(
  supabase: SupabaseClient,
  senderId: string,
  reason: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('senders')
    .update({
      status: 'banned',
      activo: false,
      connected: false,
      banned_at: new Date().toISOString(),
      ban_reason: reason,
    })
    .eq('id', senderId)
    .neq('status', 'banned')
    .select('id')

  if (error) throw new Error(`markBanned failed: ${error.message}`)

  return Array.isArray(data) && data.length > 0
}

/**
 * Promueve el sender de reserva/warming más conveniente para cubrir una baja del
 * pool (típicamente: tras banear un active, mantener capacidad).
 *
 * Selección: entre los `status IN ('reserve','warming')` con `connected=true`,
 * prioriza los `reserve` y, dentro de ellos, el más viejo (`created_at` asc) —
 * el que más tiempo lleva vinculado, listo para empezar a producir. Si no hay
 * reserve disponible, toma el warming más viejo (ya está rampeando, no requiere
 * acción adicional).
 *
 * Si el elegido está en `reserve`, lo pasa a `warming` arrancando el ramp
 * (`warmup_started_at = now`). Si ya estaba en `warming`, lo devuelve tal cual.
 *
 * Race-safety: el paso reserve→warming usa optimistic concurrency
 * (`.eq('status','reserve')`). Si otro tick promovió el mismo sender entre la
 * lectura y el UPDATE, el UPDATE no afecta filas → reintentamos la búsqueda.
 *
 * @returns el sender promovido (o el warming ya existente), o `null` si no hay
 * ninguno disponible para promover.
 */
export async function promoteFromReserve(
  supabase: SupabaseClient,
  opts?: { maxRetries?: number }
): Promise<PromotedSender | null> {
  const maxRetries = opts?.maxRetries ?? 3

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, error } = await supabase
      .from('senders')
      .select(PROMOTE_FIELDS)
      .eq('provider', 'evolution')
      .eq('connected', true)
      .in('status', ['reserve', 'warming'])
      .order('created_at', { ascending: true })

    if (error) throw new Error(`promoteFromReserve select failed: ${error.message}`)
    if (!data || data.length === 0) return null

    const candidatos = data as PromotedSender[]
    // Preferimos reserve (más viejo primero); si no hay, el warming más viejo.
    const elegido =
      candidatos.find(s => s.status === 'reserve') ??
      candidatos.find(s => s.status === 'warming') ??
      null

    if (!elegido) return null

    // Ya está rampeando: nada que transicionar, lo devolvemos.
    if (elegido.status === 'warming') return elegido

    // reserve → warming con optimistic concurrency sobre status.
    const warmupStartedAt = new Date().toISOString()
    const { data: updated, error: updateErr } = await supabase
      .from('senders')
      .update({
        status: 'warming',
        warmup_started_at: warmupStartedAt,
        // Arranca en el límite day-0 del ramp (capeado al target del chip). Sin esto,
        // el chip recién promovido conservaría su daily_limit viejo (típicamente 30) y
        // selectNextSender lo dejaría enviar a tope al instante — justo el blast que el
        // warming evita, y en el peor momento (recién baneado un activo). tickWarming
        // lo refina después (es idempotente).
        daily_limit: warmingDailyLimit(null, elegido.daily_limit_target),
      })
      .eq('id', elegido.id)
      .eq('status', 'reserve')
      .select(PROMOTE_FIELDS)

    if (updateErr) throw new Error(`promoteFromReserve update failed: ${updateErr.message}`)

    // UPDATE afectó la fila → ganamos la transición.
    if (Array.isArray(updated) && updated.length > 0) {
      return updated[0] as PromotedSender
    }

    // Race perdida: otro tick lo promovió. Reintentamos la búsqueda.
  }

  return null
}

/**
 * Tick de warming: para cada sender en `status='warming'`, recalcula su
 * `daily_limit` con `warmingDailyLimit` y, si el ramp alcanzó el target
 * (`isWarmupComplete`), lo gradúa a `status='active'`.
 *
 * Pensado para correr periódicamente (cron). Idempotente: si un sender ya tiene
 * el daily_limit que le corresponde por días, su UPDATE no cambia nada.
 *
 * Lee `daily_limit_target` por sender (cada chip puede tener su propio techo).
 *
 * @returns resumen { procesados, actualizados, graduados }.
 */
export async function tickWarming(supabase: SupabaseClient): Promise<WarmingTickSummary> {
  const { data, error } = await supabase
    .from('senders')
    .select('id, daily_limit, daily_limit_target, warmup_started_at')
    .eq('provider', 'evolution')
    .eq('status', 'warming')

  if (error) throw new Error(`tickWarming select failed: ${error.message}`)

  const rows = (data ?? []) as Array<{
    id: string
    daily_limit: number
    daily_limit_target: number
    warmup_started_at: string | null
  }>

  const now = new Date()
  let actualizados = 0
  let graduados = 0

  for (const s of rows) {
    const target = s.daily_limit_target
    const nuevoLimit = warmingDailyLimit(s.warmup_started_at, target, now)
    const completo = isWarmupComplete(s.warmup_started_at, target, now)

    const update: Record<string, unknown> = {}
    if (nuevoLimit !== s.daily_limit) update.daily_limit = nuevoLimit
    if (completo) {
      // Graduación: pasa al pool a tope. daily_limit queda en target (== nuevoLimit
      // cuando completo, porque el ramp ya capeó).
      update.status = 'active'
      update.daily_limit = target
    }

    if (Object.keys(update).length === 0) continue

    const { error: updateErr } = await supabase
      .from('senders')
      .update(update)
      .eq('id', s.id)
      // Optimistic guard: solo si sigue en warming (no pisar uno que otro tick
      // ya graduó o que fue baneado entremedio).
      .eq('status', 'warming')

    if (updateErr) throw new Error(`tickWarming update failed: ${updateErr.message}`)

    // Categorías mutuamente excluyentes: un sender que gradúa cuenta solo como
    // `graduados` (aunque su daily_limit haya cambiado al subir a target).
    // `actualizados` = subió de escalón pero todavía no completó el ramp.
    if (completo) graduados += 1
    else if (update.daily_limit !== undefined && update.daily_limit !== s.daily_limit) actualizados += 1
  }

  return { procesados: rows.length, actualizados, graduados }
}
