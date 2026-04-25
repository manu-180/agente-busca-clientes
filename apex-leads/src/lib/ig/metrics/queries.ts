import type { SupabaseClient } from '@supabase/supabase-js'

export interface DailyMetric {
  day: string
  source_kind: string
  runs_ok: number
  runs_err: number
  users_seen: number
  users_new: number
  dms_sent: number
  replies: number
}

export interface KpiSnapshot {
  replyRate7d: number
  qualifiedRate30d: number
  dmsToday: number
  pipelineHealth: number
}

export interface FunnelRow {
  day: string
  raw_discovered: number
  pre_filter_passed: number
  enriched: number
  contacted: number
  replied: number
}

export interface TemplateStatRow {
  template_id: string
  name: string
  status: string
  sends: number
  replies: number
  ctr_pct: number
  beta_alpha: number
  beta_beta: number
}

export async function getDailyMetrics(supabase: SupabaseClient, days = 30): Promise<DailyMetric[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('discovery_metrics_daily')
    .select('*')
    .gte('day', since)
    .order('day', { ascending: true })
  return (data ?? []) as DailyMetric[]
}

export async function getKpiSnapshot(supabase: SupabaseClient): Promise<KpiSnapshot> {
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const today = new Date().toISOString().slice(0, 10)

  const [
    { count: dms7 },
    { count: reps7 },
    { count: enr30 },
    { count: qual30 },
    { data: quotaRows },
    { data: runs7 },
  ] = await Promise.all([
    supabase
      .from('instagram_leads')
      .select('*', { count: 'exact', head: true })
      .gte('contacted_at', since7),
    supabase
      .from('instagram_leads')
      .select('*', { count: 'exact', head: true })
      .gte('replied_at', since7),
    supabase
      .from('instagram_leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since30),
    supabase
      .from('instagram_leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since30)
      .gte('lead_score', 60),
    supabase
      .from('dm_daily_quota')
      .select('dms_sent')
      .eq('day', today),
    supabase
      .from('discovery_runs')
      .select('status')
      .gte('started_at', since7),
  ])

  const replyRate7d = dms7 ? Math.round((100 * (reps7 ?? 0)) / dms7) : 0
  const qualifiedRate30d = enr30 ? Math.round((100 * (qual30 ?? 0)) / enr30) : 0
  const dmsToday = (quotaRows ?? []).reduce((s: number, r: { dms_sent: number }) => s + r.dms_sent, 0)
  const totalRuns = (runs7 ?? []).length
  const okRuns = (runs7 ?? []).filter((r: { status: string }) => r.status === 'ok').length
  const pipelineHealth = totalRuns ? Math.round((100 * okRuns) / totalRuns) : 100

  return { replyRate7d, qualifiedRate30d, dmsToday, pipelineHealth }
}

export async function getLeadFunnel(supabase: SupabaseClient): Promise<FunnelRow[]> {
  const { data } = await supabase
    .from('lead_funnel')
    .select('*')
    .order('day', { ascending: false })
    .limit(30)
  return (data ?? []) as FunnelRow[]
}

export async function getTemplateStats(supabase: SupabaseClient): Promise<TemplateStatRow[]> {
  const { data } = await supabase.from('dm_template_stats').select('*')
  return (data ?? []) as TemplateStatRow[]
}
