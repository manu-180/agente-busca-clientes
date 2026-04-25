import { createSupabaseServer } from '@/lib/supabase-server'
import { getKpiSnapshot, getDailyMetrics, getLeadFunnel } from '@/lib/ig/metrics/queries'
import { KpiCard } from '../_components/KpiCard'
import { SourceChart } from '../_components/SourceChart'
import { FunnelTable } from '../_components/FunnelTable'

export const dynamic = 'force-dynamic'

export default async function DiscoveryPage() {
  const supabase = createSupabaseServer()
  const [kpi, daily, funnel] = await Promise.all([
    getKpiSnapshot(supabase),
    getDailyMetrics(supabase, 30),
    getLeadFunnel(supabase),
  ])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Discovery</h1>
        <p className="text-sm text-apex-muted mt-0.5">Pipeline de descubrimiento — últimos 30 días</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Reply Rate (7d)"
          value={`${kpi.replyRate7d}%`}
          target=">= 8%"
          tone={kpi.replyRate7d >= 8 ? 'good' : kpi.replyRate7d >= 4 ? 'warn' : 'bad'}
        />
        <KpiCard
          label="Qualified Rate (30d)"
          value={`${kpi.qualifiedRate30d}%`}
          target=">= 25%"
          tone={kpi.qualifiedRate30d >= 25 ? 'good' : kpi.qualifiedRate30d >= 10 ? 'warn' : 'bad'}
        />
        <KpiCard
          label="DMs hoy"
          value={kpi.dmsToday}
        />
        <KpiCard
          label="Pipeline Health (7d)"
          value={`${kpi.pipelineHealth}%`}
          target=">= 95%"
          tone={kpi.pipelineHealth >= 95 ? 'good' : kpi.pipelineHealth >= 80 ? 'warn' : 'bad'}
        />
      </div>

      {/* Discovery by source chart */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Leads descubiertos por fuente</h2>
        <SourceChart data={daily} />
      </section>

      {/* Lead funnel */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Lead Funnel</h2>
        <FunnelTable data={funnel} />
      </section>
    </div>
  )
}
