# SESSION-D11 — A/B testing de templates (Thompson sampling)

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión (~2h)
> **Prerequisitos:** D01–D10 ✅

---

## Contexto

Lee `docs/discovery/PROGRESS.md` y `docs/discovery/MASTER-PLAN.md` § 8 antes de arrancar.

Hoy todos los DMs salen de templates hardcodeados en `apex-leads/src/lib/ig/prompts/templates.ts`.
Esta sesión:

1. Seedea `dm_templates` con 5 variantes en Supabase.
2. Implementa `lib/ig/templates/selector.ts` con Thompson sampling (Beta, Gamma puro — sin deps externas).
3. Reemplaza `pickOpeningTemplate` en `run-cycle`.
4. Loggea cada send en `dm_template_assignments`.
5. Hook en `ig-poll-inbox` para marcar `replied_at` en assignments.
6. Cron diario `auto-pause-templates` que pausa templates dominados.
7. UI admin: form para crear templates, fix del bug `content`→`body` en PATCH.

**Commits van directamente a `main`. Sin branches.**

**Plan detallado:** `docs/superpowers/plans/2026-04-25-d11-ab-testing.md`

---

## Paso 1 — Seed `dm_templates`

Aplicar via MCP Supabase (`execute_sql`, project `hpbxscfbnhspeckdmkvu`):

```sql
INSERT INTO dm_templates (name, body, variables, status, notes) VALUES
(
  'opener_v1_directo',
  'Hola {first_name}! Vi tu cuenta y me copó lo que hacés. Trabajamos con boutiques argentinas armando su web propia (mirá moda.theapexweb.com). Te interesa que te muestre algo similar para vos?',
  ARRAY['first_name'],
  'active',
  'baseline — directo al punto'
),
(
  'opener_v2_pregunta',
  'Hola {first_name}, ya tenés sitio web propio para vender por fuera de IG? Si tu negocio crece, IG solo limita. Acá una demo hecha para una boutique: moda.theapexweb.com',
  ARRAY['first_name'],
  'active',
  'pregunta abierta — desafía el status quo'
),
(
  'opener_v3_curioso',
  'Che {first_name}, soy de The Apex Web — armamos sitios para boutiques. Vi tu IG y me dio curiosidad: vendés solo por DM o tenés tienda online?',
  ARRAY['first_name'],
  'active',
  'curioso conversacional — baja la guardia'
),
(
  'opener_v4_valor',
  'Hola {first_name}! Estamos ayudando a marcas como la tuya a no perder ventas por DMs no respondidos o links muertos en bio. Si querés ver cómo lo hicimos para una boutique, te paso el caso.',
  ARRAY['first_name'],
  'active',
  'pitch valor concreto — urgencia'
),
(
  'opener_v5_corto',
  'Hola {first_name}, vi tu cuenta y me copó. Armamos sitios para boutiques: moda.theapexweb.com. Querés que te tire una idea para tu marca?',
  ARRAY['first_name'],
  'active',
  'cortísimo — menor fricción'
)
ON CONFLICT DO NOTHING;
```

Verificar: `SELECT id, name, status FROM dm_templates ORDER BY created_at;` → 5 rows activas.

Commit: `feat(discovery): D11 seed dm_templates (5 variantes)`

---

## Paso 2 — `lib/ig/templates/selector.ts`

### Tests primero (TDD)

`apex-leads/src/lib/ig/templates/__tests__/selector.test.ts`:

