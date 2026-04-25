interface KpiCardProps {
  label: string
  value: string | number
  target?: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
  sub?: string
}

const TONE_VALUE: Record<string, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
  neutral: 'text-white',
}

export function KpiCard({ label, value, target, tone = 'neutral', sub }: KpiCardProps) {
  return (
    <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-2">
      <p className="text-xs font-mono text-apex-muted uppercase tracking-widest">{label}</p>
      <p className={`font-bold text-3xl ${TONE_VALUE[tone]}`}>{value}</p>
      {target && (
        <p className="text-xs text-apex-muted">
          Target: <span className="text-white/60">{target}</span>
        </p>
      )}
      {sub && <p className="text-xs text-apex-muted">{sub}</p>}
    </div>
  )
}
