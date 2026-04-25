# PROGRESS — Discovery System v2

> Estado vivo. Actualizar al final de cada sesión D01–D14.

---

## Estado global

| Fase | Sesiones | Status | Última actualización |
|---|---|---|---|
| Phase 1 — Foundation | D01–D03 | 🟡 in progress | 2026-04-24 |
| Phase 2 — Orchestration & Intelligence | D04–D07 | ⏸ pending | 2026-04-24 |
| Phase 3 — Observability & Admin | D08–D10 | ⏸ pending | 2026-04-24 |
| Phase 4 — Optimization | D11–D12 | ⏸ pending | 2026-04-24 |
| Phase 5 — Production | D13–D14 | ⏸ pending | 2026-04-24 |

Status legend: ⏸ pending · 🟡 in progress · ✅ done · ⚠ blocked

---

## Snapshot al inicio (2026-04-24)

- **Decisión clave**: Apify abandonado (free no devuelve datos, paid no justifica costo). Pivot a instagrapi nativo con sesión `apex.stack`.
- **Sidecar Railway**: `https://ig-sidecar-production.up.railway.app` ✅ operativo, sesión válida confirmada.
- **Vercel**: `https://leads.theapexweb.com` ✅, env vars seteadas.
- **Supabase**: project `hpbxscfbnhspeckdmkvu`, tablas IG v1 ya creadas (`instagram_leads_raw`, `instagram_leads`, `instagram_conversations`, `dm_daily_quota`, `instagram_inbox_cursor`).
- **Bug fix aplicado pre-D01**: `PrivateAccountError` import en sidecar (`5c00723`).
- **Pipeline confirmado E2E** con 1 lead manual (`manu_nvrisaro`): discovery raw → enrich → filter → marcar processed. DM no enviado por filtro de followers <200 (esperado).

---

## Sesiones

### D01 — Schema cleanup + nuevas tablas
**Status:** ✅ done — 2026-04-25  
**Modelo:** Sonnet  
**Branch:** `feat/discovery-d01-schema`  
**Output:**
- Migración `20260424120000_discovery_v2_schema.sql` aplicada en Supabase (`discovery_v2_schema`)
- 9 tablas nuevas creadas: `discovery_sources`, `discovery_runs`, `niche_classifications`, `scoring_weights`, `dm_templates`, `lead_score_history`, `dm_template_assignments`, `lead_blacklist`, `alerts_log`
- ALTER `instagram_leads`: columnas `niche`, `niche_confidence`, `engagement_rate`, `scoring_version`, `template_id`, `replied_at`
- `discovery_sources` seeded: 13 rows (6 hashtag active, 4 location active, 3 competitor_followers inactive)
- Tipos TS regenerados → `apex-leads/src/types/supabase.ts` (nuevo archivo)
**Notas:**
- Índice parcial `WHERE expires_at > now()` en `niche_classifications` no es posible (not IMMUTABLE); reemplazado por índice compuesto `(ig_username, expires_at DESC)`. La app gestiona el lookup activo.
- No existía script `types:gen` en package.json; tipos generados via MCP Supabase.

### D02 — Sidecar discovery (hashtag, location)
**Status:** ✅ done — 2026-04-24  
**Modelo:** Sonnet  
**Branch:** `feat/discovery-d02-hashtag-location`  
**Output:**
- `app/routes/discover.py`: `POST /discover/hashtag` y `POST /discover/location` (HMAC via middleware)
- `app/db.py`: `get_supabase_client()` lazy factory
- `app/ig_client.py`: `discover_by_hashtag()` y `discover_by_location()` con deduplicación por username
- Upsert en `instagram_leads_raw` ON CONFLICT (ig_username) DO NOTHING
- `discovery_runs` con estado `running → ok/error`, `ended_at`, `users_seen`, `users_new`
- 21/21 tests pytest pasando (7 tests nuevos de discovery)
**Notas:**
- Circuit breaker check agregado por consistencia con otras rutas (no estaba en spec, no rompe nada)
- Supabase errors en error-path swallowed para no enmascarar excepciones de IG
- `"ended_at": "now()"` reemplazado con `datetime.now(timezone.utc).isoformat()` (más robusto)
- **Pendiente:** Smoke test contra Railway (ver Paso 6 de SESSION-D02.md)

### D03 — Sidecar discovery (competitor-followers, post-engagers)
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- 2 endpoints más en `discover.py`
- Rate-limit guard: max 1 competitor-followers / hora (Redis o table)
- Pagination cursor para competitor-followers
**Notas:** Vigilar uso (anti-ban).

