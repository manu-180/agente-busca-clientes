# PROGRESS — Discovery System v2

> Estado vivo. Actualizar al final de cada sesión D01–D14.

---

## Estado global

| Fase | Sesiones | Status | Última actualización |
|---|---|---|---|
| Phase 1 — Foundation | D01–D03 | ✅ done | 2026-04-25 |
| Phase 2 — Orchestration & Intelligence | D04–D07 | 🟡 in progress | 2026-04-25 |
| Phase 3 — Observability & Admin | D08–D10 | ✅ done | 2026-04-25 |
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
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `app/routes/discover.py`: `POST /discover/competitor-followers` (paginado con cursor) y `POST /discover/post-engagers` (likers/commenters)
- `app/rate_limits.py`: `check_and_mark(endpoint, key, cooldown_seconds)` con upsert en `sidecar_rate_limits`
- `app/ig_client.py`: `discover_competitor_followers()` (user_followers_v1_chunk + next_cursor) y `discover_post_engagers()` (media_likers/media_comments)
- Migración `discovery_v2_rate_limits` aplicada en Supabase: tabla `sidecar_rate_limits`
- Cooldowns: competitor_followers=1h por username, post_engagers=30min por media_pk
- 9 tests nuevos pytest (24 total, todos pasando)
**Notas:** Vigilar uso anti-ban. NO llamar competitor-followers más de 1×/hora total en producción.

### D04 — Discovery orchestrator + cron Vercel
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `lib/ig/discover/orchestrator.ts`: `pickSourcesToRun()` (cron-parser, evalúa schedule vs last run) + `runOrchestratorCycle()` (anti-ban: max 1 competitor/ciclo, circuit-break-on-503)
- `api/cron/discover-orchestrator/route.ts`: Bearer CRON_SECRET auth, `DISCOVERY_ENABLED` kill-switch, maxDuration=300
- `lib/ig/sidecar.ts`: funciones `discoverHashtag`, `discoverLocation`, `discoverCompetitorFollowers`, `discoverPostEngagers`
- `lib/ig/config.ts`: `DISCOVERY_ENABLED` booleano con default true
- `vercel.json`: cron `0 6 * * *` (1×/día a las 6am UTC)
- `lib/ig/discover/__tests__/orchestrator.test.ts`: 11 tests (18 total en discover, todos pasando)
**Notas:** Cron seteado a 1×/día (0 6 * * *) en lugar de cada 6h para respetar límites plan Hobby Vercel. Ajustar a `0 */6 * * *` si se cambia a Pro.

### D05 — Pre-filter v2 + dedup + blacklist
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `lib/ig/discover/pre-filter.ts`: `preFilter(raw, blacklist)` pura + `loadBlacklist(supabase)`; guards: private, verified, low/high followers, low posts; rows sin followers pasan a enrich (diseño deliberado)
- `lib/ig/discover/__tests__/pre-filter.test.ts`: 8 tests (todos pasando)
- `api/cron/cleanup-raw-leads/route.ts`: borra `instagram_leads_raw` con `processed=true AND created_at < now()-30d`
- `vercel.json`: cron `0 4 * * 0` (domingo 4am UTC) para cleanup
- `api/ig/run-cycle/route.ts`: usa `preFilter` + `loadBlacklist` (extrae bloque inline previo)
**Notas:** Leads sin followers_count (vienen de hashtag_medias_recent) pasan al enrich donde se completan. Documentado en comentario en pre-filter.ts.

### D06 — Niche classifier (Claude Haiku)
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `lib/ig/classify/prompts.ts`: system prompt + `buildUserPrompt()`
- `lib/ig/classify/niche.ts`: `classifyNiche()` con cache vía `niche_classifications` (30d TTL), retry JSON parse 1×, `checkDailyCostAlert()` (umbral $1/día, dedup 1×/día en `alerts_log`)
- `api/internal/classify-niche/route.ts`: endpoint interno auth Bearer CRON_SECRET, lookup `instagram_leads` + classifica
- `run-cycle/route.ts`: classify loop post-enrich pre-score, niche gate (`TARGET_NICHES` + `MIN_CONFIDENCE=0.6`), `niche`/`niche_confidence` en todos los upserts de `instagram_leads`
- `config.ts`: `ANTHROPIC_API_KEY` ahora required (no optional), `CLAUDE_HAIKU_MODEL` con default `claude-haiku-4-5-20251001`
- 13 tests nuevos (47 total, todos pasando)
**Notas:**
- Costo estimado por 100 leads: ~$0.015 (100 × $0.00015). Muy por debajo del umbral $1/día.
- Leads que fallan clasificación (error Claude) quedan sin niche y pasan a `wrong_niche` → seguros de ignorar.
- Cost alert fire-and-forget en run-cycle (no bloquea pipeline si falla).

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
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- Migración `20260425120000_discovery_v2_metrics.sql` aplicada en Supabase
- `discovery_metrics_daily` (materialized view) con índice único `(day, source_kind)`
- Vista `dm_template_stats`: sends, replies, CTR, beta_alpha, beta_beta
- Vista `lead_funnel`: 30d rolling window, subqueries corregidas (CTE approach)
- Función SQL `refresh_discovery_metrics()` (REFRESH MATERIALIZED VIEW CONCURRENTLY)
- `api/cron/refresh-metrics/route.ts`: Bearer CRON_SECRET auth
- `vercel.json` cron `0 2 * * *`
- `lib/ig/metrics/queries.ts`: `getDailyMetrics`, `getKpiSnapshot`, `getLeadFunnel`, `getTemplateStats`
**Notas:**
- `discovery_metrics_daily` usa CTE approach para los dms_sent/replies (correlated subqueries con ungrouped outer column no funcionan en Postgres matviews)
- `discovered_via::text` cast necesario (enum vs text mismatch)
- D08 ejecutado en misma sesión que D09

