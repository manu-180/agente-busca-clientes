import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== cronSecret) {
    return unauthorized()
  }

  const dryRun = process.env.DRY_RUN === 'true'

  if (dryRun) {
    console.log('[run-cycle] DRY_RUN=true — skipping outreach')
    return NextResponse.json({ ok: true, dry_run: true, leads_processed: 0 })
  }

  // TODO SESSION-06+: fetch leads from Supabase and send DMs via sidecar
  return NextResponse.json({ ok: true, dry_run: false, leads_processed: 0 })
}
