'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  MapPin,
  Phone,
  Sparkles,
  Star,
  Globe,
  ExternalLink,
  CheckCircle2,
  Clock,
  Square,
  Layers,
} from 'lucide-react'
import { ResultadoBusquedaLead } from '@/types'
import {
  getDefaultPais,
  getInitialSeleccionArgentina,
  PAISES_HISPANOHABLANTES,
} from '@/lib/locations-ar'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

const TODAS_LOCALIDADES = '__TODAS__'
const TODAS_PROVINCIAS = '__TODAS_PROVINCIAS__'

const OPCIONES_CONCURRENCIA = [
  { valor: 1, etiqueta: '1 — secuencial' },
  { valor: 3, etiqueta: '3 — suave' },
  { valor: 5, etiqueta: '5 — normal' },
  { valor: 8, etiqueta: '8 — agresivo' },
] as const

/** Orden fijo de arrays en `locations-ar`: primero → último, o inverso. */
const OPCIONES_ORDEN_RECORRIDO = [
  { valor: 'listado' as const, etiqueta: 'Del primero al último (como en el desplegable)' },
  { valor: 'inverso' as const, etiqueta: 'Del último al primero (orden inverso)' },
] as const

interface LeadCardState extends ResultadoBusquedaLead {
  zona: string
}

interface ApiErrorResponse {
  error?: string
}

interface QueueStats {
  pendientes: number
  enviados_hoy: number
  fallidos_hoy: number
  ventana_horaria: { inicio: number; fin: number }
  en_ventana: boolean
  activo: boolean
}

interface QueueResult {
  agregados: number
  duplicados: number
}

interface CapacitySender {
  id: string
  alias: string | null
  instance_name: string
  phone_number: string
  color: string
  msgs_today: number
  daily_limit: number
  remaining: number
  connected: boolean
}

interface CapacityStats {
  total_today: number
  used_today: number
  remaining: number
  active_connected: number
  active_total: number
  per_sender: CapacitySender[]
}

type EstadoWorkerVisual = 'espera' | 'activo' | 'hecho' | 'pausa'

interface WorkerSlotVisual {
  id: number
  estado: EstadoWorkerVisual
  label: string
}

function buildDescripcion(lead: ResultadoBusquedaLead) {
  const rating = Number.isFinite(lead.rating) ? lead.rating.toFixed(1) : '0.0'
  const reviews = Number.isFinite(lead.cantidad_reviews) ? lead.cantidad_reviews : 0

  return `Rating: ${rating}/5 (${reviews} reviews). ${lead.tiene_web && lead.url_web ? `Tiene web: ${lead.url_web}` : 'No tiene sitio web'}. Dirección: ${lead.direccion}`
}

