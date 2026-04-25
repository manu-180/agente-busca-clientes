# SESSION-D10 — Admin actions + Discord alerts

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~2h)
> **Prerequisitos:** D09 ✅

---

## Contexto

Lectura: `MASTER-PLAN.md` § 9.3, `ARCHITECTURE.md` § 4.10. PROGRESS.md.

D09 dio visibilidad. D10 da control: pause/resume sources, kill templates, blacklist leads, re-classify. Más alertas Discord que avisan a Manuel cuando algo va mal sin que tenga que mirar el dashboard.

---

## Objetivo

1. Endpoints POST autenticados (admin-only) para acciones.
2. Botones en `/admin/ig/*` que llaman estos endpoints.
3. Optimistic UI con `revalidatePath`.
4. `lib/ig/alerts/discord.ts` con `sendAlert(severity, message, meta)`.
5. Hooks de alertas: circuit_open, low_reply_rate, daily_quota_unmet, classify_cost_high.
6. Test del webhook Discord con mensaje real.

---

## Paso 1 — Branch + setup

```bash
git checkout -b feat/discovery-d10-admin-actions
```

Setear env var `DISCORD_ALERT_WEBHOOK` en Vercel (Manuel crea webhook en su server Discord).

Agregar a `lib/ig/config.ts`:
```typescript
DISCORD_ALERT_WEBHOOK: z.string().url().optional(),
```

---

## Paso 2 — Discord helper

`lib/ig/alerts/discord.ts`:

```typescript
type Severity = 'info' | 'warning' | 'critical'

const COLORS = { info: 0x3b82f6, warning: 0xf59e0b, critical: 0xef4444 }

export async function sendAlert(supabase, severity: Severity, source: string, message: string, meta: Record<string, any> = {}) {
  // Persist en DB siempre
  await supabase.from('alerts_log').insert({ severity, source, message, metadata: meta })
  // Discord opcional
  const url = igConfig.DISCORD_ALERT_WEBHOOK
  if (!url) return
  // Dedup: no mandar mismo (severity, source, message) en últimas 1h
  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await supabase.from('alerts_log').select('*', { count: 'exact', head: true })
    .eq('severity', severity).eq('source', source).eq('message', message).gte('triggered_at', since)
  if ((count ?? 0) > 1) return   // ya mandamos, evitar spam

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `[${severity.toUpperCase()}] ${source}`,
        description: message,
        color: COLORS[severity],
        fields: Object.entries(meta).slice(0, 10).map(([k, v]) => ({ name: k, value: String(v).slice(0, 200), inline: true })),
        timestamp: new Date().toISOString(),
      }],
    }),
  }).catch(err => console.error('[discord] send failed', err))
}
```

---

## Paso 3 — Hooks de alertas

### 3a. Circuit open en sidecar (sidecar.ts)
Detectar `SidecarError.isCircuitOpen` en orchestrator y run-cycle → llamar `sendAlert(supabase, 'critical', 'sidecar', 'Circuit breaker open', { error: err.message })`.

### 3b. Low reply rate cron
`/api/cron/check-reply-rate` (scheduled diario 18:00 UTC). Calcula reply_rate 7d. Si <3% AND DMs ≥ 30 en la ventana → alerta warning.

### 3c. Daily quota unmet
Mismo cron: si `dm_daily_quota.dms_sent` ayer < 50% del `DAILY_DM_LIMIT` → alerta info.

### 3d. Classify cost high
En el cost guard de D06 (Paso 8), reemplazar el "log" por `sendAlert(supabase, 'warning', 'cost', 'Daily classify spend > $1', { spend_usd: X })`.

Agregar cron a `vercel.json`:
```json
{ "path": "/api/cron/check-reply-rate", "schedule": "0 18 * * *" }
```

---

## Paso 4 — Endpoints de acciones

`apex-leads/src/app/api/admin/sources/[id]/route.ts` (PATCH):
```typescript
import { requireAdmin } from '@/lib/admin/auth'
import { revalidatePath } from 'next/cache'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin()
  const body = await req.json()  // { active?: boolean, priority?: number, schedule_cron?: string }
  const supabase = createSupabaseServer()
  const { error } = await supabase.from('discovery_sources').update(body).eq('id', params.id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  revalidatePath('/admin/ig/sources')
  return NextResponse.json({ ok: true })
}
```

Idem:
- `POST /api/admin/templates` — crear template
- `PATCH /api/admin/templates/[id]` — pause/kill/promote
- `POST /api/admin/leads/[username]/blacklist` — agrega a `lead_blacklist`
- `POST /api/admin/leads/[username]/reclassify` — borra cache niche y re-clasifica
- `POST /api/admin/discover/post-engagers` — trigger ad-hoc con media_pk

Todos firman con `requireAdmin()` y revalidan path correspondiente.

---

## Paso 5 — UI con botones

En `/admin/ig/sources`: botón "Pause" / "Resume" por row. Form action que postea a la API y `revalidatePath`.

```tsx
'use client'
function PauseButton({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition()
  const toggle = () => start(async () => {
    await fetch(`/api/admin/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ active: !active }), headers: { 'Content-Type': 'application/json' } })
    location.reload()  // o usar router.refresh()
  })
  return <button onClick={toggle} disabled={pending} className="px-2 py-1 rounded border">{active ? 'Pause' : 'Resume'}</button>
}
```

En `/admin/ig/templates`: botones Pause / Kill / Promote (draft → active).
En `/admin/ig/leads/[username]`: botones Blacklist, Re-classify, ver conversación.

---

## Paso 6 — Tests

- Acción sin auth → 401/redirect.
- Acción admin → 200 + DB updated.
- Discord helper: dedup funciona (2 calls iguales en 1h → 2da no llama fetch). Mock fetch.

---

## Paso 7 — Smoke

1. Trigger un alert manual: endpoint `/api/admin/test-alert` (temp) que llama sendAlert critical → ver mensaje en Discord.
2. Pausar una source desde UI → verificar `discovery_sources.active=false` y que orchestrator la skip.
3. Borrar el endpoint test-alert antes del PR.

---

## Criterios de éxito

1. ✅ Botones funcionan, DB se actualiza.
2. ✅ Discord recibe alerts (info/warn/critical con colores correctos).
3. ✅ Dedup evita spam.
4. ✅ Cron `/check-reply-rate` corre y dispara alert si umbral cruza.
5. ✅ Auth admin enforced.

---

## Cierre

- Update PROGRESS D10 → ✅
- PR
