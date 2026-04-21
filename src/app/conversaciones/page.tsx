'use client'

import { useEffect, useState, useRef } from 'react'
import { MessageSquare, Send, Bot, BotOff, UserCheck, CheckCircle, ArrowLeft, Sparkles, Loader2, CheckCheck } from 'lucide-react'
import type { Lead, Conversacion } from '@/types'

interface SenderInfo {
  id: string
  alias: string
  color: string
  provider: 'twilio' | 'wassenger'
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

  const gruposFiltrados = filtroSender
    ? grupos.filter(g => g.sender?.id === filtroSender)
    : grupos

  const getInitial = (nombre: string) => (nombre?.[0] ?? '?').toUpperCase()

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  const formatDate = (ts: string) =>
    new Date(ts).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8">
      {/* Panel container */}
      <div className="flex flex-1 overflow-hidden bg-white border border-gray-200 shadow-sm lg:m-0 rounded-none lg:rounded-xl lg:m-2">

        {/* ── Left: conversation list ── */}
        <div className={`w-full lg:w-[320px] flex-shrink-0 flex flex-col border-r border-gray-100 bg-white ${seleccionado ? 'hidden lg:flex' : 'flex'}`}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-base font-semibold text-gray-900 tracking-tight">Inbox</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  {loading ? 'Cargando...' : `${gruposFiltrados.length} conversaciones`}
                </p>
              </div>
              {totalNoLeidos > 0 && (
                <button
                  onClick={leerTodos}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <CheckCheck size={13} />
                  leer todos
                </button>
              )}
            </div>
          </div>

          {/* Sender filter */}
          {sendersUnicos.length > 1 && (
            <div className="px-4 py-2.5 border-b border-gray-100 flex gap-1.5 flex-wrap bg-gray-50/60">
              <button
                onClick={() => setFiltroSender(null)}
                className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-all ${
                  !filtroSender
                    ? 'bg-gray-900 text-white'
                    : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-100'
                }`}
              >
                Todos
              </button>
              {sendersUnicos.map(s => (
                <button
                  key={s.id}
                  onClick={() => setFiltroSender(filtroSender === s.id ? null : s.id)}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all"
                  style={
                    filtroSender === s.id
                      ? { backgroundColor: s.color, borderColor: s.color, color: '#111' }
                      : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }
                  }
                >
                  {s.alias}
                </button>
              ))}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-24">
                <Loader2 size={20} className="animate-spin text-gray-300" />
              </div>
            ) : gruposFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <MessageSquare size={28} className="text-gray-200" />
                <p className="text-sm text-gray-400">No hay conversaciones</p>
              </div>
            ) : (
              gruposFiltrados.map(grupo => {
                const activo = seleccionado === grupo.lead.id
                return (
                  <button
                    key={grupo.lead.id}
                    onClick={() => seleccionarLead(grupo.lead.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors relative ${
                      activo ? 'bg-lime-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {activo && (
                      <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#c8f135] rounded-r" />
                    )}
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-gray-500 mt-0.5">
                        {getInitial(grupo.lead.nombre)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={`text-sm truncate ${grupo.no_leidos > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                            {grupo.lead.nombre}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0 tabular-nums">
                            {formatDate(grupo.ultimo_timestamp)}
                          </span>
                        </div>
                        <p className={`text-xs truncate mb-1.5 ${grupo.no_leidos > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
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
          style={{ backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundColor: '#f9fafb' }}
        >
          {!grupoActivo ? (
            <div className="flex-1 flex items-center justify-center bg-transparent">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mx-auto mb-3">
                  <MessageSquare size={26} className="text-gray-300" />
                </div>
                <p className="text-sm text-gray-400">Seleccioná una conversación</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shadow-sm flex-shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSeleccionado(null)}
                    className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-600">
                    {getInitial(grupoActivo.lead.nombre)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                      {grupoActivo.lead.nombre}
                    </h3>
                    <p className="text-[11px] text-gray-400 leading-tight">
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
                        ? 'bg-lime-50 text-lime-700 border-lime-200 hover:bg-lime-100'
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {grupoActivo.lead.agente_activo ? <Bot size={13} /> : <BotOff size={13} />}
                    {grupoActivo.lead.agente_activo ? 'Agente ON' : 'Agente OFF'}
                  </button>
                  <button
                    onClick={() => cambiarEstadoLead(grupoActivo.lead.id, 'interesado')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <UserCheck size={13} />
                    Interesado
                  </button>
                  <button
                    onClick={() => cambiarEstadoLead(grupoActivo.lead.id, 'cerrado')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 transition-colors"
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
                              ? 'bg-[#c8f135] text-gray-900 rounded-br-sm'
                              : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
                          }`}
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.mensaje}</p>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 px-1">{formatTime(msg.timestamp)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={nuevoMensaje}
                    onChange={e => setNuevoMensaje(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarMensaje()}
                    placeholder="Escribí un mensaje manual..."
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-300 focus:bg-white transition-colors"
                  />
                  <button
                    onClick={sugerirRespuesta}
                    disabled={sugiriendo}
                    title="Sugerir respuesta con IA"
                    className="p-2.5 rounded-xl bg-gray-100 text-gray-400 hover:bg-lime-50 hover:text-lime-600 border border-gray-200 hover:border-lime-200 transition-all disabled:opacity-40"
                  >
                    {sugiriendo ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  </button>
                  <button
                    onClick={enviarMensaje}
                    disabled={!nuevoMensaje.trim() || enviando}
                    className="p-2.5 rounded-xl bg-[#c8f135] text-gray-900 hover:bg-[#d4f54d] transition-colors disabled:opacity-40 shadow-sm"
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