### D09 — Admin dashboard read-only
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `admin/ig/layout.tsx`: nav bar con links a Outreach / Discovery / Sources / Templates / Leads
- Auth: usa middleware existente (`apex_auth` cookie) — no se cambió a Supabase auth (existente ya cubre todo)
- `admin/ig/discovery/page.tsx`: SSR, KPI cards (Reply Rate, Qualified Rate, DMs Today, Pipeline Health) + SourceChart + FunnelTable
- `admin/ig/sources/page.tsx`: tabla discovery_sources con last_run y leads_30d agregados desde discovery_runs
- `admin/ig/templates/page.tsx`: tabla dm_template_stats con CI Beta calculado en servidor
- `admin/ig/leads/page.tsx`: tabla paginada (50/page) con filtros por niche, status, min_score (server-side via searchParams)
- `admin/ig/_components/KpiCard.tsx`: card server component con tone colors
- `admin/ig/_components/SourceChart.tsx`: recharts AreaChart stacked por source_kind (`'use client'`)
- `admin/ig/_components/FunnelTable.tsx`: funnel summary + daily breakdown 7d
**Notas:**
- `recharts` ya estaba instalado en package.json
- Página principal `/admin/ig` (outreach dashboard) preservada tal cual
- Fixes de pre-existing errors: `tsconfig target es2017` (Map.entries iteration), `cron-parser v5` API (`CronExpressionParser.parse()`)

### D10 — Admin actions + Discord alerts
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `lib/ig/alerts/discord.ts`: `sendAlert(supabase, severity, source, message, meta)` — persiste en `alerts_log`, envía Discord embed (dedup 1h)
- `config.ts`: `DISCORD_ALERT_WEBHOOK` opcional añadido
- `lib/admin/auth.ts`: `requireAdmin(req)` — cookie check defensivo (middleware ya bloquea)
- `api/admin/sources/[id]/route.ts`: PATCH pause/resume/priority source
- `api/admin/templates/[id]/route.ts`: PATCH pause/kill/promote/resume template
- `api/admin/leads/[username]/blacklist/route.ts`: POST → inserta en `lead_blacklist`, status → blacklisted
- `api/admin/leads/[username]/reclassify/route.ts`: POST → borra cache `niche_classifications`, reset niche fields
- `api/cron/check-reply-rate/route.ts`: cron diario 18:00 UTC — alerta warning si reply_rate 7d < 3% (con ≥30 DMs), alerta info si quota < 50% del límite
- `vercel.json`: cron `0 18 * * *` para check-reply-rate
- `run-cycle/route.ts`: `sendAlert critical 'sidecar'` cuando circuit breaker abre (2 puntos: enrich loop + DM send loop)
- `classify/niche.ts`: reemplazó `alerts_log.insert` directo por `sendAlert` (unifica canal)
- UI buttons: `ToggleSourceButton`, `TemplateActions`, `LeadActions` — useTransition + router.refresh() en sources/templates/leads pages
**Notas:**
- `tsc --noEmit` pasa sin errores. Build local falla OOM (problema de RAM Windows, igual que D08/D09) — Vercel compila OK.
- Setear `DISCORD_ALERT_WEBHOOK` en Vercel con la URL del webhook del server de Discord de Manuel.

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

1. D07 — Scoring v2 (10 features + pesos versionados en `scoring_weights` + sigmoid + `lead_score_history`)
2. D11 — A/B testing Thompson Sampling para templates
3. D12 — Self-learning scoring (Logistic Regression semanal en Railway)
4. D13 — E2E tests + chaos drills
5. D14 — Ramp-up 5→30 DMs/día + RUNBOOK + eliminar Apify legacy
