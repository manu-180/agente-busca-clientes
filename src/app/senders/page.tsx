'use client'

import { useEffect, useState } from 'react'
import {
  Smartphone, Plus, Zap, ToggleLeft, ToggleRight,
  Send, Edit2, X, Loader2, CheckCircle, AlertCircle, Wifi
} from 'lucide-react'

interface Sender {
  id: string
  alias: string
  provider: 'twilio' | 'wassenger'
  phone_number: string
  descripcion: string | null
  color: string
  activo: boolean
  es_legacy: boolean
  stats_messages_sent: number
  created_at: string
  updated_at: string
  conversaciones?: [{ count: number }]
}

const COLORS = ['#84cc16', '#22d3ee', '#f97316', '#a855f7', '#ec4899', '#ef4444', '#3b82f6', '#f59e0b']

const emptyForm = {
  alias: '',
  provider: 'twilio' as 'twilio' | 'wassenger',
  phone_number: '',
  descripcion: '',
  color: '#84cc16',
}

export default function SendersPage() {
  const [senders, setSenders] = useState<Sender[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editando, setEditando] = useState<Sender | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [guardando, setGuardando] = useState(false)
  const [testModal, setTestModal] = useState<Sender | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testando, setTestando] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const cargar = async () => {
    try {
      const res = await fetch('/api/senders')
      const data = await res.json()
      setSenders(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const abrirAgregar = () => {
    setEditando(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const abrirEditar = (s: Sender) => {
    setEditando(s)
    setForm({
      alias: s.alias,
      provider: s.provider,
      phone_number: s.phone_number,
      descripcion: s.descripcion ?? '',
      color: s.color,
    })
    setShowModal(true)
  }

  const cerrarModal = () => {
    setShowModal(false)
    setEditando(null)
    setForm(emptyForm)
  }

  const guardar = async () => {
    setGuardando(true)
    try {
      if (editando) {
        await fetch('/api/senders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editando.id, alias: form.alias, descripcion: form.descripcion, color: form.color }),
        })
      } else {
        await fetch('/api/senders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      cerrarModal()
      await cargar()
    } catch (e) {
      console.error(e)
    } finally {
      setGuardando(false)
    }
  }

  const toggleActivo = async (s: Sender) => {
    await fetch('/api/senders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, activo: !s.activo }),
    })
    await cargar()
  }

  const abrirTest = (s: Sender) => {
    setTestModal(s)
    setTestPhone('')
    setTestResult(null)
  }

  const ejecutarTest = async () => {
    if (!testModal || !testPhone) return
    setTestando(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/senders/${testModal.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono_test: testPhone }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch (e) {
      setTestResult({ ok: false, error: String(e) })
    } finally {
      setTestando(false)
    }
  }

  const convCount = (s: Sender) => s.conversaciones?.[0]?.count ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Senders</h1>
          <p className="text-apex-muted text-sm mt-1 font-mono">Gestiona tus números de WhatsApp</p>
        </div>
        <button
          onClick={abrirAgregar}
          className="flex items-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold hover:bg-apex-lime/90 transition-colors"
        >
          <Plus size={16} />
          Agregar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-apex-muted py-12">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm font-mono">Cargando senders...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {senders.map(s => (
            <div
              key={s.id}
              className={`bg-apex-card border border-apex-border rounded-xl p-5 flex flex-col gap-4 transition-opacity ${!s.activo ? 'opacity-50' : ''}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <div>
                    <h3 className="font-syne font-bold text-base">{s.alias}</h3>
                    <p className="text-[11px] font-mono text-apex-muted">{s.phone_number}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      s.provider === 'twilio'
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                    }`}
                  >
                    {s.provider}
                  </span>
                  {s.es_legacy && (
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                      legacy
                    </span>
                  )}
                </div>
              </div>

              {/* Descripción */}
              {s.descripcion && (
                <p className="text-xs text-apex-muted leading-relaxed">{s.descripcion}</p>
              )}

              {/* Stats */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-apex-muted font-mono">
                  <span>{convCount(s)} conversaciones</span>
                  <span>{s.stats_messages_sent} msgs enviados</span>
                </div>
                <div className="w-full h-1 bg-apex-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (convCount(s) / Math.max(1, Math.max(...senders.map(x => convCount(x))))) * 100)}%`,
                      background: s.color,
                    }}
                  />
                </div>
                <p className="text-[10px] text-apex-muted font-mono">
                  Actualizado: {new Date(s.updated_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>

              {/* Acciones */}
              <div className="flex items-center gap-2 pt-1 border-t border-apex-border">
                <button
                  onClick={() => abrirTest(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apex-border hover:bg-apex-border/70 transition-colors"
                >
                  <Wifi size={13} />
                  Test
                </button>
                <button
                  onClick={() => abrirEditar(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apex-border hover:bg-apex-border/70 transition-colors"
                >
                  <Edit2 size={13} />
                  Editar
                </button>
                <button
                  onClick={() => toggleActivo(s)}
                  className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    s.activo
                      ? 'bg-apex-lime/10 text-apex-lime border border-apex-lime/20 hover:bg-apex-lime/20'
                      : 'bg-apex-border text-apex-muted hover:text-white'
                  }`}
                >
                  {s.activo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  {s.activo ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal agregar/editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-apex-card border border-apex-border rounded-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-syne font-bold text-lg">
                {editando ? 'Editar Sender' : 'Agregar Sender'}
              </h2>
              <button onClick={cerrarModal} className="p-1 hover:text-apex-lime transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Alias</label>
                <input
                  value={form.alias}
                  onChange={e => setForm(f => ({ ...f, alias: e.target.value }))}
                  placeholder="Ej: APEX, OFICIOS..."
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>

              {!editando && (
                <>
                  <div>
                    <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Proveedor</label>
                    <select
                      value={form.provider}
                      onChange={e => setForm(f => ({ ...f, provider: e.target.value as 'twilio' | 'wassenger' }))}
                      className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                    >
                      <option value="twilio">Twilio</option>
                      <option value="wassenger">Wassenger</option>
                    </select>
                    {form.provider === 'twilio' && (
                      <p className="text-[10px] text-apex-muted font-mono mt-1">
                        Usa las credenciales TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN del sistema
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Número (con código país)</label>
                    <input
                      value={form.phone_number}
                      onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                      placeholder="+5491112345678"
                      className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Descripción (opcional)</label>
                <input
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Descripción del número..."
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-2">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${form.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={cerrarModal}
                className="flex-1 px-4 py-2.5 border border-apex-border rounded-lg text-sm text-apex-muted hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando || !form.alias || (!editando && !form.phone_number)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-apex-lime/90 transition-colors"
              >
                {guardando ? <Loader2 size={16} className="animate-spin" /> : null}
                {editando ? 'Guardar cambios' : 'Agregar sender'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal test */}
      {testModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-apex-card border border-apex-border rounded-xl w-full max-w-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: testModal.color }} />
                <h2 className="font-syne font-bold text-lg">Test: {testModal.alias}</h2>
              </div>
              <button onClick={() => setTestModal(null)} className="p-1 hover:text-apex-lime transition-colors">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-apex-muted font-mono">
              Enviará un mensaje de prueba desde {testModal.phone_number} al número que ingreses.
            </p>

            <div>
              <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Número destino</label>
              <input
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="5491112345678"
                className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
              />
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                testResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              }`}>
                {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {testResult.ok ? 'Mensaje enviado correctamente' : `Error: ${testResult.error}`}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setTestModal(null)}
                className="flex-1 px-4 py-2.5 border border-apex-border rounded-lg text-sm text-apex-muted hover:text-white transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={ejecutarTest}
                disabled={testando || !testPhone}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold disabled:opacity-40"
              >
                {testando ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}
                Enviar test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
