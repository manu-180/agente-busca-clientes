'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Plus,
  Save,
  Edit,
  Trash2,
  Sparkles,
  Link2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import type { DemoRubro } from '@/lib/demo-match'

interface TestResult {
  loading: boolean
  score: number | null
  demo: DemoRubro | null
  reason: {
    strongHits: string[]
    weakHits: string[]
    negativeHits: string[]
  } | null
  error?: string
}

const emptyDemo: Partial<DemoRubro> = {
  slug: '',
  rubro_label: '',
  url: '',
  strong_keywords: [],
  weak_keywords: [],
  negative_keywords: [],
  active: true,
  priority: 100,
}

function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function slugifyRubro(rubro: string): string {
  const base = removeDiacritics(rubro)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'demo'
}

function keywordsFromRubro(rubro: string): string[] {
  const cleaned = removeDiacritics(rubro).toLowerCase()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  const result: string[] = []
  const seen = new Set<string>()
  for (const word of parts) {
    if (!seen.has(word)) {
      seen.add(word)
      result.push(word)
    }
    if (word.endsWith('s')) {
      const singular = word.slice(0, -1)
      if (singular.length > 2 && !seen.has(singular)) {
        seen.add(singular)
        result.push(singular)
      }
    }
  }
  return result
}

export default function DemosPage() {
  const [demos, setDemos] = useState<DemoRubro[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<DemoRubro>>(emptyDemo)
  const [saving, setSaving] = useState(false)
  const [testTexto, setTestTexto] = useState('')
  const [testRubro, setTestRubro] = useState('')
  const [testResult, setTestResult] = useState<TestResult>({
    loading: false,
    score: null,
    demo: null,
    reason: null,
  })

  const isEditing = useMemo(() => !!editingId, [editingId])

  const cargar = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/demos')
      const data = await res.json()
      setDemos(Array.isArray(data.demos) ? data.demos : [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setForm(emptyDemo)
  }

  const handleEdit = (demo: DemoRubro) => {
    setEditingId(demo.id)
    setForm({
      ...demo,
    })
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar esta demo?')) return
    await fetch('/api/demos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await cargar()
  }

  const handleSave = async () => {
    if (!form.rubro_label || !form.url) return
    setSaving(true)
    try {
      const rubroLabel = form.rubro_label.trim()
      const url = form.url.trim()
      const slug = (form.slug && form.slug.trim()) || slugifyRubro(rubroLabel)

      let strongKeywords = form.strong_keywords ?? []
      if (!strongKeywords.length) {
        strongKeywords = keywordsFromRubro(rubroLabel)
      }

      const payload = {
        slug,
        rubro_label: rubroLabel,
        url,
        strong_keywords: strongKeywords,
        weak_keywords: form.weak_keywords ?? [],
        negative_keywords: form.negative_keywords ?? [],
        active: form.active ?? true,
        priority: 100,
      }

      const method = isEditing ? 'PUT' : 'POST'
      const body = isEditing ? { id: editingId, ...payload } : payload

      const res = await fetch('/api/demos', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'No se pudo guardar la demo')
      } else {
        resetForm()
        await cargar()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (demo: DemoRubro) => {
    await fetch('/api/demos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: demo.id, active: !demo.active }),
    })
    await cargar()
  }

  const handleTest = async () => {
    setTestResult({ loading: true, score: null, demo: null, reason: null })
    try {
      const res = await fetch('/api/demos/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: testTexto, rubro: testRubro }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResult({
          loading: false,
          score: null,
          demo: null,
          reason: null,
          error: data.error || 'No se pudo probar el matcher',
        })
        return
      }
      setTestResult({
        loading: false,
        score: data.score ?? null,
        demo: data.demo ?? null,
        reason: data.reason ?? null,
      })
    } catch (e) {
      console.error(e)
      setTestResult({
        loading: false,
        score: null,
        demo: null,
        reason: null,
        error: 'Error de conexión',
      })
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Demos por rubro</h1>
          <p className="text-apex-muted text-sm mt-1 font-mono">
            Vinculá demos específicas con rubros para que el agente las ofrezca automáticamente
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetForm()
          }}
          className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm hover:bg-apex-lime-hover transition-colors"
        >
          <Plus size={16} />
          Nueva demo
        </button>
      </div>

      {/* Formulario de creación/edición */}
      <div className="bg-apex-card border border-apex-lime/20 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-apex-lime" />
            <h2 className="font-syne font-semibold text-lg">
              {isEditing ? 'Editar demo' : 'Nueva demo'}
            </h2>
          </div>
          {isEditing && (
            <button
              type="button"
              onClick={resetForm}
              className="text-apex-muted text-xs hover:text-white"
            >
              Cancelar edición
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
              Rubro
            </label>
            <input
              type="text"
              value={form.rubro_label || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, rubro_label: e.target.value }))}
              placeholder="Gimnasios, Tienda de ropa femenina..."
              className="w-full bg-apex-black border border-apex-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
          </div>
          <div>
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block mb-1.5">
              URL demo
            </label>
            <input
              type="text"
              value={form.url || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="https://gym.theapexweb.com"
              className="w-full bg-apex-black border border-apex-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-apex-lime/50"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, active: !(prev.active ?? true) }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                form.active ?? true ? 'bg-apex-lime' : 'bg-apex-border'
              }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  form.active ?? true ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-apex-muted">
              {form.active ?? true ? 'Demo activa' : 'Demo inactiva'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.rubro_label || !form.url}
            className="flex items-center gap-2 bg-apex-lime text-apex-black px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar demo
          </button>
        </div>
      </div>

      {/* Lista de demos */}
      <div className="space-y-3">
        <h2 className="font-syne font-semibold text-lg">Demos configuradas</h2>
        {loading ? (
          <p className="text-sm text-apex-muted">Cargando demos...</p>
        ) : demos.length === 0 ? (
          <p className="text-sm text-apex-muted">
            Todavía no cargaste ninguna demo. Creá la de gimnasios, por ejemplo{' '}
            <span className="text-apex-lime">https://gym.theapexweb.com</span>.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {demos.map((demo) => (
              <div
                key={demo.id}
                className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-syne font-semibold text-base">{demo.rubro_label}</h3>
                    <p className="text-[11px] text-apex-muted font-mono mt-0.5">
                      slug: <span className="text-apex-lime">{demo.slug}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className={`px-2 py-1 rounded-full text-[11px] font-mono ${
                        demo.active
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-apex-border text-apex-muted'
                      }`}
                    >
                      {demo.active ? 'ACTIVA' : 'INACTIVA'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(demo)}
                      className="text-xs text-apex-muted hover:text-white px-1"
                    >
                      toggle
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <Link2 size={14} className="text-apex-muted" />
                  <a
                    href={demo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-apex-lime hover:underline"
                  >
                    {demo.url}
                  </a>
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <p className="text-apex-muted font-mono uppercase tracking-wider">Fuerte</p>
                  <div className="flex flex-wrap gap-1">
                    {demo.strong_keywords?.length
                      ? demo.strong_keywords.map((kw) => (
                          <span
                            key={kw}
                            className="px-2 py-0.5 rounded-full bg-apex-lime/15 text-apex-lime border border-apex-lime/30"
                          >
                            {kw}
                          </span>
                        ))
                      : (
                        <span className="text-apex-muted italic">Sin keywords fuertes</span>
                      )}
                  </div>
                  <p className="text-apex-muted font-mono uppercase tracking-wider mt-2">Débil</p>
                  <div className="flex flex-wrap gap-1">
                    {demo.weak_keywords?.length
                      ? demo.weak_keywords.map((kw) => (
                          <span
                            key={kw}
                            className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30"
                          >
                            {kw}
                          </span>
                        ))
                      : (
                        <span className="text-apex-muted italic">Sin keywords débiles</span>
                      )}
                  </div>
                  <p className="text-apex-muted font-mono uppercase tracking-wider mt-2">
                    Negativas
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {demo.negative_keywords?.length
                      ? demo.negative_keywords.map((kw) => (
                          <span
                            key={kw}
                            className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/30"
                          >
                            {kw}
                          </span>
                        ))
                      : (
                        <span className="text-apex-muted italic">Sin negativas</span>
                      )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(demo)}
                    className="flex items-center gap-1.5 text-xs text-apex-muted hover:text-white"
                  >
                    <Edit size={12} />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(demo.id)}
                    className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test rápido */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <h2 className="font-syne font-semibold text-lg">Test rápido de matching</h2>
        <p className="text-sm text-apex-muted">
          Pegá un mensaje real del cliente y probá qué demo se ofrecería. Si no hay match fuerte,
          el sistema no ofrecerá ninguna demo.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[2fr,1fr] gap-4">
          <div className="space-y-2">
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block">
              Texto del cliente (WhatsApp / web)
            </label>
            <textarea
              value={testTexto}
              onChange={(e) => setTestTexto(e.target.value)}
              rows={3}
              className="w-full bg-apex-black border border-apex-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-apex-lime/50 resize-none"
              placeholder="Ej: hola, tengo un gimnasio en Palermo y quiero mejorar la web..."
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block">
              Rubro guardado (opcional)
            </label>
            <input
              type="text"
              value={testRubro}
              onChange={(e) => setTestRubro(e.target.value)}
              className="w-full bg-apex-black border border-apex-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-apex-lime/50"
              placeholder="Ej: Gimnasio"
            />
            <button
              type="button"
              onClick={handleTest}
              disabled={testResult.loading || (!testTexto && !testRubro)}
              className="mt-2 inline-flex items-center gap-2 bg-apex-border text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-apex-muted/30 transition-colors disabled:opacity-40"
            >
              {testResult.loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Probando...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Probar matcher
                </>
              )}
            </button>
          </div>
        </div>

        {testResult.error && (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle size={16} />
            <span>{testResult.error}</span>
          </div>
        )}

        {!testResult.error && testResult.score !== null && (
          <div className="mt-2 border border-apex-border rounded-lg p-4 space-y-2">
            {testResult.demo ? (
              <>
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle size={16} />
                  <span>
                    Match fuerte con demo{' '}
                    <span className="font-semibold">{testResult.demo.rubro_label}</span> (slug{' '}
                    <span className="font-mono">{testResult.demo.slug}</span>) — score{' '}
                    <span className="font-mono">{testResult.score}</span>
                  </span>
                </div>
                {testResult.reason && (
                  <div className="text-xs text-apex-muted space-y-1">
                    <p>
                      Strong hits:{' '}
                      {testResult.reason.strongHits.length
                        ? testResult.reason.strongHits.join(', ')
                        : 'ninguno'}
                    </p>
                    <p>
                      Weak hits:{' '}
                      {testResult.reason.weakHits.length
                        ? testResult.reason.weakHits.join(', ')
                        : 'ninguno'}
                    </p>
                    <p>
                      Negative hits:{' '}
                      {testResult.reason.negativeHits.length
                        ? testResult.reason.negativeHits.join(', ')
                        : 'ninguno'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-apex-muted">
                <AlertCircle size={16} />
                <span>
                  Sin match fuerte. El agente <span className="font-semibold">no</span> ofrecería
                  ninguna demo con este texto.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

