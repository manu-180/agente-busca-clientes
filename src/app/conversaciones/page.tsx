'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { MessageSquare, Send, Bot, BotOff, UserCheck, CheckCircle, ArrowLeft, Sparkles, Loader2, CheckCheck } from 'lucide-react'
import type { Lead, Conversacion } from '@/types'

interface SenderInfo {
  id: string
  alias: string
  color: string
  provider: 'twilio'
  phone_number: string
}

interface ConversacionGrupo {
  lead: Lead
  mensajes: (Conversacion & { sender?: SenderInfo | null })[]
  ultimo_mensaje: string
  ultimo_timestamp: string
  no_leidos: number
  sender: SenderInfo | null
}

export default function ConversacionesPage() {
  const [grupos, setGrupos] = useState<ConversacionGrupo[]>([])
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [nuevoMensaje, setNuevoMensaje] = useState('')
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [sugiriendo, setSugiriendo] = useState(false)
  const [filtroSender, setFiltroSender] = useState<string | null>(null)
  const [soloNoLeidos, setSoloNoLeidos] = useState(false)
  /** Cola operativa: solo leads que aceptaron boceto por WhatsApp */
  const [soloBocetos, setSoloBocetos] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const cargarConversaciones = async () => {
    try {
      const res = await fetch('/api/conversaciones')
      const data = await res.json()
      setGrupos(data.grupos ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargarConversaciones()
    const interval = setInterval(cargarConversaciones, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [seleccionado, grupos])

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
    setSeleccionado(leadId)
    fetch('/api/conversaciones', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId }),
    })
  }

  const enviarMensaje = async () => {
    if (!nuevoMensaje.trim() || !grupoActivo) return
    setEnviando(true)
    try {
      await fetch('/api/agente/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefono: grupoActivo.lead.telefono,
          mensaje: nuevoMensaje,
          lead_id: grupoActivo.lead.id,
          sender_id: grupoActivo.sender?.id ?? null,
          manual: true,
        }),
      })
      setNuevoMensaje('')
      await cargarConversaciones()
    } catch (err) {
      console.error(err)
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

  const sendersUnicos = Array.from(
    new Map(
      grupos
        .filter(g => g.sender)
        .map(g => [g.sender!.id, g.sender!])
    ).values()
  )

  const countBocetoPendientes = useMemo(
    () => grupos.filter(g => g.lead.boceto_aceptado === true).length,
    [grupos]
  )

  const gruposFiltrados = useMemo(() => {
    let list = filtroSender ? grupos.filter(g => g.sender?.id === filtroSender) : grupos
    if (soloNoLeidos) list = list.filter(g => g.no_leidos > 0)
    if (soloBocetos) list = list.filter(g => g.lead.boceto_aceptado === true)
    return list
  }, [grupos, filtroSender, soloNoLeidos, soloBocetos])

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

          {/* Filtro inbox: todos / no leídos + remitentes */}
          <div className="px-4 py-2.5 border-b border-apex-border flex gap-1.5 flex-wrap bg-apex-black/50">
            <button
              type="button"
              onClick={() => {
                setFiltroSender(null)
                setSoloNoLeidos(false)
                setSoloBocetos(false)
              }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                !filtroSender && !soloNoLeidos && !soloBocetos
                  ? 'bg-apex-lime text-apex-black'
                  : 'bg-apex-card border border-apex-border text-apex-muted hover:bg-apex-border'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setSoloNoLeidos(s => !s)}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                soloNoLeidos
                  ? 'bg-apex-lime text-apex-black'
                  : 'bg-apex-card border border-apex-border text-apex-muted hover:bg-apex-border'
              }`}
            >
              No leídos
            </button>
            {sendersUnicos.map(s => (
              <button
                type="button"
                key={s.id}
                onClick={() => setFiltroSender(filtroSender === s.id ? null : s.id)}
                className="text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all"
                style={
                  filtroSender === s.id
                    ? { backgroundColor: s.color, borderColor: s.color, color: '#111' }
                    : { backgroundColor: '#161616', borderColor: '#222222', color: '#888888' }
                }
              >
                {s.alias}
              </button>
            ))}
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
                <p className="text-sm text-apex-muted">
                  {soloBocetos
                    ? 'Nadie aceptó boceto todavía o ya los gestionaste'
                    : soloNoLeidos
                      ? 'No tenés conversaciones sin leer'
                      : 'No hay conversaciones'}
                </p>
              </div>
            ) : (
              gruposOrdenados.map(grupo => {
                const activo = seleccionado === grupo.lead.id
                return (
                  <button
                    key={grupo.lead.id}
                    onClick={() => seleccionarLead(grupo.lead.id)}
                    className={`w-full text-left px-4 py-3 border-b border-apex-border transition-colors relative ${
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
                          <span className={`text-sm truncate ${grupo.no_leidos > 0 ? 'font-semibold text-white' : 'font-medium text-neutral-400'}`}>
                            {grupo.lead.nombre}
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

                <div className="flex items-center gap-2">
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
                {grupoActivo.mensajes.map(msg => {
                  const isAgente = msg.rol === 'agente'
                  return (
                    <div key={msg.id} className={`flex ${isAgente ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col max-w-[70%] ${isAgente ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                            isAgente
                              ? 'bg-[#c8f135] text-apex-black rounded-br-sm'
                              : 'bg-apex-card text-neutral-200 rounded-bl-sm border border-apex-border'
                          }`}
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.mensaje}</p>
                        </div>
                        <p className="text-[10px] text-apex-muted mt-1 px-1">{formatTime(msg.timestamp)}</p>
                      </div>
                    </div>
                  )
                })}
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
    </div>
  )
}
