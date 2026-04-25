import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { runOrchestratorCycle } from '@/lib/ig/discover/orchestrator'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${igConfig.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!igConfig.DISCOVERY_ENABLED) {
    return NextResponse.json({ ok: true, skipped: 'DISCOVERY_ENABLED=false' })
  }

  const supabase = createSupabaseServer()
  const result = await runOrchestratorCycle(supabase)
  return NextResponse.json({ ok: true, ...result })
}
