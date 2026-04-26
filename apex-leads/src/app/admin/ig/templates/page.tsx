import { createSupabaseServer } from '@/lib/supabase-server'
import { getTemplateStats } from '@/lib/ig/metrics/queries'
import type { TemplateStatRow } from '@/lib/ig/metrics/queries'
import { TemplateActions } from '../_components/TemplateActions'
import { NewTemplateForm } from '../_components/NewTemplateForm'

export const dynamic = 'force-dynamic'

function betaCi(alpha: number, beta: number): { lo: number; hi: number } {
  const mean = alpha / (alpha + beta)
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1))
  const sd = Math.sqrt(variance)
  return {
    lo: Math.max(0, Math.round((mean - 1.96 * sd) * 1000) / 10),
    hi: Math.min(100, Math.round((mean + 1.96 * sd) * 1000) / 10),
  }
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-950 text-emerald-400',
  paused: 'bg-amber-950 text-amber-400',
  killed: 'bg-rose-950 text-rose-400',
}

export default async function TemplatesPage() {
  const supabase = createSupabaseServer()
  const rows: TemplateStatRow[] = await getTemplateStats(supabase)

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">DM Templates</h1>
        <p className="text-sm text-apex-muted mt-0.5">{rows.length} templates</p>
      </div>

      <NewTemplateForm />

      <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-mono text-apex-muted border-b border-apex-border">
              <th className="text-left px-5 py-3">Nombre</th>
              <th className="text-right px-4 py-3">Envíos</th>
              <th className="text-right px-4 py-3">Replies</th>
              <th className="text-right px-4 py-3">CTR</th>
              <th className="text-left px-4 py-3">CI 95%</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const ci = betaCi(t.beta_alpha, t.beta_beta)
              return (
                <tr
                  key={t.template_id}
                  className="border-b border-apex-border/50 hover:bg-white/[0.02] last:border-0"
                >
                  <td className="px-5 py-3 font-medium text-white">{t.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-apex-muted">{t.sends}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">{t.replies}</td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {t.sends > 0 ? `${t.ctr_pct}%` : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-apex-muted">
                    {t.sends >= 5
                      ? `[${ci.lo}%–${ci.hi}%]`
                      : <span className="italic">min 5 envíos</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                        STATUS_STYLE[t.status] ?? 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TemplateActions id={t.template_id} status={t.status} />
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-apex-muted text-sm">
                  Sin templates aún. Se crean en D11 (A/B testing).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
