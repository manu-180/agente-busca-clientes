import type { SupabaseClient } from '@supabase/supabase-js'

export interface Template {
  id: string; name: string; body: string; variables: string[]; status: string
}

export interface TemplateStat {
  template_id: string; name: string; status: string
  sends: number; replies: number; ctr_pct: number
  beta_alpha: number; beta_beta: number
}

// Gamma sampler (Marsaglia-Tsang) — no external deps
function normalRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function sampleGamma(shape: number): number {
  if (shape < 1) return sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do { x = normalRandom(); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

export function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha)
  const y = sampleGamma(beta)
  return x / (x + y)
}

export function thompsonPick(stats: TemplateStat[]): TemplateStat {
  if (stats.length === 0) throw new Error('no active templates')
  let best = stats[0]; let bestSample = -1
  for (const t of stats) {
    const s = sampleBeta(t.beta_alpha, t.beta_beta)
    if (s > bestSample) { bestSample = s; best = t }
  }
  return best
}

export async function pickTemplate(supabase: SupabaseClient): Promise<Template> {
  const { data: stats, error } = await supabase
    .from('dm_template_stats')
    .select('template_id, name, status, sends, replies, ctr_pct, beta_alpha, beta_beta')
    .eq('status', 'active')
  if (error) throw new Error(`pickTemplate: ${error.message}`)
  if (!stats?.length) throw new Error('pickTemplate: no active templates')

  const winner = thompsonPick(stats as TemplateStat[])
  const { data: tpl, error: e } = await supabase
    .from('dm_templates').select('id, name, body, variables, status')
    .eq('id', winner.template_id).single()
  if (e || !tpl) throw new Error(`pickTemplate: body fetch failed — ${e?.message}`)
  return tpl as Template
}

export function renderTemplate(tpl: Template, vars: Record<string, string>): string {
  let out = tpl.body
  for (const v of tpl.variables) out = out.replaceAll(`{${v}}`, vars[v] ?? '')
  return out
}