### D04 — Discovery orchestrator + cron Railway
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- `apex-leads/src/app/api/cron/discover-orchestrator/route.ts`
- Lee `discovery_sources active=true`, evalúa `schedule_cron`, llama sidecar
- Cron Vercel `0 */6 * * *` o cron Railway con misma frecuencia
- Seed inicial de `discovery_sources` con 6 hashtags + 4 locations + 3 competitors
**Notas:** —

### D05 — Pre-filter v2 + dedup robusto
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- `lib/ig/discover/pre-filter.ts` extracted con tests
- `lead_blacklist` integrado en pre-filter
- Cleanup de raw > 30 días no procesados
**Notas:** —

### D06 — Niche classifier (Claude Haiku)
**Status:** ⏸ pending  
**Modelo:** Opus  
**Output esperado:**
- `lib/ig/classify/niche.ts` con cache vía `niche_classifications`
- Endpoint `/api/internal/classify-niche` para reuso/manual
- Integración en `run-cycle` antes de scoring
- Costo monitoreado en `alerts_log` si > $1/día
**Notas:** —

### D07 — Scoring v2
**Status:** ⏸ pending  
**Modelo:** Opus  
**Output esperado:**
- `lib/ig/score/v2.ts` con sigmoide + features extendidos
- Seed de pesos v1 en `scoring_weights` con `status='production'`
- `lead_score_history` poblado en cada run-cycle
- Backfill opcional de leads existentes con score nuevo
**Notas:** —

### D08 — Metrics layer
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- Materialized view `discovery_metrics_daily`
- Cron `/api/cron/refresh-metrics` (1× por día 02:00 ART)
- Vista SQL `dm_template_stats` con CIs Beta
- Vista `lead_funnel` (raw → filtered → enriched → contacted → replied)
**Notas:** —

### D09 — Admin dashboard read-only
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- `/admin/ig` con auth (cookie + email allowlist)
- KPI cards (Reply Rate, Qualified Rate, DMs Today, Pipeline Health)
- Charts con `recharts` (leads/día por fuente, CTR/template)
- Tablas leads + sources + templates (read-only)
**Notas:** —

### D10 — Admin actions + Discord alerts
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- POST endpoints para pause/resume source, kill template, blacklist lead, re-classify
- `lib/ig/alerts/discord.ts` con sendAlert(severity, msg, meta)
- Hooks: circuit_open, low_reply_rate, daily_quota_unmet
**Notas:** —

### D11 — A/B testing infra
**Status:** ⏸ pending  
**Modelo:** Opus  
**Output esperado:**
- `dm_templates` seeded con 3-5 variantes iniciales
- `lib/ig/templates/selector.ts` Thompson sampling
- Auto-pause cron `/api/cron/auto-pause-templates`
- UI en `/admin/ig/templates` para crear/editar/promover
**Notas:** —

### D12 — Self-learning scoring
**Status:** ⏸ pending  
**Modelo:** Opus  
**Output esperado:**
- Worker Python `sidecar/jobs/update_weights.py` (sklearn LogisticRegression)
- Cron Railway semanal (lunes 04:00 ART)
- Shadow A/B integration en `lib/ig/score/v2.ts`
- Auto-promote cuando p<0.1 en test de proporciones
**Notas:** —

### D13 — E2E tests + chaos drills
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- Playwright tests para `/admin/ig` y endpoints públicos
- Mock sidecar local con FastAPI test client
- Chaos drill: kill sidecar, verificar circuit breaker + alerta Discord
- CI workflow GitHub Actions
**Notas:** —

### D14 — Ramp-up + runbook
**Status:** ⏸ pending  
**Modelo:** Sonnet  
**Output esperado:**
- `DRY_RUN=false` en Vercel
- `DAILY_DM_LIMIT=5` día 1, +5 cada día sin incidente hasta 30
- `RUNBOOK.md` en docs/discovery con: monitoreo diario, escalación, rollback
- Eliminación legacy Apify (`/api/cron/ig-discover`, env vars)
**Notas:** —

---

## Decisiones de scope (changelog)

> Cualquier cambio que se desvíe del MASTER-PLAN se anota acá.

- **2026-04-24** — Plan creado tras descartar Apify. Master plan inmutable.

---

## Bloqueos abiertos

- ninguno

---

## Próximos pasos inmediatos

1. Manuel revisa `MASTER-PLAN.md` y aprueba scope.
2. Manuel inicia sesión nueva con prompt `prompts/SESSION-D01.md`.
3. Tras D01: actualizar este archivo con resultados, pasar a D02.
