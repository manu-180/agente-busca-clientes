'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Phone, Sparkles, Star, Globe, ExternalLink, CheckCircle2, Clock } from 'lucide-react'
import { ResultadoBusquedaLead } from '@/types'
import { getDefaultPais, PAISES_HISPANOHABLANTES } from '@/lib/locations-ar'

const TODAS_LOCALIDADES = '__TODAS__'

interface LeadCardState extends ResultadoBusquedaLead {
  zona: string
}

interface ApiErrorResponse {
  error?: string
}

interface QueueStats {
  pendientes: number
  enviados_hoy: number
  limite_diario: number
  ventana_horaria: { inicio: number; fin: number }
  intervalo_min: { min: number; max: number }
  next_slot_at: string | null
  activo: boolean
}

interface QueueResult {
  agregados: number
  duplicados: number
}

function buildDescripcion(lead: ResultadoBusquedaLead) {
  const rating = Number.isFinite(lead.rating) ? lead.rating.toFixed(1) : '0.0'
  const reviews = Number.isFinite(lead.cantidad_reviews) ? lead.cantidad_reviews : 0

  return `Rating: ${rating}/5 (${reviews} reviews). ${lead.tiene_web && lead.url_web ? `Tiene web: ${lead.url_web}` : 'No tiene sitio web'}. Dirección: ${lead.direccion}`
}

