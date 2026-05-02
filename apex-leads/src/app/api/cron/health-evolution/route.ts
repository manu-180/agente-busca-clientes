// Cron health-check de instancias Evolution.
//
// Corre cada 2 min (configurado vía Railway cron-pinger o vercel.json).
// Es la red de seguridad del webhook `connection.update` — si Evolution
// pierde un evento, este cron lo detecta en máximo 2 min.
//
// Responsabilidades:
//   1. Llamar `GET /instance/fetchInstances` y leer el estado real de cada
//      instancia que tenemos registrada como sender Evolution.
//   2. Sincronizar `senders.connected` con la verdad de Evolution.
//   3. Registrar `health_checked_at = now()` en todos los senders verificados.
//   4. Detectar instancias que existen en Evolution pero no en DB (orfas) y
//      viceversa (sender en DB sin instance en Evolution → marcar disconnected).
//
// Idempotente: correrlo dos veces seguidas no cambia nada si nada cambió.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { fetchAllInstances, restartInstance } from '@/lib/evolution-instance'
import { updateHealthCheck } from '@/lib/sender-pool'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SupabaseClient = ReturnType<typeof createSupabaseServer>

interface SenderRow {
  id: string
  alias: string | null
  instance_name: string
  connected: boolean
  phone_number: string | null
  disconnected_at: string | null
  disconnection_reason: string | null
}

// Si una instancia está close/connecting por más de este threshold, intentamos
// `restartInstance` automáticamente (sin necesidad de re-escanear QR — la cuenta
// sigue vinculada en el celular). Manuel reportó que tras un envío la sesión
// se cae, pero apretar "Reconectar QR" la levanta sin re-escanear: este cron
// hace ese paso solo.
const AUTO_RESTART_THRESHOLD_MS = 3 * 60_000

// Razones de desconexión que NO se recuperan con restart (requieren QR humano).
// Si el sender tiene una de éstas, no intentamos auto-restart.
const REASONS_REQUIRING_QR = new Set<string>([
  'device_removed',  // 401 Baileys: cuenta eliminada del celular
  'health_check_instance_missing',  // la instance ni existe en Evolution
])

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

interface SyncResult {
  instance_name: string
  alias: string | null
  prev_connected: boolean
  evo_state: string
  next_connected: boolean
  changed: boolean
  reason: string | null
  auto_restart_triggered: boolean
}

