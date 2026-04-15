'use client'

import { useEffect, useState } from 'react'
import { Search, Filter, ExternalLink, MessageSquare, Plus } from 'lucide-react'
import Link from 'next/link'
import type { Lead, EstadoLead } from '@/types'

const ESTADOS: EstadoLead[] = ['pendiente', 'contactado', 'respondio', 'interesado', 'cerrado', 'descartado', 'no_interesado']

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<string>('todos')

  useEffect(() => {
    fetch('/api/leads')
      .then(r => r.json())
      .then(data => setLeads(data.leads ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const leadsFiltrados = leads.filter(lead => {
    const matchBusqueda = lead.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      lead.rubro.toLowerCase().includes(busqueda.toLowerCase()) ||
      lead.zona.toLowerCase().includes(busqueda.toLowerCase())
    const matchEstado = filtroEstado === 'todos' || lead.estado === filtroEstado
    return matchBusqueda && matchEstado
  })

  const cambiarEstado = async (id: string, estado: EstadoLead) => {
    await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado }),
    })
    setLeads(prev => prev.map(l => l.id === id ? { ...l, estado } : l))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Leads</h1>
          <p className="text-apex-muted text-sm mt-1 font-mono">{leads.length} leads totales</p>
        </div>
        <Link
          href="/leads/nuevo"
          className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-apex-lime-hover transition-colors"
        >
          <Plus size={16} />
          Nuevo Lead
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-apex-muted" />
          <input
            type="text"
            placeholder="Buscar por nombre, rubro o zona..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full bg-apex-card border border-apex-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50 transition-colors"
          />
        </div>
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="bg-apex-card border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
        >
          <option value="todos">Todos los estados</option>
          {ESTADOS.map(e => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-apex-border text-left text-xs text-apex-muted font-mono uppercase tracking-wider">
                <th className="px-5 py-3">Nombre</th>
                <th className="px-5 py-3">Rubro</th>
                <th className="px-5 py-3">Zona</th>
                <th className="px-5 py-3">Teléfono</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3">Origen</th>
                <th className="px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-apex-muted text-sm">Cargando...</td></tr>
              ) : leadsFiltrados.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-apex-muted text-sm">No se encontraron leads</td></tr>
              ) : (
                leadsFiltrados.map(lead => (
                  <tr key={lead.id} className="border-b border-apex-border/50 hover:bg-apex-border/20 transition-colors">
                    <td className="px-5 py-3 text-sm font-medium">{lead.nombre}</td>
                    <td className="px-5 py-3 text-sm text-apex-muted">{lead.rubro}</td>
                    <td className="px-5 py-3 text-sm text-apex-muted">{lead.zona}</td>
                    <td className="px-5 py-3 text-sm font-mono text-apex-muted">{lead.telefono}</td>
                    <td className="px-5 py-3">
                      <select
                        value={lead.estado}
                        onChange={e => cambiarEstado(lead.id, e.target.value as EstadoLead)}
                        className={`badge-${lead.estado} text-xs px-2 py-1 rounded-full bg-transparent border border-apex-border cursor-pointer`}
                      >
                        {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        lead.origen === 'inbound' ? 'bg-apex-lime/10 text-apex-lime' : 'bg-blue-500/10 text-blue-400'
                      }`}>{lead.origen}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://wa.me/${lead.telefono}`}
                          target="_blank"
                          className="p-1.5 rounded-lg hover:bg-apex-border transition-colors text-apex-muted hover:text-green-400"
                          title="Abrir WhatsApp"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <Link
                          href={`/conversaciones?tel=${lead.telefono}`}
                          className="p-1.5 rounded-lg hover:bg-apex-border transition-colors text-apex-muted hover:text-apex-lime"
                          title="Ver conversación"
                        >
                          <MessageSquare size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
