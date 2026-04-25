# SESSION-D05 — Pre-filter v2 + dedup + blacklist

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~1.5h)
> **Prerequisitos:** D04 ✅ (orchestrator alimentando raw)

---

## Contexto

Lectura: `MASTER-PLAN.md` § 4, `ARCHITECTURE.md` § 4.9, `apex-leads/src/app/api/ig/run-cycle/route.ts` (entender lógica actual de pre-filter inline).

Hoy el pre-filter está embebido en `run-cycle` (líneas 89-97). Lo extraemos a su propio módulo, lo extendemos con blacklist y agregamos un cleanup de raw viejos.

---

## Objetivo

1. Extraer `lib/ig/discover/pre-filter.ts` con función pura `preFilter(rawLead) -> { keep: boolean, reason?: string }`.
2. Integrar `lead_blacklist` en pre-filter.
3. Cleanup job: `/api/cron/cleanup-raw-leads` que borra rows en `instagram_leads_raw` con `processed=true AND created_at < now()-30d`.
4. Tests unitarios del pre-filter.
5. Modificar `run-cycle` para usar el módulo nuevo.

---

## Paso 1 — Branch + lectura

```bash
git checkout -b feat/discovery-d05-prefilter
```

Leer en run-cycle/route.ts el bloque `// Pre-filter using raw_profile data`.

---

## Paso 2 — Módulo pre-filter

`apex-leads/src/lib/ig/discover/pre-filter.ts`:

```typescript
export interface RawLead { id: string; ig_username: string; raw_profile: Record<string, unknown>; source_ref?: string }
export interface PreFilterResult { keep: boolean; reason?: string }

const MIN_FOLLOWERS = 200
const MAX_FOLLOWERS = 100_000
const MIN_POSTS = 5

export function preFilter(raw: RawLead, blacklist: Set<string>): PreFilterResult {
  if (blacklist.has(raw.ig_username.toLowerCase())) return { keep: false, reason: 'blacklisted' }
  const p = raw.raw_profile as any
  const followers = Number(p.followersCount ?? p.followers_count ?? p.follower_count ?? 0)
  const posts = Number(p.postsCount ?? p.posts_count ?? p.media_count ?? 0)
  const isPrivate = Boolean(p.isPrivate ?? p.is_private)
  const isVerified = Boolean(p.isVerified ?? p.is_verified)
  if (isPrivate) return { keep: false, reason: 'private' }
  if (isVerified) return { keep: false, reason: 'verified' }   // verificadas suelen ser brands grandes, no target
  if (followers && followers < MIN_FOLLOWERS) return { keep: false, reason: 'low_followers' }
  if (followers && followers > MAX_FOLLOWERS) return { keep: false, reason: 'too_many_followers' }
  if (posts && posts < MIN_POSTS) return { keep: false, reason: 'low_posts' }
  return { keep: true }
}

export async function loadBlacklist(supabase): Promise<Set<string>> {
  const { data } = await supabase.from('lead_blacklist').select('ig_username')
  return new Set((data ?? []).map((r: any) => r.ig_username.toLowerCase()))
}
```

**Importante:** algunos rows recientes vienen del sidecar D02 con raw_profile que NO tiene followers_count (porque hashtag_medias_recent no devuelve eso). Para esos, `followers === 0` y la guard `followers && followers < MIN`-style permite que pasen al enrich (donde se completa). Esto es deliberado — pre-filter es solo "matar obvios", no "garantizar quality". Documentar en comentario.

---

## Paso 3 — Integrar en run-cycle

Reemplazar el bloque inline:

```typescript
import { preFilter, loadBlacklist } from '@/lib/ig/discover/pre-filter'

const blacklist = await loadBlacklist(supabase)
const filterResults = newLeads.map((r) => ({ raw: r, ...preFilter(r as any, blacklist) }))
const candidates = filterResults.filter((x) => x.keep).map((x) => x.raw)
const skipped = filterResults.filter((x) => !x.keep)

if (skipped.length > 0) {
  // bulk update con processing_error = reason
  for (const s of skipped) {
    await supabase.from('instagram_leads_raw')
      .update({ processed: true, processing_error: s.reason })
      .eq('id', s.raw.id)
  }
}
```

Optimización: agrupar por reason y hacer 1 update con `.in('id', [...])` por grupo (menos round-trips).

---

## Paso 4 — Cleanup cron

`apex-leads/src/app/api/cron/cleanup-raw-leads/route.ts`:

```typescript
export async function GET(req: NextRequest) {
  // auth Bearer CRON_SECRET
  const supabase = createSupabaseServer()
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { count, error } = await supabase
    .from('instagram_leads_raw')
    .delete({ count: 'exact' })
    .eq('processed', true)
    .lt('created_at', cutoff)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, deleted: count })
}
```

Agregar a `vercel.json` crons: `{ "path": "/api/cron/cleanup-raw-leads", "schedule": "0 4 * * 0" }` (domingo 4am UTC).

---

## Paso 5 — Tests

`pre-filter.test.ts`:
- private → reason 'private'
- verified → reason 'verified'
- followers=150 → 'low_followers'
- followers=200_000 → 'too_many_followers'
- posts=2 → 'low_posts'
- en blacklist → 'blacklisted'
- válido → keep:true
- raw vacío (followers/posts ausentes) → keep:true (deja pasar a enrich)

---

## Paso 6 — Smoke

Insertar manualmente un blacklist row:
```sql
INSERT INTO lead_blacklist (ig_username, reason) VALUES ('manu_nvrisaro', 'test_self');
```

Disparar `/api/ig/run-cycle` y verificar que `manu_nvrisaro` cae con `processing_error='blacklisted'`.

---

## Criterios de éxito

1. ✅ `pre-filter.ts` con tests verdes.
2. ✅ run-cycle usa el módulo, comportamiento equivalente al actual + blacklist.
3. ✅ Cleanup cron registrado.
4. ✅ Smoke con blacklist funciona.

---

## Cierre

- Update PROGRESS D05 → ✅
- PR
