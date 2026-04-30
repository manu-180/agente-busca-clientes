'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Plus, ToggleLeft, ToggleRight,
  Send, Edit2, X, Loader2, CheckCircle, AlertCircle, Wifi,
  QrCode, RefreshCw,
} from 'lucide-react'

interface Sender {
  id: string
  alias: string
  provider: 'twilio' | 'evolution' | 'wassenger'
  phone_number: string
  descripcion: string | null
  color: string
  activo: boolean
  es_legacy: boolean
  stats_messages_sent: number
  instance_name: string | null
  daily_limit: number
  msgs_today: number
  connected: boolean
  connected_at: string | null
  qr_requested_at: string | null
  created_at: string
  updated_at: string
  conversaciones?: [{ count: number }]
}

interface Orphan {
  name: string
  state: string
  phone: string | null
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

const COLORS = ['#84cc16', '#22d3ee', '#f97316', '#a855f7', '#ec4899', '#ef4444', '#3b82f6', '#f59e0b']
const DAILY_LIMIT_OPTIONS = [10, 15, 20, 25, 30]

const emptyAddForm = { alias: '', daily_limit: 15, color: '#84cc16' }
const emptyEditForm = { alias: '', descripcion: '', color: '#84cc16', daily_limit: 15 }
const emptyAdoptForm = { alias: '', daily_limit: 15, color: '#84cc16' }

type AddStep = 'form' | 'qr'

export default function SendersPage() {
  const [senders, setSenders] = useState<Sender[]>([])
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [capacity, setCapacity] = useState<CapacityStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Modal Add (2 pantallas)
  const [showAdd, setShowAdd] = useState(false)
  const [addStep, setAddStep] = useState<AddStep>('form')
  const [addForm, setAddForm] = useState(emptyAddForm)
  const [addCreating, setAddCreating] = useState(false)
  const [addCreatedSenderId, setAddCreatedSenderId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // Modal Edit
  const [editing, setEditing] = useState<Sender | null>(null)
  const [editForm, setEditForm] = useState(emptyEditForm)
  const [editSaving, setEditSaving] = useState(false)

  // Modal Reconnect
  const [reconnectSender, setReconnectSender] = useState<Sender | null>(null)

  // Modal Adopt
  const [adoptOrphan, setAdoptOrphan] = useState<Orphan | null>(null)
  const [adoptForm, setAdoptForm] = useState(emptyAdoptForm)
  const [adopting, setAdopting] = useState(false)

  // Test (legacy)
  const [testModal, setTestModal] = useState<Sender | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testando, setTestando] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  // Toast
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const showToast = (kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4000)
  }

