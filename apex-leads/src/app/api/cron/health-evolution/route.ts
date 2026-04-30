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
import { fetchAllInstances } from '@/lib/evolution-instance'
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
}

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
}

async function syncOne(
  supabase: SupabaseClient,
  sender: SenderRow,
  evoState: string | null,
  evoPhone: string | null
): Promise<SyncResult> {
  const next_connected = evoState === 'open'
  const changed = next_connected !== sender.connected

  let reason: string | null = null
  if (!next_connected) {
    if (evoState === 'close') reason = 'health_check_close'
    else if (evoState === 'connecting') reason = 'health_check_connecting'
    else if (evoState == null) reason = 'health_check_instance_missing'
    else reason = `health_check_${evoState}`
  }

  await updateHealthCheck(supabase, sender.id, {
    connected: next_connected,
    reason,
    phoneNumber: evoPhone,
  })

  return {
    instance_name: sender.instance_name,
    alias: sender.alias,
    prev_connected: sender.connected,
    evo_state: evoState ?? 'missing',
    next_connected,
    changed,
    reason,
  }
}

async function runHealthCheck(supabase: SupabaseClient) {
  // 1. Cargar todos los senders Evolution activos.
  const { data: senders, error } = await supabase
    .from('senders')
    .select('id, alias, instance_name, connected, phone_number')
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
        }))
    })
  )

  const transitions = results.filter(r => r.changed)
  if (transitions.length > 0) {
    console.log(
      `[health-evolution] ${transitions.length} transición(es): ` +
      transitions.map(t => `${t.alias ?? t.instance_name}:${t.prev_connected}→${t.next_connected}(${t.reason ?? 'open'})`).join(', ')
    )
  }

  return {
    ok: true,
    checked: results.length,
    transitions: transitions.length,
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