export default function NuevoLeadClient() {
  const [rubro, setRubro] = useState('')
  const [paisCodigo, setPaisCodigo] = useState(getDefaultPais().codigo)
  const [provinciaNombre, setProvinciaNombre] = useState(
    () => getInitialSeleccionArgentina(getDefaultPais()).provincia
  )
  const [localidadNombre, setLocalidadNombre] = useState(
    () => getInitialSeleccionArgentina(getDefaultPais()).localidad
  )
  const [resultados, setResultados] = useState<LeadCardState[]>([])
  const [buscando, setBuscando] = useState(false)
  const [encolando, setEncolando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null)
  const [capacity, setCapacity] = useState<CapacityStats | null>(null)
  const [ultimoResultadoCola, setUltimoResultadoCola] = useState<QueueResult | null>(null)

  const [progresoActual, setProgresoActual] = useState(0)
  const [progresoTotal, setProgresoTotal] = useState(0)
  const [progresoLocalidad, setProgresoLocalidad] = useState('')
  const [slotsParalelo, setSlotsParalelo] = useState<WorkerSlotVisual[]>([])
  const [detenidoPorUsuario, setDetenidoPorUsuario] = useState(false)
  const [concurrenciaBusqueda, setConcurrenciaBusqueda] = useState(5)
  const [ordenRecorrido, setOrdenRecorrido] = useState<'listado' | 'inverso'>('listado')

  const detenerBusquedaRef = useRef(false)
  const abortBusquedaRef = useRef<AbortController | null>(null)

  const paisSeleccionado = useMemo(
    () => PAISES_HISPANOHABLANTES.find((p) => p.codigo === paisCodigo) || getDefaultPais(),
    [paisCodigo]
  )

  const esModoTodasProvincias = provinciaNombre === TODAS_PROVINCIAS

  const provinciaSeleccionada = useMemo(
    () =>
      esModoTodasProvincias
        ? null
        : paisSeleccionado.provincias.find((p) => p.nombre === provinciaNombre) || paisSeleccionado.provincias[0],
    [paisSeleccionado, provinciaNombre, esModoTodasProvincias]
  )

  const esModoProvincia = localidadNombre === TODAS_LOCALIDADES && !esModoTodasProvincias

  const totalLocalidadesPais = useMemo(
    () => paisSeleccionado.provincias.reduce((n, p) => n + p.localidades.length, 0),
    [paisSeleccionado]
  )

  const puedeBuscar = useMemo(
    () =>
      rubro.trim().length > 0 &&
      !buscando &&
      !encolando &&
      (esModoTodasProvincias ||
        esModoProvincia ||
        (localidadNombre.trim().length > 0 && localidadNombre !== TODAS_LOCALIDADES)),
    [rubro, localidadNombre, buscando, encolando, esModoTodasProvincias, esModoProvincia]
  )

  const zona = useMemo(
    () =>
      esModoTodasProvincias
        ? `${paisSeleccionado.nombre} (todas las provincias)`
        : esModoProvincia
          ? `${provinciaSeleccionada?.nombre}, ${paisSeleccionado.nombre}`
          : `${localidadNombre}, ${provinciaSeleccionada?.nombre}, ${paisSeleccionado.nombre}`,
    [
      localidadNombre,
      provinciaSeleccionada?.nombre,
      paisSeleccionado.nombre,
      esModoProvincia,
      esModoTodasProvincias,
      paisSeleccionado,
    ]
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

  async function cargarCapacity() {
    try {
      const res = await fetch('/api/senders/capacity', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as CapacityStats
        setCapacity(data)
      }
    } catch {
      // silencioso, no es crítico
    }
  }

  useEffect(() => {
    cargarStats()
    cargarCapacity()
    const intervalo = setInterval(() => {
      cargarStats()
      cargarCapacity()
    }, 30_000)
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

  async function buscarEnLocalidad(
    zonaLocal: string,
    signal?: AbortSignal
  ): Promise<ResultadoBusquedaLead[]> {
    const response = await fetch('/api/leads/buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rubro, zona: zonaLocal }),
      signal,
    })
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data?.resultados) ? data.resultados : []
  }

  function detenerBusqueda() {
    detenerBusquedaRef.current = true
    abortBusquedaRef.current?.abort()
  }

  async function encolarLeads(leads: LeadCardState[]): Promise<QueueResult | null> {
    if (leads.length === 0) return { agregados: 0, duplicados: 0 }

    const permitidos = leads.filter(l => l.telefono && !isTelefonoHardBlocked(l.telefono))
    if (permitidos.length === 0) {
      return { agregados: 0, duplicados: leads.length }
    }

    const payload = {
      leads: permitidos.map(l => ({
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
    detenerBusquedaRef.current = false
    setDetenidoPorUsuario(false)
    abortBusquedaRef.current = new AbortController()
    const signal = abortBusquedaRef.current.signal

    setBuscando(true)
    setErrorBusqueda(null)
    setResultados([])
    setUltimoResultadoCola(null)
    setProgresoActual(0)
    setProgresoTotal(0)
    setProgresoLocalidad('')
    setSlotsParalelo([])

    let detenidoManual = false

    try {
      let acumulados: LeadCardState[] = []

      if (esModoTodasProvincias || esModoProvincia) {
        type TareaBusqueda = { zonaLocal: string; progresoLabel: string }
        const tareas: TareaBusqueda[] = []

        if (esModoTodasProvincias) {
          const provs = [...paisSeleccionado.provincias]
          if (ordenRecorrido === 'inverso') provs.reverse()
          for (const prov of provs) {
            const locs =
              ordenRecorrido === 'inverso' ? [...prov.localidades].reverse() : prov.localidades
            for (const loc of locs) {
              tareas.push({
                zonaLocal: `${loc.nombre}, ${prov.nombre}, ${paisSeleccionado.nombre}`,
                progresoLabel: `${loc.nombre} · ${prov.nombre}`,
              })
            }
          }
        } else {
          const provSel = provinciaSeleccionada ?? paisSeleccionado.provincias[0]
          const baseLocs = provSel.localidades || []
          const locs = ordenRecorrido === 'inverso' ? [...baseLocs].reverse() : baseLocs
          for (const loc of locs) {
            tareas.push({
              zonaLocal: `${loc.nombre}, ${provSel.nombre}, ${paisSeleccionado.nombre}`,
              progresoLabel: loc.nombre,
            })
          }
        }

        setProgresoTotal(tareas.length)

        const acum = { telefonos: new Set<string>(), filas: [] as LeadCardState[] }
        const workers = Math.min(8, Math.max(1, concurrenciaBusqueda))
        let nextIndex = 0
        let completados = 0

        setSlotsParalelo(
          Array.from({ length: workers }, (_, i) => ({
            id: i + 1,
            estado: 'espera' as const,
            label: 'Iniciando…',
          }))
        )

        const actualizarSlot = (slotIdx: number, patch: Partial<WorkerSlotVisual>) => {
          setSlotsParalelo((prev) => {
            const next = [...prev]
            if (!next[slotIdx]) return prev
            next[slotIdx] = { ...next[slotIdx], ...patch }
            return next
          })
        }

        const workerParalelo = async (slotIdx: number) => {
          while (true) {
            if (detenerBusquedaRef.current) {
              actualizarSlot(slotIdx, { estado: 'pausa', label: 'Detenido' })
              break
            }
            const i = nextIndex++
            if (i >= tareas.length) {
              actualizarSlot(slotIdx, { estado: 'hecho', label: 'Listo' })
              break
            }
            const t = tareas[i]
            actualizarSlot(slotIdx, { estado: 'activo', label: t.progresoLabel })
            setProgresoLocalidad(t.progresoLabel)
            try {
              const lista = await buscarEnLocalidad(t.zonaLocal, signal)
              if (detenerBusquedaRef.current) break
              for (const lead of lista) {
                if (lead.telefono && !acum.telefonos.has(lead.telefono)) {
                  acum.telefonos.add(lead.telefono)
                  acum.filas.push({ ...lead, zona: t.zonaLocal })
                }
              }
            } catch (err) {
              if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                detenerBusquedaRef.current = true
                break
              }
            } finally {
              completados += 1
              setProgresoActual(completados)
              setResultados([...acum.filas])
              if (detenerBusquedaRef.current) {
                actualizarSlot(slotIdx, { estado: 'pausa', label: 'Detenido' })
              } else {
                actualizarSlot(slotIdx, { estado: 'espera', label: 'Disponible' })
              }
            }
          }
        }

        await Promise.all(Array.from({ length: workers }, (_, slotIdx) => workerParalelo(slotIdx)))
        acumulados = acum.filas
      } else {
        const response = await fetch('/api/leads/buscar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rubro, zona }),
          signal,
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

      detenidoManual = detenerBusquedaRef.current
      setDetenidoPorUsuario(detenidoManual)
      detenerBusquedaRef.current = false
      abortBusquedaRef.current = null

      // Encolar automáticamente (también si detuviste a mitad: todo lo hallado hasta ahora)
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
      if (error instanceof DOMException && error.name === 'AbortError') {
        detenidoManual = true
        setDetenidoPorUsuario(true)
      } else {
        const msg = error instanceof Error ? error.message : 'No se pudieron buscar negocios.'
        setErrorBusqueda(msg)
      }
    } finally {
      setBuscando(false)
      setProgresoLocalidad('')
      setSlotsParalelo([])
      detenerBusquedaRef.current = false
      abortBusquedaRef.current = null
    }
  }

  const porcentajeProgreso = progresoTotal > 0 ? Math.round((progresoActual / progresoTotal) * 100) : 0

  const clasesGridWorkers = (n: number) => {
    if (n <= 0) return 'grid-cols-1'
    if (n === 1) return 'grid-cols-1 max-w-sm mx-auto w-full'
    if (n === 2) return 'grid-cols-2'
    if (n === 3) return 'grid-cols-3'
    if (n === 4) return 'grid-cols-2 sm:grid-cols-4'
    if (n === 5) return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
    if (n === 6) return 'grid-cols-2 sm:grid-cols-3'
    return 'grid-cols-2 sm:grid-cols-4'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Nuevo Lead</h1>
          <p className="text-apex-muted text-sm mt-1">
            Cola automática de primer contacto: sin tope diario. El cron solo envía entre{' '}
            <span className="text-apex-lime/90">7:00 y 21:00</span> (hora Argentina).
            {queueStats
              ? queueStats.en_ventana
                ? ' Ahora estás en ventana de envío.'
                : ' Ahora estás fuera de ventana; los envíos reanudan al abrirse el horario.'
              : null}
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
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Hoy</div>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-bold text-apex-lime">{queueStats.enviados_hoy}</span>
              <span className="text-xs text-apex-muted font-mono">enviados</span>
            </div>
            {queueStats.fallidos_hoy > 0 && (
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-sm font-bold text-red-400">{queueStats.fallidos_hoy}</span>
                <span className="text-xs text-apex-muted font-mono">fallidos</span>
              </div>
            )}
          </div>
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Horario envío</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">
              {String(queueStats.ventana_horaria.inicio).padStart(2, '0')}:00–
              {String(queueStats.ventana_horaria.fin).padStart(2, '0')}:00
              <span className="text-sm text-apex-muted font-mono ml-1">ART</span>
            </div>
            <p
              className={`text-xs mt-1.5 font-mono ${
                queueStats.en_ventana ? 'text-apex-lime' : 'text-amber-400/90'
              }`}
            >
              {queueStats.en_ventana
                ? 'En horario de envío'
                : 'Fuera de ventana — el cron reanuda a las 7:00 ART'}
            </p>
          </div>
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Sistema</div>
            <div className={`text-2xl font-bold mt-1 ${queueStats.activo ? 'text-apex-lime' : 'text-red-400'}`}>
              {queueStats.activo ? 'ACTIVO' : 'PAUSADO'}
            </div>
          </div>
        </div>
      )}

      {/* Capacidad del pool de SIMs */}
      {capacity && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Pool restante</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-apex-lime tabular-nums">{capacity.remaining}</span>
              <span className="text-sm text-apex-muted font-mono">de {capacity.total_today} msgs</span>
            </div>
            <div className="w-full h-1 bg-apex-border rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-apex-lime rounded-full transition-all"
                style={{
                  width: `${
                    capacity.total_today > 0
                      ? Math.min(100, (capacity.used_today / capacity.total_today) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="bg-apex-card border border-apex-border rounded-lg p-3">
            <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">SIMs activas</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-apex-lime tabular-nums">{capacity.active_connected}</span>
              <span className="text-sm text-apex-muted font-mono">de {capacity.active_total} conectadas</span>
            </div>
            <div className="flex gap-1 mt-2 flex-wrap">
              {capacity.per_sender.map((s) => (
                <div
                  key={s.id}
                  className={`w-2 h-2 rounded-full ${s.connected ? 'bg-apex-lime' : 'bg-red-500/50'}`}
                  title={`${s.alias ?? s.instance_name} — ${s.connected ? 'conectada' : 'desconectada'}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mini-grid por SIM */}
      {capacity && capacity.per_sender.length > 0 && (
        <div className="bg-apex-card/60 border border-apex-border/60 rounded-xl p-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-apex-muted mb-3">
            Capacidad por SIM
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {capacity.per_sender.map((s) => {
              const pct = s.daily_limit > 0 ? (s.msgs_today / s.daily_limit) * 100 : 0
              return (
                <div key={s.id} className="flex items-center gap-3 bg-apex-black/40 rounded-lg p-3">
                  <div
                    className={`w-2 h-8 rounded-full flex-shrink-0 ${s.connected ? '' : 'opacity-30'}`}
                    style={{ background: s.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-syne font-semibold truncate">
                        {s.alias ?? s.instance_name}
                      </span>
                      <span className="text-xs font-mono text-apex-muted tabular-nums whitespace-nowrap">
                        {s.msgs_today}/{s.daily_limit}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-apex-border rounded-full overflow-hidden mt-1.5">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          background: s.color,
                          opacity: s.connected ? 1 : 0.3,
                        }}
                      />
                    </div>
                    {!s.connected && (
                      <span className="text-[10px] font-mono text-red-400/80">desconectada</span>
                    )}
                  </div>
                </div>
              )
            })}
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
                  if (nuevoPais) {
                    const sel = getInitialSeleccionArgentina(nuevoPais)
                    setProvinciaNombre(sel.provincia)
                    setLocalidadNombre(sel.localidad)
                  }
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
                    if (nuevoNombre === TODAS_PROVINCIAS) {
                      setLocalidadNombre(TODAS_LOCALIDADES)
                    } else {
                      const prov = paisSeleccionado.provincias.find((p) => p.nombre === nuevoNombre)
                      setLocalidadNombre(prov?.localidades[0]?.nombre || '')
                    }
                  }}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                >
                  <option value={TODAS_PROVINCIAS}>
                    ★ Todo el país ({paisSeleccionado.provincias.length} provincias, {totalLocalidadesPais}{' '}
                    localidades)
                  </option>
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
                  disabled={esModoTodasProvincias}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {esModoTodasProvincias ? (
                    <option value={TODAS_LOCALIDADES}>
                      Recorre cada localidad de cada provincia
                    </option>
                  ) : (
                    <>
                      <option value={TODAS_LOCALIDADES}>
                        ★ Toda la provincia ({provinciaSeleccionada?.localidades.length} localidades)
                      </option>
                      {provinciaSeleccionada?.localidades.map((loc) => (
                        <option key={loc.nombre} value={loc.nombre}>
                          {loc.nombre}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>
        </div>

        {(esModoTodasProvincias || esModoProvincia) && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                Orden del recorrido
              </label>
              <p className="text-[11px] text-apex-muted mb-1.5">
                {esModoTodasProvincias
                  ? 'Define si se recorre el país de la primera a la última provincia en el listado, o al revés. En cada provincia, el orden de localidades sigue la misma lógica.'
                  : 'Define si se recorre la provincia de la primera a la última localidad en el desplegable, o al revés.'}
              </p>
              <select
                value={ordenRecorrido}
                onChange={(e) => setOrdenRecorrido(e.target.value as 'listado' | 'inverso')}
                className="w-full sm:max-w-md bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
              >
                {OPCIONES_ORDEN_RECORRIDO.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
                Concurrencia
              </label>
              <p className="text-[11px] text-apex-muted mb-1.5">
                Toda la provincia o todo el país: varias búsquedas en paralelo (máx. 8). Más grupos, más
                carga a la API.
              </p>
              <select
                value={concurrenciaBusqueda}
                onChange={(e) => setConcurrenciaBusqueda(Number(e.target.value))}
                className="w-full sm:max-w-xs bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
              >
                {OPCIONES_CONCURRENCIA.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!puedeBuscar}
            className="flex items-center gap-2 bg-apex-lime text-apex-black px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-apex-lime-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {buscando ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {esModoTodasProvincias
                  ? 'Buscando en todo el país...'
                  : esModoProvincia
                    ? 'Buscando en la provincia...'
                    : 'Buscando negocios...'}
              </>
            ) : encolando ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Agregando a la cola...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {esModoTodasProvincias
                  ? `Buscar y encolar (${paisSeleccionado.nombre} completo)`
                  : esModoProvincia
                    ? `Buscar y encolar (toda ${provinciaSeleccionada?.nombre})`
                    : 'Buscar y encolar'}
              </>
            )}
          </button>
          {buscando && (esModoTodasProvincias || esModoProvincia) && (
            <button
              type="button"
              onClick={detenerBusqueda}
              className="inline-flex items-center gap-1.5 border border-red-500/50 text-red-300 bg-red-500/10 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              <Square size={14} className="fill-current" />
              Detener y encolar lo encontrado
            </button>
          )}
        </div>

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
              {detenidoPorUsuario && (
                <p className="text-amber-200/90 text-xs mt-1.5">
                  Búsqueda detenida a mano: se usaron solo los resultados acumulados hasta ese momento.
                </p>
              )}
              {ultimoResultadoCola.duplicados > 0 && (
                <p className="text-apex-muted text-xs mt-0.5">
                  {ultimoResultadoCola.duplicados} {ultimoResultadoCola.duplicados === 1 ? 'estaba' : 'estaban'} duplicados (omitidos)
                </p>
              )}
              <p className="text-apex-muted text-xs mt-0.5">
                Con el sistema activo, el cron envía según cola solo entre 7:00 y 21:00 (hora Argentina);
                no hay tope diario de cantidad.
              </p>
            </div>
          </div>
        )}
      </form>

      {/* Progreso global + un slot por worker (concurrencia) */}
      {buscando && (esModoProvincia || esModoTodasProvincias) && progresoTotal > 0 && (
        <div className="bg-apex-card/80 border border-apex-border rounded-xl p-5 sm:p-6 space-y-4 backdrop-blur-sm shadow-lg shadow-black/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-mono uppercase tracking-wider text-apex-muted">Progreso global</p>
              <p className="text-lg font-syne font-semibold text-white mt-0.5 tabular-nums">
                {progresoActual}
                <span className="text-apex-muted text-base font-normal"> / </span>
                {progresoTotal}
                <span className="text-apex-muted text-sm font-mono font-normal ml-1.5">localidades</span>
              </p>
              {progresoLocalidad ? (
                <p className="text-xs text-apex-muted font-mono mt-1.5 truncate" aria-live="polite">
                  Última petición: <span className="text-apex-lime/90">{progresoLocalidad}</span>
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={detenerBusqueda}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] shrink-0 border border-red-500/50 text-red-300 bg-red-500/10 px-4 py-2 rounded-lg text-sm font-mono font-semibold hover:bg-red-500/20 transition-colors"
            >
              <Square size={12} className="fill-current" />
              Detener
            </button>
          </div>
          <div
            className="w-full bg-apex-black/80 rounded-full h-1.5 overflow-hidden ring-1 ring-apex-border/50"
            role="progressbar"
            aria-valuenow={progresoActual}
            aria-valuemin={0}
            aria-valuemax={progresoTotal}
            aria-label="Progreso de búsqueda"
          >
            <div
              className="h-full bg-gradient-to-r from-apex-lime/80 to-apex-lime rounded-full transition-all duration-300 ease-out"
              style={{ width: `${porcentajeProgreso}%` }}
            />
          </div>

          {slotsParalelo.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Layers className="text-apex-lime shrink-0" size={16} strokeWidth={2} aria-hidden />
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-apex-muted">
                  Grupos en paralelo ({slotsParalelo.length})
                </h3>
              </div>
              <div
                className={`grid ${clasesGridWorkers(slotsParalelo.length)} gap-2.5 sm:gap-3`}
                role="list"
                aria-label="Estado de cada grupo de búsqueda"
              >
                {slotsParalelo.map((slot) => {
                  const esActivo = slot.estado === 'activo'
                  const esHecho = slot.estado === 'hecho'
                  const esPausa = slot.estado === 'pausa'
                  return (
                    <div
                      key={slot.id}
                      role="listitem"
                      className={[
                        'relative rounded-xl border p-3 sm:p-3.5 min-h-[5.25rem] flex flex-col justify-between transition-all duration-200',
                        esActivo
                          ? 'border-apex-lime/40 bg-apex-lime/[0.06] shadow-[0_0_0_1px_rgba(190,242,100,0.1)]'
                          : esHecho
                            ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                            : esPausa
                              ? 'border-amber-500/25 bg-amber-500/[0.06]'
                              : 'border-apex-border/70 bg-apex-black/45',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                          Grupo {slot.id}
                        </span>
                        {esActivo && (
                          <Loader2
                            size={15}
                            className="text-apex-lime animate-spin shrink-0"
                            aria-label="Buscando"
                          />
                        )}
                        {esHecho && (
                          <CheckCircle2
                            size={15}
                            className="text-emerald-400/90 shrink-0"
                            aria-label="Completado"
                          />
                        )}
                        {esPausa && (
                          <Square
                            size={12}
                            className="text-amber-300/90 shrink-0 fill-amber-300/30"
                            aria-label="Detenido"
                          />
                        )}
                        {slot.estado === 'espera' && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-apex-border shrink-0"
                            aria-hidden
                          />
                        )}
                      </div>
                      <p
                        className={`text-xs sm:text-sm font-mono leading-snug line-clamp-2 mt-1.5 ${esActivo ? 'text-white' : 'text-apex-muted'}`}
                        title={slot.label}
                      >
                        {slot.label}
                      </p>
                      {esActivo && (
                        <div
                          className="mt-2.5 h-0.5 w-full rounded-full bg-apex-black/80 overflow-hidden"
                          aria-hidden
                        >
                          <div className="h-full w-2/5 bg-apex-lime/70 rounded-full motion-safe:animate-pulse" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {resultados.length > 0 && (
            <p className="text-xs text-apex-muted font-mono pt-1 border-t border-apex-border/50">
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
              {buscando && (esModoProvincia || esModoTodasProvincias) ? ' y contando...' : ''})
            </h2>
            {esModoTodasProvincias && !buscando && (
              <span className="text-xs text-apex-muted font-mono">
                {paisSeleccionado.provincias.length} provincias, {totalLocalidadesPais} localidades escaneadas
              </span>
            )}
            {esModoProvincia && !esModoTodasProvincias && !buscando && (
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
                        {(lead.rating ?? 0).toFixed(1)} ({lead.cantidad_reviews ?? 0} reviews)
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
