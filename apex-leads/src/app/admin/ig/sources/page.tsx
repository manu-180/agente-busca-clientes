import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

interface DiscoverySource {
  id: string
  kind: string
  ref: string
  schedule_cron: string | null
  active: boolean
  priority: number
  notes: string | null
  created_at: string
}

interface RunSummary {
  kind: string
  last_run: string | null
  leads_30d: number
}

const KIND_LABELS: Record<string, string> = {
  hashtag: 'Hashtag',
  location: 'Location',
  competitor_followers: 'Competitor',
  post_engagers: 'Engagers',
}

export default async function SourcesPage() {
  const supabase = createSupabaseServer()

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [{ data: sources }, { data: runs }] = await Promise.all([
    supabase
      .from('discovery_sources')
      .select('id,kind,ref,schedule_cron,active,priority,notes,created_at')
      .order('priority', { ascending: true }),
    supabase
      .from('discovery_runs')
      .select('kind,started_at,users_new')
      .gte('started_at', since30)
      .order('started_at', { ascending: false }),
  ])

  // Aggregate last_run and leads_30d per kind
  const runMap: Record<string, RunSummary> = {}
  for (const r of (runs ?? []) as { kind: string; started_at: string; users_new: number | null }[]) {
    if (!runMap[r.kind]) {
      runMap[r.kind] = { kind: r.kind, last_run: r.started_at, leads_30d: 0 }
    }
    runMap[r.kind].leads_30d += r.users_new ?? 0
  }

  const rows = (sources ?? []) as DiscoverySource[]

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Discovery Sources</h1>
        <p className="text-sm text-apex-muted mt-0.5">{rows.length} fuentes configuradas</p>
      </div>

      <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-mono text-apex-muted border-b border-apex-border">
              <th className="text-left px-5 py-3">Tipo</th>
              <th className="text-left px-4 py-3">Ref</th>
              <th className="text-left px-4 py-3">Cron</th>
              <th className="text-right px-4 py-3">Prioridad</th>
              <th className="text-right px-4 py-3">Leads 30d</th>
              <th className="text-left px-4 py-3">Último run</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Notas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const summary = runMap[s.kind]
              return (
                <tr
                  key={s.id}
                  className="border-b border-apex-border/50 hover:bg-white/[0.02] last:border-0"
                >
                  <td className="px-5 py-3 font-mono text-xs">
                    <span className="bg-apex-dark px-2 py-1 rounded text-indigo-400">
                      {KIND_LABELS[s.kind] ?? s.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate">{s.ref}</td>
                  <td className="px-4 py-3 font-mono text-xs text-apex-muted">{s.schedule_cron ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-apex-muted">{s.priority}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className={summary?.leads_30d ? 'text-emerald-400' : 'text-apex-muted'}>
                      {summary?.leads_30d ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-apex-muted font-mono">
                    {summary?.last_run
                      ? new Date(summary.last_run).toLocaleString('es-AR', {
                          timeZone: 'America/Argentina/Buenos_Aires',
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                        s.active
                          ? 'bg-emerald-950 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {s.active ? 'activa' : 'inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-apex-muted max-w-[180px] truncate">
                    {s.notes ?? '—'}
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-apex-muted text-sm">
                  Sin fuentes configuradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