async function syncOne(
  supabase: SupabaseClient,
  sender: SenderRow,
  evoState: string | null,
  evoPhone: string | null
): Promise<SyncResult> {
  // 'connecting' es transitorio: puede ser un escaneo QR en curso o un auto-reconnect
  // de Baileys. Llamar restartInstance aquí mataría la reconexión activa. Llamar
  // updateHealthCheck(connected: false) resetearía disconnected_at, rompiendo el
  // threshold de auto-restart. Solo actualizamos health_checked_at y salimos.
  if (evoState === 'connecting') {
    await supabase
      .from('senders')
      .update({ health_checked_at: new Date().toISOString() })
      .eq('id', sender.id)
    return {
      instance_name: sender.instance_name,
      alias: sender.alias,
      prev_connected: sender.connected,
      evo_state: 'connecting',
      next_connected: sender.connected,
      changed: false,
      reason: null,
      auto_restart_triggered: false,
    }
  }

  const next_connected = evoState === 'open'
  const changed = next_connected !== sender.connected

  // Solo actualizamos reason/disconnected_at en la primera detección (transición
  // de estado o primera vez que vemos disconnected_at=null). En re-confirmaciones
  // preservamos el timestamp original para que el threshold de auto-restart funcione.
  const isFirstDetect = !next_connected && (changed || sender.disconnected_at === null)

  let reason: string | null = null
  if (!next_connected && isFirstDetect) {
    if (evoState === 'close') reason = 'health_check_close'
    else if (evoState == null) reason = 'health_check_instance_missing'
    else reason = `health_check_${evoState}`
  }

  await updateHealthCheck(supabase, sender.id, {
    connected: next_connected,
    reason,
    phoneNumber: evoPhone,
    preserveDisconnectedAt: !next_connected && !isFirstDetect,
  })

  // ── Auto-restart ──
  // Si la instancia lleva > AUTO_RESTART_THRESHOLD_MS caída y la razón NO es
  // device_removed (que requiere QR humano), disparamos `restartInstance` para
  // que Evolution intente reconectar el WebSocket. La cuenta sigue vinculada
  // en el celular, así que con reabrir el socket alcanza.
  let auto_restart_triggered = false
  if (!next_connected && evoState != null) {
    // Calcular cuánto lleva caída. Si `disconnected_at` está NULL pero `connected=false`
    // (ej: arranque del sistema), lo consideramos "caído desde ahora" y NO restart en
    // este tick (esperamos al próximo).
    const downSinceMs = sender.disconnected_at
      ? Date.now() - new Date(sender.disconnected_at).getTime()
      : 0

    const reasonExistente = sender.disconnection_reason ?? reason ?? ''
    const recoverable = !REASONS_REQUIRING_QR.has(reasonExistente)

    if (recoverable && downSinceMs >= AUTO_RESTART_THRESHOLD_MS) {
      try {
        await restartInstance(sender.instance_name)
        auto_restart_triggered = true
        console.log(
          `[health-evolution] auto-restart disparado: ${sender.alias ?? sender.instance_name} ` +
          `(down ${Math.floor(downSinceMs / 1000)}s, reason=${reasonExistente || 'unknown'})`
        )
      } catch (err) {
        console.error(
          `[health-evolution] auto-restart falló para ${sender.instance_name}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  return {
    instance_name: sender.instance_name,
    alias: sender.alias,
    prev_connected: sender.connected,
    evo_state: evoState ?? 'missing',
    next_connected,
    changed,
    reason,
    auto_restart_triggered,
  }
}

async function runHealthCheck(supabase: SupabaseClient) {
  // 1. Cargar todos los senders Evolution activos.
  const { data: senders, error } = await supabase
    .from('senders')
    .select('id, alias, instance_name, connected, phone_number, disconnected_at, disconnection_reason')
    .eq('provider', 'evolution')
    .eq('activo', true)
    .order('created_at', { ascending: true })

  if (error) {
    return { ok: false, error: `db_select_failed: ${error.message}` }
  }
  const senderRows = (senders ?? []) as SenderRow[]
  if (senderRows.length === 0) {
    return { ok: true, checked: 0, results: [] }
  }

  // 2. Pedir el estado real a Evolution.
  let instances: Array<{ name: string; state: string; phone: string | null }>
  try {
    instances = await fetchAllInstances()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[health-evolution] fetchAllInstances falló:', msg)
    return { ok: false, error: `fetchAllInstances_failed: ${msg}` }
  }

  const byName = new Map(instances.map(i => [i.name, i]))

  // 3. Sincronizar cada sender en paralelo (operaciones independientes en DB).
  const results = await Promise.all(
    senderRows.map(s => {
      const evo = byName.get(s.instance_name)
      return syncOne(supabase, s, evo?.state ?? null, evo?.phone ?? null)
        .catch(err => ({
          instance_name: s.instance_name,
          alias: s.alias,
          prev_connected: s.connected,
          evo_state: 'error',
          next_connected: s.connected,
          changed: false,
          reason: `sync_error: ${err instanceof Error ? err.message : String(err)}`,
          auto_restart_triggered: false,
        }))
    })
  )

  const transitions = results.filter(r => r.changed)
  const restarts = results.filter(r => r.auto_restart_triggered)
  if (transitions.length > 0) {
    console.log(
      `[health-evolution] ${transitions.length} transición(es): ` +
      transitions.map(t => `${t.alias ?? t.instance_name}:${t.prev_connected}→${t.next_connected}(${t.reason ?? 'open'})`).join(', ')
    )
  }
  if (restarts.length > 0) {
    console.log(
      `[health-evolution] ${restarts.length} auto-restart(s): ` +
      restarts.map(r => r.alias ?? r.instance_name).join(', ')
    )
  }

  return {
    ok: true,
    checked: results.length,
    transitions: transitions.length,
    auto_restarts: restarts.length,
    results,
  }
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createSupabaseServer()
  const result = await runHealthCheck(supabase)
  const status = result.ok ? 200 : 500
  return NextResponse.json(result, { status })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