```typescript
import { sampleBeta, thompsonPick, renderTemplate, type TemplateStat, type Template } from '../selector'

describe('sampleBeta', () => {
  it('returns 0–1', () => {
    for (let i = 0; i < 100; i++) {
      const v = sampleBeta(2, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
  it('Beta(1,1) mean ~0.5', () => {
    let sum = 0
    for (let i = 0; i < 5000; i++) sum += sampleBeta(1, 1)
    expect(sum / 5000).toBeCloseTo(0.5, 1)
  })
})

describe('thompsonPick', () => {
  it('throws on empty', () => {
    expect(() => thompsonPick([])).toThrow('no active templates')
  })
  it('favors higher CTR template (>70% of 1000 picks)', () => {
    const stats: TemplateStat[] = [
      { template_id: 'A', name: 'A', status: 'active', sends: 30, replies: 9, ctr_pct: 30, beta_alpha: 10, beta_beta: 22 },
      { template_id: 'B', name: 'B', status: 'active', sends: 5, replies: 0, ctr_pct: 0, beta_alpha: 1, beta_beta: 6 },
    ]
    const wins = Array.from({ length: 1000 }).filter(() => thompsonPick(stats).template_id === 'A').length
    expect(wins).toBeGreaterThan(700)
  })
  it('both templates get chances when equal priors', () => {
    const stats: TemplateStat[] = [
      { template_id: 'X', name: 'X', status: 'active', sends: 0, replies: 0, ctr_pct: 0, beta_alpha: 1, beta_beta: 1 },
      { template_id: 'Y', name: 'Y', status: 'active', sends: 0, replies: 0, ctr_pct: 0, beta_alpha: 1, beta_beta: 1 },
    ]
    const xWins = Array.from({ length: 1000 }).filter(() => thompsonPick(stats).template_id === 'X').length
    expect(xWins).toBeGreaterThan(300)
    expect(xWins).toBeLessThan(700)
  })
})

describe('renderTemplate', () => {
  const tpl: Template = {
    id: 'abc', name: 'test',
    body: 'Hola {first_name}, rubro {niche}.',
    variables: ['first_name', 'niche'], status: 'active',
  }
  it('substitutes vars', () => {
    expect(renderTemplate(tpl, { first_name: 'Ana', niche: 'moda' })).toBe('Hola Ana, rubro moda.')
  })
  it('missing var → empty string', () => {
    expect(renderTemplate(tpl, { first_name: 'Ana' })).toBe('Hola Ana, rubro .')
  })
})
```

Correr: `npx jest src/lib/ig/templates/__tests__/selector.test.ts --no-coverage` → FAIL esperado.

### Implementación

`apex-leads/src/lib/ig/templates/selector.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Template {
  id: string; name: string; body: string; variables: string[]; status: string
}

export interface TemplateStat {
  template_id: string; name: string; status: string
  sends: number; replies: number; ctr_pct: number
  beta_alpha: number; beta_beta: number
}

// Gamma sampler (Marsaglia-Tsang) — no external deps
function normalRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function sampleGamma(shape: number): number {
  if (shape < 1) return sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do { x = normalRandom(); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

export function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha)
  const y = sampleGamma(beta)
  return x / (x + y)
}

export function thompsonPick(stats: TemplateStat[]): TemplateStat {
  if (stats.length === 0) throw new Error('no active templates')
  let best = stats[0]; let bestSample = -1
  for (const t of stats) {
    const s = sampleBeta(t.beta_alpha, t.beta_beta)
    if (s > bestSample) { bestSample = s; best = t }
  }
  return best
}

export async function pickTemplate(supabase: SupabaseClient): Promise<Template> {
  const { data: stats, error } = await supabase
    .from('dm_template_stats')
    .select('template_id, name, status, sends, replies, ctr_pct, beta_alpha, beta_beta')
    .eq('status', 'active')
  if (error) throw new Error(`pickTemplate: ${error.message}`)
  if (!stats?.length) throw new Error('pickTemplate: no active templates')

  const winner = thompsonPick(stats as TemplateStat[])
  const { data: tpl, error: e } = await supabase
    .from('dm_templates').select('id, name, body, variables, status')
    .eq('id', winner.template_id).single()
  if (e || !tpl) throw new Error(`pickTemplate: body fetch failed — ${e?.message}`)
  return tpl as Template
}

export function renderTemplate(tpl: Template, vars: Record<string, string>): string {
  let out = tpl.body
  for (const v of tpl.variables) out = out.replaceAll(`{${v}}`, vars[v] ?? '')
  return out
}
```

Correr tests → todos verdes.

Commit: `feat(discovery): D11 Thompson sampling selector (pure JS)`

---

## Paso 3 — Integrar en run-cycle

En `apex-leads/src/app/api/ig/run-cycle/route.ts`:

**Cambio de import:**
- Eliminar: `import { pickOpeningTemplate } from '@/lib/ig/prompts/templates'`
- Agregar: `import { pickTemplate, renderTemplate } from '@/lib/ig/templates/selector'`

**`pickOpeningTemplate(profile)` ya está en línea 301, ANTES del `if (dryRun)` en línea 303.**
Reemplazar esa línea única:

```typescript
// ANTES:
const dmText = pickOpeningTemplate(profile)

// DESPUÉS:
const template = await pickTemplate(supabase)
const firstName = (profile.full_name ?? profile.ig_username ?? '').split(' ')[0] || (profile.ig_username ?? '')
const dmText = renderTemplate(template, {
  first_name: firstName,
  niche: cls.niche.replaceAll('_', ' '),
})
```

