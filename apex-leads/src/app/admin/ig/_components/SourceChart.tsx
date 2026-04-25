'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import type { DailyMetric } from '@/lib/ig/metrics/queries'

interface SourceChartProps {
  data: DailyMetric[]
}

const SOURCE_COLORS: Record<string, string> = {
  hashtag: '#818cf8',
  location: '#34d399',
  competitor_followers: '#fb923c',
  post_engagers: '#f472b6',
}

const SOURCE_LABELS: Record<string, string> = {
  hashtag: 'Hashtag',
  location: 'Location',
  competitor_followers: 'Competitors',
  post_engagers: 'Engagers',
}

function buildChartData(data: DailyMetric[]) {
  const byDay: Record<string, Record<string, number>> = {}
  for (const row of data) {
    if (!byDay[row.day]) byDay[row.day] = { day: row.day as unknown as number }
    byDay[row.day][row.source_kind] = (byDay[row.day][row.source_kind] ?? 0) + row.users_new
  }
  return Object.values(byDay).sort((a, b) =>
    String(a.day).localeCompare(String(b.day)),
  )
}

function formatDay(day: string): string {
  return new Date(day + 'T00:00:00').toLocaleDateString('es-AR', {
    month: 'short',
    day: 'numeric',
  })
}

export function SourceChart({ data }: SourceChartProps) {
  if (!data.length) {
    return (
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 text-center text-apex-muted text-sm">
        Sin datos de discovery aún.
      </div>
    )
  }

  const chartData = buildChartData(data)
  const sources = Array.from(new Set(data.map((d) => d.source_kind)))

  return (
    <div className="bg-apex-card border border-apex-border rounded-xl p-5">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis
            dataKey="day"
            tickFormatter={formatDay}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }}
            labelStyle={{ color: '#9ca3af', fontSize: 11 }}
            itemStyle={{ fontSize: 12 }}
            labelFormatter={formatDay}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: '#9ca3af' }}
            formatter={(v) => SOURCE_LABELS[v] ?? v}
          />
          {sources.map((src) => (
            <Area
              key={src}
              type="monotone"
              dataKey={src}
              stackId="1"
              stroke={SOURCE_COLORS[src] ?? '#6b7280'}
              fill={SOURCE_COLORS[src] ?? '#6b7280'}
              fillOpacity={0.25}
              strokeWidth={2}
              name={src}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
