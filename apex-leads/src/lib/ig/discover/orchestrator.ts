import CronExpressionParser from 'cron-parser'
import {
  SidecarError,
  discoverCompetitorFollowers,
  discoverHashtag,
  discoverLocation,
  discoverPostEngagers,
} from '../sidecar'

interface Source {
  id: string
  kind: string
  ref: string
  params: Record<string, unknown> | null
  schedule_cron: string
  priority: number
}

export async function pickSourcesToRun(
  supabase: any,
  now: Date,
): Promise<Source[]> {
  const { data: sources } = await supabase
    .from('discovery_sources')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: false })

  const out: Source[] = []
  for (const s of sources ?? []) {
    const { data: lastRun } = await supabase
      .from('discovery_runs')
      .select('started_at')
      .eq('source_id', s.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const baseDate = lastRun?.started_at ? new Date(lastRun.started_at) : new Date(0)
    const cron = CronExpressionParser.parse(s.schedule_cron, { currentDate: baseDate })
    const nextRunAt = cron.next().toDate()
    if (nextRunAt <= now) out.push(s)
  }
  return out
}

export async function runOrchestratorCycle(
  supabase: any,
): Promise<{ ran: number; results: unknown[] }> {
  const now = new Date()
  const sources = await pickSourcesToRun(supabase, now)
  const results: unknown[] = []

  let competitorAllowance = 1

  for (const s of sources) {
    if (s.kind === 'competitor_followers' && competitorAllowance <= 0) continue
    try {
      let res: unknown
      const params = s.params ?? {}
      switch (s.kind) {
        case 'hashtag':
          res = await discoverHashtag(s.ref, (params.limit as number) ?? 50)
          break
        case 'location':
          res = await discoverLocation(Number(s.ref), (params.limit as number) ?? 50)
          break
        case 'competitor_followers':
          res = await discoverCompetitorFollowers(
            s.ref,
            (params.max_users as number) ?? 200,
            (params.cursor as string) ?? undefined,
          )
          competitorAllowance--
          break
        case 'post_engagers':
          res = await discoverPostEngagers(
            s.ref,
            ((params.kind as 'likers' | 'commenters') ?? 'likers'),
          )
          break
        default:
          throw new Error(`unknown kind ${s.kind}`)
      }
      results.push({ source_id: s.id, kind: s.kind, ref: s.ref, ...( res as object) })
    } catch (err) {
      results.push({ source_id: s.id, kind: s.kind, ref: s.ref, error: String(err) })
      if (err instanceof SidecarError && err.isCircuitOpen) {
        console.warn('[orchestrator] circuit open — aborting cycle')
        break
      }
    }
  }
  return { ran: results.length, results }
}
