# SESSION-D04 — Discovery orchestrator + cron

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~2h)
> **Prerequisitos:** D01–D03 ✅

---

## Contexto

Lectura obligatoria: `MASTER-PLAN.md`, `ARCHITECTURE.md` § 1, 2, 4.1, 5, `PROGRESS.md`.

Tenemos 4 endpoints discovery en el sidecar y 13 sources en `discovery_sources`. Falta el componente que decide **cuándo** llamar a cada uno. Eso es el orchestrator.

Decisión de runtime: lo hacemos en **Next.js cron** (`/api/cron/discover-orchestrator`) y dejamos el scheduler Railway de WhatsApp/run-cycle como está. Vercel cron es suficiente para una llamada cada 6h. Railway lo usaremos sólo para tasks Python pesadas (D12 weight updater).

---

## Objetivo

1. Endpoint `apex-leads/src/app/api/cron/discover-orchestrator/route.ts`.
2. Lee `discovery_sources WHERE active=true` ordenado por priority desc.
3. Para cada source, evalúa si toca correr según `schedule_cron` y `discovery_runs` previos (último `started_at`).
4. Llama el endpoint sidecar correspondiente (vía `lib/ig/sidecar.ts` extendido).
5. Loggea resultado, respeta cooldowns.
6. Cron Vercel: `0 */6 * * *` (cada 6h).
7. Kill-switch: si `DISCOVERY_ENABLED=false` → no-op.

---

## Paso 1 — Branch + base

```bash
git checkout -b feat/discovery-d04-orchestrator
```

Lectura: `apex-leads/src/lib/ig/sidecar.ts` (cliente HMAC), `vercel.json` o `apex-leads/vercel.json` para crons.

---

## Paso 2 — Extender sidecar client

`apex-leads/src/lib/ig/sidecar.ts`:

```typescript
export interface DiscoverHashtagResult { run_id: string; users_seen: number; users_new: number; }
export interface DiscoverCompetitorResult extends DiscoverHashtagResult { next_cursor: string | null; }

export async function discoverHashtag(tag: string, limit = 50): Promise<DiscoverHashtagResult> {
  return signedPost('/discover/hashtag', { tag, limit })
}
export async function discoverLocation(location_pk: number, limit = 50): Promise<DiscoverHashtagResult> {
  return signedPost('/discover/location', { location_pk, limit })
}
export async function discoverCompetitorFollowers(username: string, max_users = 200, cursor?: string): Promise<DiscoverCompetitorResult> {
  return signedPost('/discover/competitor-followers', { username, max_users, cursor })
}
export async function discoverPostEngagers(media_pk: string, kind: 'likers'|'commenters' = 'likers'): Promise<DiscoverHashtagResult> {
  return signedPost('/discover/post-engagers', { media_pk, kind })
}
```

Reusar el patrón existente de `signedPost` / `SidecarError`.

---

## Paso 3 — Orchestrator core

`apex-leads/src/lib/ig/discover/orchestrator.ts`:

```typescript
import { parseExpression } from 'cron-parser'   // pnpm add cron-parser

interface Source { id: string; kind: string; ref: string; params: any; schedule_cron: string; priority: number }

export async function pickSourcesToRun(supabase, now: Date): Promise<Source[]> {
  const { data: sources } = await supabase.from('discovery_sources').select('*').eq('active', true).order('priority', { ascending: false })
  const out: Source[] = []
  for (const s of sources ?? []) {
    // último run de este source
    const { data: lastRun } = await supabase.from('discovery_runs')
      .select('started_at').eq('source_id', s.id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    const cron = parseExpression(s.schedule_cron, { currentDate: lastRun?.started_at ? new Date(lastRun.started_at) : new Date(0) })
    const nextRunAt = cron.next().toDate()
    if (nextRunAt <= now) out.push(s)
  }
  return out
}

export async function runOrchestratorCycle(supabase): Promise<{ ran: number; results: any[] }> {
  const now = new Date()
  const sources = await pickSourcesToRun(supabase, now)
  const results: any[] = []

  // Anti-ban: max 1 competitor_followers por ciclo
  let competitorAllowance = 1

  for (const s of sources) {
    if (s.kind === 'competitor_followers' && competitorAllowance <= 0) continue
    try {
      let res: any
      switch (s.kind) {
        case 'hashtag':              res = await discoverHashtag(s.ref, s.params?.limit ?? 50); break
        case 'location':             res = await discoverLocation(Number(s.ref), s.params?.limit ?? 50); break
        case 'competitor_followers': res = await discoverCompetitorFollowers(s.ref, s.params?.max_users ?? 200, s.params?.cursor); competitorAllowance--; break
        case 'post_engagers':        res = await discoverPostEngagers(s.ref, s.params?.kind ?? 'likers'); break
        default: throw new Error(`unknown kind ${s.kind}`)
      }
      results.push({ source_id: s.id, kind: s.kind, ref: s.ref, ...res })
    } catch (err) {
      results.push({ source_id: s.id, kind: s.kind, ref: s.ref, error: String(err) })
      if (err instanceof SidecarError && err.isCircuitOpen) {
        console.warn('[orchestrator] circuit open — abort cycle')
        break
      }
    }
  }
  return { ran: results.length, results }
}
```

---

## Paso 4 — Endpoint

`apex-leads/src/app/api/cron/discover-orchestrator/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { runOrchestratorCycle } from '@/lib/ig/discover/orchestrator'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // discovery puede tomar varios minutos

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${igConfig.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!igConfig.DISCOVERY_ENABLED) {
    return NextResponse.json({ ok: true, skipped: 'DISCOVERY_ENABLED=false' })
  }
  const supabase = createSupabaseServer()
  const result = await runOrchestratorCycle(supabase)
  return NextResponse.json({ ok: true, ...result })
}
```

Agregar `DISCOVERY_ENABLED: z.coerce.boolean().default(true)` a `lib/ig/config.ts`.

---

## Paso 5 — Cron Vercel

`apex-leads/vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/discover-orchestrator", "schedule": "0 */6 * * *" }
  ]
}
```

(Verificar que Hobby plan permite el número de crons; si ya hay crons, sumarlo al array.)

**Nota plan Hobby:** si crons Vercel no alcanzan, usar Railway scheduler (existente) llamando este endpoint con curl + CRON_SECRET — adaptá.

---

## Paso 6 — Tests

`apex-leads/src/lib/ig/discover/__tests__/orchestrator.test.ts`:
- Mock supabase chain
- Mock sidecar functions
- Caso: 3 sources, 1 con cron pasado → 1 ejecución
- Caso: 2 competitor_followers → solo 1 corre (allowance)
- Caso: SidecarError circuitOpen → corta cycle

---

## Paso 7 — Smoke test

```bash
curl -s -X GET "https://leads.theapexweb.com/api/cron/discover-orchestrator" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Esperar response con leads encontrados. Verificar Supabase:
```sql
SELECT kind, count(*), sum(users_new) FROM discovery_runs
WHERE started_at > now() - interval '10 minutes' GROUP BY kind;
```

---

## Criterios de éxito

1. ✅ Endpoint responde 200 con array de results.
2. ✅ Cron Vercel registrado, dispara automáticamente.
3. ✅ Discovery_runs poblado.
4. ✅ instagram_leads_raw crece.
5. ✅ Tests verdes.
6. ✅ Anti-ban guard funciona (1 competitor max).

---

## Cierre

- Update PROGRESS D04 → ✅, anotar cuántos leads/día se descubren en primera corrida.
- PR.
