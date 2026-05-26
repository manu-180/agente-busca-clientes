'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle,
  Edit,
  Plus,
  Save,
  Trash2,
  X,
  Tag,
  Globe,
  Search,
  MessageSquare,
} from 'lucide-react'
import type { ProjectRow } from '@/lib/projects'

const CATEGORIAS = ['servicios', 'precios', 'proceso', 'portfolio', 'faqs', 'diferencial']

interface ProjectInfoRow {
  id: string
  project_id: string
  categoria: string
  titulo: string
  contenido: string
  activo: boolean
  created_at: string
}

export function ProyectoClient({
  project,
  infosInicial,
}: {
  project: ProjectRow
  infosInicial: ProjectInfoRow[]
}) {
  // Identidad
  const [nombre, setNombre] = useState(project.nombre)
  const [descripcion, setDescripcion] = useState(project.descripcion)
  const [urlPublica, setUrlPublica] = useState(project.url_publica ?? '')

  // Búsqueda
  const [filtroSinWeb, setFiltroSinWeb] = useState(project.filtro_sin_web)
  const [rubros, setRubros] = useState<string[]>(project.rubros_sugeridos ?? [])
  const [nuevoRubro, setNuevoRubro] = useState('')

  // Plantilla
  const [plantilla, setPlantilla] = useState(project.plantilla_primer_mensaje)

  // Info para la IA
  const [infos, setInfos] = useState<ProjectInfoRow[]>(infosInicial)
  const [showInfoForm, setShowInfoForm] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [infoForm, setInfoForm] = useState({ categoria: 'servicios', titulo: '', contenido: '' })

  const [guardadoFlash, setGuardadoFlash] = useState<string | null>(null)

  function flash(seccion: string) {
    setGuardadoFlash(seccion)
    setTimeout(() => setGuardadoFlash(null), 1800)
  }

  async function guardarProyecto(patch: Partial<ProjectRow>, seccion: string) {
    const res = await fetch(`/api/projects/${project.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) flash(seccion)
    else alert('Error guardando: ' + (await res.text()))
  }

  async function recargarInfos() {
    const res = await fetch(`/api/agente/info?project_id=${project.id}`)
    if (res.ok) {
      const { infos } = await res.json()
      setInfos(infos ?? [])
    }
  }

  async function guardarInfo() {
    const method = editandoId ? 'PUT' : 'POST'
    const body = editandoId
      ? { ...infoForm, id: editandoId }
      : { ...infoForm, project_id: project.id }
    await fetch('/api/agente/info', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setShowInfoForm(false)
    setEditandoId(null)
    setInfoForm({ categoria: 'servicios', titulo: '', contenido: '' })
    await recargarInfos()
  }

  async function eliminarInfo(id: string) {
    if (!confirm('¿Borrar este bloque?')) return
    await fetch('/api/agente/info', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await recargarInfos()
  }

  function editarInfo(info: ProjectInfoRow) {
    setInfoForm({ categoria: info.categoria, titulo: info.titulo, contenido: info.contenido })
    setEditandoId(info.id)
    setShowInfoForm(true)
  }

  function agregarRubro() {
    const r = nuevoRubro.trim().toLowerCase()
    if (!r || rubros.includes(r)) return
    const nuevo = [...rubros, r]
    setRubros(nuevo)
    setNuevoRubro('')
    void guardarProyecto({ rubros_sugeridos: nuevo }, 'busqueda')
  }

  function quitarRubro(r: string) {
    const nuevo = rubros.filter(x => x !== r)
    setRubros(nuevo)
    void guardarProyecto({ rubros_sugeridos: nuevo }, 'busqueda')
  }

  const infosPorCategoria = CATEGORIAS.map(cat => ({
    categoria: cat,
    items: infos.filter(i => i.categoria === cat),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-syne font-bold text-3xl tracking-tight">{project.nombre}</h1>
        <p className="text-apex-muted text-sm mt-1 font-mono">
          Panel del proyecto · slug: <span className="text-apex-lime">{project.slug}</span>
        </p>
      </div>

      {/* ── Identidad ── */}
      <section className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-apex-lime" />
            <h2 className="font-syne font-semibold text-lg">Identidad</h2>
          </div>
          {guardadoFlash === 'identidad' && (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <CheckCircle size={14} />
              Guardado
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
              Nombre público
            </label>
            <input
              type="text"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              onBlur={() => guardarProyecto({ nombre }, 'identidad')}
              className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
          </div>
          <div>
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
              URL pública
            </label>
            <input
              type="text"
              value={urlPublica}
              onChange={e => setUrlPublica(e.target.value)}
              onBlur={() => guardarProyecto({ url_publica: urlPublica || null }, 'identidad')}
              placeholder="www.ejemplo.com (opcional)"
              className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
            Descripción para la IA
          </label>
          <textarea
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            onBlur={() => guardarProyecto({ descripcion }, 'identidad')}
            rows={3}
            placeholder="Una o dos líneas: qué es el producto, para quién, qué resuelve. La IA usa esto para presentarse."
            className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-apex-lime/50 resize-none"
          />
        </div>
      </section>

      {/* ── Búsqueda ── */}
      <section className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-apex-lime" />
            <h2 className="font-syne font-semibold text-lg">Búsqueda</h2>
          </div>
          {guardadoFlash === 'busqueda' && (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <CheckCircle size={14} />
              Guardado
            </span>
          )}
        </div>

        <button
          onClick={() => {
            const nuevo = !filtroSinWeb
            setFiltroSinWeb(nuevo)
            void guardarProyecto({ filtro_sin_web: nuevo }, 'busqueda')
          }}
          className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
            filtroSinWeb
              ? 'border-emerald-400/50 bg-emerald-500/10'
              : 'border-apex-border bg-apex-black'
          }`}
        >
          <p className="text-sm font-medium flex items-center gap-2">
            <Globe size={14} /> Filtrar solo negocios sin página web
          </p>
          <p className="text-xs text-apex-muted mt-1">
            {filtroSinWeb
              ? 'Activo — solo se muestran negocios sin web en los resultados de Google Places.'
              : 'Desactivado — se muestran todos los negocios, tengan o no web.'}
          </p>
        </button>

        <div>
          <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-2">
            Rubros sugeridos (chips en "Nuevo Lead")
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {rubros.length === 0 && (
              <span className="text-xs text-apex-muted italic">Todavía no agregaste ninguno.</span>
            )}
            {rubros.map(r => (
              <span
                key={r}
                className="inline-flex items-center gap-1.5 bg-apex-black border border-apex-border text-sm px-3 py-1.5 rounded-full"
              >
                {r}
                <button
                  onClick={() => quitarRubro(r)}
                  className="text-apex-muted hover:text-red-400 transition-colors"
                  aria-label={`Quitar ${r}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={nuevoRubro}
              onChange={e => setNuevoRubro(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  agregarRubro()
                }
              }}
              placeholder="ej. plomero, taller de cerámica, agencia de marketing"
              className="flex-1 bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
            <button
              onClick={agregarRubro}
              disabled={!nuevoRubro.trim()}
              className="flex items-center gap-1.5 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-apex-lime-hover transition-colors"
            >
              <Plus size={14} />
              Agregar
            </button>
          </div>
        </div>
      </section>

      {/* ── Plantilla primer mensaje ── */}
      <section className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-apex-lime" />
            <h2 className="font-syne font-semibold text-lg">Plantilla del primer mensaje</h2>
          </div>
          {guardadoFlash === 'plantilla' && (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <CheckCircle size={14} />
              Guardado
            </span>
          )}
        </div>
        <p className="text-xs text-apex-muted">
          Instrucción que la IA usa para generar el primer mensaje de WhatsApp outbound. Describí
          cómo presentarte y qué proponer. Si está vacío, los leads de este proyecto se saltan en
          el cron de primer contacto.
        </p>
        <textarea
          value={plantilla}
          onChange={e => setPlantilla(e.target.value)}
          onBlur={() => guardarProyecto({ plantilla_primer_mensaje: plantilla }, 'plantilla')}
          rows={10}
          placeholder={`ej. Presentate como del equipo de ${project.nombre}. Mencioná el negocio del cliente (rubro y zona). Ofrecé [explicá qué ofrecés]. Tono: rioplatense, breve, sin emojis.`}
          className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-apex-lime/50 resize-none font-mono"
        />
      </section>

      {/* ── Info para la IA ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-syne font-semibold text-xl">Información para la IA</h2>
          <button
            onClick={() => {
              setShowInfoForm(true)
              setEditandoId(null)
              setInfoForm({ categoria: 'servicios', titulo: '', contenido: '' })
            }}
            className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm hover:bg-apex-lime-hover transition-colors"
          >
            <Plus size={16} />
            Agregar
          </button>
        </div>
        <p className="text-sm text-apex-muted">
          Lo que la IA sabe sobre <span className="text-white font-semibold">{project.nombre}</span>. Si no
          está acá, no lo va a mencionar. El bot SOLO usa info de este proyecto al responder a sus leads —
          nunca mezcla con otros proyectos.
        </p>

        {showInfoForm && (
          <div className="bg-apex-card border border-apex-lime/20 rounded-xl p-6 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editandoId ? 'Editar' : 'Nueva'} información</h3>
              <button
                onClick={() => {
                  setShowInfoForm(false)
                  setEditandoId(null)
                }}
                className="text-apex-muted hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                  Categoría
                </label>
                <select
                  value={infoForm.categoria}
                  onChange={e => setInfoForm(f => ({ ...f, categoria: e.target.value }))}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm"
                >
                  {CATEGORIAS.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                  Título
                </label>
                <input
                  type="text"
                  value={infoForm.titulo}
                  onChange={e => setInfoForm(f => ({ ...f, titulo: e.target.value }))}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                Contenido
              </label>
              <textarea
                value={infoForm.contenido}
                onChange={e => setInfoForm(f => ({ ...f, contenido: e.target.value }))}
                rows={4}
                className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-apex-lime/50 resize-none"
              />
            </div>
            <button
              onClick={guardarInfo}
              disabled={!infoForm.titulo || !infoForm.contenido}
              className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40"
            >
              <Save size={16} />
              Guardar
            </button>
          </div>
        )}

        {infosPorCategoria
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
          ))}

        {infos.length === 0 && !showInfoForm && (
          <div className="bg-apex-card border border-dashed border-apex-border rounded-xl p-8 text-center">
            <p className="text-apex-muted text-sm">
              Todavía no cargaste información para {project.nombre}.
            </p>
            <p className="text-apex-muted text-xs mt-1">
              Sumá bloques con categorías (servicios, precios, faqs...) para que la IA sepa qué
              responder.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
