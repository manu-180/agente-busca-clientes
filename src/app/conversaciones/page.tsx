'use client'

import { useEffect, useState, useRef } from 'react'
import { MessageSquare, Send, Bot, BotOff, UserCheck, CheckCircle, ArrowLeft } from 'lucide-react'
import type { Lead, Conversacion } from '@/types'

interface ConversacionGrupo {
  lead: Lead
  mensajes: Conversacion[]
  ultimo_mensaje: string
  ultimo_timestamp: string
  no_leidos: number
}

export default function ConversacionesPage() {
  const [grupos, setGrupos] = useState<ConversacionGrupo[]>([])
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [nuevoMensaje, setNuevoMensaje] = useState('')
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(false)
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
    // Polling cada 10 segundos
    const interval = setInterval(cargarConversaciones, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [seleccionado, grupos])

  const grupoActivo = grupos.find(g => g.lead.id === seleccionado)

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-syne font-bold text-3xl tracking-tight">Inbox</h1>
        <p className="text-apex-muted text-sm mt-1 font-mono">Conversaciones de WhatsApp</p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-200px)]">
        {/* Lista de conversaciones */}
        <div className={`w-full lg:w-80 flex-shrink-0 bg-apex-card border border-apex-border rounded-xl overflow-hidden flex flex-col ${seleccionado ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-4 border-b border-apex-border">
            <p className="text-xs font-mono text-apex-muted uppercase tracking-wider">
              {grupos.length} conversaciones
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-apex-muted">Cargando...</p>
            ) : grupos.length === 0 ? (
              <div className="p-6 text-center">
                <MessageSquare size={32} className="text-apex-muted mx-auto mb-3" />
                <p className="text-sm text-apex-muted">No hay conversaciones aún</p>
              </div>
            ) : (
              grupos.map(grupo => (
                <button
                  key={grupo.lead.id}
                  onClick={() => setSeleccionado(grupo.lead.id)}
                  className={`w-full text-left p-4 border-b border-apex-border/50 hover:bg-apex-border/20 transition-colors ${
                    seleccionado === grupo.lead.id ? 'bg-apex-lime/5 border-l-2 border-l-apex-lime' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{grupo.lead.nombre}</span>
                    {grupo.no_leidos > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                        {grupo.no_leidos}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-apex-muted truncate">{grupo.ultimo_mensaje}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`badge-${grupo.lead.estado} text-[10px] px-1.5 py-0.5 rounded-full`}>
                      {grupo.lead.estado}
                    </span>
                    <span className="text-[10px] text-apex-muted font-mono">
                      {new Date(grupo.ultimo_timestamp).toLocaleString('es-AR', { 
                        hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
                      })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat */}
        <div className={`flex-1 bg-apex-card border border-apex-border rounded-xl overflow-hidden flex flex-col ${!seleccionado ? 'hidden lg:flex' : 'flex'}`}>
          {!grupoActivo ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare size={48} className="text-apex-border mx-auto mb-3" />
                <p className="text-apex-muted text-sm">Seleccioná una conversación</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header del chat */}
              <div className="p-4 border-b border-apex-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSeleccionado(null)}
                    className="lg:hidden p-1 rounded hover:bg-apex-border"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <h3 className="font-semibold text-sm">{grupoActivo.lead.nombre}</h3>
                    <p className="text-[11px] text-apex-muted font-mono">{grupoActivo.lead.telefono} · {grupoActivo.lead.rubro}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAgente(grupoActivo.lead.id, !grupoActivo.lead.agente_activo)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      grupoActivo.lead.agente_activo
                        ? 'bg-apex-lime/10 text-apex-lime border border-apex-lime/20'
                        : 'bg-apex-border text-apex-muted'
                    }`}
                  >
                    {grupoActivo.lead.agente_activo ? <Bot size={14} /> : <BotOff size={14} />}
                    {grupoActivo.lead.agente_activo ? 'Agente ON' : 'Agente OFF'}
                  </button>
                  <button
                    onClick={() => cambiarEstadoLead(grupoActivo.lead.id, 'interesado')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apex-border hover:bg-apex-muted/30 transition-colors"
                  >
                    <UserCheck size={14} />
                    Interesado
                  </button>
                  <button
                    onClick={() => cambiarEstadoLead(grupoActivo.lead.id, 'cerrado')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <CheckCircle size={14} />
                    Cerrado
                  </button>
                </div>
              </div>

              {/* Mensajes */}
              <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {grupoActivo.mensajes.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.rol === 'agente' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                        msg.rol === 'agente'
                          ? 'bg-apex-lime/15 text-apex-lime rounded-br-md'
                          : 'bg-apex-border text-white rounded-bl-md'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.mensaje}</p>
                      <p className={`text-[10px] mt-1 ${
                        msg.rol === 'agente' ? 'text-apex-lime/50' : 'text-apex-muted'
                      }`}>
                        {new Date(msg.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-apex-border">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nuevoMensaje}
                    onChange={e => setNuevoMensaje(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarMensaje()}
                    placeholder="Escribí un mensaje manual..."
                    className="flex-1 bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                  />
                  <button
                    onClick={enviarMensaje}
                    disabled={!nuevoMensaje.trim() || enviando}
                    className="bg-apex-lime text-apex-black p-2.5 rounded-lg hover:bg-apex-lime-hover transition-colors disabled:opacity-40"
                  >
                    <Send size={18} />
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
