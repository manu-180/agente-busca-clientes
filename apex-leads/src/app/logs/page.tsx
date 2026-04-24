'use client'

import React, { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, SkipForward, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CronRun {
  id: string
  cron_name: string
  started_at: string
  finished_at: string | null
  status: string
  result: Record<string, unknown> | null
  duration_ms: number | null
  forced: boolean
}

interface StatusConfig {
  label: string
  color: string
  icon: LucideIcon
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  success: { label: 'OK',      color: 'text-emerald-400', icon: CheckCircle },
  error:   { label: 'ERROR',   color: 'text-red-400',     icon: XCircle     },
  skipped: { label: 'SKIP',    color: 'text-yellow-400',  icon: SkipForward },
  running: { label: 'RUNNING', color: 'text-blue-400',    icon: Clock       },
}

const CRON_OPTIONS = [
  'leads-pendientes',
  'followup',
  'ig-daily',
  'ig-send-pending',
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: 'text-apex-muted', icon: Clock }
  const Icon = cfg.icon
  return (
    <span className={cn('flex items-center gap-1 font-mono text-xs font-semibold', cfg.color)}>
      <Icon size={13} />
      {cfg.label}
    </span>
  )
}

function ResultSummary({ result }: { result: Record<string, unknown> }) {
  if (result.skipped)  return <span className="text-apex-muted font-mono">{String(result.skipped)}</span>
  if (result.nombre)   return <span className="text-apex-lime font-medium">{String(result.nombre)}</span>
  if (result.error)    return <span className="text-red-400 font-mono text-xs">{String(result.error)}</span>
  return <span className="text-apex-muted">—</span>
}

export default function LogsPage() {
  const [runs, setRuns]       = useState<CronRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [cron, setCron]       = useState('leads-pendientes')

  const load = () => {
    setLoading(true)
    fetch(`/api/admin/cron-logs?cron=${cron}&limit=100`)
      .then(r => r.json())
      .then(d => setRuns(d.runs ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [cron]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusKeys = ['success', 'error', 'skipped', 'running'] as const

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-syne font-bold text-white">Cron Logs</h1>
          <p className="text-sm text-apex-muted mt-1">Historial de ejecuciones automáticas</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={cron}
            onChange={e => setCron(e.target.value)}
            className="bg-apex-card border border-apex-border rounded-lg px-3 py-2 text-sm text-white font-mono"
          >
            {CRON_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-apex-card border border-apex-border rounded-lg text-sm text-white hover:bg-apex-border transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {runs.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {statusKeys.map(s => {
            const count = runs.filter(r => r.status === s).length
            const cfg   = STATUS_CONFIG[s]
            return (
              <div key={s} className="bg-apex-card border border-apex-border rounded-lg p-3 text-center">
                <div className={cn('text-2xl font-bold font-mono', cfg.color)}>{count}</div>
                <div className="text-xs text-apex-muted mt-1">{cfg.label}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-apex-muted text-sm">Cargando...</div>
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-apex-muted text-sm">
            Sin registros para <span className="font-mono ml-1">{cron}</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-apex-border text-apex-muted text-xs font-mono uppercase">
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Resultado</th>
                <th className="text-right px-4 py-3">Duración</th>
                <th className="text-right px-4 py-3">Force</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <React.Fragment key={run.id}>
                  <tr
                    onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    className="border-b border-apex-border/50 hover:bg-apex-border/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-apex-muted whitespace-nowrap">
                      {formatDate(run.started_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-white max-w-xs truncate">
                      {run.result ? <ResultSummary result={run.result} /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-apex-muted">
                      {run.duration_ms != null ? `${run.duration_ms}ms` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {run.forced && (
                        <span className="flex items-center justify-end gap-1 text-apex-lime text-xs font-mono">
                          <Zap size={11} /> force
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded === run.id && run.result && (
                    <tr className="border-b border-apex-border/50 bg-black/20">
                      <td colSpan={5} className="px-4 py-3">
                        <pre className="text-xs font-mono text-apex-muted whitespace-pre-wrap break-all">
                          {JSON.stringify(run.result, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-apex-muted mt-3">
        Últimas {runs.length} ejecuciones · Click en fila para ver JSON completo
      </p>
    </div>
  )
}
