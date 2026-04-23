'use client'

import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, Send, Bot, BotOff, UserCheck, CheckCircle, ArrowLeft, Sparkles, Loader2, CheckCheck, Search, X, Star } from 'lucide-react'
import type { Lead, Conversacion } from '@/types'

interface SenderInfo {
  id: string
  alias: string
  color: string
  provider: 'twilio'
  phone_number: string
}

type MensajeConSender = Conversacion & { sender?: SenderInfo | null }

interface ConversacionGrupo {
  lead: Lead
  mensajes: MensajeConSender[]
  ultimo_mensaje: string
  ultimo_timestamp: string
  no_leidos: number
  sender: SenderInfo | null
  /** Primer rol del hilo (vista SQL); evita traer todo el listado. */
  inicio_rol?: string | null
}

/** Cola "Enviar bocetos": el webhook marcó `boceto_prometido_24h` al enviar el mensaje de compromiso 24h. */
function enColaBocetos(g: ConversacionGrupo): boolean {
  if (g.lead.boceto_prometido_24h !== true) return false
  if (g.lead.conversacion_cerrada === true) return false
  return true
}

function ts(msj: MensajeConSender | undefined): number {
  if (!msj?.timestamp) return 0
  const n = new Date(msj.timestamp).getTime()
  return Number.isFinite(n) ? n : 0
}

/** Quitar prefijo `[IMAGEN]` / `[AUDIO]` que guarda el webhook de Twilio. */
function captionLimpio(mensaje: string): string {
  return mensaje.replace(/^\[(IMAGEN|AUDIO|OTRO)\]\s*/i, '').trim()
}

function ContenidoMensajeChat({ msg, isAgente }: { msg: MensajeConSender; isAgente: boolean }) {
  const proxySrc = `/api/conversaciones/media?id=${encodeURIComponent(msg.id)}`
  const caption = captionLimpio(msg.mensaje || '')

  if (msg.tipo_mensaje === 'imagen' && msg.media_url) {
    return (
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={proxySrc}
          alt={caption || 'Imagen del cliente'}
          className="max-w-full max-h-64 w-auto rounded-lg object-contain border border-black/10"
          loading="lazy"
        />
        {caption ? <p className="whitespace-pre-wrap leading-relaxed">{caption}</p> : null}
      </div>
    )
  }

  if (msg.tipo_mensaje === 'audio' && msg.media_url) {
    return (
      <div className="space-y-2">
        <audio
          src={proxySrc}
          controls
          className={`w-full max-w-[280px] h-9 ${isAgente ? 'accent-apex-black' : 'accent-apex-lime'}`}
          preload="metadata"
        />
        {caption ? <p className="whitespace-pre-wrap leading-relaxed text-xs opacity-90">{caption}</p> : null}
      </div>
    )
  }

  return <p className="whitespace-pre-wrap leading-relaxed">{msg.mensaje}</p>
}

const FAVORITOS_STORAGE_KEY = 'apex-inbox-favoritos'
const LONG_PRESS_MS = 550

function readFavoritoIdsFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(FAVORITOS_STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

/**
 * Fusiona dos listas de mensajes garantizando que NUNCA se pierde historial.
 *
 * Estrategia: siempre merge por ID.
 * - Incoming (datos frescos de DB) sobreescribe duplicados con datos actualizados.
 * - Prev aporta mensajes que incoming todavía no tiene (p. ej. optimistas en vuelo).
 * - Mensajes tmp-* del prev se conservan si incoming no los confirmó aún;
 *   desaparecen sólo cuando `enviarMensaje` los reemplaza por el id real de DB.
 */
function elegirMensajesMasRecientes(
  prevMensajes: MensajeConSender[],
  incomingMensajes: MensajeConSender[]
): MensajeConSender[] {
  if (!incomingMensajes.length) return prevMensajes
  if (!prevMensajes.length) return incomingMensajes

  const merged = new Map<string, MensajeConSender>()

  // 1. Prev primero (incluye optimistas tmp-*)
  for (const m of prevMensajes) merged.set(m.id, m)

  // 2. Incoming sobreescribe con datos frescos de DB (nunca descartamos mensajes reales)
  for (const m of incomingMensajes) merged.set(m.id, m)

  return Array.from(merged.values()).sort((a, b) => ts(a) - ts(b))
}

export default function ConversacionesPage() {
  const [grupos, setGrupos] = useState<ConversacionGrupo[]>([])
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [nuevoMensaje, setNuevoMensaje] = useState('')
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [sugiriendo, setSugiriendo] = useState(false)
  const [cargandoMensajes, setCargandoMensajes] = useState(false)
  /** Primer mensaje del hilo = cliente (no arrancó con template / outbound Twilio) */
  const [soloWeb, setSoloWeb] = useState(false)
  /** Leads cuyo estado ya indica respuesta del cliente. */
  const [soloRespond, setSoloRespond] = useState(false)
  /** Cola operativa: compromiso de boceto 24h (flag en DB) */
  const [soloBocetos, setSoloBocetos] = useState(false)
  const [soloFavoritos, setSoloFavoritos] = useState(false)
  const [marcandoBocetoEnviado, setMarcandoBocetoEnviado] = useState(false)
  const [favoritoIds, setFavoritoIds] = useState<Set<string>>(readFavoritoIdsFromStorage)
  const [menuCtx, setMenuCtx] = useState<{ leadId: string; x: number; y: number } | null>(null)
  const menuCtxRef = useRef<HTMLDivElement | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Tras abrir el menú con long-press, ignora un clic fantasma al soltar. */
  const ignoreListClickUntilRef = useRef(0)
  const [busquedaNombre, setBusquedaNombre] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)
  const seleccionadoRef = useRef<string | null>(null)
  /** Evita que respuestas viejas de /api/conversaciones pisen un estado ya actualizado (intervalo 10s + refetch al enviar). */
  const cargaInboxIdRef = useRef(0)
  /** Misma idea para el historial del hilo activo. */
  const cargaMensajesIdRef = useRef(0)
  seleccionadoRef.current = seleccionado

  const cargarMensajesHilo = useCallback(async (leadId: string) => {
    const id = ++cargaMensajesIdRef.current
    setCargandoMensajes(true)
    try {
      const t = Date.now()
      const res = await fetch(
        `/api/conversaciones/messages?lead_id=${encodeURIComponent(leadId)}&_=${t}`,
        { cache: 'no-store' }
      )
      if (id !== cargaMensajesIdRef.current) return
      if (!res.ok) {
        console.error('[Inbox] Error cargando mensajes del hilo', leadId, res.status, res.statusText)
        return
      }
      const data = await res.json()
      if (id !== cargaMensajesIdRef.current) return
      const mensajes = (data.mensajes ?? []) as MensajeConSender[]
      setGrupos(prev =>
        prev.map(g =>
          g.lead.id === leadId
            ? { ...g, mensajes: elegirMensajesMasRecientes(g.mensajes, mensajes) }
            : g
        )
      )
    } catch (err) {
      console.error('[Inbox] Excepción cargando mensajes del hilo', leadId, err)
    } finally {
      if (id === cargaMensajesIdRef.current) setCargandoMensajes(false)
    }
  }, [])

  const cargarConversaciones = useCallback(async () => {
    const id = ++cargaInboxIdRef.current
    try {
      const res = await fetch('/api/conversaciones', { cache: 'no-store' })
      if (id !== cargaInboxIdRef.current) return
      if (!res.ok) return
      const data = await res.json()
      const list: ConversacionGrupo[] = data.grupos ?? []
      const sel = seleccionadoRef.current
      if (id !== cargaInboxIdRef.current) return
      if (sel) {
        const t = Date.now()
        const r2 = await fetch(
          `/api/conversaciones/messages?lead_id=${encodeURIComponent(sel)}&_=${t}`,
          { cache: 'no-store' }
        )
        if (id !== cargaInboxIdRef.current) return
        if (r2.ok) {
          const d2 = await r2.json()
          if (id !== cargaInboxIdRef.current) return
          const mensajes = (d2.mensajes ?? []) as MensajeConSender[]
          setGrupos(prev => {
            const prevSel = prev.find(g => g.lead.id === sel)
            return list.map(g => {
              if (g.lead.id !== sel) return g
              return {
                ...g,
                mensajes: elegirMensajesMasRecientes(prevSel?.mensajes ?? [], mensajes),
              }
            })
          })
        } else {
          // Si falla el fetch del hilo, no perder el estado del chat visible.
          setGrupos(prev => {
            const prevSel = prev.find(g => g.lead.id === sel)
            return list.map(g =>
              g.lead.id === sel && prevSel
                ? { ...g, mensajes: prevSel.mensajes }
                : g
            )
          })
        }
      } else {
        setGrupos(list)
      }
    } catch (err) {
      console.error(err)
    } finally {
      if (id === cargaInboxIdRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    cargarConversaciones()
    const interval = setInterval(cargarConversaciones, 10_000)
    return () => clearInterval(interval)
  }, [cargarConversaciones])

  useEffect(() => {
    if (!seleccionado) return
    void cargarMensajesHilo(seleccionado)
  }, [seleccionado, cargarMensajesHilo])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [seleccionado, grupos])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(FAVORITOS_STORAGE_KEY, JSON.stringify(Array.from(favoritoIds)))
    } catch {
      /* ignore */
    }
  }, [favoritoIds])

  useEffect(() => {
    if (!menuCtx) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuCtx(null)
    }
    const onPointer = (e: PointerEvent) => {
      if (menuCtxRef.current?.contains(e.target as Node)) return
      setMenuCtx(null)
    }
    // Evita que el levantar el dedo tras long-press cierre el menú al instante
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onPointer, true)
      document.addEventListener('keydown', onKey, true)
    }, 200)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuCtx])

  const toggleFavorito = useCallback((leadId: string) => {
    setFavoritoIds(prev => {
      const n = new Set(prev)
      if (n.has(leadId)) n.delete(leadId)
      else n.add(leadId)
      return n
    })
  }, [])

  const grupoActivo = grupos.find(g => g.lead.id === seleccionado)

  const leerTodos = async () => {
    setGrupos(prev => prev.map(g => ({ ...g, no_leidos: 0 })))
    fetch('/api/conversaciones', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
  }

  const totalNoLeidos = grupos.reduce((acc, g) => acc + g.no_leidos, 0)

  const seleccionarLead = async (leadId: string) => {
    setGrupos(prev => prev.map(g =>
      g.lead.id === leadId ? { ...g, no_leidos: 0 } : g
    ))
    setCargandoMensajes(true)
    setSeleccionado(leadId)
    fetch('/api/conversaciones', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId }),
    })
  }

  const enviarMensaje = async () => {
    if (!nuevoMensaje.trim() || !grupoActivo) return
    const leadId = grupoActivo.lead.id
    const texto = nuevoMensaje.trim()
    const tempId = `tmp-${Date.now()}`
    const timestampOptimista = new Date().toISOString()
    const mensajeOptimista: MensajeConSender = {
      id: tempId,
      lead_id: leadId,
      telefono: grupoActivo.lead.telefono,
      mensaje: texto,
      rol: 'agente',
      tipo_mensaje: 'texto',
      timestamp: timestampOptimista,
      leido: true,
      manual: true,
      es_followup: false,
      sender: grupoActivo.sender ?? null,
    }

    setNuevoMensaje('')
    setGrupos(prev =>
      prev.map(g =>
        g.lead.id === leadId
          ? {
              ...g,
              mensajes: [...g.mensajes, mensajeOptimista],
              ultimo_mensaje: texto,
              ultimo_timestamp: timestampOptimista,
              sender: g.sender ?? mensajeOptimista.sender ?? null,
            }
          : g
      )
    )
    setEnviando(true)
    try {
      const res = await fetch('/api/agente/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefono: grupoActivo.lead.telefono,
          mensaje: texto,
          lead_id: leadId,
          sender_id: grupoActivo.sender?.id ?? null,
          manual: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msgError = (data as { error?: string }).error ?? res.statusText
        console.error('[Inbox] Error al enviar:', msgError)
        setGrupos(prev =>
          prev.map(g =>
            g.lead.id === leadId
              ? {
                  ...g,
                  mensajes: g.mensajes.filter(m => m.id !== tempId),
                }
              : g
          )
        )
        setNuevoMensaje(texto)
        return
      }
      const mensajePersistido = (data as { conversacion?: MensajeConSender | null }).conversacion
      if (mensajePersistido?.id) {
        setGrupos(prev =>
          prev.map(g =>
            g.lead.id === leadId
              ? {
                  ...g,
                  mensajes: g.mensajes.map(m => (m.id === tempId ? mensajePersistido : m)),
                  ultimo_mensaje: mensajePersistido.mensaje,
                  ultimo_timestamp: mensajePersistido.timestamp,
                  sender: g.sender ?? mensajePersistido.sender ?? null,
                }
              : g
          )
        )
      }
      await cargarConversaciones()
      // Último en aplicar: evita carreras con el poll de 10s o un r2 aún en vuelo.
      await cargarMensajesHilo(leadId)
    } catch (err) {
      console.error(err)
      setGrupos(prev =>
        prev.map(g =>
          g.lead.id === leadId
            ? {
                ...g,
                mensajes: g.mensajes.filter(m => m.id !== tempId),
              }
            : g
        )
      )
      setNuevoMensaje(texto)
    } finally {
      setEnviando(false)
    }
  }

  const sugerirRespuesta = async () => {
    if (!grupoActivo) return
    setSugiriendo(true)
    try {
      const res = await fetch('/api/agente/sugerir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: grupoActivo.lead.id }),
      })
      const data = await res.json()
      if (data.sugerencia) setNuevoMensaje(data.sugerencia)
    } catch (err) {
      console.error(err)
    } finally {
      setSugiriendo(false)
    }
  }

  const toggleAgente = async (leadId: string, activo: boolean) => {
    await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, agente_activo: activo }),
    })
    await cargarConversaciones()
  }

  const cambiarEstadoLead = async (leadId: string, estado: string) => {
    await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, estado }),
    })
    await cargarConversaciones()
  }

  const marcarBocetoEnviado = async (leadId: string) => {
    setMarcandoBocetoEnviado(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, boceto_prometido_24h: false }),
      })
      if (!res.ok) console.error('[Inbox] PATCH boceto enviado', res.status)
      await cargarConversaciones()
    } catch (e) {
      console.error(e)
    } finally {
      setMarcandoBocetoEnviado(false)
    }
  }

  const countBocetoPendientes = useMemo(
    () => grupos.filter(enColaBocetos).length,
    [grupos]
  )

  const gruposFiltrados = useMemo(() => {
    const primerMensaje = (g: ConversacionGrupo) => {
      if (!g.mensajes?.length) return null
      return [...g.mensajes].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )[0]
    }
    const inicioDesdeCliente = (g: ConversacionGrupo) => {
      if (g.inicio_rol) return g.inicio_rol === 'cliente'
      return primerMensaje(g)?.rol === 'cliente'
    }

    let list = grupos
    if (soloBocetos) list = list.filter(enColaBocetos)
    if (soloWeb) list = list.filter(inicioDesdeCliente)
    if (soloRespond) list = list.filter(g => g.lead.estado === 'respondio')
    if (soloFavoritos) list = list.filter(g => favoritoIds.has(g.lead.id))
    const q = busquedaNombre.trim().toLowerCase()
    if (q) {
      list = list.filter(g => (g.lead.nombre || '').toLowerCase().includes(q))
    }
    return list
  }, [grupos, soloBocetos, soloWeb, soloRespond, soloFavoritos, favoritoIds, busquedaNombre])

  const gruposOrdenados = useMemo(() => {
    return [...gruposFiltrados].sort((a, b) => {
      const aUn = a.no_leidos > 0
      const bUn = b.no_leidos > 0
      if (aUn !== bUn) return aUn ? -1 : 1
      if (aUn && bUn && a.no_leidos !== b.no_leidos) {
        return b.no_leidos - a.no_leidos
      }
      return (
        new Date(b.ultimo_timestamp).getTime() - new Date(a.ultimo_timestamp).getTime()
      )
    })
  }, [gruposFiltrados])

  const getInitial = (nombre: string) => (nombre?.[0] ?? '?').toUpperCase()

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  const formatDate = (ts: string) =>
    new Date(ts).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8">
      {/* Panel container */}
      <div className="flex flex-1 overflow-hidden bg-apex-card border border-apex-border shadow-sm lg:m-0 rounded-none lg:rounded-xl lg:m-2">

        {/* ── Left: conversation list ── */}
        <div className={`w-full lg:w-[320px] flex-shrink-0 flex flex-col border-r border-apex-border bg-apex-dark ${seleccionado ? 'hidden lg:flex' : 'flex'}`}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-apex-border">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="min-w-0">
                <h1 className="text-base font-semibold text-white tracking-tight">Inbox</h1>
                <p className="text-xs text-apex-muted mt-0.5">
                  {loading ? 'Cargando...' : `${gruposFiltrados.length} conversaciones`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSoloBocetos(v => !v)}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${
                    soloBocetos
                      ? 'bg-apex-lime text-apex-black border-apex-lime'
                      : 'bg-apex-black/60 text-apex-lime border-apex-lime/45 hover:border-apex-lime'
                  }`}
                >
                  Enviar bocetos
                  {countBocetoPendientes > 0 && (
                    <span
                      className={`ml-1 tabular-nums ${soloBocetos ? 'text-apex-black/75' : 'text-apex-lime'}`}
                    >
                      ({countBocetoPendientes})
                    </span>
                  )}
                </button>
                {totalNoLeidos > 0 && (
                  <button
                    type="button"
                    onClick={leerTodos}
                    className="flex items-center gap-1.5 text-xs text-apex-muted hover:text-neutral-300 transition-colors"
                  >
                    <CheckCheck size={13} />
                    leer todos
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Filtro inbox: todos + remitentes */}
          <div className="px-4 py-2.5 border-b border-apex-border flex gap-1.5 flex-wrap bg-apex-black/50">
            <button
              type="button"
              onClick={() => {
                setSoloBocetos(false)
                setSoloWeb(false)
                setSoloRespond(false)
                setSoloFavoritos(false)
                setBusquedaNombre('')
              }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                !soloBocetos && !soloWeb && !soloRespond && !soloFavoritos
                  ? 'bg-apex-lime text-apex-black'
                  : 'bg-apex-card border border-apex-border text-apex-muted hover:bg-apex-border'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => {
                setSoloWeb(s => {
                  const next = !s
                  if (next) {
                    setSoloRespond(false)
                    setSoloFavoritos(false)
                  }
                  return next
                })
              }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                soloWeb
                  ? 'bg-apex-lime text-apex-black'
                  : 'bg-apex-card border border-apex-border text-apex-muted hover:bg-apex-border'
              }`}
            >
              web
            </button>
            <button
              type="button"
              onClick={() => {
                setSoloRespond(s => {
                  const next = !s
                  if (next) {
                    setSoloWeb(false)
                    setSoloFavoritos(false)
                  }
                  return next
                })
              }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                soloRespond
                  ? 'bg-apex-lime text-apex-black'
                  : 'bg-apex-card border border-apex-border text-apex-muted hover:bg-apex-border'
              }`}
            >
              respond
            </button>
            <button
              type="button"
              onClick={() => {
                if (!soloFavoritos) {
                  setSoloWeb(false)
                  setSoloRespond(false)
                }
                setSoloFavoritos(f => !f)
              }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                soloFavoritos
                  ? 'bg-apex-lime text-apex-black'
                  : 'bg-apex-card border border-apex-border text-apex-muted hover:bg-apex-border'
              }`}
            >
              Fav.
            </button>
          </div>

          {/* Búsqueda por nombre (debajo de categorías) */}
          <div className="px-4 py-2.5 border-b border-apex-border bg-apex-black/50">
            <label htmlFor="inbox-search" className="sr-only">
              Buscar conversación por nombre
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-apex-lime/90"
                aria-hidden
                strokeWidth={2.25}
              />
              <input
                id="inbox-search"
                type="search"
                value={busquedaNombre}
                onChange={e => setBusquedaNombre(e.target.value)}
                placeholder="Buscar por nombre…"
                autoComplete="off"
                enterKeyHint="search"
                className="w-full min-h-[44px] rounded-xl border border-apex-border bg-[#0d0d0d] py-2.5 pl-10 pr-10 text-sm text-neutral-200 placeholder:text-apex-muted/90 shadow-inner transition-[border-color,box-shadow,background-color] focus:border-apex-lime/55 focus:bg-[#0a0a0a] focus:outline-none focus:ring-2 focus:ring-apex-lime/25"
              />
              {busquedaNombre ? (
                <button
                  type="button"
                  onClick={() => setBusquedaNombre('')}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-apex-muted transition-colors hover:bg-apex-border/50 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-apex-lime/70"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" strokeWidth={2.25} />
                </button>
              ) : null}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-24">
                <Loader2 size={20} className="animate-spin text-apex-muted" />
              </div>
            ) : gruposOrdenados.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <MessageSquare size={28} className="text-apex-border" />
                <p className="text-sm text-apex-muted text-center px-2">
                  {busquedaNombre.trim()
                    ? 'Ninguna conversación coincide con tu búsqueda'
                    : soloBocetos
                      ? 'Nadie con boceto prometido (~24h) pendiente de enviar'
                      : soloWeb
                        ? 'No hay chats que empiecen con un mensaje del cliente'
                        : soloRespond
                          ? 'No hay chats de leads que hayan respondido'
                        : soloFavoritos
                          ? 'No tenés favoritos. Mantené presionada una conversación o usá el clic derecho'
                          : 'No hay conversaciones'}
                </p>
              </div>
            ) : (
              gruposOrdenados.map(grupo => {
                const activo = seleccionado === grupo.lead.id
                const esFav = favoritoIds.has(grupo.lead.id)
                return (
                  <button
                    key={grupo.lead.id}
                    onClick={() => {
                      if (Date.now() < ignoreListClickUntilRef.current) return
                      void seleccionarLead(grupo.lead.id)
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMenuCtx({ leadId: grupo.lead.id, x: e.clientX, y: e.clientY })
                    }}
                    onPointerDown={e => {
                      if (e.button === 2) return
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
                      const leadId = grupo.lead.id
                      const { clientX, clientY } = e
                      longPressTimerRef.current = setTimeout(() => {
                        ignoreListClickUntilRef.current = Date.now() + 500
                        setMenuCtx({ leadId, x: clientX, y: clientY })
                      }, LONG_PRESS_MS)
                    }}
                    onPointerUp={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current)
                        longPressTimerRef.current = null
                      }
                    }}
                    onPointerCancel={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current)
                        longPressTimerRef.current = null
                      }
                    }}
                    onPointerMove={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current)
                        longPressTimerRef.current = null
                      }
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-apex-border transition-colors relative select-none ${
                      activo ? 'bg-apex-lime-dim/40' : 'hover:bg-apex-card'
                    }`}
                  >
                    {activo && (
                      <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#c8f135] rounded-r" />
                    )}
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-apex-border flex items-center justify-center flex-shrink-0 text-sm font-semibold text-apex-muted mt-0.5">
                        {getInitial(grupo.lead.nombre)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={`text-sm truncate flex items-center gap-1 min-w-0 ${grupo.no_leidos > 0 ? 'font-semibold text-white' : 'font-medium text-neutral-400'}`}>
                            {esFav && (
                              <Star
                                className="h-3.5 w-3.5 flex-shrink-0 text-apex-lime"
                                fill="currentColor"
                                strokeWidth={1.5}
                                aria-hidden
                              />
                            )}
                            <span className="truncate">{grupo.lead.nombre}</span>
                          </span>
                          <span className="text-[10px] text-apex-muted flex-shrink-0 tabular-nums">
                            {formatDate(grupo.ultimo_timestamp)}
                          </span>
                        </div>
                        <p className={`text-xs truncate mb-1.5 ${grupo.no_leidos > 0 ? 'text-neutral-300' : 'text-apex-muted'}`}>
                          {grupo.ultimo_mensaje}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <span className={`badge-${grupo.lead.estado} text-[9px] px-1.5 py-0.5 rounded-full`}>
                              {grupo.lead.estado}
                            </span>
                            {grupo.sender && (
                              <span
                                className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                                style={{ color: grupo.sender.color, background: grupo.sender.color + '20' }}
                              >
                                {grupo.sender.alias}
                              </span>
                            )}
                          </div>
                          {grupo.no_leidos > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                              {grupo.no_leidos}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* ── Right: chat view ── */}
        <div
          className={`flex-1 flex flex-col min-w-0 ${!seleccionado ? 'hidden lg:flex' : 'flex'}`}
          style={{ backgroundImage: 'radial-gradient(circle, #2a2a2a 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundColor: '#0a0a0a' }}
        >
          {!grupoActivo ? (
            <div className="flex-1 flex items-center justify-center bg-transparent">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-apex-card border border-apex-border flex items-center justify-center mx-auto mb-3">
                  <MessageSquare size={26} className="text-apex-muted" />
                </div>
                <p className="text-sm text-apex-muted">Seleccioná una conversación</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-apex-border bg-apex-dark flex items-center justify-between shadow-sm flex-shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSeleccionado(null)}
                    className="lg:hidden p-1.5 rounded-lg hover:bg-apex-border text-apex-muted"
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-apex-border flex items-center justify-center text-sm font-semibold text-neutral-300">
                    {getInitial(grupoActivo.lead.nombre)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-sm leading-tight">
                      {grupoActivo.lead.nombre}
                    </h3>
                    <p className="text-[11px] text-apex-muted leading-tight">
                      {grupoActivo.lead.telefono}
                      {grupoActivo.lead.rubro && ` · ${grupoActivo.lead.rubro}`}
                      {grupoActivo.sender && (
                        <span className="ml-1" style={{ color: grupoActivo.sender.color }}>
                          · {grupoActivo.sender.alias} ({grupoActivo.sender.phone_number})
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {grupoActivo.lead.boceto_prometido_24h === true && (
                    <button
                      type="button"
                      onClick={() => void marcarBocetoEnviado(grupoActivo.lead.id)}
                      disabled={marcandoBocetoEnviado}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apex-lime/20 text-apex-lime border border-apex-lime/50 hover:bg-apex-lime/30 transition-colors disabled:opacity-50"
                    >
                      {marcandoBocetoEnviado ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
                      Boceto enviado
                    </button>
                  )}
                  <button
                    onClick={() => toggleAgente(grupoActivo.lead.id, !grupoActivo.lead.agente_activo)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      grupoActivo.lead.agente_activo
                        ? 'bg-apex-lime/15 text-apex-lime border-apex-lime/30 hover:bg-apex-lime/25'
                        : 'bg-apex-card text-apex-muted border-apex-border hover:bg-apex-border'
                    }`}
                  >
                    {grupoActivo.lead.agente_activo ? <Bot size={13} /> : <BotOff size={13} />}
                    {grupoActivo.lead.agente_activo ? 'Agente ON' : 'Agente OFF'}
                  </button>
                  <button
                    onClick={() => cambiarEstadoLead(grupoActivo.lead.id, 'interesado')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apex-card text-neutral-300 border border-apex-border hover:bg-apex-border transition-colors"
                  >
                    <UserCheck size={13} />
                    Interesado
                  </button>
                  <button
                    onClick={() => cambiarEstadoLead(grupoActivo.lead.id, 'cerrado')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors"
                  >
                    <CheckCircle size={13} />
                    Cerrado
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={chatRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-1.5">
                {cargandoMensajes && grupoActivo.mensajes.length <= 1 ? (
                  <div className="flex items-center justify-center h-24">
                    <Loader2 size={20} className="animate-spin text-apex-muted" />
                  </div>
                ) : grupoActivo.mensajes.length === 0 ? (
                  <div className="flex items-center justify-center h-24">
                    <p className="text-sm text-apex-muted">Sin mensajes en este hilo</p>
                  </div>
                ) : (
                  grupoActivo.mensajes.map(msg => {
                    const isAgente = msg.rol === 'agente'
                    return (
                      <div key={msg.id} className={`flex ${isAgente ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex flex-col max-w-[70%] ${isAgente ? 'items-end' : 'items-start'}`}>
                          <div
                            className={`px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                              isAgente
                                ? 'bg-[#c8f135] text-apex-black rounded-br-sm'
                                : 'bg-[#1e2a1e] text-neutral-100 rounded-bl-sm border border-[#2d4230]'
                            }`}
                          >
                            <ContenidoMensajeChat msg={msg} isAgente={isAgente} />
                          </div>
                          <p className="text-[10px] text-apex-muted mt-1 px-1">{formatTime(msg.timestamp)}</p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-apex-border bg-apex-dark flex-shrink-0">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={nuevoMensaje}
                    onChange={e => setNuevoMensaje(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarMensaje()}
                    placeholder="Escribí un mensaje manual..."
                    className="flex-1 bg-apex-black border border-apex-border rounded-xl px-4 py-2.5 text-sm text-neutral-200 placeholder-apex-muted focus:outline-none focus:border-apex-lime/40 focus:bg-apex-black transition-colors"
                  />
                  <button
                    onClick={sugerirRespuesta}
                    disabled={sugiriendo}
                    title="Sugerir respuesta con IA"
                    className="p-2.5 rounded-xl bg-apex-card text-apex-muted hover:bg-apex-lime/15 hover:text-apex-lime border border-apex-border hover:border-apex-lime/30 transition-all disabled:opacity-40"
                  >
                    {sugiriendo ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  </button>
                  <button
                    onClick={enviarMensaje}
                    disabled={!nuevoMensaje.trim() || enviando}
                    className="p-2.5 rounded-xl bg-[#c8f135] text-apex-black hover:bg-[#d4f54d] transition-colors disabled:opacity-40 shadow-sm"
                  >
                    {enviando ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {menuCtx && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuCtxRef}
              role="menu"
              className="fixed z-[200] min-w-[200px] rounded-lg border border-apex-border bg-[#161616] py-1 shadow-2xl"
              style={{
                left: Math.min(menuCtx.x, window.innerWidth - 220),
                top: Math.min(menuCtx.y, window.innerHeight - 52),
              }}
              onPointerDown={e => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="w-full px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-apex-lime/15 hover:text-apex-lime"
                onClick={() => {
                  toggleFavorito(menuCtx.leadId)
                  setMenuCtx(null)
                }}
              >
                {favoritoIds.has(menuCtx.leadId) ? 'Quitar de favoritos' : 'Añadir a favoritos'}
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
