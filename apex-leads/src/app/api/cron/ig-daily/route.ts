/**
 * Cron: daily 09:15 ART (12:15 UTC).
 * Selects top-N qualified leads and schedules their DMs with gaussian jitter
 * distributed across 09:30–21:30 ART.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DAILY_LIMIT = igConfig.DAILY_DM_LIMIT
const IG_SENDER = igConfig.IG_SENDER_USERNAME
// Warmup mode: cap at 3 DMs during first 14 days of operation
const WARMUP_MODE = igConfig.IG_WARMUP_MODE
const WARMUP_LIMIT = 3

// Window: 07:00–21:00 ART = 10:00–00:00 UTC
const WINDOW_START_UTC_HOUR = 10
const WINDOW_START_UTC_MIN = 0
const WINDOW_DURATION_MINUTES = 14 * 60 // 14 hours

function authCron(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${igConfig.CRON_SECRET}`
}

function gaussianRandom(mean: number, stdDev: number): number {
  // Box-Muller transform
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stdDev
}

function scheduleTimestamps(count: number): Date[] {
  const today = new Date()
  // Build window start in UTC
  const windowStart = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      WINDOW_START_UTC_HOUR,
      WINDOW_START_UTC_MIN,
    ),
  )

  // If we're already past window start, push to tomorrow
  if (Date.now() > windowStart.getTime()) {
    windowStart.setUTCDate(windowStart.getUTCDate() + 1)
  }

  const slots: Date[] = []
  // Space DMs evenly across window with gaussian jitter
  // μ = window_duration / count, σ = μ * 0.3, floor = 4 min
  const baseIntervalMs = (WINDOW_DURATION_MINUTES * 60 * 1000) / count
  const sigmaMs = baseIntervalMs * 0.3
  const floorMs = 4 * 60 * 1000

  let cursor = windowStart.getTime()
  for (let i = 0; i < count; i++) {
    const jitteredMs = Math.max(floorMs, gaussianRandom(baseIntervalMs, sigmaMs))
    cursor += jitteredMs
    slots.push(new Date(cursor))
  }

  return slots
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()
  const limit = WARMUP_MODE ? WARMUP_LIMIT : DAILY_LIMIT

  // Check circuit breaker
  const { data: healthRows } = await supabase
    .from('account_health_log')
    .select('event, cooldown_until')
    .eq('sender_ig', IG_SENDER)
    .gt('cooldown_until', new Date().toISOString())
    .limit(1)

  if (healthRows?.length) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: 'circuit_open',
      event: healthRows[0].event,
      cooldown_until: healthRows[0].cooldown_until,
    })
  }

  // Check today's quota
  const today = new Date().toISOString().split('T')[0]
  const { data: quota } = await supabase
    .from('dm_daily_quota')
    .select('dms_sent')
    .eq('sender_ig_username', IG_SENDER)
    .eq('day', today)
    .single()

  const alreadySent = quota?.dms_sent ?? 0
  const remaining = limit - alreadySent

  if (remaining <= 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'quota_full', alreadySent })
  }

  // Pick top leads by score
  const { data: leads, error } = await supabase
    .from('instagram_leads')
    .select('id, ig_username, lead_score')
    .eq('status', 'qualified')
    .eq('do_not_contact', false)
    .eq('dm_sent_count', 0)
    .order('lead_score', { ascending: false })
    .limit(remaining)

  if (error || !leads?.length) {
    return NextResponse.json({ ok: true, queued: 0, reason: error?.message ?? 'no qualified leads' })
  }

  const timestamps = scheduleTimestamps(leads.length)

  const queueRows = leads.map((lead, i) => ({
    lead_id: lead.id,
    scheduled_at: timestamps[i].toISOString(),
  }))

  const { error: qErr } = await supabase.from('dm_queue').insert(queueRows)

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 })
  }

  // Mark as queued
  const leadIds = leads.map((l) => l.id)
  await supabase
    .from('instagram_leads')
    .update({ status: 'queued' })
    .in('id', leadIds)

  return NextResponse.json({ ok: true, queued: leads.length, warmup: WARMUP_MODE })
}