  const cargar = async () => {
    try {
      const [sendersRes, orphansRes, capacityRes] = await Promise.all([
        fetch('/api/senders'),
        fetch('/api/senders/orphans'),
        fetch('/api/senders/capacity', { cache: 'no-store' }),
      ])
      const sendersData = await sendersRes.json()
      setSenders(Array.isArray(sendersData) ? sendersData : [])
      const orphansData = orphansRes.ok ? await orphansRes.json() : { orphans: [] }
      setOrphans(Array.isArray(orphansData?.orphans) ? orphansData.orphans : [])
      if (capacityRes.ok) {
        const cap = (await capacityRes.json()) as CapacityStats
        setCapacity(cap)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargar()
    const intervalo = setInterval(cargar, 30_000)
    return () => clearInterval(intervalo)
  }, [])

  // ─── ADD FLOW ─────────────────────────────────────────────────────────
  const abrirAgregar = () => {
    setAddForm(emptyAddForm)
    setAddStep('form')
    setAddCreatedSenderId(null)
    setAddError(null)
    setShowAdd(true)
  }
  const cerrarAdd = () => {
    setShowAdd(false)
    setAddStep('form')
    setAddCreatedSenderId(null)
    setAddError(null)
  }
  const crearYConectar = async () => {
    if (!addForm.alias.trim()) return
    setAddCreating(true)
    setAddError(null)
    try {
      const res = await fetch('/api/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: addForm.alias.trim(),
          provider: 'evolution',
          color: addForm.color,
          daily_limit: addForm.daily_limit,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddError(data?.error ?? 'No se pudo crear la SIM')
        return
      }
      setAddCreatedSenderId(data.id)
      setAddStep('qr')
      void cargar()
    } catch (e) {
      setAddError(String(e))
    } finally {
      setAddCreating(false)
    }
  }

  // ─── EDIT ─────────────────────────────────────────────────────────────
  const abrirEditar = (s: Sender) => {
    setEditing(s)
    setEditForm({
      alias: s.alias,
      descripcion: s.descripcion ?? '',
      color: s.color,
      daily_limit: s.daily_limit ?? 15,
    })
  }
  const cerrarEdit = () => setEditing(null)
  const guardarEdit = async () => {
    if (!editing) return
    setEditSaving(true)
    try {
      await fetch('/api/senders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          alias: editForm.alias,
          descripcion: editForm.descripcion,
          color: editForm.color,
          daily_limit: editForm.daily_limit,
        }),
      })
      cerrarEdit()
      await cargar()
    } catch (e) {
      console.error(e)
    } finally {
      setEditSaving(false)
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

  // ─── RECONNECT ────────────────────────────────────────────────────────
  const abrirReconnect = (s: Sender) => setReconnectSender(s)
  const cerrarReconnect = () => setReconnectSender(null)

  // ─── ADOPT ────────────────────────────────────────────────────────────
  const abrirAdopt = (o: Orphan) => {
    setAdoptOrphan(o)
    setAdoptForm({
      alias: o.name.replace(/^wa-/, '').toUpperCase(),
      daily_limit: 15,
      color: '#84cc16',
    })
  }
  const cerrarAdopt = () => setAdoptOrphan(null)
  const ejecutarAdopt = async () => {
    if (!adoptOrphan) return
    setAdopting(true)
    try {
      const res = await fetch('/api/senders/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: adoptOrphan.name,
          alias: adoptForm.alias.trim(),
          daily_limit: adoptForm.daily_limit,
          color: adoptForm.color,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('error', data?.error ?? 'Falló la adopción')
        return
      }
      showToast('ok', `✅ ${adoptOrphan.name} adoptada como sender`)
      cerrarAdopt()
      await cargar()
    } catch (e) {
      showToast('error', String(e))
    } finally {
      setAdopting(false)
    }
  }

  const borrarOrphan = async (o: Orphan) => {
    if (!confirm(`¿Borrar la instancia "${o.name}" de Evolution? Esta acción no se puede deshacer.`)) return
    try {
      const res = await fetch(`/api/senders/orphans?name=${encodeURIComponent(o.name)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        showToast('error', data?.error ?? 'Falló el borrado')
        return
      }
      showToast('ok', `Instancia ${o.name} borrada de Evolution`)
      await cargar()
    } catch (e) {
      showToast('error', String(e))
    }
  }

  // ─── TEST (legacy, dejar funcionando) ─────────────────────────────────
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Senders</h1>
          <p className="text-apex-muted text-sm mt-1 font-mono">
            Pool de SIMs WhatsApp
          </p>
        </div>
        <button
          onClick={abrirAgregar}
          className="flex items-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold hover:bg-apex-lime/90 transition-colors"
        >
          <Plus size={16} />
          Agregar SIM
        </button>
      </div>

      {/* Stats agregados del pool */}
      {capacity && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-apex-card border border-apex-border rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-apex-muted">Pool hoy</span>
            <span className="text-lg font-syne font-bold tabular-nums">
              <span className="text-apex-lime">{capacity.used_today}</span>
              <span className="text-apex-muted text-sm">/</span>
              <span>{capacity.total_today}</span>
            </span>
            <span className="text-xs font-mono text-apex-muted">
              ({capacity.remaining} restantes)
            </span>
          </div>

          <div className="h-4 w-px bg-apex-border" />

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-apex-muted">SIMs</span>
            <span className="text-lg font-syne font-bold tabular-nums">
              <span className="text-apex-lime">{capacity.active_connected}</span>
              <span className="text-apex-muted text-sm">/</span>
              <span>{capacity.active_total}</span>
            </span>
            <div className="flex gap-1 flex-wrap">
              {capacity.per_sender.map(s => (
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

      {/* Banda de huérfanas */}
      {orphans.length > 0 && (
        <div className="border border-yellow-500/40 bg-yellow-500/10 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <p className="text-sm text-yellow-200">
                Detectamos <strong>{orphans.length}</strong> instancia{orphans.length !== 1 ? 's' : ''} en Evolution sin sender en la base:
              </p>
              <div className="flex flex-wrap gap-2">
                {orphans.map(o => (
                  <div
                    key={o.name}
                    className="flex items-center gap-2 bg-apex-black/60 border border-yellow-500/30 rounded-lg px-3 py-1.5"
                  >
                    <span className="font-mono text-xs">
                      {o.name}
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                        o.state === 'open' ? 'bg-emerald-500/20 text-emerald-400' :
                        o.state === 'connecting' ? 'bg-yellow-500/20 text-yellow-300' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {o.state}
                      </span>
                    </span>
                    <button
                      onClick={() => abrirAdopt(o)}
                      className="text-[11px] font-semibold px-2 py-0.5 bg-apex-lime text-apex-black rounded hover:bg-apex-lime/90"
                    >
                      Adoptar
                    </button>
                    <button
                      onClick={() => borrarOrphan(o)}
                      className="text-[11px] text-red-400 hover:text-red-300"
                    >
                      Borrar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-apex-muted py-12">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm font-mono">Cargando senders...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {senders.map(s => {
            const isEvolution = s.provider === 'evolution'
            const used = s.msgs_today ?? 0
            const limit = s.daily_limit ?? 15
            const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0

            return (
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
                      <p className="text-[11px] font-mono text-apex-muted">
                        {s.phone_number || (isEvolution ? 'sin número aún' : '—')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                      isEvolution
                        ? 'bg-apex-lime/10 text-apex-lime border-apex-lime/20'
                        : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                    }`}>
                      {s.provider}
                    </span>
                    {s.es_legacy && (
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                        legacy
                      </span>
                    )}
                  </div>
                </div>

                {/* Connection badge */}
                {isEvolution && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full font-mono font-medium border ${
                      s.connected
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {s.connected ? 'connected' : 'disconnected'}
                    </span>
                    {s.instance_name && (
                      <span className="text-[10px] font-mono text-apex-muted">{s.instance_name}</span>
                    )}
                  </div>
                )}

                {/* Descripción */}
                {s.descripcion && (
                  <p className="text-xs text-apex-muted leading-relaxed">{s.descripcion}</p>
                )}

                {/* Stats */}
                {isEvolution ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-apex-muted">msgs hoy</span>
                      <span className="tabular-nums">
                        <span className={used >= limit ? 'text-amber-400' : 'text-apex-lime'}>
                          {used}
                        </span>
                        <span className="text-apex-muted">/{limit}</span>
                      </span>
                    </div>
                    <div className="w-full h-2 bg-apex-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: used >= limit ? '#f59e0b' : s.color,
                        }}
                      />
                    </div>
                    {used >= limit && (
                      <p className="text-[10px] text-amber-400/90 font-mono">
                        Límite diario alcanzado
                      </p>
                    )}
                    <p className="text-[10px] text-apex-muted font-mono">
                      Actualizado: {new Date(s.updated_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-apex-muted font-mono">
                      <span>{s.conversaciones?.[0]?.count ?? 0} conversaciones</span>
                      <span>{s.stats_messages_sent} msgs enviados</span>
                    </div>
                    <p className="text-[10px] text-apex-muted font-mono">
                      Provider legacy — ya no envía nuevos mensajes
                    </p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-apex-border">
                  {isEvolution && !s.connected && (
                    <button
                      onClick={() => abrirReconnect(s)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apex-lime/10 text-apex-lime border border-apex-lime/20 hover:bg-apex-lime/20 transition-colors"
                    >
                      <QrCode size={13} />
                      Reconectar QR
                    </button>
                  )}
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
            )
          })}
        </div>
      )}

      {/* ─── MODAL ADD (2 pantallas) ───────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          {addStep === 'form' && (
            <div className="bg-apex-card border border-apex-border rounded-xl w-full max-w-md p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-syne font-bold text-lg">Agregar SIM</h2>
                <button onClick={cerrarAdd} className="p-1 hover:text-apex-lime transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Alias</label>
                  <input
                    autoFocus
                    value={addForm.alias}
                    onChange={e => setAddForm(f => ({ ...f, alias: e.target.value }))}
                    placeholder="Ej: SIM 01"
                    className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Límite diario</label>
                  <select
                    value={addForm.daily_limit}
                    onChange={e => setAddForm(f => ({ ...f, daily_limit: Number(e.target.value) }))}
                    className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                  >
                    {DAILY_LIMIT_OPTIONS.map(n => <option key={n} value={n}>{n} mensajes/día</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-2">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAddForm(f => ({ ...f, color: c }))}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${addForm.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>

                {addError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg text-sm bg-red-500/10 text-red-400">
                    <AlertCircle size={16} />
                    {addError}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={cerrarAdd}
                  className="flex-1 px-4 py-2.5 border border-apex-border rounded-lg text-sm text-apex-muted hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={crearYConectar}
                  disabled={addCreating || !addForm.alias.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-apex-lime/90 transition-colors"
                >
                  {addCreating ? <Loader2 size={16} className="animate-spin" /> : null}
                  Conectar SIM →
                </button>
              </div>
            </div>
          )}

          {addStep === 'qr' && addCreatedSenderId && (
            <QRConnectModal
              senderId={addCreatedSenderId}
              onClose={async () => { cerrarAdd(); await cargar() }}
              onConnected={async (phone) => {
                showToast('ok', `✅ SIM conectada${phone ? ` como ${phone}` : ''}`)
                cerrarAdd()
                await cargar()
              }}
              mode="initial"
            />
          )}
        </div>
      )}

      {/* ─── MODAL RECONNECT ───────────────────────────────────────── */}
      {reconnectSender && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <QRConnectModal
            senderId={reconnectSender.id}
            onClose={async () => { cerrarReconnect(); await cargar() }}
            onConnected={async (phone) => {
              showToast('ok', `✅ SIM ${reconnectSender.alias} reconectada${phone ? ` como ${phone}` : ''}`)
              cerrarReconnect()
              await cargar()
            }}
            mode="reconnect"
            senderAlias={reconnectSender.alias}
          />
        </div>
      )}

      {/* ─── MODAL EDIT ───────────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-apex-card border border-apex-border rounded-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-syne font-bold text-lg">Editar Sender</h2>
              <button onClick={cerrarEdit} className="p-1 hover:text-apex-lime transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Alias</label>
                <input
                  value={editForm.alias}
                  onChange={e => setEditForm(f => ({ ...f, alias: e.target.value }))}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Descripción</label>
                <input
                  value={editForm.descripcion}
                  onChange={e => setEditForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Descripción del número..."
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>

              {editing.provider === 'evolution' && (
                <div>
                  <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Límite diario</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.daily_limit}
                    onChange={e => setEditForm(f => ({ ...f, daily_limit: Number(e.target.value) }))}
                    className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-2">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${editForm.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={cerrarEdit}
                className="flex-1 px-4 py-2.5 border border-apex-border rounded-lg text-sm text-apex-muted hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={guardarEdit}
                disabled={editSaving || !editForm.alias.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-apex-lime/90 transition-colors"
              >
                {editSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL ADOPT ──────────────────────────────────────────── */}
      {adoptOrphan && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-apex-card border border-apex-border rounded-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-syne font-bold text-lg">Adoptar instancia</h2>
              <button onClick={cerrarAdopt} className="p-1 hover:text-apex-lime transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="bg-apex-black/40 border border-apex-border rounded-lg p-3 text-xs font-mono">
              <div>instance: <span className="text-apex-lime">{adoptOrphan.name}</span></div>
              <div>state: <span className="text-white">{adoptOrphan.state}</span></div>
              <div>phone: <span className="text-white">{adoptOrphan.phone ?? '—'}</span></div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Alias</label>
                <input
                  autoFocus
                  value={adoptForm.alias}
                  onChange={e => setAdoptForm(f => ({ ...f, alias: e.target.value }))}
                  placeholder="Ej: SIM 01"
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-1.5">Límite diario</label>
                <select
                  value={adoptForm.daily_limit}
                  onChange={e => setAdoptForm(f => ({ ...f, daily_limit: Number(e.target.value) }))}
                  className="w-full bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
                >
                  {DAILY_LIMIT_OPTIONS.map(n => <option key={n} value={n}>{n} mensajes/día</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-mono text-apex-muted uppercase tracking-wider block mb-2">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAdoptForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${adoptForm.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={cerrarAdopt}
                className="flex-1 px-4 py-2.5 border border-apex-border rounded-lg text-sm text-apex-muted hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={ejecutarAdopt}
                disabled={adopting || !adoptForm.alias.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-apex-lime/90 transition-colors"
              >
                {adopting ? <Loader2 size={16} className="animate-spin" /> : null}
                Adoptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL TEST (legacy) ──────────────────────────────────── */}
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
              Enviará un mensaje de prueba desde {testModal.phone_number || testModal.alias} al número que ingreses.
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

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl border ${
          toast.kind === 'ok'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/15 border-red-500/30 text-red-300'
        }`}>
          {toast.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span className="text-sm">{toast.text}</span>
        </div>
      )}
    </div>
  )
}

// ─── Componente reutilizable: QR Connect Modal ─────────────────────────────────
function QRConnectModal({
  senderId,
  onClose,
  onConnected,
  mode,
  senderAlias,
}: {
  senderId: string
  onClose: () => void
  onConnected: (phone: string | null) => void
  mode: 'initial' | 'reconnect'
  senderAlias?: string
}) {
  const [base64, setBase64] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(true)
  const [qrError, setQrError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(40)
  const [state, setState] = useState<'close' | 'connecting' | 'open' | 'unknown'>('unknown')
  const [phone, setPhone] = useState<string | null>(null)
  const [connectedFlash, setConnectedFlash] = useState(false)
  const stoppedRef = useRef(false)

  const fetchQr = async (initial: boolean) => {
    setLoadingQr(true)
    setQrError(null)
    try {
      const url = initial ? `/api/senders/${senderId}/qr` : `/api/senders/${senderId}/reconnect`
      const res = await fetch(url, { method: initial ? 'GET' : 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setQrError(data?.error ?? 'No se pudo obtener el QR')
        return
      }
      setBase64(data.base64 ?? null)
      setSecondsLeft(40)
    } catch (e) {
      setQrError(String(e))
    } finally {
      setLoadingQr(false)
    }
  }

  // Initial QR fetch
  useEffect(() => {
    fetchQr(mode === 'reconnect')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderId, mode])

  // Countdown
  useEffect(() => {
    if (loadingQr || secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [loadingQr, secondsLeft])

  // Polling state cada 2s
  useEffect(() => {
    stoppedRef.current = false
    let interval: NodeJS.Timeout | null = null
    const poll = async () => {
      if (stoppedRef.current) return
      try {
        const res = await fetch(`/api/senders/${senderId}/state`)
        const data = await res.json()
        if (res.ok) {
          setState(data.state)
          if (data.phone_number) setPhone(data.phone_number)
          if (data.state === 'open') {
            stoppedRef.current = true
            if (interval) clearInterval(interval)
            setConnectedFlash(true)
            setTimeout(() => onConnected(data.phone_number ?? null), 800)
          }
        }
      } catch {
        // soft fail, seguimos polleando
      }
    }
    interval = setInterval(poll, 2000)
    poll()
    return () => {
      stoppedRef.current = true
      if (interval) clearInterval(interval)
    }
  }, [senderId, onConnected])

  const regenerar = () => fetchQr(true)

  const titulo = mode === 'reconnect'
    ? `Reconectar ${senderAlias ?? 'SIM'}`
    : 'Conectá la SIM'

  return (
    <div className="bg-apex-card border border-apex-border rounded-xl w-full max-w-md p-6 space-y-5 relative">
      <div className="flex items-center justify-between">
        <h2 className="font-syne font-bold text-lg">{titulo}</h2>
        <button onClick={onClose} className="p-1 hover:text-apex-lime transition-colors">
          <X size={18} />
        </button>
      </div>

      <p className="text-sm text-apex-muted">
        Abrí WhatsApp en el celular →{' '}
        <span className="text-white">Dispositivos vinculados</span> →{' '}
        <span className="text-white">Vincular dispositivo</span>, y escaneá:
      </p>

      <div className="flex flex-col items-center gap-3">
        <div className="relative w-64 h-64 bg-apex-black border-2 border-apex-lime/40 rounded-lg flex items-center justify-center overflow-hidden">
          {loadingQr ? (
            <Loader2 size={36} className="animate-spin text-apex-lime" />
          ) : qrError ? (
            <div className="flex flex-col items-center gap-2 text-red-400 px-4 text-center">
              <AlertCircle size={24} />
              <span className="text-xs font-mono">{qrError}</span>
            </div>
          ) : base64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${base64}`} alt="QR de conexión" className="w-full h-full object-contain" />
          ) : (
            <div className="text-apex-muted text-xs font-mono">Sin QR disponible</div>
          )}
          {connectedFlash && (
            <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center backdrop-blur-sm">
              <CheckCircle size={64} className="text-emerald-400 animate-pulse" />
            </div>
          )}
        </div>

        <div className="text-xs font-mono text-apex-muted">
          {secondsLeft > 0 && !qrError ? (
            <>Caduca en <span className="text-apex-lime">{secondsLeft}s</span></>
          ) : (
            <span className="text-yellow-400">QR caducado — regenerá para escanear de nuevo</span>
          )}
        </div>

        {(secondsLeft <= 0 || qrError) && (
          <button
            onClick={regenerar}
            className="flex items-center gap-2 px-3 py-1.5 bg-apex-lime/10 text-apex-lime border border-apex-lime/30 rounded-lg text-xs font-semibold hover:bg-apex-lime/20"
          >
            <RefreshCw size={13} />
            Regenerar QR
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 text-xs font-mono">
        <span className="text-apex-muted">Esperando conexión</span>
        <span className="flex gap-0.5">
          <span className="w-1 h-1 bg-apex-lime rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
          <span className="w-1 h-1 bg-apex-lime rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
          <span className="w-1 h-1 bg-apex-lime rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
        </span>
        {state !== 'unknown' && (
          <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
            state === 'open' ? 'bg-emerald-500/20 text-emerald-400' :
            state === 'connecting' ? 'bg-yellow-500/20 text-yellow-300' :
            'bg-red-500/20 text-red-400'
          }`}>
            {state}
          </span>
        )}
        {phone && state === 'open' && (
          <span className="text-emerald-400 ml-1">{phone}</span>
        )}
      </div>

      <div>
        <button
          onClick={onClose}
          className="w-full px-4 py-2 border border-apex-border rounded-lg text-sm text-apex-muted hover:text-white transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}
