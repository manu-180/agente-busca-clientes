'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Instagram, ShieldAlert, ShieldCheck, Zap, MessageSquare,
  TrendingUp, Users, Clock, AlertTriangle, CheckCircle2,
  Pause, Play, RefreshCw, Eye, Activity, Send,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface IgStats {
  status_counts: Record<string, number>
  quota: { sent_today: number; limit: number; remaining: number; pct: number }
  queue_pending: number
  health: {
    circuit_open: boolean
    active_event: string | null
    cooldown_until: string | null
    logs: Array<{ event: string; occurred_at: string; cooldown_until: string | null; payload: Record<string, unknown> }>
  }
  reply_rate_7d: { total: number; replied: number; rate: number }
  shadowban_suspected: boolean
  recent_leads: Array<{
    id: string
    ig_username: string
    status: string
    lead_score: number
    contacted_at: string | null
    reply_count: number
    last_reply_at: string | null
    business_category: string | null
  }>
  warmup_mode: boolean
  dry_run: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  discovered:        'bg-zinc-800 text-zinc-400',
  qualified:         'bg-blue-950 text-blue-400',
  queued:            'bg-purple-950 text-purple-400',
  contacted:         'bg-sky-950 text-sky-400',
  follow_up_sent:    'bg-amber-950 text-amber-400',
  replied:           'bg-emerald-950 text-emerald-400',
  interested:        'bg-apex-lime/10 text-apex-lime',
  meeting_booked:    'bg-green-950 text-green-400',
  closed_positive:   'bg-green-900 text-green-300',
  closed_negative:   'bg-red-950 text-red-400',
  closed_ghosted:    'bg-zinc-900 text-zinc-500',
  owner_takeover:    'bg-orange-950 text-orange-400',
  blacklisted:       'bg-red-900 text-red-300',
  error:             'bg-rose-950 text-rose-400',
}

const STATUS_LABELS: Record<string, string> = {
  discovered:        'Descubiertos',
  qualified:         'Calificados',
  queued:            'En cola',
  contacted:         'Contactados',
  follow_up_sent:    'Follow-up',
  replied:           'Respondieron',
  interested:        'Interesados',
  meeting_booked:    'Reunión',
  closed_positive:   'Cerrado +',
  closed_negative:   'Cerrado −',
  closed_ghosted:    'Ghosteados',
  owner_takeover:    'Owner tomó ctrl',
  blacklisted:       'Bloqueados',
  error:             'Errores',
}

const EVENT_COLORS: Record<string, string> = {
  feedback_required:  'text-rose-400',
  challenge_required: 'text-rose-400',
  action_blocked:     'text-orange-400',
  rate_limited:       'text-amber-400',
  login_required:     'text-red-400',
  shadowban_suspected:'text-orange-400',
  ok:                 'text-emerald-400',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 60) return `hace ${min}m`
  const hs = Math.floor(min / 60)
  if (hs < 24) return `hace ${hs}h`
  return `hace ${Math.floor(hs / 24)}d`
}

function QuotaBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-apex-lime'
  return (
    <div className="w-full bg-apex-border rounded-full h-2 overflow-hidden">
      <div
        className={`${color} h-2 rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function IgDashboardPage() {
  const [stats, setStats] = useState<IgStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [pausing, setPausing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/ig/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* silent */ }
    finally {
      setLoading(false)
      setLastRefresh(new Date())
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 60_000)
    return () => clearInterval(interval)
  }, [fetchStats])

  const handlePause = async (resume = false) => {
    setPausing(true)
    try {
      await fetch('/api/ig/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resume ? { resume: true } : { hours: 24 }),
      })
      await fetchStats()
    } finally {
      setPausing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-apex-muted" size={24} />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center text-apex-muted py-20">
        No se pudieron cargar los datos. Verificá ADMIN_PASSWORD.
      </div>
    )
  }

  const isCircuitOpen = stats.health.circuit_open
  const totalActive = Object.entries(stats.status_counts)
    .filter(([s]) => !['closed_positive', 'closed_negative', 'closed_ghosted', 'blacklisted'].includes(s))
    .reduce((acc, [, v]) => acc + v, 0)

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
            <Instagram size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-syne font-bold text-2xl tracking-tight">Instagram Outreach</h1>
            <p className="text-xs font-mono text-apex-muted mt-0.5">
              Actualizado {lastRefresh.toLocaleTimeString('es-AR')}
              {stats.warmup_mode && <span className="ml-2 text-amber-400">· WARMUP</span>}
              {stats.dry_run && <span className="ml-2 text-purple-400">· DRY RUN</span>}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => fetchStats()}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-apex-card border border-apex-border rounded-lg text-apex-muted hover:text-white transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>

          {isCircuitOpen ? (
            <button
              onClick={() => handlePause(true)}
              disabled={pausing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            >
              <Play size={14} /> Reanudar outbound
            </button>
          ) : (
            <button
              onClick={() => handlePause(false)}
              disabled={pausing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-rose-700 hover:bg-rose-600 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            >
              <Pause size={14} /> Pausar 24h
            </button>
          )}
        </div>
      </div>

      {/* ── Alerts ── */}
      {(isCircuitOpen || stats.shadowban_suspected) && (
        <div className="space-y-3">
          {isCircuitOpen && (
            <div className="flex items-start gap-3 p-4 bg-rose-950/60 border border-rose-800 rounded-xl">
              <ShieldAlert size={20} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-rose-300 font-semibold text-sm">Circuit breaker activo</p>
                <p className="text-rose-400/80 text-xs mt-0.5">
                  Evento: <span className="font-mono">{stats.health.active_event}</span>
                  {stats.health.cooldown_until && (
                    <> · Cooldown hasta{' '}
                      {new Date(stats.health.cooldown_until).toLocaleString('es-AR', {
                        timeZone: 'America/Argentina/Buenos_Aires',
                      })} ART
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          {stats.shadowban_suspected && (
            <div className="flex items-start gap-3 p-4 bg-amber-950/60 border border-amber-800 rounded-xl">
              <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 font-semibold text-sm">Posible shadowban detectado</p>
                <p className="text-amber-400/80 text-xs mt-0.5">
                  Reply rate de {stats.reply_rate_7d.rate.toFixed(1)}% en 7d con {stats.reply_rate_7d.total} DMs enviados. Revisá la cuenta manualmente.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* DMs hoy */}
        <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-apex-muted uppercase tracking-widest">DMs hoy</span>
            <Send size={16} className="text-apex-muted" />
          </div>
          <div>
            <span className="font-syne font-bold text-3xl text-white">{stats.quota.sent_today}</span>
            <span className="text-apex-muted text-sm ml-1">/ {stats.quota.limit}</span>
          </div>
          <QuotaBar pct={stats.quota.pct} />
          <p className="text-xs text-apex-muted">{stats.quota.remaining} restantes hoy</p>
        </div>

        {/* Reply rate */}
        <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-apex-muted uppercase tracking-widest">Reply rate 7d</span>
            <TrendingUp size={16} className={stats.shadowban_suspected ? 'text-amber-400' : 'text-apex-muted'} />
          </div>
          <div>
            <span className={`font-syne font-bold text-3xl ${stats.shadowban_suspected ? 'text-amber-400' : 'text-white'}`}>
              {stats.reply_rate_7d.rate.toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-apex-muted">
            {stats.reply_rate_7d.replied}/{stats.reply_rate_7d.total} respondieron
          </p>
        </div>

        {/* Interesados */}
        <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-apex-muted uppercase tracking-widest">Interesados</span>
            <Zap size={16} className="text-apex-lime" />
          </div>
          <span className="font-syne font-bold text-3xl text-apex-lime block">
            {(stats.status_counts.interested ?? 0) + (stats.status_counts.meeting_booked ?? 0)}
          </span>
          <p className="text-xs text-apex-muted">
            {stats.status_counts.meeting_booked ?? 0} con reunión agendada
          </p>
        </div>

        {/* En cola */}
        <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-apex-muted uppercase tracking-widest">En cola</span>
            <Clock size={16} className="text-apex-muted" />
          </div>
          <span className="font-syne font-bold text-3xl text-white block">
            {stats.queue_pending}
          </span>
          <p className="text-xs text-apex-muted">DMs pendientes de envío</p>
        </div>
      </div>

      {/* ── Leads by status ── */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-5">
          <Users size={16} className="text-apex-muted" />
          <h2 className="font-syne font-semibold">Leads por estado</h2>
          <span className="ml-auto text-xs font-mono text-apex-muted">{totalActive} activos</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(STATUS_LABELS).map(([status, label]) => {
            const count = stats.status_counts[status] ?? 0
            if (count === 0 && ['blacklisted', 'error', 'meeting_booked'].includes(status)) return null
            return (
              <div key={status} className="bg-apex-dark rounded-lg p-3 space-y-1">
                <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_COLORS[status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                  {label}
                </span>
                <p className="font-syne font-bold text-2xl text-white">{count}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Two-col: Recent leads + Health log ── */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* Recent leads */}
        <div className="bg-apex-card border border-apex-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-apex-muted" />
            <h2 className="font-syne font-semibold">Leads recientes</h2>
          </div>
          <div className="space-y-2">
            {stats.recent_leads.length === 0 && (
              <p className="text-apex-muted text-sm text-center py-6">Sin leads contactados aún</p>
            )}
            {stats.recent_leads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between py-2.5 border-b border-apex-border last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-700 to-pink-700 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-white">
                      {lead.ig_username[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">@{lead.ig_username}</p>
                    <p className="text-xs text-apex-muted truncate">
                      {lead.business_category ?? 'Boutique'}
                      {lead.contacted_at && <> · {relativeTime(lead.contacted_at)}</>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {lead.reply_count > 0 && (
                    <div className="flex items-center gap-1 text-xs text-emerald-400">
                      <MessageSquare size={12} />
                      {lead.reply_count}
                    </div>
                  )}
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_COLORS[lead.status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                    {STATUS_LABELS[lead.status] ?? lead.status}
                  </span>
                  <span className="text-xs font-mono text-apex-muted">{lead.lead_score}pt</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Health log */}
        <div className="bg-apex-card border border-apex-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            {isCircuitOpen
              ? <ShieldAlert size={16} className="text-rose-400" />
              : <ShieldCheck size={16} className="text-emerald-400" />
            }
            <h2 className="font-syne font-semibold">Estado de la cuenta</h2>
            <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded-full ${isCircuitOpen ? 'bg-rose-950 text-rose-400' : 'bg-emerald-950 text-emerald-400'}`}>
              {isCircuitOpen ? 'PAUSADO' : 'ACTIVO'}
            </span>
          </div>

          {stats.health.logs.length === 0 ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm py-6 justify-center">
              <CheckCircle2 size={16} />
              Sin eventos en las últimas 24hs
            </div>
          ) : (
            <div className="space-y-2">
              {stats.health.logs.map((log, i) => (
                <div key={i} className="flex items-start justify-between py-2 border-b border-apex-border last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                      ['feedback_required', 'challenge_required', 'login_required'].includes(log.event)
                        ? 'bg-rose-400'
                        : log.event === 'ok'
                        ? 'bg-emerald-400'
                        : 'bg-amber-400'
                    }`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-mono ${EVENT_COLORS[log.event] ?? 'text-white'}`}>
                        {log.event}
                      </p>
                      {log.cooldown_until && new Date(log.cooldown_until) > new Date() && (
                        <p className="text-xs text-apex-muted">
                          cooldown hasta {new Date(log.cooldown_until).toLocaleTimeString('es-AR')}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-apex-muted shrink-0 ml-2">
                    {relativeTime(log.occurred_at)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Circuit controls */}
          {isCircuitOpen && (
            <div className="mt-4 pt-4 border-t border-apex-border">
              <button
                onClick={() => handlePause(true)}
                disabled={pausing}
                className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm text-white font-medium transition-colors disabled:opacity-50"
              >
                <Play size={14} />
                {pausing ? 'Reanudando...' : 'Reanudar outbound manualmente'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── System status footer ── */}
      <div className="bg-apex-dark border border-apex-border rounded-xl p-4 flex flex-wrap items-center gap-6 text-xs font-mono text-apex-muted">
        <div className="flex items-center gap-2">
          <Eye size={12} />
          <span>Modo: <span className={stats.dry_run ? 'text-purple-400' : 'text-emerald-400'}>{stats.dry_run ? 'DRY RUN' : 'PRODUCCIÓN'}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Zap size={12} />
          <span>Warmup: <span className={stats.warmup_mode ? 'text-amber-400' : 'text-emerald-400'}>{stats.warmup_mode ? 'ON (máx 3/día)' : 'OFF'}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={12} />
          <span>Auto-refresh cada 60s</span>
        </div>
        <div className="ml-auto text-apex-muted/60">
          Poll inbox · every 2min · Send pending · every 2min
        </div>
      </div>
    </div>
  )
}
