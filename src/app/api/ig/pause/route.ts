/**
 * POST /api/ig/pause  → inserts a manual cooldown into account_health_log
 * POST /api/ig/pause  { resume: true } → clears active cooldowns
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function authAdmin(req: NextRequest): boolean {
  const secret = process.env.ADMIN_PASSWORD
  if (!secret) return false
  return req.headers.get('x-admin-key') === secret
}

export async function POST(req: NextRequest) {
  if (!authAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const supabase = createSupabaseServer()
  const IG_SENDER = process.env.IG_SENDER_USERNAME ?? ''

  if (body.resume) {
    // Clear all active cooldowns by setting cooldown_until to past
    const { error } = await supabase
      .from('account_health_log')
      .update({ cooldown_until: new Date(0).toISOString() })
      .eq('sender_ig', IG_SENDER)
      .gt('cooldown_until', new Date().toISOString())

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'resumed' })
  }

  // Pause: insert a manual circuit-open event
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
