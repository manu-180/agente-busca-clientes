'use client'

import { useEffect, useState } from 'react'
import { Bot, BotOff, Plus, Edit, Trash2, Save, X, Loader2 } from 'lucide-react'
import type { ApexInfo } from '@/types'

const CATEGORIAS = ['servicios', 'precios', 'proceso', 'portfolio', 'faqs', 'diferencial']

export default function AgentePage() {
  const [infos, setInfos] = useState<ApexInfo[]>([])
  const [agenteActivo, setAgenteActivo] = useState(true)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [form, setForm] = useState({ categoria: 'servicios', titulo: '', contenido: '' })

  const cargar = async () => {
    try {
      const [infoRes, configRes] = await Promise.all([
        fetch('/api/agente/info'),
        fetch('/api/agente/config'),
      ])
      const infoData = await infoRes.json()
      const configData = await configRes.json()
      setInfos(infoData.infos ?? [])
      setAgenteActivo(configData.agente_activo === 'true')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const toggleAgente = async () => {
    const nuevoValor = !agenteActivo
    await fetch('/api/agente/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: 'agente_activo', valor: nuevoValor ? 'true' : 'false' }),
    })
    setAgenteActivo(nuevoValor)
  }

  const guardarInfo = async () => {
    const method = editando ? 'PUT' : 'POST'
    const body = editando ? { ...form, id: editando } : form

    await fetch('/api/agente/info', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setShowForm(false)
    setEditando(null)
    setForm({ categoria: 'servicios', titulo: '', contenido: '' })
    await cargar()
  }

  const eliminarInfo = async (id: string) => {
    await fetch('/api/agente/info', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await cargar()
  }

  const editarInfo = (info: ApexInfo) => {
    setForm({ categoria: info.categoria, titulo: info.titulo, contenido: info.contenido })
    setEditando(info.id)
    setShowForm(true)
  }

  const infosPorCategoria = CATEGORIAS.map(cat => ({
    categoria: cat,
    items: infos.filter(i => i.categoria === cat),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-syne font-bold text-3xl tracking-tight">Agente IA</h1>
        <p className="text-apex-muted text-sm mt-1 font-mono">Configurá qué sabe y cómo responde</p>
      </div>

      {/* Toggle global */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            agenteActivo ? 'bg-apex-lime/10' : 'bg-apex-border'
          }`}>
            {agenteActivo ? <Bot size={24} className="text-apex-lime" /> : <BotOff size={24} className="text-apex-muted" />}
          </div>
          <div>
            <h2 className="font-semibold">Agente {agenteActivo ? 'ACTIVO' : 'INACTIVO'}</h2>
            <p className="text-sm text-apex-muted">
              {agenteActivo ? 'Respondiendo automáticamente a conversaciones' : 'No responde a ninguna conversación'}
            </p>
          </div>
        </div>
        <button
          onClick={toggleAgente}
          className={`relative w-14 h-7 rounded-full transition-colors ${
            agenteActivo ? 'bg-apex-lime' : 'bg-apex-border'
          }`}
        >
          <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-apex-black transition-transform ${
            agenteActivo ? 'left-[30px]' : 'left-0.5'
          }`} />
        </button>
      </div>

      {/* Info de APEX */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-syne font-semibold text-xl">Información de APEX</h2>
          <button
            onClick={() => { setShowForm(true); setEditando(null); setForm({ categoria: 'servicios', titulo: '', contenido: '' }) }}
            className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm hover:bg-apex-lime-hover transition-colors"
          >
            <Plus size={16} />
            Agregar
          </button>
        </div>
        <p className="text-sm text-apex-muted">
          Todo lo que cargues acá es lo que el agente sabe sobre APEX. Si no está acá, no lo va a mencionar.
        </p>

        {/* Form */}
        {showForm && (
          <div className="bg-apex-card border border-apex-lime/20 rounded-xl p-6 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editando ? 'Editar' : 'Nueva'} información</h3>
              <button onClick={() => { setShowForm(false); setEditando(null) }} className="text-apex-muted hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">Categoría</label>
                <select
                  value={form.categoria}
                  onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm"
                >
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">Título</label>
                <input
                  type="text"
                  value={form.titulo}
                  onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">Contenido</label>
              <textarea
                value={form.contenido}
                onChange={e => setForm(f => ({ ...f, contenido: e.target.value }))}
                rows={4}
                className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-apex-lime/50 resize-none"
              />
            </div>
            <button
              onClick={guardarInfo}
              disabled={!form.titulo || !form.contenido}
              className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40"
            >
              <Save size={16} />
              Guardar
            </button>
          </div>
        )}

        {/* Cards por categoría */}
        {loading ? (
          <p className="text-apex-muted text-sm">Cargando...</p>
        ) : (
          infosPorCategoria
            .filter(g => g.items.length > 0)
            .map(grupo => (
              <div key={grupo.categoria} className="space-y-2">
                <h3 className="font-mono text-xs text-apex-muted uppercase tracking-widest">
                  {grupo.categoria}
                </h3>
                {grupo.items.map(info => (
                  <div key={info.id} className="bg-apex-card border border-apex-border rounded-xl p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-sm">{info.titulo}</h4>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => editarInfo(info)}
                          className="p-1.5 rounded hover:bg-apex-border text-apex-muted hover:text-white transition-colors"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => eliminarInfo(info.id)}
                          className="p-1.5 rounded hover:bg-red-500/10 text-apex-muted hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-apex-muted whitespace-pre-wrap">{info.contenido}</p>
                  </div>
                ))}
              </div>
            ))
        )}
      </div>
    </div>
  )
}