export default function NuevoLeadClient() {
  const [rubro, setRubro] = useState('')
  const [paisCodigo, setPaisCodigo] = useState(getDefaultPais().codigo)
  const [provinciaNombre, setProvinciaNombre] = useState(getDefaultPais().provincias[0]?.nombre || '')
  const [localidadNombre, setLocalidadNombre] = useState(
    getDefaultPais().provincias[0]?.localidades[0]?.nombre || ''
  )
  const [resultados, setResultados] = useState<LeadCardState[]>([])
  const [buscando, setBuscando] = useState(false)
  const [encolando, setEncolando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null)
  const [ultimoResultadoCola, setUltimoResultadoCola] = useState<QueueResult | null>(null)

  const [progresoActual, setProgresoActual] = useState(0)
  const [progresoTotal, setProgresoTotal] = useState(0)
  const [progresoLocalidad, setProgresoLocalidad] = useState('')

  const paisSeleccionado = useMemo(
    () => PAISES_HISPANOHABLANTES.find((p) => p.codigo === paisCodigo) || getDefaultPais(),
    [paisCodigo]
  )

  const provinciaSeleccionada = useMemo(
    () => paisSeleccionado.provincias.find((p) => p.nombre === provinciaNombre) || paisSeleccionado.provincias[0],
    [paisSeleccionado, provinciaNombre]
  )

  const esModoProvincia = localidadNombre === TODAS_LOCALIDADES

  const puedeBuscar = useMemo(
    () => rubro.trim().length > 0 && localidadNombre.trim().length > 0 && !buscando && !encolando,
    [rubro, localidadNombre, buscando, encolando]
  )

  const zona = useMemo(
    () =>
      esModoProvincia
        ? `${provinciaSeleccionada?.nombre}, ${paisSeleccionado.nombre}`
        : `${localidadNombre}, ${provinciaSeleccionada?.nombre}, ${paisSeleccionado.nombre}`,
    [localidadNombre, provinciaSeleccionada?.nombre, paisSeleccionado.nombre, esModoProvincia]
  )

  async function cargarStats() {
    try {
      const res = await fetch('/api/leads/queue-stats', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as QueueStats
        setQueueStats(data)
      }
    } catch {
      // silencioso, no es crítico
    }
  }

  useEffect(() => {
    cargarStats()
    const intervalo = setInterval(cargarStats, 30_000)
    return () => clearInterval(intervalo)
  }, [])

  async function parseApiError(res: Response, fallback: string) {
    try {
      const data = (await res.json()) as ApiErrorResponse
      return data.error || fallback
    } catch {
      return fallback
    }
  }

  async function buscarEnLocalidad(zonaLocal: string): Promise<ResultadoBusquedaLead[]> {
    const response = await fetch('/api/leads/buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rubro, zona: zonaLocal }),
    })
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data?.resultados) ? data.resultados : []
  }

  async function encolarLeads(leads: LeadCardState[]): Promise<QueueResult | null> {
    if (leads.length === 0) return { agregados: 0, duplicados: 0 }

    const payload = {
      leads: leads.map(l => ({
        nombre: l.nombre,
        rubro: l.rubro,
        zona: l.zona,
        telefono: l.telefono,
        descripcion: buildDescripcion(l),
      })),
    }

    const res = await fetch('/api/leads/bulk-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const msg = await parseApiError(res, 'No se pudo encolar leads.')
      throw new Error(msg)
    }

    const data = await res.json()
    return {
      agregados: data?.agregados ?? 0,
      duplicados: data?.duplicados ?? 0,
    }
  }

  async function buscarNegocios(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBuscando(true)
    setErrorBusqueda(null)
    setResultados([])
    setUltimoResultadoCola(null)
    setProgresoActual(0)
    setProgresoTotal(0)
    setProgresoLocalidad('')

    try {
      let acumulados: LeadCardState[] = []

      if (esModoProvincia) {
        const localidades = provinciaSeleccionada?.localidades || []
        setProgresoTotal(localidades.length)

        const telefonosVistos = new Set<string>()

        for (let i = 0; i < localidades.length; i++) {
          const loc = localidades[i]
          setProgresoActual(i + 1)
          setProgresoLocalidad(loc.nombre)

          const zonaLocal = `${loc.nombre}, ${provinciaSeleccionada.nombre}, ${paisSeleccionado.nombre}`
          try {
            const lista = await buscarEnLocalidad(zonaLocal)
            for (const lead of lista) {
              if (lead.telefono && !telefonosVistos.has(lead.telefono)) {
                telefonosVistos.add(lead.telefono)
                acumulados.push({ ...lead, zona: zonaLocal })
              }
            }
            setResultados([...acumulados])
          } catch {
            // seguir
          }
        }
      } else {
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

        acumulados = lista.map((lead) => ({ ...lead, zona }))
        setResultados(acumulados)
      }

      // Encolar automáticamente
      if (acumulados.length > 0) {
        setEncolando(true)
        try {
          const resultado = await encolarLeads(acumulados)
          setUltimoResultadoCola(resultado)
          await cargarStats()
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Error encolando leads'
          setErrorBusqueda(msg)
        } finally {
          setEncolando(false)
        }
      } else {
        setUltimoResultadoCola({ agregados: 0, duplicados: 0 })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudieron buscar negocios.'
      setErrorBusqueda(msg)
    } finally {
      setBuscando(false)
      setProgresoLocalidad('')
    }
  }

  const porcentajeProgreso = progresoTotal > 0 ? Math.round((progresoActual / progresoTotal) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Nuevo Lead</h1>
          <p className="text-apex-muted text-sm mt-1">
            Cola automática de primer contacto — el cron envía cada {queueStats?.intervalo_min.min ?? 10}-{queueStats?.intervalo_min.max ?? 15} min
          </p>
        </div>
      </div>

      {/* Stats bar */}
      {queueStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">En cola</div>
            <div className="text-2xl font-bold text-apex-lime mt-1">{queueStats.pendientes}</div>
          </div>
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Enviados hoy</div>
            <div className="text-2xl font-bold mt-1">
              {queueStats.enviados_hoy}
              <span className="text-sm text-apex-muted font-mono">/{queueStats.limite_diario}</span>
            </div>
          </div>
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Ventana AR</div>
            <div className="text-2xl font-bold mt-1">
              {queueStats.ventana_horaria.inicio}-{queueStats.ventana_horaria.fin}
              <span className="text-sm text-apex-muted font-mono">hs</span>
            </div>
          </div>
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Sistema</div>
            <div className={`text-2xl font-bold mt-1 ${queueStats.activo ? 'text-apex-lime' : 'text-red-400'}`}>
              {queueStats.activo ? 'ACTIVO' : 'PAUSADO'}
            </div>
          </div>
        </div>
      )}

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
          <div className="space-y-3">
            <div>
              <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                País
              </label>
              <select
                value={paisCodigo}
                onChange={(event) => {
                  const nuevoCodigo = event.target.value
                  setPaisCodigo(nuevoCodigo)
                  const nuevoPais = PAISES_HISPANOHABLANTES.find((p) => p.codigo === nuevoCodigo)
                  const primeraProvincia = nuevoPais?.provincias[0]
                  setProvinciaNombre(primeraProvincia?.nombre || '')
                  setLocalidadNombre(primeraProvincia?.localidades[0]?.nombre || '')
                }}
                className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
              >
                {PAISES_HISPANOHABLANTES.map((pais) => (
                  <option key={pais.codigo} value={pais.codigo}>
                    {pais.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                  Provincia
                </label>
                <select
                  value={provinciaNombre}
                  onChange={(event) => {
                    const nuevoNombre = event.target.value
                    setProvinciaNombre(nuevoNombre)
                    const prov = paisSeleccionado.provincias.find((p) => p.nombre === nuevoNombre)
                    setLocalidadNombre(prov?.localidades[0]?.nombre || '')
                  }}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                >
                  {paisSeleccionado.provincias.map((provincia) => (
                    <option key={provincia.nombre} value={provincia.nombre}>
                      {provincia.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                  Localidad
                </label>
                <select
                  value={localidadNombre}
                  onChange={(event) => setLocalidadNombre(event.target.value)}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                >
                  <option value={TODAS_LOCALIDADES}>
                    ★ Toda la provincia ({provinciaSeleccionada?.localidades.length} localidades)
                  </option>
                  {provinciaSeleccionada?.localidades.map((loc) => (
                    <option key={loc.nombre} value={loc.nombre}>
                      {loc.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
              {esModoProvincia ? 'Buscando en la provincia...' : 'Buscando negocios...'}
            </>
          ) : encolando ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Agregando a la cola...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              {esModoProvincia
                ? `Buscar y encolar (toda ${provinciaSeleccionada?.nombre})`
                : 'Buscar y encolar'}
            </>
          )}
        </button>

        {errorBusqueda && (
          <p className="text-sm text-red-400 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">{errorBusqueda}</p>
        )}

        {ultimoResultadoCola && !buscando && !encolando && (
          <div className="text-sm flex items-start gap-2 border border-apex-lime/30 bg-apex-lime/5 rounded-lg px-3 py-2.5">
            <CheckCircle2 size={16} className="text-apex-lime shrink-0 mt-0.5" />
            <div>
              <p className="text-apex-lime font-semibold">
                {ultimoResultadoCola.agregados} {ultimoResultadoCola.agregados === 1 ? 'lead agregado' : 'leads agregados'} a la cola
              </p>
              {ultimoResultadoCola.duplicados > 0 && (
                <p className="text-apex-muted text-xs mt-0.5">
                  {ultimoResultadoCola.duplicados} {ultimoResultadoCola.duplicados === 1 ? 'estaba' : 'estaban'} duplicados (omitidos)
                </p>
              )}
              <p className="text-apex-muted text-xs mt-0.5">
                El bot empezará a enviar en el próximo slot (cada {queueStats?.intervalo_min.min ?? 10}-{queueStats?.intervalo_min.max ?? 15} min).
              </p>
            </div>
          </div>
        )}
      </form>

      {/* Barra de progreso búsqueda provincial */}
      {buscando && esModoProvincia && progresoTotal > 0 && (
        <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-apex-muted font-mono">
              Buscando en <span className="text-white">{progresoLocalidad}</span>
            </span>
            <span className="text-apex-lime font-mono font-bold">
              {progresoActual}/{progresoTotal} localidades
            </span>
          </div>
          <div className="w-full bg-apex-black rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-apex-lime rounded-full transition-all duration-300"
              style={{ width: `${porcentajeProgreso}%` }}
            />
          </div>
          {resultados.length > 0 && (
            <p className="text-xs text-apex-muted font-mono">
              {resultados.length} leads encontrados hasta ahora
            </p>
          )}
        </div>
      )}

      {/* Skeletons iniciales */}
      {buscando && resultados.length === 0 && (
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

      {resultados.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-syne font-semibold text-lg">
              Encontrados ({resultados.length}
              {buscando && esModoProvincia ? ' y contando...' : ''})
            </h2>
            {esModoProvincia && !buscando && (
              <span className="text-xs text-apex-muted font-mono">
                {provinciaSeleccionada?.localidades.length} localidades escaneadas
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resultados.map((lead, index) => {
              const yaRegistrado = lead.ya_registrado
              const sinWeb = !lead.tiene_web

              return (
                <div
                  key={`${lead.telefono}-${lead.nombre}-${index}`}
                  className={`bg-apex-card border border-apex-border rounded-xl p-5 space-y-3 animate-fade-in ${
                    yaRegistrado ? 'opacity-55' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {sinWeb && (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-apex-lime/20 text-apex-lime font-mono uppercase tracking-wide">
                        SIN WEB
                      </span>
                    )}
                    {yaRegistrado ? (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-apex-border text-apex-muted font-mono uppercase tracking-wide">
                        Ya registrado
                      </span>
                    ) : !encolando && ultimoResultadoCola ? (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-mono uppercase tracking-wide">
                        <Clock size={10} /> En cola
                      </span>
                    ) : null}
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
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
