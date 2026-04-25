# SESSION-D09 — Admin dashboard read-only

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~2.5h)
> **Prerequisitos:** D08 ✅

---

## Contexto

Lectura: `MASTER-PLAN.md` § 9.2, `ARCHITECTURE.md` § 5 (env vars `ADMIN_EMAILS`).

Manuel necesita ver el sistema funcionando antes de aprobar live. Esta sesión construye un dashboard simple, profesional y server-rendered en `/admin/ig`.

---

## Objetivo

1. Auth básica: cookie sesión Supabase + chequeo `ADMIN_EMAILS` allowlist.
2. Página `/admin/ig` con KPIs, charts (recharts), tablas read-only.
3. Subpáginas: `/admin/ig/sources`, `/admin/ig/templates`, `/admin/ig/leads` (read-only en esta sesión, write en D10).
4. UI clean, mobile-friendly. NO instalar UI library pesada (use Tailwind + componentes simples).
5. SSR donde se pueda, no client-side fetching innecesario.

---

## Paso 1 — Branch + deps

```bash
git checkout -b feat/discovery-d09-admin-readonly
pnpm add recharts
```

Si todavía no hay Tailwind config: probablemente sí. Confirmar `tailwind.config.ts`.

Agregar a `lib/ig/config.ts`:
```typescript
ADMIN_EMAILS: z.string().default('manunv97@gmail.com').transform(s => s.split(',').map(x => x.trim().toLowerCase())),
```

---

## Paso 2 — Auth helper

`apex-leads/src/lib/admin/auth.ts`:

```typescript
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'

export async function requireAdmin() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) redirect('/admin/login')
  if (!igConfig.ADMIN_EMAILS.includes(user.email.toLowerCase())) redirect('/admin/forbidden')
  return user
}
```

Si no hay un `/admin/login` ya, crear uno simple con magic link Supabase:
```typescript
// /admin/login/page.tsx — form con email, llama supabase.auth.signInWithOtp()
```

(Si Manuel no quiere setup auth completo, fallback a header secret: `x-admin-token` env var. Decidir en sesión según preferencia.)

---

## Paso 3 — Layout

`apex-leads/src/app/admin/ig/layout.tsx`:

```tsx
import { requireAdmin } from '@/lib/admin/auth'
import Link from 'next/link'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex gap-6">
        <Link href="/admin/ig" className="font-bold">Discovery</Link>
        <Link href="/admin/ig/sources">Sources</Link>
        <Link href="/admin/ig/templates">Templates</Link>
        <Link href="/admin/ig/leads">Leads</Link>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}
```

---

## Paso 4 — Dashboard principal

`apex-leads/src/app/admin/ig/page.tsx`:

```tsx
import { createSupabaseServer } from '@/lib/supabase-server'
import { getKpiSnapshot, getDailyMetrics, getLeadFunnel } from '@/lib/ig/metrics/queries'
import { KpiCard } from './_components/KpiCard'
import { SourceChart } from './_components/SourceChart'
import { FunnelTable } from './_components/FunnelTable'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = createSupabaseServer()
  const [kpi, daily, funnel] = await Promise.all([
    getKpiSnapshot(supabase),
    getDailyMetrics(supabase, 30),
    getLeadFunnel(supabase),
  ])
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Reply Rate (7d)" value={`${kpi.replyRate7d}%`} target="≥ 8%" tone={kpi.replyRate7d >= 8 ? 'good' : 'warn'} />
        <KpiCard label="Qualified Rate (30d)" value={`${kpi.qualifiedRate30d}%`} target="≥ 25%" tone={kpi.qualifiedRate30d >= 25 ? 'good' : 'warn'} />
        <KpiCard label="DMs Today" value={kpi.dmsToday} />
        <KpiCard label="Pipeline Health (7d)" value={`${kpi.pipelineHealth}%`} target="≥ 95%" tone={kpi.pipelineHealth >= 95 ? 'good' : 'warn'} />
      </div>
      <section><h2 className="text-xl font-semibold mb-2">Discovery por fuente (30d)</h2><SourceChart data={daily} /></section>
      <section><h2 className="text-xl font-semibold mb-2">Lead Funnel</h2><FunnelTable data={funnel} /></section>
    </div>
  )
}
```

Componentes en `_components/`:

- `KpiCard.tsx` — server component, props simples.
- `SourceChart.tsx` — `'use client'`, `<ResponsiveContainer><AreaChart>...</AreaChart></ResponsiveContainer>` con stacked area por source_kind.
- `FunnelTable.tsx` — server component, tabla simple con %.

---

## Paso 5 — Subpáginas read-only

### `/admin/ig/sources/page.tsx`
Tabla de `discovery_sources` con columnas: kind, ref, schedule, priority, active, last_run, leads_30d.

### `/admin/ig/templates/page.tsx`
Tabla de `dm_template_stats` con columnas: name, status, sends, replies, ctr_pct + Beta CI (calcular en el cliente con beta-distribution o aproximación: `mean ± 1.96 * sqrt(α*β / ((α+β)^2 * (α+β+1)))`).

### `/admin/ig/leads/page.tsx`
Tabla paginada (50/page) de `instagram_leads` ordenada por `created_at DESC`. Columnas: ig_username (link a https://instagram.com/<u>), niche, score, status, last_dm_sent_at, replied_at.
Filtros: niche dropdown, status dropdown, score range.
Server-side pagination con `?page=N`.

---

## Paso 6 — Estilos

Tailwind utility-first. Mantener visual: cards con `rounded-2xl border bg-white shadow-sm p-4`, números grandes `text-3xl font-bold`. Tone colors: good=green, warn=amber, bad=red.

Paleta minimal (gray-900 / gray-50 / blue-600 accent). Mobile: cards stack en 1 col.

---

## Paso 7 — Tests

- E2E con Playwright (D13 los formaliza, acá solo smoke):
  - Login redirect funciona
  - Allowlist filter
  - Dashboard renderiza con KPIs > 0 (mock data en CI)

Por ahora: tests unitarios de helpers (KpiCard tone logic).

---

## Paso 8 — Smoke

Deploy, login con `manunv97@gmail.com`, navegar las 4 páginas, verificar que cargan sin error y muestran datos reales.

Probar acceso con email no-allowed → redirect a `/admin/forbidden`.

---

## Criterios de éxito

1. ✅ `/admin/ig` carga con KPIs reales.
2. ✅ Auth bloquea no-admins.
3. ✅ Charts renderizan con datos.
4. ✅ Tablas muestran rows con paginación y filtros.
5. ✅ Mobile responsive.

---

## Cierre

- Update PROGRESS D09 → ✅
- PR