El `if (dryRun)` ya usa `dmText` — no hay que tocarlo más que actualizar el log para incluir `template.name`:
```typescript
console.log(`[run-cycle][DRY_RUN] @${username} template=${template.name}: ${dmText.slice(0, 80)}...`)
```

**Después del `instagram_conversations` insert, agregar assignment:**

```typescript
// Log template assignment
if (leadRow?.id) {
  await supabase.from('dm_template_assignments').insert({
    lead_id: leadRow.id,
    template_id: template.id,
    sent_at: now,
  })
}
```

**En el upsert de `instagram_leads`** (el del send exitoso), agregar `template_id: template.id`.

Verificar con `npx tsc --noEmit`.

Commit: `feat(discovery): D11 run-cycle usa pickTemplate + dm_template_assignments`

---

## Paso 3b — Integrar en ig-send-pending (legacy queue-based sender)

`apex-leads/src/app/api/cron/ig-send-pending/route.ts` también llama `pickOpeningTemplate` en líneas 123 y 140 (fallback). Este cron usa `dm_queue` (pipeline legacy), a diferencia de `run-cycle` que usa discovery v2. Actualizar para usar `pickTemplate`:

**Cambio de import** (misma línea a reemplazar):
- Eliminar: `import { pickOpeningTemplate } from '@/lib/ig/prompts/templates'`
- Agregar: `import { pickTemplate, renderTemplate, type Template } from '@/lib/ig/templates/selector'`

**Bloque principal (línea ~118):** Reemplazar la lógica de template:

```typescript
// ANTES:
const template = pickOpeningTemplate(lead)
const completion = await anthropic.messages.create({
  ...
  content: `... Usá esta plantilla como base ... ${template} ...`
})
messageText = completion.content[0].type === 'text' ? completion.content[0].text.trim() : template
```

```typescript
// DESPUÉS:
let pickedTemplate: Template
try {
  pickedTemplate = await pickTemplate(supabase)
} catch (err) {
  console.error('[ig-send-pending] pickTemplate failed', err)
  return NextResponse.json({ ok: false, error: 'no_active_templates' }, { status: 503 })
}
const firstName = (lead.full_name ?? lead.ig_username ?? '').split(' ')[0] || (lead.ig_username ?? '')
const templateText = renderTemplate(pickedTemplate, { first_name: firstName })

const completion = await anthropic.messages.create({
  ...
  content: `... Usá esta plantilla como base (podés adaptarla levemente para que suene natural):\n${templateText}\n\nDevolvé ÚNICAMENTE el texto del mensaje, sin comillas ni explicaciones.`,
})
messageText = completion.content[0].type === 'text' ? completion.content[0].text.trim() : templateText
```

**Fallback en catch (línea ~140):** Reemplazar `pickOpeningTemplate(lead)` por `templateText` (ya disponible en el scope).

**Agregar `dm_template_assignments` insert** después del `Promise.all` de "Record everything in parallel" (si `lead.id` existe):
```typescript
await supabase.from('dm_template_assignments').insert({
  lead_id: lead.id,
  template_id: pickedTemplate.id,
  sent_at: now,
})
```

Commit: `feat(discovery): D11 ig-send-pending usa pickTemplate + dm_template_assignments`

---

## Paso 4 — Reply detection en ig-poll-inbox

En `apex-leads/src/app/api/cron/ig-poll-inbox/route.ts`:

**Cambiar query del lead** para incluir `template_id, replied_at`:
```typescript
.select('id, status, reply_count, template_id, replied_at')
```

**Después del `instagram_leads` update block**, agregar:
```typescript
// Mark assignment replied (first reply only)
// dm_template_assignments has: replied (boolean), replied_at (timestamp), reply_was_positive (boolean)
if (lead.template_id && !lead.replied_at) {
  const replyTs = new Date(msg.timestamp * 1000).toISOString()
  await supabase
    .from('dm_template_assignments')
    .update({ replied: true, replied_at: replyTs, reply_was_positive: true })
    .eq('lead_id', lead.id)
    .eq('replied', false)   // idempotent — solo el primer reply

  await supabase
    .from('instagram_leads')
    .update({ replied_at: replyTs })
    .eq('id', lead.id)
}
```

Commit: `feat(discovery): D11 inbox poller marca dm_template_assignments replied+replied_at`

---

## Paso 5 — Auto-pause cron

### Tests primero

`apex-leads/src/app/api/cron/auto-pause-templates/__tests__/auto-pause.test.ts`:

