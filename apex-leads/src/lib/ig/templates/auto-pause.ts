export interface TemplateStat {
  template_id: string; name: string; status: string
  sends: number; replies: number; beta_alpha: number; beta_beta: number
}

const MIN_SENDS = 100

export function betaCI95(alpha: number, beta: number): { lo: number; hi: number; mean: number } {
  const mean = alpha / (alpha + beta)
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1))
  const sd = Math.sqrt(variance)
  return { lo: Math.max(0, mean - 1.96 * sd), hi: Math.min(1, mean + 1.96 * sd), mean }
}

export function findTemplatesToPause(stats: TemplateStat[]): string[] {
  const eligible = stats.filter((t) => t.status === 'active' && t.sends >= MIN_SENDS)
  if (eligible.length < 2) return []
  const cis = eligible.map((t) => ({ ...t, ci: betaCI95(t.beta_alpha, t.beta_beta) }))
  const best = cis.reduce((a, b) => (a.ci.mean > b.ci.mean ? a : b))
  return cis
    .filter((t) => t.template_id !== best.template_id && t.ci.hi < best.ci.lo)
    .map((t) => t.template_id)
}
