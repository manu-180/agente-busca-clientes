import type { FunnelRow } from '@/lib/ig/metrics/queries'

interface FunnelTableProps {
  data: FunnelRow[]
}

function pct(num: number, denom: number): string {
  if (!denom) return '—'
  return `${Math.round((100 * num) / denom)}%`
}

export function FunnelTable({ data }: FunnelTableProps) {
  if (!data.length) {
    return (
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 text-center text-apex-muted text-sm">
        Sin datos de funnel aún.
      </div>
    )
  }

  const totals = data.reduce(
    (acc, r) => ({
      raw_discovered: acc.raw_discovered + r.raw_discovered,
      pre_filter_passed: acc.pre_filter_passed + r.pre_filter_passed,
      enriched: acc.enriched + r.enriched,
      contacted: acc.contacted + r.contacted,
      replied: acc.replied + r.replied,
    }),
    { raw_discovered: 0, pre_filter_passed: 0, enriched: 0, contacted: 0, replied: 0 },
  )

  return (
    <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
      {/* Funnel summary bar */}
      <div className="grid grid-cols-5 divide-x divide-apex-border border-b border-apex-border">
        {[
          { label: 'Raw', value: totals.raw_discovered, conv: null },
          { label: 'Filtrados', value: totals.pre_filter_passed, conv: pct(totals.pre_filter_passed, totals.raw_discovered) },
          { label: 'Enriquecidos', value: totals.enriched, conv: pct(totals.enriched, totals.pre_filter_passed) },
          { label: 'Contactados', value: totals.contacted, conv: pct(totals.contacted, totals.enriched) },
          { label: 'Respondieron', value: totals.replied, conv: pct(totals.replied, totals.contacted) },
        ].map((s) => (
          <div key={s.label} className="p-4 text-center">
            <p className="text-xs font-mono text-apex-muted uppercase tracking-widest mb-1">{s.label}</p>
            <p className="font-bold text-2xl text-white">{s.value}</p>
            {s.conv && <p className="text-xs text-emerald-400 mt-0.5">{s.conv}</p>}
          </div>
        ))}
      </div>

      {/* Daily breakdown (last 7) */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-apex-muted border-b border-apex-border">
              <th className="text-left px-4 py-2">Día</th>
              <th className="text-right px-3 py-2">Raw</th>
              <th className="text-right px-3 py-2">Filtrados</th>
              <th className="text-right px-3 py-2">Enriquecidos</th>
              <th className="text-right px-3 py-2">Contactados</th>
              <th className="text-right px-3 py-2">Respondieron</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 7).map((r) => (
              <tr key={r.day} className="border-b border-apex-border/50 hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-white">{r.day}</td>
                <td className="text-right px-3 py-2 text-apex-muted">{r.raw_discovered}</td>
                <td className="text-right px-3 py-2 text-apex-muted">{r.pre_filter_passed}</td>
                <td className="text-right px-3 py-2 text-apex-muted">{r.enriched}</td>
                <td className="text-right px-3 py-2 text-apex-muted">{r.contacted}</td>
                <td className="text-right px-3 py-2 text-emerald-400">{r.replied}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
