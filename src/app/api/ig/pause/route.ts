/**
 * POST /api/ig/pause  → inserts a manual cooldown into account_health_log
 * POST /api/ig/pause  { resume: true } → clears active cooldowns
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const supabase = createSupabaseServer()
  const IG_SENDER = igConfig.IG_SENDER_USERNAME

  if (body.resume) {
    const { error } = await supabase
      .from('account_health_log')
      .update({ cooldown_until: new Date(0).toISOString() })
      .eq('sender_ig', IG_SENDER)
      .gt('cooldown_until', new Date().toISOString())

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'resumed' })
  }

  const hours = typeof body.hours === 'number' ? body.hours : 24
  const cooldownUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('account_health_log').insert({
    sender_ig: IG_SENDER,
    event: 'action_blocked',
    payload: { reason: 'manual_pause', triggered_by: 'admin' },
    cooldown_until: cooldownUntil,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, action: 'paused', cooldown_until: cooldownUntil, hours })
}
