'use client'

import { useEffect, useState } from 'react'
import { Users, MessageSquare, UserCheck, Trophy, Clock, TrendingUp } from 'lucide-react'

interface Metricas {
  total_leads: number
  contactados_hoy: number
  respondieron: number
  interesados: number
  cerrados_mes: number
  leads_recientes: any[]
  conversational_metrics_available: boolean
  no_reply_emoji_7d: number
  no_reply_low_signal_7d: number
  handoff_human_7d: number
  guardrail_block_7d: number
}

export default function DashboardPage() {
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(setMetricas)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const cards = [
    { label: 'Total Leads', value: metricas?.total_leads ?? 0, icon: Users, color: 'text-white' },
    { label: 'Contactados Hoy', value: metricas?.contactados_hoy ?? 0, icon: Clock, color: 'text-blue-400' },
    { label: 'Respondieron', value: metricas?.respondieron ?? 0, icon: MessageSquare, color: 'text-green-400' },
    { label: 'Interesados', value: metricas?.interesados ?? 0, icon: TrendingUp, color: 'text-apex-lime' },
    { label: 'Cerrados (mes)', value: metricas?.cerrados_mes ?? 0, icon: Trophy, color: 'text-emerald-400' },
  ]

  const qualityCards = [
    {
      label: 'No reply emoji (7d)',
      value: metricas?.no_reply_emoji_7d ?? 0,
      color: 'text-orange-300',
    },
    {
      label: 'No reply baja señal (7d)',
      value: metricas?.no_reply_low_signal_7d ?? 0,
      color: 'text-amber-300',
    },
    {
      label: 'Handoff humano (7d)',
      value: metricas?.handoff_human_7d ?? 0,
      color: 'text-sky-300',
    },
    {
      label: 'Bloqueos guardrail (7d)',
      value: metricas?.guardrail_block_7d ?? 0,
      color: 'text-rose-300',
    },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-syne font-bold text-3xl tracking-tight">Dashboard</h1>
        <p className="text-apex-muted text-sm mt-1 font-mono">Resumen de tu operación</p>
      </div>

      {/* Calidad conversacional */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-syne font-semibold text-lg">Inteligencia conversacional</h2>
          <p className="text-xs text-apex-muted mt-1">
            Últimos 7 días. Si ves todo en 0, aplicá la migración de eventos conversacionales.
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {qualityCards.map(card => (
            <div key={card.label} className="bg-apex-black border border-apex-border rounded-lg p-4">
              <p className={`font-syne font-bold text-2xl ${card.color}`}>{loading ? '—' : card.value}</p>
              <p className="text-xs text-apex-muted mt-1">{card.label}</p>
            </div>
          ))}
        </div>
        {metricas && !metricas.conversational_metrics_available ? (
          <p className="text-xs text-amber-300">
            No se pudieron leer métricas conversacionales (tabla no disponible o sin permisos).
          </p>
        ) : null}
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-apex-card border border-apex-border rounded-xl p-5 animate-fade-in"
          >
            <div className="flex items-center justify-between mb-3">
              <card.icon size={18} className={card.color} />
            </div>
            <p className={`font-syne font-bold text-2xl ${card.color}`}>
              {loading ? '—' : card.value}
            </p>
            <p className="text-xs text-apex-muted mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Leads recientes */}
      <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-apex-border">
          <h2 className="font-syne font-semibold text-lg">Leads recientes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-apex-border text-left text-xs text-apex-muted font-mono uppercase tracking-wider">
                <th className="px-5 py-3">Nombre</th>
                <th className="px-5 py-3">Rubro</th>
                <th className="px-5 py-3">Zona</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3">Origen</th>
                <th className="px-5 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-apex-muted text-sm">
                    Cargando...
                  </td>
                </tr>
              ) : metricas?.leads_recientes?.length ? (
                metricas.leads_recientes.map((lead: any) => (
                  <tr key={lead.id} className="border-b border-apex-border/50 hover:bg-apex-border/20 transition-colors">
                    <td className="px-5 py-3 text-sm font-medium">{lead.nombre}</td>
                    <td className="px-5 py-3 text-sm text-apex-muted">{lead.rubro}</td>
                    <td className="px-5 py-3 text-sm text-apex-muted">{lead.zona}</td>
                    <td className="px-5 py-3">
                      <span className={`badge-${lead.estado} text-xs px-2 py-1 rounded-full`}>
                        {lead.estado}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        lead.origen === 'inbound' 
                          ? 'bg-apex-lime/10 text-apex-lime' 
                          : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {lead.origen}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-apex-muted font-mono">
                      {new Date(lead.created_at).toLocaleDateString('es-AR')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-apex-muted text-sm">
                    No hay leads todavía. Andá a "Nuevo Lead" para empezar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
