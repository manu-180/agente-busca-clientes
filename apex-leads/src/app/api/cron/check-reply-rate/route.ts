import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'
import { sendAlert } from '@/lib/ig/alerts/discord'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  if (token !== cronSecret) return unauthorized()

  const supabase = createSupabaseServer()
  const senderIg = igConfig.IG_SENDER_USERNAME
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString()

  // ── 1. Low reply rate (7-day window) ─────────────────────────────────────
  const { count: dmCount } = await supabase
    .from('instagram_leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'contacted')
    .gte('contacted_at', since7d)

  const { count: replyCount } = await supabase
    .from('instagram_leads')
    .select('*', { count: 'exact', head: true })
    .not('replied_at', 'is', null)
    .gte('replied_at', since7d)

  const dms = dmCount ?? 0
  const replies = replyCount ?? 0
  const replyRate = dms > 0 ? replies / dms : 0

  if (dms >= 30 && replyRate < 0.03) {
    await sendAlert(
      supabase,
      'warning',
      'reply_rate',
      `Reply rate 7d is ${(replyRate * 100).toFixed(1)}% (${replies}/${dms} DMs). Under 3% threshold.`,
      { reply_rate_pct: (replyRate * 100).toFixed(1), replies, dms_sent: dms },
    ).catch((err) => console.error('[check-reply-rate] sendAlert failed', err))
  }

  // ── 2. Daily quota unmet ─────────────────────────────────────────────────
  const { data: quotaRow } = await supabase
    .from('dm_daily_quota')
    .select('dms_sent')
    .eq('sender_ig_username', senderIg)
    .eq('day', yesterday)
    .maybeSingle()

  const sentYesterday = quotaRow?.dms_sent ?? 0
  const limit = igConfig.DAILY_DM_LIMIT
  const quotaThreshold = Math.ceil(limit * 0.5)

  if (sentYesterday < quotaThreshold) {
    await sendAlert(
      supabase,
      'info',
      'daily_quota',
      `Only ${sentYesterday}/${limit} DMs sent yesterday (${today}). Check pipeline for blockages.`,
      { sent: sentYesterday, limit, day: yesterday },
    ).catch((err) => console.error('[check-reply-rate] sendAlert quota failed', err))
  }

  return NextResponse.json({
    ok: true,
    reply_rate: { dms, replies, rate_pct: (replyRate * 100).toFixed(1) },
    quota: { sent_yesterday: sentYesterday, limit },
  })
}
