'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function NewTemplateForm() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  const submit = () => start(async () => {
    setErr(null)
    const vars = Array.from(body.matchAll(/\{([^|}]+)\}/g)).map((m) => m[1])
    const res = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, body, variables: [...new Set(vars)], notes }),
    })
    const json = await res.json()
    if (!json.ok) { setErr(json.error ?? 'Error'); return }
    setOpen(false); setName(''); setBody(''); setNotes(''); router.refresh()
  })

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="text-xs font-mono px-3 py-1.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-950 transition-colors">
      + New template
    </button>
  )

  return (
    <div className="bg-apex-card border border-apex-border rounded-xl p-5 space-y-4 max-w-2xl">
      <h2 className="font-semibold text-sm text-white">Nuevo template (draft)</h2>
      <div className="space-y-1">
        <label className="text-xs text-apex-muted">Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="opener_v6_nuevo"
          className="w-full bg-apex-bg border border-apex-border rounded px-3 py-1.5 text-sm font-mono text-white placeholder:text-apex-muted focus:outline-none focus:border-zinc-500" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-apex-muted">{'Cuerpo — usar {first_name} para variables'}</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Hola {first_name}, ..."
          className="w-full bg-apex-bg border border-apex-border rounded px-3 py-1.5 text-sm text-white placeholder:text-apex-muted focus:outline-none focus:border-zinc-500 resize-none font-mono" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-apex-muted">Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto..."
          className="w-full bg-apex-bg border border-apex-border rounded px-3 py-1.5 text-sm text-white placeholder:text-apex-muted focus:outline-none focus:border-zinc-500" />
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending || !name.trim() || !body.trim()}
          className="text-xs font-mono px-3 py-1.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-950 transition-colors disabled:opacity-50">
          {pending ? 'Creando...' : 'Crear draft'}
        </button>
        <button onClick={() => setOpen(false)}
          className="text-xs font-mono px-3 py-1.5 rounded border border-apex-border text-apex-muted hover:bg-white/[0.03] transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  )
}