```typescript
import { betaCI95, findTemplatesToPause } from '../route'

describe('betaCI95', () => {
  it('Beta(2,2) mean 0.5 symmetric', () => {
    const { lo, hi, mean } = betaCI95(2, 2)
    expect(mean).toBeCloseTo(0.5)
    expect(hi - mean).toBeCloseTo(mean - lo, 2)
  })
})

describe('findTemplatesToPause', () => {
  it('returns empty with 1 eligible template', () => {
    expect(findTemplatesToPause([
      { template_id: 'A', name: 'A', status: 'active', sends: 200, replies: 40, beta_alpha: 41, beta_beta: 161 },
    ])).toEqual([])
  })

  it('pauses clearly dominated template (B dominated by C)', () => {
    // C: mean 0.30, lo ~0.21. B: mean 0.04, hi ~0.07 → hi_B < lo_C → pause B
    const stats = [
      { template_id: 'A', name: 'A', status: 'active', sends: 200, replies: 40, beta_alpha: 41, beta_beta: 161 },
      { template_id: 'B', name: 'B', status: 'active', sends: 150, replies: 5, beta_alpha: 6, beta_beta: 146 },
      { template_id: 'C', name: 'C', status: 'active', sends: 100, replies: 30, beta_alpha: 31, beta_beta: 71 },
    ]
    expect(findTemplatesToPause(stats)).toContain('B')
    expect(findTemplatesToPause(stats)).not.toContain('C')
  })

  it('skips templates with < 100 sends', () => {
    const stats = [
      { template_id: 'A', name: 'A', status: 'active', sends: 99, replies: 0, beta_alpha: 1, beta_beta: 100 },
      { template_id: 'B', name: 'B', status: 'active', sends: 99, replies: 50, beta_alpha: 51, beta_beta: 50 },
    ]
    expect(findTemplatesToPause(stats)).toEqual([])
  })

  it('ignores already-paused templates', () => {
    const stats = [
      { template_id: 'A', name: 'A', status: 'paused', sends: 200, replies: 0, beta_alpha: 1, beta_beta: 201 },
      { template_id: 'B', name: 'B', status: 'active', sends: 200, replies: 100, beta_alpha: 101, beta_beta: 101 },
    ]
    expect(findTemplatesToPause(stats)).toEqual([])
  })
})
```

### Implementación

`apex-leads/src/app/api/cron/auto-pause-templates/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { sendAlert } from '@/lib/ig/alerts/discord'

export const dynamic = 'force-dynamic'

const MIN_SENDS = 100

interface TemplateStat {
  template_id: string; name: string; status: string
  sends: number; replies: number; beta_alpha: number; beta_beta: number
}

export function betaCI95(alpha: number, beta: number): { lo: number; hi: number; mean: number } {
  const mean = alpha / (alpha + beta)
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1))
  const sd = Math.sqrt(variance)
  return { lo: Math.max(0, mean - 1.96 * sd), hi: Math.min(1, mean + 1.96 * sd), mean }
}

export function findTemplatesToPause(stats: TemplateStat[]): string[] {
  const eligible = stats.filter((t) => t.status === 'active' && t.sends >= MIN_SENDS)
  if (eligible.length < 2) return []
  const cis = eligible.map((t) => ({ ...t, ci: betaCI95(t.beta_alpha, t.beta_beta) }))
  const best = cis.reduce((a, b) => (a.ci.mean > b.ci.mean ? a : b))
  return cis
    .filter((t) => t.template_id !== best.template_id && t.ci.hi < best.ci.lo)
    .map((t) => t.template_id)
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createSupabaseServer()
  const { data: stats, error } = await supabase
    .from('dm_template_stats')
    .select('template_id, name, status, sends, replies, beta_alpha, beta_beta')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const toPause = findTemplatesToPause((stats ?? []) as TemplateStat[])
  const paused: string[] = []

  for (const templateId of toPause) {
    const stat = (stats ?? []).find((t: TemplateStat) => t.template_id === templateId)
    const { error: e } = await supabase.from('dm_templates').update({ status: 'paused' }).eq('id', templateId)
    if (!e) {
      paused.push(templateId)
      if (stat) {
        sendAlert(supabase, 'info', 'templates',
          `Auto-paused "${stat.name}" (CTR dominated — hi < best lo)`,
          { template_id: templateId, sends: stat.sends, replies: stat.replies },
        ).catch((err) => console.error('[auto-pause] alert failed', err))
      }
    }
  }

  return NextResponse.json({ ok: true, evaluated: (stats ?? []).length, paused })
}
```

Agregar en `apex-leads/vercel.json` dentro de `"crons"`:
```json
{ "path": "/api/cron/auto-pause-templates", "schedule": "0 6 * * *" }
```

