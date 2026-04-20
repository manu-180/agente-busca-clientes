import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()
  const IG_SENDER = process.env.IG_SENDER_USERNAME ?? ''
  const DAILY_LIMIT = parseInt(process.env.DAILY_DM_LIMIT ?? '10', 10)
  const today = new Date().toISOString().split('T')[0]
  const ago7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const ago24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    statusCounts,
    todayQuota,
    healthLogs,
    recentLeads,
    replyRate7d,
    queuePending,
  ] = await Promise.all([
    supabase
      .from('instagram_leads')
      .select('status')
      .then(({ data }) => {
        const counts: Record<string, number> = {}
        for (const row of data ?? []) {
          counts[row.status] = (counts[row.status] ?? 0) + 1
        }
        return counts
      }),

    supabase
      .from('dm_daily_quota')
      .select('dms_sent')
      .eq('sender_ig_username', IG_SENDER)
      .eq('day', today)
      .maybeSingle()
      .then(({ data }) => data?.dms_sent ?? 0),

    supabase
      .from('account_health_log')
      .select('event, payload, occurred_at, cooldown_until')
      .eq('sender_ig', IG_SENDER)
      .gte('occurred_at', ago24h)
      .order('occurred_at', { ascending: false })
      .limit(20)
      .then(({ data }) => data ?? []),

    supabase
      .from('instagram_leads')
      .select('id, ig_username, status, lead_score, contacted_at, reply_count, last_reply_at, business_category')
      .in('status', ['contacted', 'follow_up_sent', 'replied', 'interested', 'meeting_booked', 'owner_takeover'])
      .order('contacted_at', { ascending: false })
      .limit(10)
      .then(({ data }) => data ?? []),

    supabase
      .from('instagram_leads')
      .select('reply_count, contacted_at')
      .gte('contacted_at', ago7d)
      .then(({ data }) => {
        const rows = data ?? []
        const total = rows.length
        const replied = rows.filter((r) => (r.reply_count ?? 0) > 0).length
        return total > 0 ? { total, replied, rate: (replied / total) * 100 } : { total: 0, replied: 0, rate: 0 }
      }),

    supabase
      .from('dm_queue')
      .select('id', { count: 'exact', head: true })
      .is('sent_at', null)
      .then(({ count }) => count ?? 0),
  ])

  const circuitOpen = healthLogs.some(
    (log) => log.cooldown_until && new Date(log.cooldown_until) > new Date(),
  )
  const activeCircuit = circuitOpen
    ? healthLogs.find((log) => log.cooldown_until && new Date(log.cooldown_until) > new Date())
    : null

  const shadowbanSuspected = replyRate7d.total >= 10 && replyRate7d.rate < 5

  return NextResponse.json({
    status_counts: statusCounts,
    quota: {
      sent_today: todayQuota,
      limit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - todayQuota),
      pct: Math.min(100, Math.round((todayQuota / DAILY_LIMIT) * 100)),
    },
    queue_pending: queuePending,
    health: {
      circuit_open: circuitOpen,
      active_event: activeCircuit?.event ?? null,
      cooldown_until: activeCircuit?.cooldown_until ?? null,
      logs: healthLogs,
    },
    reply_rate_7d: replyRate7d,
    shadowban_suspected: shadowbanSuspected,
    recent_leads: recentLeads,
    warmup_mode: process.env.IG_WARMUP_MODE === 'true',
    dry_run: process.env.DRY_RUN === 'true',
  })
}
