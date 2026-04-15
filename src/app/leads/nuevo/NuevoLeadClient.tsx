'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Phone, Sparkles, Save, Send, Star, Globe, ExternalLink } from 'lucide-react'
import { ResultadoBusquedaLead } from '@/types'

interface LeadCardState extends ResultadoBusquedaLead {
  mensaje_sugerido: string
  generando_mensaje: boolean
  guardando: boolean
  guardado: boolean
}

interface ApiErrorResponse {
  error?: string
}

function getEnviadosKey() {
  return `apex_enviados_${new Date().toDateString()}`
}

function getEnviadosHoy() {
  if (typeof window === 'undefined') return 0
  return parseInt(localStorage.getItem(getEnviadosKey()) || '0', 10)
}

function buildDescripcion(lead: ResultadoBusquedaLead) {
  const rating = Number.isFinite(lead.rating) ? lead.rating.toFixed(1) : '0.0'
  const reviews = Number.isFinite(lead.cantidad_reviews) ? lead.cantidad_reviews : 0

  return `Rating: ${rating}/5 (${reviews} reviews). ${lead.tiene_web && lead.url_web ? `Tiene web: ${lead.url_web}` : 'No tiene sitio web'}. Dirección: ${lead.direccion}`
}

export default function NuevoLeadClient() {
  const [rubro, setRubro] = useState('')
  const [zona, setZona] = useState('Buenos Aires')
  const [resultados, setResultados] = useState<LeadCardState[]>([])
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [enviadosHoy, setEnviadosHoy] = useState<number>(0)

  const puedeBuscar = useMemo(() => rubro.trim().length > 0 && !buscando, [rubro, buscando])

  useEffect(() => {
    setEnviadosHoy(getEnviadosHoy())
  }, [])

  async function parseApiError(res: Response, fallback: string) {
    try {
      const data = (await res.json()) as ApiErrorResponse
      return data.error || fallback
    } catch {
      return fallback
    }
  }

  async function buscarNegocios(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBuscando(true)
    setErrorBusqueda(null)

    try {
      const response = await fetch('/api/leads/buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubro, zona }),
      })

      if (!response.ok) {
        const msg = await parseApiError(response, 'No se pudieron obtener resultados.')
        throw new Error(msg)
      }

      const data = await response.json()
      const lista: ResultadoBusquedaLead[] = Array.isArray(data?.resultados) ? data.resultados : []

      setResultados(
        lista.map((lead) => ({
          ...lead,
          mensaje_sugerido: '',
          generando_mensaje: false,
          guardando: false,
          guardado: false,
        }))
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudieron buscar negocios.'
      setErrorBusqueda(msg)
    } finally {
      setBuscando(false)
    }
  }

  async function generarMensaje(index: number) {
    const lead = resultados[index]
    if (!lead || lead.ya_registrado) return

    setResultados((prev) =>
      prev.map((item, i) => (i === index ? { ...item, generando_mensaje: true } : item))
    )

    try {
      const descripcion = buildDescripcion(lead)
      const response = await fetch('/api/leads/generar-mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: lead.nombre,
          rubro: lead.rubro,
          zona,
          descripcion,
          instagram: null,
        }),
      })

      if (!response.ok) {
        const msg = await parseApiError(response, 'No se pudo generar el mensaje.')
        throw new Error(msg)
      }

      const data = await response.json()
      const mensaje = typeof data?.mensaje === 'string' ? data.mensaje : ''

      setResultados((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, mensaje_sugerido: mensaje, generando_mensaje: false } : item
        )
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo generar el mensaje.'
      setErrorBusqueda(msg)
      setResultados((prev) =>
        prev.map((item, i) => (i === index ? { ...item, generando_mensaje: false } : item))
      )
    }
  }

  async function guardarLead(index: number, abrirWhatsapp: boolean) {
    const lead = resultados[index]
    if (!lead || lead.ya_registrado || lead.guardando || !lead.mensaje_sugerido) return

    setResultados((prev) =>
      prev.map((item, i) => (i === index ? { ...item, guardando: true } : item))
    )

    try {
      const descripcion = buildDescripcion(lead)
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: lead.nombre,
          rubro: lead.rubro,
          zona,
          telefono: lead.telefono,
          instagram: null,
          descripcion,
          mensaje_inicial: lead.mensaje_sugerido,
          estado: 'pendiente',
          origen: 'outbound',
        }),
      })

      if (!response.ok) {
        const msg = await parseApiError(response, 'No se pudo guardar el lead.')
        throw new Error(msg)
      }

      setResultados((prev) =>
        prev.map((item, i) => (i === index ? { ...item, guardando: false, guardado: true } : item))
      )

      if (abrirWhatsapp) {
        const mensaje = encodeURIComponent(lead.mensaje_sugerido)
        window.open(`https://wa.me/${lead.telefono}?text=${mensaje}`, '_blank')
        const enviados = getEnviadosHoy() + 1
        localStorage.setItem(getEnviadosKey(), enviados.toString())
        setEnviadosHoy(enviados)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo guardar el lead.'
      setErrorBusqueda(msg)
      setResultados((prev) =>
        prev.map((item, i) => (i === index ? { ...item, guardando: false } : item))
      )
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Nuevo Lead</h1>
          <p className="text-apex-muted text-sm mt-1">Buscador automático con Google Places</p>
        </div>
        <div className="bg-apex-card border border-apex-border rounded-lg px-4 py-2 font-mono text-sm">
          Enviados hoy: <span className="text-apex-lime font-bold">{enviadosHoy}</span>/20
        </div>
      </div>

      <form onSubmit={buscarNegocios} className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <h2 className="font-syne font-semibold text-lg">Buscar negocios</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
              Rubro
            </label>
            <input
              type="text"
              value={rubro}
              onChange={(event) => setRubro(event.target.value)}
              placeholder="Ej: pizzería, peluquería, gimnasio"
              className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
          </div>
          <div>
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
              Zona
            </label>
            <input
              type="text"
              value={zona}
              onChange={(event) => setZona(event.target.value)}
              placeholder="Ej: Palermo, Buenos Aires"
              className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!puedeBuscar}
          className="flex items-center gap-2 bg-apex-lime text-apex-black px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-apex-lime-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {buscando ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Buscando negocios...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Buscar negocios
            </>
          )}
        </button>

        {errorBusqueda && (
          <p className="text-sm text-red-400 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">{errorBusqueda}</p>
        )}
      </form>

      {buscando && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3 animate-pulse">
              <div className="h-5 w-2/3 rounded bg-apex-border" />
              <div className="h-4 w-full rounded bg-apex-border" />
              <div className="h-4 w-5/6 rounded bg-apex-border" />
              <div className="h-9 w-1/2 rounded bg-apex-border" />
            </div>
          ))}
        </div>
      )}

      {!buscando && resultados.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-syne font-semibold text-lg">Resultados ({resultados.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resultados.map((lead, index) => {
              const deshabilitado = lead.ya_registrado
              const sinWeb = !lead.tiene_web

              return (
                <div
                  key={`${lead.telefono}-${lead.nombre}-${index}`}
                  className={`bg-apex-card border border-apex-border rounded-xl p-5 space-y-3 animate-fade-in ${
                    deshabilitado ? 'opacity-55' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {sinWeb && (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-apex-lime/20 text-apex-lime font-mono uppercase tracking-wide">
                        SIN WEB - Potencial lead
                      </span>
                    )}
                    {lead.ya_registrado && (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-apex-border text-apex-muted font-mono uppercase tracking-wide">
                        Ya registrado
                      </span>
                    )}
                    {lead.guardado && !lead.ya_registrado && (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-mono uppercase tracking-wide">
                        Guardado
                      </span>
                    )}
                  </div>

                  <div>
                    <h3 className="font-syne font-semibold text-lg leading-tight">{lead.nombre}</h3>
                    <p className="text-sm text-apex-muted mt-1 flex items-start gap-2">
                      <MapPin size={14} className="mt-0.5 shrink-0" />
                      <span>{lead.direccion || 'Dirección no disponible'}</span>
                    </p>
                  </div>

                  <div className="space-y-1.5 text-sm font-mono text-apex-muted">
                    <p className="flex items-center gap-2">
                      <Phone size={14} className="shrink-0" />
                      <span>{lead.telefono || 'Sin teléfono'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Star size={14} className="shrink-0" />
                      <span>
                        {lead.rating.toFixed(1)} ({lead.cantidad_reviews} reviews)
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Globe size={14} className="shrink-0" />
                      <span>{lead.tiene_web && lead.url_web ? lead.url_web : 'No tiene sitio web'}</span>
                    </p>
                    {lead.google_maps_url && (
                      <a
                        href={lead.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-apex-lime hover:underline"
                      >
                        <ExternalLink size={12} />
                        Ver en Google Maps
                      </a>
                    )}
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => generarMensaje(index)}
                      disabled={deshabilitado || lead.generando_mensaje}
                      className="w-full flex items-center justify-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-apex-lime-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {lead.generando_mensaje ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          Generando mensaje...
                        </>
                      ) : (
                        <>
                          <Sparkles size={15} />
                          Generar mensaje
                        </>
                      )}
                    </button>

                    {lead.mensaje_sugerido && (
                      <div className="space-y-2">
                        <textarea
                          value={lead.mensaje_sugerido}
                          onChange={(event) =>
                            setResultados((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, mensaje_sugerido: event.target.value } : item
                              )
                            )
                          }
                          rows={4}
                          className="w-full bg-apex-black border border-apex-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-apex-lime/50 resize-none"
                        />

                        <div className="grid grid-cols-1 gap-2">
                          <button
                            type="button"
                            onClick={() => guardarLead(index, false)}
                            disabled={deshabilitado || lead.guardando}
                            className="flex items-center justify-center gap-2 bg-apex-border text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-apex-muted/30 transition-colors disabled:opacity-40"
                          >
                            {lead.guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            Solo guardar
                          </button>

                          <button
                            type="button"
                            onClick={() => guardarLead(index, true)}
                            disabled={deshabilitado || lead.guardando}
                            className="flex items-center justify-center gap-2 bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-green-500 transition-colors disabled:opacity-40"
                          >
                            {lead.guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Guardar y abrir WhatsApp
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