Correr `npx jest src/app/api/cron/auto-pause-templates --no-coverage` → todos verdes.

Commit: `feat(discovery): D11 auto-pause-templates cron + tests`

---

## Paso 6 — Admin UI

### 6a — Fix bug PATCH `content`→`body`

En `apex-leads/src/app/api/admin/templates/[id]/route.ts`:

Reemplazar:
```typescript
const allowed = ['status', 'name', 'content']
const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))
```

Con:
```typescript
const allowed = ['status', 'name', 'body']
const normalized = body.content !== undefined && body.body === undefined
  ? { ...body, body: body.content }
  : body
const update = Object.fromEntries(Object.entries(normalized).filter(([k]) => allowed.includes(k)))
```

### 6b — POST create endpoint

Crear `apex-leads/src/app/api/admin/templates/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError

  let body: { name?: string; body?: string; variables?: string[]; notes?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 })

  const supabase = createSupabaseServer()
  const { data, error } = await supabase
    .from('dm_templates')
    .insert({ name: body.name.trim(), body: body.body.trim(), variables: body.variables ?? [], notes: body.notes?.trim() ?? null, status: 'draft' })
    .select('id').single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  revalidatePath('/admin/ig/templates')
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
```

### 6c — NewTemplateForm component

Crear `apex-leads/src/app/admin/ig/_components/NewTemplateForm.tsx`:

```typescript
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
        <label className="text-xs text-apex-muted">Cuerpo — usar <code className="text-amber-400">{'{first_name}'}</code> para variables</label>
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
```

### 6d — Actualizar templates/page.tsx

Agregar import y componente entre el header y la tabla:

```typescript
import { NewTemplateForm } from '../_components/NewTemplateForm'
// ...
<div>
  <h1 ...>DM Templates</h1>
  <p ...>{rows.length} templates</p>
</div>

<NewTemplateForm />

<div className="bg-apex-card border ...">
```

Verificar `npx tsc --noEmit` sin errores.

Commit: `feat(discovery): D11 admin create template + fix PATCH content→body`

---

## Paso 6b — Regenerar tipos TypeScript de Supabase

La vista `dm_template_stats` no está en `apex-leads/src/types/supabase.ts` (es una VIEW, no una tabla base). Regenerar los tipos vía MCP Supabase para incluirla:

```
mcp__claude_ai_Supabase__generate_typescript_types  (project hpbxscfbnhspeckdmkvu)
```

Copiar el output generado a `apex-leads/src/types/supabase.ts`. Verificar que `dm_template_assignments.replied` y `dm_template_stats` aparezcan.

Commit: `chore: regenerar tipos Supabase post-D11`

---

## Paso 7 — Tests y cierre

```bash
cd apex-leads && npx jest --no-coverage 2>&1 | tail -20
```

Esperado: todos los tests pasan (47 existentes + ~10 nuevos).

Actualizar `docs/discovery/PROGRESS.md`:
- D11 Status: `✅ done — 2026-04-25`
- Branch: `main`
- Output: resumir lo implementado

Commit final: `feat(discovery): D11 done — A/B testing Thompson sampling`

---

## Criterios de éxito

1. `SELECT count(*) FROM dm_templates WHERE status='active'` → 5
2. Tests pasan (incluyendo nuevos de selector y auto-pause)
3. `run-cycle` en DRY_RUN muestra nombres de template distintos en logs
4. `ig-poll-inbox` actualiza `dm_template_assignments.replied_at` cuando detecta respuesta
5. Admin UI permite crear templates nuevos (quedan como draft)
6. `npx tsc --noEmit` sin errores

---

## Notas técnicas importantes

- **Sin branches** — todo en `main`
- **Sin `@stdlib/random-base-beta`** — Gamma sampler puro (Marsaglia-Tsang) en selector.ts
- **`replied: boolean` SÍ existe** — `dm_template_assignments` tiene `replied boolean` (línea 530 de supabase.ts) + `replied_at timestamp`. Setear AMBOS en el update
- **`dm_template_stats` view** (D08) ya computa `beta_alpha = replies + 1`, `beta_beta = (sends - replies) + 1` — el selector solo lee
- **Dry-run path** — `pickOpeningTemplate` ya está en línea 301 (antes del `if (dryRun)` en línea 303). El reemplazo es directo, sin reestructurar el bloque
- **`ig-send-pending`** — legacy cron que también usa `pickOpeningTemplate` (líneas 123, 140). Actualizar en Paso 3b
