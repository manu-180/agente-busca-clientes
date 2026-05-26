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
  KeyRound,
  AlertTriangle,
  Zap,
} from 'lucide-react'
import { ResultadoBusquedaLead } from '@/types'
import {
  getDefaultPais,
  getInitialSeleccionArgentina,
  PAISES_HISPANOHABLANTES,
} from '@/lib/locations-ar'
import {
  contarLocalidadesPais,
  contarPrincipalesPais,
  contarPrincipalesProvincia,
  filtrarPrincipales,
} from '@/lib/localidades-principales-ar'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
import { usePolling } from '@/hooks/usePolling'

const TODAS_LOCALIDADES = '__TODAS__'
const TODAS_PROVINCIAS = '__TODAS_PROVINCIAS__'

const OPCIONES_CONCURRENCIA = [
  { valor: 1, etiqueta: '1 — secuencial (más estable)' },
  { valor: 2, etiqueta: '2 — recomendado' },
  { valor: 3, etiqueta: '3 — suave' },
  { valor: 5, etiqueta: '5 — agresivo (puede saturar QPM)' },
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
  quota_exhausted?: boolean
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

interface PlacesKeyStatus {
  label: string
  configured: boolean
  suffix: string | null
  used: number
  quota: number
  exhausted: boolean
  active: boolean
  last_used_at: string | null
  last_error: string | null
  last_error_at: string | null
}

interface PlacesKeysSnapshot {
  month: string
  next_reset_at: string
  days_until_reset: number
  keys: PlacesKeyStatus[]
}

type EstadoWorkerVisual = 'espera' | 'activo' | 'hecho' | 'pausa'

interface WorkerSlotVisual {
  id: number
  estado: EstadoWorkerVisual
  label: string
}

interface BuscarResponse {
  resultados: ResultadoBusquedaLead[]
  key_label?: string
  key_used?: number
  key_quota?: number
}

function buildDescripcion(lead: ResultadoBusquedaLead) {
  const rating = Number.isFinite(lead.rating) ? lead.rating.toFixed(1) : '0.0'
  const reviews = Number.isFinite(lead.cantidad_reviews) ? lead.cantidad_reviews : 0

  return `Rating: ${rating}/5 (${reviews} reviews). ${lead.tiene_web && lead.url_web ? `Tiene web: ${lead.url_web}` : 'No tiene sitio web'}. Dirección: ${lead.direccion}`
}

function pctColor(pct: number, exhausted: boolean): string {
  if (exhausted) return 'bg-red-500'
  if (pct >= 95) return 'bg-red-500'
  if (pct >= 70) return 'bg-amber-400'
  return 'bg-apex-lime'
}

interface ProjectOption {
  id: string
  slug: string
  nombre: string
  filtro_sin_web: boolean
  rubros_sugeridos: string[]
}

export default function NuevoLeadClient() {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [proyectoId, setProyectoId] = useState<string | null>(null)
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
  const [placesKeys, setPlacesKeys] = useState<PlacesKeysSnapshot | null>(null)
  const [ultimoResultadoCola, setUltimoResultadoCola] = useState<QueueResult | null>(null)

  const [progresoActual, setProgresoActual] = useState(0)
  const [progresoTotal, setProgresoTotal] = useState(0)
  const [progresoLocalidad, setProgresoLocalidad] = useState('')
  const [slotsParalelo, setSlotsParalelo] = useState<WorkerSlotVisual[]>([])
  const [detenidoPorUsuario, setDetenidoPorUsuario] = useState(false)
  const [concurrenciaBusqueda, setConcurrenciaBusqueda] = useState(2)
  const [ordenRecorrido, setOrdenRecorrido] = useState<'listado' | 'inverso'>('listado')
  const [modoEficiencia, setModoEficiencia] = useState(true)

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
    () => contarLocalidadesPais(paisSeleccionado),
    [paisSeleccionado]
  )

  const totalPrincipalesPais = useMemo(
    () => contarPrincipalesPais(paisSeleccionado),
    [paisSeleccionado]
  )

  const totalPrincipalesProvincia = useMemo(
    () => (provinciaSeleccionada ? contarPrincipalesProvincia(provinciaSeleccionada) : 0),
    [provinciaSeleccionada]
  )

  // Si el filtro no reduce nada (provincia o país sin datos curados), el modo
  // eficiencia es un no-op: lo informamos en la UI para no confundir al usuario.
  const filtroAportaAhorro = useMemo(() => {
    if (esModoTodasProvincias) return totalPrincipalesPais < totalLocalidadesPais
    if (esModoProvincia && provinciaSeleccionada)
      return totalPrincipalesProvincia < provinciaSeleccionada.localidades.length
    return false
  }, [
    esModoTodasProvincias,
    esModoProvincia,
    provinciaSeleccionada,
    totalPrincipalesPais,
    totalLocalidadesPais,
    totalPrincipalesProvincia,
  ])

  const placesKeysResumen = useMemo(() => {
    if (!placesKeys) return null
    const configuradas = placesKeys.keys.filter((k) => k.configured)
    if (configuradas.length === 0) {
      return { configuradas: 0, restantesGlobales: 0, agotadas: 0, sinKeys: true as const }
    }
    const totalUsado = configuradas.reduce((s, k) => s + k.used, 0)
    const totalQuota = configuradas.reduce((s, k) => s + k.quota, 0)
    const agotadas = configuradas.filter((k) => k.exhausted).length
    return {
      configuradas: configuradas.length,
      totalUsado,
      totalQuota,
      restantesGlobales: Math.max(0, totalQuota - totalUsado),
      agotadas,
      sinKeys: false as const,
    }
  }, [placesKeys])

  const sinKeysDisponibles = useMemo(() => {
    if (!placesKeys) return false
    const configuradas = placesKeys.keys.filter((k) => k.configured)
    return configuradas.length > 0 && configuradas.every((k) => k.exhausted)
  }, [placesKeys])

  const puedeBuscar = useMemo(
    () =>
      rubro.trim().length > 0 &&
      !buscando &&
      !encolando &&
      !sinKeysDisponibles &&
      (esModoTodasProvincias ||
        esModoProvincia ||
        (localidadNombre.trim().length > 0 && localidadNombre !== TODAS_LOCALIDADES)),
    [
      rubro,
      localidadNombre,
      buscando,
      encolando,
      esModoTodasProvincias,
      esModoProvincia,
      sinKeysDisponibles,
    ]
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

  // Cargar proyectos al montar + setear APEX como default
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(({ projects }) => {
        const list = (projects ?? []) as ProjectOption[]
        setProjects(list)
        const apex = list.find(p => p.slug === 'apex')
        setProyectoId(apex?.id ?? list[0]?.id ?? null)
      })
      .catch(() => {})
  }, [])

  const proyectoActual = useMemo(
    () => projects.find(p => p.id === proyectoId) ?? null,
    [projects, proyectoId]
  )

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

  async function cargarPlacesKeys() {
    try {
      const res = await fetch('/api/leads/places-keys', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as PlacesKeysSnapshot
        setPlacesKeys(data)
      }
    } catch {
      // silencioso, no es crítico
    }
  }

  const [reseteandoKey, setReseteandoKey] = useState<string | null>(null)

  async function rehabilitarKey(label: string) {
    if (reseteandoKey) return
    const ok = window.confirm(
      `Re-habilitar ${label}?\n\nEsto pone su contador en 0 para el mes actual. Usalo solo si la marcaste como agotada por un 403 (billing / restricción) y ya arreglaste la config en Google Cloud.`,
    )
    if (!ok) return
    setReseteandoKey(label)
    try {
      const res = await fetch('/api/leads/places-keys/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        window.alert(data?.error ?? 'No se pudo re-habilitar la key.')
        return
      }
      await cargarPlacesKeys()
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'Error desconocido'
      window.alert(`No se pudo re-habilitar la key: ${mensaje}`)
    } finally {
      setReseteandoKey(null)
    }
  }

  // Polling cada 120s con visibility-gate (vía usePolling). Pausa en pestaña
  // oculta y refresca al volver. Reemplaza la implementación manual previa.
  usePolling(() => {
    cargarStats()
    cargarCapacity()
    cargarPlacesKeys()
  }, 120_000)

  async function parseApiError(res: Response, fallback: string): Promise<{ msg: string; quota: boolean }> {
    try {
      const data = (await res.json()) as ApiErrorResponse
      return { msg: data.error || fallback, quota: Boolean(data.quota_exhausted) }
    } catch {
      return { msg: fallback, quota: false }
    }
  }

  async function buscarEnLocalidad(
    zonaLocal: string,
    signal?: AbortSignal
  ): Promise<{ leads: ResultadoBusquedaLead[]; quotaExhausted: boolean }> {
    try {
      const res = await fetch('/api/leads/buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubro, zona: zonaLocal, project_id: proyectoId }),
        signal,
      })
      if (!res.ok) {
        const { quota } = await parseApiError(res, 'Error buscando negocios.')
        // Si Google reporta cuota agotada GLOBAL → cortamos toda la sesión.
        if (quota || res.status === 429) {
          return { leads: [], quotaExhausted: true }
        }
        return { leads: [], quotaExhausted: false }
      }
      const data = (await res.json()) as BuscarResponse
      return { leads: data.resultados ?? [], quotaExhausted: false }
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw err
      }
      // Una localidad fallida no debe romper la sesión completa.
      return { leads: [], quotaExhausted: false }
    }
  }

  async function marcarDuplicados(
    leads: LeadCardState[]
  ): Promise<LeadCardState[]> {
    const tels = Array.from(new Set(leads.map((l) => l.telefono).filter(Boolean)))
    if (tels.length === 0) return leads
    try {
      const res = await fetch('/api/leads/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefonos: tels }),
      })
      if (!res.ok) return leads
      const data = await res.json()
      const existentes = new Set<string>(
        Array.isArray(data?.existentes) ? data.existentes : []
      )
      return leads
        .map((l) => ({ ...l, ya_registrado: existentes.has(l.telefono) }))
        .filter((l) => !l.ya_registrado)
    } catch {
      return leads
    }
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
      project_id: proyectoId,
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
      const { msg } = await parseApiError(res, 'No se pudo encolar leads.')
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
    let cuotaAgotadaGlobal = false

    try {
      let acumulados: LeadCardState[] = []

      if (esModoTodasProvincias || esModoProvincia) {
        type TareaBusqueda = { zonaLocal: string; progresoLabel: string }
        const tareas: TareaBusqueda[] = []

        if (esModoTodasProvincias) {
          const provs = [...paisSeleccionado.provincias]
          if (ordenRecorrido === 'inverso') provs.reverse()
          for (const prov of provs) {
            const fuenteLocs = modoEficiencia
              ? filtrarPrincipales(prov.nombre, prov.localidades)
              : prov.localidades
            const locs =
              ordenRecorrido === 'inverso' ? [...fuenteLocs].reverse() : fuenteLocs
            for (const loc of locs) {
              tareas.push({
                zonaLocal: `${loc.nombre}, ${prov.nombre}, ${paisSeleccionado.nombre}`,
                progresoLabel: `${loc.nombre} · ${prov.nombre}`,
              })
            }
          }
        } else {
          const provSel = provinciaSeleccionada ?? paisSeleccionado.provincias[0]
          const baseLocs = modoEficiencia
            ? filtrarPrincipales(provSel.nombre, provSel.localidades || [])
            : provSel.localidades || []
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
              const { leads, quotaExhausted } = await buscarEnLocalidad(t.zonaLocal, signal)
              if (quotaExhausted) {
                cuotaAgotadaGlobal = true
                detenerBusquedaRef.current = true
                break
              }
              if (detenerBusquedaRef.current) break
              for (const lead of leads) {
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
        // Búsqueda en una sola localidad — vía API server-side.
        const { leads, quotaExhausted } = await buscarEnLocalidad(zona, signal)
        if (quotaExhausted) {
          cuotaAgotadaGlobal = true
        }
        acumulados = leads.map((lead) => ({ ...lead, ya_registrado: false, zona }))
        setResultados(acumulados)
      }

      // Filtro de duplicados único, al final, contra Supabase (1 sola invocation).
      if (acumulados.length > 0 && !detenerBusquedaRef.current) {
        const limpios = await marcarDuplicados(acumulados)
        acumulados = limpios
        setResultados(acumulados)
      }

      detenidoManual = detenerBusquedaRef.current && !cuotaAgotadaGlobal
      setDetenidoPorUsuario(detenidoManual)
      detenerBusquedaRef.current = false
      abortBusquedaRef.current = null

      if (cuotaAgotadaGlobal) {
        setErrorBusqueda(
          'Cuota mensual gratuita agotada en todas las API keys de Google Places. Sumá otra clave en una env var GOOGLE_PLACES_API_KEY_N o esperá al primer día del próximo mes (hora del Pacífico).',
        )
      }

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
      // Refresca el panel de keys: el contador del mes acaba de subir.
      cargarPlacesKeys()
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

      {/* Panel de API keys de Google Places — cuota mensual gratuita por key */}
      {placesKeys && (
        <section className="bg-apex-card/80 border border-apex-border rounded-xl p-5 sm:p-6 space-y-4 backdrop-blur-sm">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="text-apex-lime shrink-0" />
                <h2 className="font-syne font-semibold text-base sm:text-lg">
                  Google Places — cuota mensual
                </h2>
              </div>
              <p className="text-xs text-apex-muted mt-1.5 leading-relaxed">
                Mes <span className="text-white font-mono tabular-nums">{placesKeys.month}</span> · 1.000
                búsquedas gratis por key (Text Search Enterprise). Sumá más keys con{' '}
                <code className="text-apex-lime/90 font-mono">GOOGLE_PLACES_API_KEY_2</code>,{' '}
                <code className="text-apex-lime/90 font-mono">_3</code>, etc. Cuando la activa se llena,
                rota automáticamente.
              </p>
              <p className="text-[11px] text-apex-muted/85 mt-1 font-mono">
                Próximo reset:{' '}
                <span className="text-apex-lime/90">
                  {new Date(placesKeys.next_reset_at).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: 'short',
                    timeZone: 'America/Argentina/Buenos_Aires',
                  })}
                </span>{' '}
                ·{' '}
                <span className="text-white tabular-nums">{placesKeys.days_until_reset}</span>{' '}
                día{placesKeys.days_until_reset === 1 ? '' : 's'} restante
                {placesKeys.days_until_reset === 1 ? '' : 's'} (00:00 hora Pacífico).
              </p>
            </div>
            {placesKeysResumen && !placesKeysResumen.sinKeys && (
              <div className="text-right shrink-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                  Total restante
                </div>
                <div className="text-2xl font-syne font-bold text-apex-lime tabular-nums">
                  {placesKeysResumen.restantesGlobales.toLocaleString('es-AR')}
                </div>
                <div className="text-[11px] font-mono text-apex-muted">
                  de {placesKeysResumen.totalQuota?.toLocaleString('es-AR')} ·{' '}
                  {placesKeysResumen.configuradas} key{placesKeysResumen.configuradas === 1 ? '' : 's'}
                </div>
              </div>
            )}
          </header>

          {placesKeysResumen?.sinKeys && (
            <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 rounded-lg px-3 py-2.5">
              <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-100">
                No hay ninguna API key configurada. Definí{' '}
                <code className="text-amber-300 font-mono">GOOGLE_PLACES_API_KEY</code> en las variables de
                entorno antes de buscar.
              </p>
            </div>
          )}

          {sinKeysDisponibles && (
            <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 rounded-lg px-3 py-2.5">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-200">
                <p className="font-semibold">Cuota agotada en todas las keys.</p>
                <p className="text-xs text-red-200/85 mt-1">
                  Sumá una nueva clave (env <code className="font-mono">GOOGLE_PLACES_API_KEY_N</code>) o
                  esperá al primer día del próximo mes (hora del Pacífico). La búsqueda quedó
                  deshabilitada hasta que haya cupo disponible.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {placesKeys.keys.map((k, idx) => {
              const pct = k.quota > 0 ? Math.min(100, (k.used / k.quota) * 100) : 0
              const slotIdx = idx + 1
              const titulo = idx === 0 ? 'Key principal' : `Key #${slotIdx}`
              const envHint =
                idx === 0 ? 'GOOGLE_PLACES_API_KEY' : `GOOGLE_PLACES_API_KEY_${slotIdx}`

              if (!k.configured) {
                return (
                  <div
                    key={k.label}
                    className="rounded-xl border border-dashed border-apex-border/60 bg-apex-black/30 p-4 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                        Slot {slotIdx} · libre
                      </span>
                      <span className="text-[10px] font-mono text-apex-muted/80">SIN CONFIGURAR</span>
                    </div>
                    <p className="text-sm font-syne text-apex-muted">{titulo}</p>
                    <p className="text-[11px] font-mono text-apex-muted/80 leading-snug">
                      Para sumar otra cuenta gratis, definí la env var{' '}
                      <code className="text-apex-lime/80">{envHint}</code> y redeploy.
                    </p>
                  </div>
                )
              }

              const restante = Math.max(0, k.quota - k.used)
              const tono = k.exhausted
                ? 'border-red-500/40 bg-red-500/5'
                : k.active
                  ? 'border-apex-lime/40 bg-apex-lime/[0.05] shadow-[0_0_0_1px_rgba(190,242,100,0.1)]'
                  : 'border-apex-border/70 bg-apex-black/40'

              return (
                <div key={k.label} className={`rounded-xl border p-4 flex flex-col gap-2.5 ${tono}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                      Slot {slotIdx}
                    </span>
                    {k.exhausted ? (
                      <span className="text-[10px] font-mono text-red-300 bg-red-500/15 border border-red-500/30 rounded-full px-2 py-0.5">
                        AGOTADA
                      </span>
                    ) : k.active ? (
                      <span className="text-[10px] font-mono text-apex-lime bg-apex-lime/15 border border-apex-lime/40 rounded-full px-2 py-0.5">
                        ACTIVA
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-apex-muted bg-apex-border/40 rounded-full px-2 py-0.5">
                        EN ESPERA
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <p className="text-sm font-syne font-semibold truncate">{titulo}</p>
                    <span className="text-[11px] font-mono text-apex-muted/90 shrink-0">
                      ••••{k.suffix ?? '----'}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-apex-muted tabular-nums">
                        <span className="text-white">{k.used.toLocaleString('es-AR')}</span> / {k.quota.toLocaleString('es-AR')} usadas
                      </span>
                      <span className="text-[11px] font-mono text-apex-muted tabular-nums">
                        {restante.toLocaleString('es-AR')} libres
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-apex-black/80 rounded-full overflow-hidden ring-1 ring-apex-border/40">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${pctColor(pct, k.exhausted)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {k.last_error && (
                    <p
                      className="text-[10px] font-mono text-red-300/85 leading-snug line-clamp-2"
                      title={k.last_error}
                    >
                      Último error: {k.last_error}
                    </p>
                  )}

                  {k.exhausted && (
                    <button
                      type="button"
                      onClick={() => rehabilitarKey(k.label)}
                      disabled={reseteandoKey === k.label}
                      className="text-[10px] font-mono uppercase tracking-wider text-apex-lime/90 hover:text-apex-lime border border-apex-lime/30 hover:border-apex-lime/60 rounded px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start"
                      title="Pone el contador en 0 para este mes. Útil si el agotamiento vino de un 403 (billing/restricción) y ya arreglaste la config."
                    >
                      {reseteandoKey === k.label ? 'Re-habilitando…' : 'Re-habilitar'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
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

        {/* Selector de proyecto */}
        <div>
          <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
            Proyecto
          </label>
          <select
            value={proyectoId ?? ''}
            onChange={(event) => setProyectoId(event.target.value || null)}
            className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
          >
            {projects.length === 0 && <option value="">Cargando proyectos...</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          {proyectoActual && (
            <p className="text-[11px] text-apex-muted mt-1.5 font-mono">
              {proyectoActual.filtro_sin_web
                ? '🔎 Buscando solo negocios sin web'
                : '🌐 Mostrando todos los resultados (negocios con o sin web)'}
            </p>
          )}
        </div>

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
            {/* Chips de rubros sugeridos del proyecto activo */}
            {proyectoActual && proyectoActual.rubros_sugeridos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {proyectoActual.rubros_sugeridos.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRubro(r)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      rubro === r
                        ? 'bg-apex-lime/15 border-apex-lime/50 text-apex-lime'
                        : 'bg-apex-black border-apex-border text-apex-muted hover:text-white hover:border-apex-lime/30'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
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
            {/* Switch modo eficiencia */}
            {(() => {
              const totalLocs = esModoTodasProvincias
                ? totalLocalidadesPais
                : provinciaSeleccionada?.localidades.length ?? 0
              const totalPrinc = esModoTodasProvincias
                ? totalPrincipalesPais
                : totalPrincipalesProvincia
              const localidadesAUsar = modoEficiencia ? totalPrinc : totalLocs
              const ahorroPct =
                totalLocs > 0 ? Math.round(((totalLocs - totalPrinc) / totalLocs) * 100) : 0

              return (
                <div
                  className={`rounded-xl border p-4 transition-colors ${
                    modoEficiencia && filtroAportaAhorro
                      ? 'border-apex-lime/40 bg-apex-lime/[0.05] shadow-[0_0_0_1px_rgba(190,242,100,0.08)]'
                      : 'border-apex-border/70 bg-apex-black/30'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Zap
                          size={16}
                          className={`shrink-0 ${
                            modoEficiencia && filtroAportaAhorro
                              ? 'text-apex-lime'
                              : 'text-apex-muted'
                          }`}
                        />
                        <span className="font-syne font-semibold text-sm">
                          Modo eficiencia
                        </span>
                        {modoEficiencia && filtroAportaAhorro && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-apex-lime bg-apex-lime/15 border border-apex-lime/40 rounded-full px-2 py-0.5">
                            ACTIVO
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-apex-muted mt-1.5 leading-relaxed">
                        Sólo busca en localidades céntricas (capitales, cabeceras de
                        partido/depto. y ciudades ≥ 10k hab.). Cada Text Search a Google
                        Places gasta 1 request del cupo gratis, da igual la zona — saltearse
                        parajes rurales captura casi todos los negocios usando muchísimo
                        menos quota.
                      </p>
                      {!filtroAportaAhorro && (
                        <p className="text-[11px] text-amber-300/85 mt-2 leading-relaxed">
                          {paisSeleccionado.codigo === 'AR'
                            ? 'Esta provincia no tiene lista curada — el modo eficiencia no la afecta.'
                            : 'El modo eficiencia sólo está implementado para Argentina por ahora.'}
                        </p>
                      )}
                    </div>

                    {/* Toggle switch — accesible y con teclado */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={modoEficiencia}
                      aria-label="Activar modo eficiencia"
                      onClick={() => setModoEficiencia((v) => !v)}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-apex-lime/60 focus:ring-offset-2 focus:ring-offset-apex-card ${
                        modoEficiencia
                          ? 'bg-apex-lime'
                          : 'bg-apex-border hover:bg-apex-border/80'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-apex-black shadow transition-transform ${
                          modoEficiencia ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Contador antes/después */}
                  <div className="mt-3 pt-3 border-t border-apex-border/50 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                        Sin filtrar
                      </div>
                      <div className="text-lg font-syne font-bold text-apex-muted/80 tabular-nums mt-0.5 line-through">
                        {totalLocs.toLocaleString('es-AR')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                        A buscar
                      </div>
                      <div
                        className={`text-lg font-syne font-bold tabular-nums mt-0.5 ${
                          modoEficiencia && filtroAportaAhorro
                            ? 'text-apex-lime'
                            : 'text-white'
                        }`}
                      >
                        {localidadesAUsar.toLocaleString('es-AR')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-apex-muted">
                        Ahorro
                      </div>
                      <div
                        className={`text-lg font-syne font-bold tabular-nums mt-0.5 ${
                          modoEficiencia && filtroAportaAhorro
                            ? 'text-apex-lime'
                            : 'text-apex-muted/80'
                        }`}
                      >
                        {modoEficiencia && filtroAportaAhorro ? `−${ahorroPct}%` : '0%'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

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
                Toda la provincia o todo el país: cuántas búsquedas de Google Places en paralelo. Cada
                búsqueda gasta 1 request del cupo gratuito mensual.
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
                {(() => {
                  if (!esModoTodasProvincias && !esModoProvincia)
                    return 'Buscar y encolar'
                  const cuantas = esModoTodasProvincias
                    ? modoEficiencia
                      ? totalPrincipalesPais
                      : totalLocalidadesPais
                    : modoEficiencia
                      ? totalPrincipalesProvincia
                      : provinciaSeleccionada?.localidades.length ?? 0
                  const ambito = esModoTodasProvincias
                    ? `${paisSeleccionado.nombre} completo`
                    : `toda ${provinciaSeleccionada?.nombre}`
                  return `Buscar y encolar (${ambito} · ${cuantas.toLocaleString('es-AR')} localidades)`
                })()}
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
