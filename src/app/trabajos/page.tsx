'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  Plus, ChevronDown, ChevronUp, Pencil, Trash2, Check, X,
  Briefcase, CalendarDays, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Cuota {
  id: string
  trabajo_id: string
  numero_cuota: number
  valor: number
  fecha_vencimiento: string | null
  pagado: boolean
  fecha_pago: string | null
  notas: string | null
}

interface Trabajo {
  id: string
  nombre: string
  cliente: string | null
  descripcion: string | null
  tipo: 'cuotas' | 'indefinido'
  valor_cuota: number
  moneda: 'ARS' | 'USD'
  total_cuotas: number | null
  fecha_inicio: string
  activo: boolean
  cuotas: Cuota[]
}

type TrabajoForm = Omit<Trabajo, 'id' | 'cuotas' | 'activo'>

const EMPTY_FORM: TrabajoForm = {
  nombre: '',
  cliente: '',
  descripcion: '',
  tipo: 'cuotas',
  valor_cuota: 0,
  moneda: 'ARS',
  total_cuotas: 6,
  fecha_inicio: new Date().toISOString().split('T')[0],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number, moneda: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function currentMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function isThisMonth(dateStr: string | null, year: number, month: number) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d.getFullYear() === year && d.getMonth() === month
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-apex-dark border border-apex-border rounded-2xl w-full max-w-lg shadow-2xl animate-[fadeIn_0.2s_ease]">
        <div className="flex items-center justify-between p-6 border-b border-apex-border">
          <h2 className="font-syne font-bold text-lg text-white">{title}</h2>
          <button onClick={onClose} className="text-apex-muted hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── TrabajoForm ──────────────────────────────────────────────────────────────

function TrabajoFormModal({
  initial,
  onSave,
  onClose,
  loading,
}: {
  initial: TrabajoForm
  onSave: (f: TrabajoForm) => void
  onClose: () => void
  loading: boolean
}) {
  const [form, setForm] = useState<TrabajoForm>(initial)

  const set = (k: keyof TrabajoForm, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const label = 'block text-xs font-mono text-apex-muted mb-1 uppercase tracking-wider'
  const input = 'w-full bg-apex-card border border-apex-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-apex-muted/50 focus:outline-none focus:border-apex-lime/50 transition-colors'

  return (
    <Modal title={initial.nombre ? 'Editar trabajo' : 'Nuevo trabajo'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={label}>Nombre del proyecto *</label>
            <input className={input} value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Landing page cliente X" />
          </div>
          <div>
            <label className={label}>Cliente</label>
            <input className={input} value={form.cliente ?? ''} onChange={e => set('cliente', e.target.value)} placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className={label}>Moneda</label>
            <select className={input} value={form.moneda} onChange={e => set('moneda', e.target.value as 'ARS' | 'USD')}>
              <option value="ARS">ARS $</option>
              <option value="USD">USD $</option>
            </select>
          </div>
          <div>
            <label className={label}>Tipo</label>
            <select className={input} value={form.tipo} onChange={e => set('tipo', e.target.value as 'cuotas' | 'indefinido')}>
              <option value="cuotas">Cuotas fijas</option>
              <option value="indefinido">Tiempo indefinido</option>
            </select>
          </div>
          <div>
            <label className={label}>Valor cuota</label>
            <input className={input} type="number" min="0" value={form.valor_cuota} onChange={e => set('valor_cuota', parseFloat(e.target.value) || 0)} />
          </div>
          {form.tipo === 'cuotas' && (
            <div>
              <label className={label}>Cantidad cuotas</label>
              <input className={input} type="number" min="1" value={form.total_cuotas ?? ''} onChange={e => set('total_cuotas', parseInt(e.target.value) || null)} />
            </div>
          )}
          <div className={form.tipo === 'cuotas' ? '' : 'col-span-2'}>
            <label className={label}>Fecha inicio</label>
            <input className={input} type="date" value={form.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label}>Descripción</label>
            <textarea
              className={cn(input, 'resize-none')}
              rows={2}
              value={form.descripcion ?? ''}
              onChange={e => set('descripcion', e.target.value)}
              placeholder="Detalles del trabajo..."
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-apex-border text-apex-muted hover:text-white hover:border-white/20 text-sm transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.nombre || loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-apex-lime text-apex-black font-semibold text-sm hover:bg-apex-lime-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── CuotaRow ─────────────────────────────────────────────────────────────────

function CuotaRow({
  cuota,
  moneda,
  onTogglePago,
  onEdit,
  onDelete,
}: {
  cuota: Cuota
  moneda: string
  onTogglePago: (c: Cuota) => void
  onEdit: (c: Cuota) => void
  onDelete: (id: string) => void
}) {
  const overdue = !cuota.pagado && cuota.fecha_vencimiento && new Date(cuota.fecha_vencimiento) < new Date()

  return (
    <tr className={cn('border-b border-apex-border/50 group transition-colors', cuota.pagado ? 'opacity-60' : 'hover:bg-apex-card/60')}>
      <td className="px-4 py-3 text-sm font-mono text-apex-muted">{cuota.numero_cuota}</td>
      <td className="px-4 py-3 text-sm text-white">{fmt(cuota.valor, moneda)}</td>
      <td className={cn('px-4 py-3 text-sm', overdue ? 'text-red-400' : 'text-apex-muted')}>
        {fmtDate(cuota.fecha_vencimiento)}
        {overdue && <span className="ml-1 text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">vencida</span>}
      </td>
      <td className="px-4 py-3">
        {cuota.pagado ? (
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-1 rounded-full font-medium">
            <Check size={10} /> Cobrada {cuota.fecha_pago ? fmtDate(cuota.fecha_pago) : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs bg-apex-lime/10 text-apex-lime border border-apex-lime/20 px-2 py-1 rounded-full font-medium">
            Pendiente
          </span>
        )}
      </td>
      {cuota.notas && (
        <td className="px-4 py-3 text-xs text-apex-muted max-w-[160px] truncate">{cuota.notas}</td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            title={cuota.pagado ? 'Marcar pendiente' : 'Marcar cobrada'}
            onClick={() => onTogglePago(cuota)}
            className={cn(
              'p-1.5 rounded-lg transition-colors text-xs',
              cuota.pagado
                ? 'bg-apex-card text-apex-muted hover:text-white'
                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
            )}
          >
            <Check size={13} />
          </button>
          <button title="Editar" onClick={() => onEdit(cuota)} className="p-1.5 rounded-lg bg-apex-card text-apex-muted hover:text-apex-lime transition-colors">
            <Pencil size={13} />
          </button>
          <button title="Eliminar" onClick={() => onDelete(cuota.id)} className="p-1.5 rounded-lg bg-apex-card text-apex-muted hover:text-red-400 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── EditCuotaModal ───────────────────────────────────────────────────────────

function EditCuotaModal({
  cuota,
  moneda,
  onSave,
  onClose,
  loading,
}: {
  cuota: Cuota
  moneda: string
  onSave: (data: Partial<Cuota>) => void
  onClose: () => void
  loading: boolean
}) {
  const [valor, setValor] = useState(String(cuota.valor))
  const [fecha, setFecha] = useState(cuota.fecha_vencimiento ?? '')
  const [notas, setNotas] = useState(cuota.notas ?? '')

  const label = 'block text-xs font-mono text-apex-muted mb-1 uppercase tracking-wider'
  const input = 'w-full bg-apex-card border border-apex-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-apex-muted/50 focus:outline-none focus:border-apex-lime/50 transition-colors'

  return (
    <Modal title={`Editar cuota #${cuota.numero_cuota}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={label}>Valor ({moneda})</label>
          <input className={input} type="number" min="0" value={valor} onChange={e => setValor(e.target.value)} />
        </div>
        <div>
          <label className={label}>Fecha vencimiento</label>
          <input className={input} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div>
          <label className={label}>Notas</label>
          <input className={input} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej: adelantó pago, ajuste de precio..." />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-apex-border text-apex-muted hover:text-white text-sm transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ valor: parseFloat(valor), fecha_vencimiento: fecha || null, notas: notas || null })}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-apex-lime text-apex-black font-semibold text-sm hover:bg-apex-lime-hover disabled:opacity-40 transition-colors"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── TrabajoCard ──────────────────────────────────────────────────────────────

function TrabajoCard({
  trabajo,
  onEdit,
  onDelete,
  onToggleCuota,
  onEditCuota,
  onDeleteCuota,
  onAddCuota,
}: {
  trabajo: Trabajo
  onEdit: (t: Trabajo) => void
  onDelete: (id: string) => void
  onToggleCuota: (c: Cuota) => void
  onEditCuota: (c: Cuota) => void
  onDeleteCuota: (id: string) => void
  onAddCuota: (t: Trabajo) => void
}) {
  const [expanded, setExpanded] = useState(true)

  const pagadas = trabajo.cuotas.filter(c => c.pagado).length
  const total = trabajo.cuotas.length
  const pct = total > 0 ? Math.round((pagadas / total) * 100) : 0
  const cobradoTotal = trabajo.cuotas.filter(c => c.pagado).reduce((s, c) => s + c.valor, 0)
  const pendienteTotal = trabajo.cuotas.filter(c => !c.pagado).reduce((s, c) => s + c.valor, 0)

  return (
    <div className={cn('bg-apex-dark border rounded-2xl overflow-hidden transition-all', trabajo.activo ? 'border-apex-border' : 'border-apex-border/40 opacity-60')}>
      {/* Card header */}
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-xl bg-apex-lime/10 border border-apex-lime/20 flex items-center justify-center flex-shrink-0">
          <Briefcase size={18} className="text-apex-lime" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-syne font-bold text-white text-base leading-tight">{trabajo.nombre}</h3>
            {trabajo.cliente && (
              <span className="text-[11px] bg-apex-card border border-apex-border text-apex-muted px-2 py-0.5 rounded-full">
                {trabajo.cliente}
              </span>
            )}
            <span className={cn(
              'text-[11px] px-2 py-0.5 rounded-full font-medium',
              trabajo.tipo === 'cuotas'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
            )}>
              {trabajo.tipo === 'cuotas' ? `${total_label(trabajo)} cuotas` : 'Indefinido'}
            </span>
            {!trabajo.activo && (
              <span className="text-[11px] bg-apex-card text-apex-muted border border-apex-border px-2 py-0.5 rounded-full">Inactivo</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1">
            <span className="text-sm font-mono text-apex-lime font-semibold">{fmt(trabajo.valor_cuota, trabajo.moneda)}<span className="text-apex-muted font-normal text-xs">/cuota</span></span>
            {trabajo.tipo === 'cuotas' && total > 0 && (
              <span className="text-xs text-apex-muted">{pagadas}/{total} cobradas</span>
            )}
          </div>
        </div>

        {/* Right side: stats + actions */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-apex-muted mb-0.5">Pendiente</div>
            <div className="text-sm font-mono font-semibold text-white">{fmt(pendienteTotal, trabajo.moneda)}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(trabajo)} title="Editar" className="p-2 rounded-lg text-apex-muted hover:text-apex-lime hover:bg-apex-lime/10 transition-colors">
              <Pencil size={15} />
            </button>
            <button onClick={() => onDelete(trabajo.id)} title="Eliminar" className="p-2 rounded-lg text-apex-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 size={15} />
            </button>
            <button onClick={() => setExpanded(e => !e)} className="p-2 rounded-lg text-apex-muted hover:text-white transition-colors">
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar (cuotas only) */}
      {trabajo.tipo === 'cuotas' && total > 0 && (
        <div className="px-5 pb-3">
          <div className="h-1.5 bg-apex-card rounded-full overflow-hidden">
            <div
              className="h-full bg-apex-lime rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-apex-muted font-mono">Cobrado: {fmt(cobradoTotal, trabajo.moneda)}</span>
            <span className="text-[10px] text-apex-muted font-mono">{pct}%</span>
          </div>
        </div>
      )}

      {/* Cuotas table */}
      {expanded && (
        <div className="border-t border-apex-border">
          {trabajo.cuotas.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-apex-border/50">
                    <th className="px-4 py-2.5 text-[11px] font-mono text-apex-muted uppercase tracking-wider">#</th>
                    <th className="px-4 py-2.5 text-[11px] font-mono text-apex-muted uppercase tracking-wider">Valor</th>
                    <th className="px-4 py-2.5 text-[11px] font-mono text-apex-muted uppercase tracking-wider">Vencimiento</th>
                    <th className="px-4 py-2.5 text-[11px] font-mono text-apex-muted uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-2.5 text-[11px] font-mono text-apex-muted uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {trabajo.cuotas.map(c => (
                    <CuotaRow
                      key={c.id}
                      cuota={c}
                      moneda={trabajo.moneda}
                      onTogglePago={onToggleCuota}
                      onEdit={onEditCuota}
                      onDelete={onDeleteCuota}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-6 text-center text-sm text-apex-muted">
              Sin cuotas registradas
            </div>
          )}

          <div className="px-5 py-3 border-t border-apex-border/50">
            <button
              onClick={() => onAddCuota(trabajo)}
              className="flex items-center gap-2 text-xs text-apex-muted hover:text-apex-lime transition-colors font-medium"
            >
              <Plus size={13} /> Agregar cuota manual
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function total_label(t: Trabajo) {
  return t.total_cuotas ?? t.cuotas.length
}

// ─── AddCuotaModal ────────────────────────────────────────────────────────────

function AddCuotaModal({
  trabajo,
  onSave,
  onClose,
  loading,
}: {
  trabajo: Trabajo
  onSave: (data: { trabajo_id: string; numero_cuota: number; valor: number; fecha_vencimiento: string | null; notas: string }) => void
  onClose: () => void
  loading: boolean
}) {
  const nextNum = trabajo.cuotas.length > 0 ? Math.max(...trabajo.cuotas.map(c => c.numero_cuota)) + 1 : 1
  const [num, setNum] = useState(nextNum)
  const [valor, setValor] = useState(String(trabajo.valor_cuota))
  const [fecha, setFecha] = useState('')
  const [notas, setNotas] = useState('')

  const label = 'block text-xs font-mono text-apex-muted mb-1 uppercase tracking-wider'
  const input = 'w-full bg-apex-card border border-apex-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-apex-muted/50 focus:outline-none focus:border-apex-lime/50 transition-colors'

  return (
    <Modal title={`Agregar cuota — ${trabajo.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>N° cuota</label>
            <input className={input} type="number" min="1" value={num} onChange={e => setNum(parseInt(e.target.value))} />
          </div>
          <div>
            <label className={label}>Valor ({trabajo.moneda})</label>
            <input className={input} type="number" min="0" value={valor} onChange={e => setValor(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label}>Fecha vencimiento</label>
            <input className={input} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label}>Notas</label>
            <input className={input} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional..." />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-apex-border text-apex-muted hover:text-white text-sm transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ trabajo_id: trabajo.id, numero_cuota: num, valor: parseFloat(valor), fecha_vencimiento: fecha || null, notas })}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-apex-lime text-apex-black font-semibold text-sm hover:bg-apex-lime-hover disabled:opacity-40 transition-colors"
          >
            {loading ? 'Guardando...' : 'Agregar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TrabajosPage() {
  const [trabajos, setTrabajos] = useState<Trabajo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modal states
  const [showAdd, setShowAdd] = useState(false)
  const [editTrabajo, setEditTrabajo] = useState<Trabajo | null>(null)
  const [editCuota, setEditCuota] = useState<Cuota | null>(null)
  const [editCuotaTrabajo, setEditCuotaTrabajo] = useState<Trabajo | null>(null)
  const [addCuotaTrabajo, setAddCuotaTrabajo] = useState<Trabajo | null>(null)

  const { year, month } = currentMonth()

  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/trabajos')
    const data = await res.json()
    setTrabajos(data.trabajos ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Stats
  const allCuotas = trabajos.flatMap(t => t.cuotas)
  const cuotasEsteMes = allCuotas.filter(c => isThisMonth(c.fecha_vencimiento, year, month))
  const totalMes = cuotasEsteMes.reduce((s, c) => s + c.valor, 0)
  const cobradoMes = cuotasEsteMes.filter(c => c.pagado).reduce((s, c) => s + c.valor, 0)
  const pendienteMes = totalMes - cobradoMes
  const trabajosActivos = trabajos.filter(t => t.activo).length

  // ── CRUD handlers ──

  async function handleSaveTrabajo(form: TrabajoForm) {
    setSaving(true)
    if (editTrabajo) {
      await fetch(`/api/trabajos/${editTrabajo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, activo: editTrabajo.activo }),
      })
      setEditTrabajo(null)
    } else {
      await fetch('/api/trabajos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setShowAdd(false)
    }
    setSaving(false)
    load()
  }

  async function handleDeleteTrabajo(id: string) {
    if (!confirm('¿Eliminar este trabajo y todas sus cuotas?')) return
    await fetch(`/api/trabajos/${id}`, { method: 'DELETE' })
    load()
  }

  async function handleToggleCuota(cuota: Cuota) {
    await fetch(`/api/cuotas/${cuota.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cuota, pagado: !cuota.pagado }),
    })
    load()
  }

  async function handleSaveEditCuota(data: Partial<Cuota>) {
    if (!editCuota) return
    setSaving(true)
    await fetch(`/api/cuotas/${editCuota.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editCuota, ...data }),
    })
    setEditCuota(null)
    setEditCuotaTrabajo(null)
    setSaving(false)
    load()
  }

  async function handleDeleteCuota(id: string) {
    if (!confirm('¿Eliminar esta cuota?')) return
    await fetch(`/api/cuotas/${id}`, { method: 'DELETE' })
    load()
  }

  async function handleAddCuota(data: { trabajo_id: string; numero_cuota: number; valor: number; fecha_vencimiento: string | null; notas: string }) {
    setSaving(true)
    await fetch('/api/cuotas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setAddCuotaTrabajo(null)
    setSaving(false)
    load()
  }

  // ── UI ──

  return (
    <div className="min-h-screen bg-apex-black p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-syne font-bold text-2xl text-white tracking-tight">Trabajos</h1>
          <p className="text-sm text-apex-muted mt-1">Control de contratos, cuotas y cobros</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-apex-lime text-apex-black font-semibold text-sm rounded-xl hover:bg-apex-lime-hover transition-colors shadow-lg shadow-apex-lime/10"
        >
          <Plus size={16} />
          Nuevo trabajo
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<CalendarDays size={18} className="text-apex-lime" />}
          label={`Total ${MONTH_NAMES[month]}`}
          value={fmt(totalMes, 'ARS')}
          sub={`${cuotasEsteMes.length} cuotas`}
        />
        <StatCard
          icon={<Check size={18} className="text-emerald-400" />}
          label="Cobrado este mes"
          value={fmt(cobradoMes, 'ARS')}
          sub={`${cuotasEsteMes.filter(c => c.pagado).length} cuotas`}
          highlight="emerald"
        />
        <StatCard
          icon={<Clock size={18} className="text-amber-400" />}
          label="Pendiente este mes"
          value={fmt(pendienteMes, 'ARS')}
          sub={`${cuotasEsteMes.filter(c => !c.pagado).length} cuotas`}
          highlight="amber"
        />
        <StatCard
          icon={<Briefcase size={18} className="text-blue-400" />}
          label="Trabajos activos"
          value={String(trabajosActivos)}
          sub={`${trabajos.length} total`}
          highlight="blue"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="h-40 bg-apex-dark border border-apex-border rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : trabajos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-apex-lime/10 border border-apex-lime/20 flex items-center justify-center mb-4">
            <Briefcase size={28} className="text-apex-lime" />
          </div>
          <h2 className="font-syne font-bold text-xl text-white mb-2">Sin trabajos aún</h2>
          <p className="text-apex-muted text-sm max-w-xs">Agregá tu primer trabajo para empezar a trackear cuotas y cobros.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-6 flex items-center gap-2 px-6 py-3 bg-apex-lime text-apex-black font-semibold rounded-xl hover:bg-apex-lime-hover transition-colors"
          >
            <Plus size={16} /> Agregar primer trabajo
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {trabajos.map(t => (
            <TrabajoCard
              key={t.id}
              trabajo={t}
              onEdit={setEditTrabajo}
              onDelete={handleDeleteTrabajo}
              onToggleCuota={handleToggleCuota}
              onEditCuota={(c) => { setEditCuota(c); setEditCuotaTrabajo(t) }}
              onDeleteCuota={handleDeleteCuota}
              onAddCuota={setAddCuotaTrabajo}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <TrabajoFormModal
          initial={EMPTY_FORM}
          onSave={handleSaveTrabajo}
          onClose={() => setShowAdd(false)}
          loading={saving}
        />
      )}
      {editTrabajo && (
        <TrabajoFormModal
          initial={{
            nombre: editTrabajo.nombre,
            cliente: editTrabajo.cliente,
            descripcion: editTrabajo.descripcion,
            tipo: editTrabajo.tipo,
            valor_cuota: editTrabajo.valor_cuota,
            moneda: editTrabajo.moneda,
            total_cuotas: editTrabajo.total_cuotas,
            fecha_inicio: editTrabajo.fecha_inicio,
          }}
          onSave={handleSaveTrabajo}
          onClose={() => setEditTrabajo(null)}
          loading={saving}
        />
      )}
      {editCuota && editCuotaTrabajo && (
        <EditCuotaModal
          cuota={editCuota}
          moneda={editCuotaTrabajo.moneda}
          onSave={handleSaveEditCuota}
          onClose={() => { setEditCuota(null); setEditCuotaTrabajo(null) }}
          loading={saving}
        />
      )}
      {addCuotaTrabajo && (
        <AddCuotaModal
          trabajo={addCuotaTrabajo}
          onSave={handleAddCuota}
          onClose={() => setAddCuotaTrabajo(null)}
          loading={saving}
        />
      )}
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, highlight,
}: {
  icon: ReactNode
  label: string
  value: string
  sub: string
  highlight?: 'emerald' | 'amber' | 'blue'
}) {
  const ring: Record<string, string> = {
    emerald: 'border-emerald-500/20',
    amber:   'border-amber-500/20',
    blue:    'border-blue-500/20',
  }
  return (
    <div className={cn('bg-apex-dark border rounded-xl p-5', highlight ? ring[highlight] : 'border-apex-border')}>
      <div className="flex items-center gap-2 mb-3">{icon}<span className="text-xs font-mono text-apex-muted uppercase tracking-wider">{label}</span></div>
      <div className="font-syne font-bold text-xl text-white">{value}</div>
      <div className="text-xs text-apex-muted mt-1">{sub}</div>
    </div>
  )
}
