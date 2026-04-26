# PROGRESS — Discovery System v2

> Estado vivo. Actualizar al final de cada sesión D01–D14.

---

## Estado global

| Fase | Sesiones | Status | Última actualización |
|---|---|---|---|
| Phase 1 — Foundation | D01–D03 | ✅ done | 2026-04-25 |
| Phase 2 — Orchestration & Intelligence | D04–D07 | ✅ done | 2026-04-26 |
| Phase 3 — Observability & Admin | D08–D10 | ✅ done | 2026-04-25 |
| Phase 4 — Optimization | D11–D12 | ✅ done | 2026-04-25 |
| Phase 5 — Production | D13–D14 | 🟡 in progress | 2026-04-25 |

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
**Status:** ✅ done — 2026-04-26  
**Modelo:** Opus  
**Branch:** main  
**Output:**
- `lib/ig/score/features.ts`: 10 features normalizadas (followers_log, posts_log, engagement_rate, has_business_category, business_category_match, bio_keyword_match, has_external_url, link_is_linktree_or_ig_only, posts_recency, niche_classifier_confidence)
- `lib/ig/score/v2.ts`: sigmoid engine, `loadProductionWeights()`, `computeScore()`, `scoreAndPersist()` (acepta `cachedWeights` para evitar N+1)
- `scoring_weights` seeded en Supabase: v1 `status=production`, id `45edfa2b`, 11 pesos manuales
- `run-cycle/route.ts`: pre-carga pesos 1 sola vez, reemplaza `scoreLead`, usa `igConfig.MIN_SCORE_FOR_DM` (default 60 vs 25 anterior), escribe `lead_score_history` post-DM con leadId real, elimina `score_breakdown` legacy
- `config.ts`: `MIN_SCORE_FOR_DM: intEnv(60)` agregado
- `api/internal/rescore-all/route.ts`: backfill paginado (default 100/página, max 500), reconstruye profile desde columnas + niche desde `instagram_leads`, inserta en `lead_score_history` sin overwrite
- 13 tests nuevos (69 total, todos pasando)
**Notas:**
- Test "marginal profile": con weight 2.0 en niche_classifier_confidence, un perfil con niche match válido siempre puntúa alto (≥80). El test marginal usa `niche='otro'` (fuera de TARGET_NICHES) para forzar niche_confidence=0 y obtener score ~55.
- `MIN_SCORE_FOR_DM=60` implica que aprox. el 40% menos de leads pasarán al DM gate vs. el umbral viejo de 25 — calidad sube.
- D12 (self-learning) actualizará los pesos via LogisticRegression semanal.

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
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `dm_templates` seeded: 5 variantes activas (opener_v1_directo…v5_corto)
- `lib/ig/templates/selector.ts`: Thompson sampling puro (Marsaglia-Tsang Gamma, sin deps externas) — `sampleBeta`, `thompsonPick`, `pickTemplate`, `renderTemplate`
- `lib/ig/templates/auto-pause.ts`: lógica pura `betaCI95` + `findTemplatesToPause` (MIN_SENDS=100, CI 95%)
- `lib/ig/templates/__tests__/selector.test.ts`: 7 tests (distribución Beta, favoritismo, renderizado)
- `app/api/cron/auto-pause-templates/route.ts`: cron diario, pausa templates dominados, alerta Discord
- `app/api/cron/auto-pause-templates/__tests__/auto-pause.test.ts`: 5 tests
- `app/api/ig/run-cycle/route.ts`: `pickTemplate` + `renderTemplate` reemplaza `pickOpeningTemplate`; logging template.name en DRY_RUN; insert en `dm_template_assignments` post-send; `template_id` en upsert `instagram_leads`
- `app/api/cron/ig-send-pending/route.ts`: `pickTemplate` + Claude adapta templateText; insert `dm_template_assignments`
- `app/api/cron/ig-poll-inbox/route.ts`: reply detection — marca `dm_template_assignments.replied + replied_at + reply_was_positive` en primer reply
- `app/api/admin/templates/route.ts`: POST create endpoint (status=draft, variables auto-detectadas)
- `app/api/admin/templates/[id]/route.ts`: fix PATCH `content→body` normalización
- `app/admin/ig/_components/NewTemplateForm.tsx`: form create con extracción automática de variables
- `app/admin/ig/templates/page.tsx`: integrado `NewTemplateForm`
- `vercel.json`: cron `0 6 * * *` para auto-pause-templates
- `types/supabase.ts`: regenerado con `dm_template_stats` view y `dm_template_assignments` FK
- 81 tests (todos pasando), `tsc --noEmit` limpio
**Notas:**
- `betaCI95` y `findTemplatesToPause` en módulo separado (`auto-pause.ts`) para tests sin drag de igConfig
- Cast `features as unknown as Record<string, number>` en `rescore-all/route.ts` (Features no tiene index signature)

### D12 — Self-learning scoring
**Status:** ✅ done — 2026-04-25  
**Modelo:** Sonnet  
**Branch:** main  
**Output:**
- `sidecar/jobs/update_weights.py`: sklearn LogisticRegression(C=1.0) + StandardScaler; MIN_POSITIVES=50; cross-val accuracy; proportions_ztest vs production; auto-promote if p<0.05 and candidate_accuracy > production_accuracy; Discord alert en ambos casos
- `sidecar/app/routes/jobs.py`: POST /jobs/update-weights (HMAC auth via middleware existente)
- `sidecar/app/main.py`: jobs router registrado
- `sidecar/requirements.txt`: scikit-learn==1.5.2, statsmodels==0.14.4 agregados
- `apex-leads/api/cron/trigger-weight-update/route.ts`: Vercel cron, Bearer CRON_SECRET auth, HMAC sign al sidecar
- `vercel.json`: cron `0 7 * * 1` (lunes 07:00 UTC = 04:00 ART)
- `lib/ig/score/v2.ts`: `loadCandidateWeights()` + `scoreWithShadow()` (fire-and-forget, log diff, early return si no hay candidate)
- `run-cycle/route.ts`: `void scoreWithShadow(supabase, features, score)` después de computeScore
- `sidecar/tests/test_update_weights.py`: 4 tests (skip <50 positivos, inserta candidate, ztest llamado con valores correctos, no auto-promueve si p≥0.05)
- `lib/ig/score/__tests__/v2-shadow.test.ts`: 6 tests (loadCandidateWeights null/present, scoreWithShadow no-throw en 3 escenarios, log check)
- 24 pytest passing · 19 jest score tests passing · tsc --noEmit limpio
**Notas:**
- sklearn y statsmodels no están en el venv local — los tests de update_weights.py corren en Railway donde el venv tiene todas las deps
- proportions_ztest alternative="larger" (candidate mejor que production)
- scoreWithShadow usa `loadCandidateWeights` con order version desc + limit 1 (siempre el más nuevo)

### D13 — E2E tests + chaos drills
**Status:** ✅ done — 2026-04-25
**Modelo:** Sonnet
**Branch:** main
**Output:**
- `.github/workflows/ci.yml`: 3 jobs paralelos — `sidecar-tests` (pytest, Python 3.13), `apex-tests` (jest --no-coverage, Node 20), `apex-typecheck` (tsc --noEmit); trigger push+PR a main; env vars dummy para CI
- `apex-leads/playwright.config.ts`: baseURL localhost:3000, 1 worker, 0 retries, webServer `npm run dev`; env vars forwarded al proceso Next
- `apex-leads/e2e/admin-ig.spec.ts`: 4 tests — discovery KPI cards, sources tabla con filas, templates tabla + botón "New Template", leads tabla + filtros niche/status; cookie `apex_auth` seteada via `beforeEach`
- `apex-leads/scripts/chaos-sidecar.ts`: drill ejecutable con `npx tsx`; apunta a localhost:3000 con Bearer CRON_SECRET; verifica que run-cycle no crashea ante sidecar muerto; documenta setup (IG_SIDECAR_URL=localhost:1) y checks manuales en Supabase
- `apex-leads/src/lib/ig/__mocks__/sidecar.ts`: manual Jest mock — `enrichProfiles`, `sendDM`, `pollInbox`, `discover*`, `SidecarError`; activado con `jest.mock('@/lib/ig/sidecar')`
- `apex-leads/src/app/api/ig/run-cycle/__tests__/route.test.ts`: 2 tests unitarios — `daily_limit_reached` (quota=5/5), `no_raw_leads` (queue vacío); mock Supabase chain thenable; todas las deps mockeadas
- `package.json`: devDeps `@playwright/test ^1.49.0`, `tsx ^4.19.0`; scripts `test:e2e` y `chaos:sidecar`
- 89 jest tests passing (vs 81 pre-D13)
**Notas:**
- Playwright tests requieren Supabase real (discovery_sources seeded D01); diseñados para correr local o contra staging, no en CI puro
- Chaos drill deja estado limpio si instagram_leads_raw está vacío o DRY_RUN=true
- `makeChain` en route.test.ts es thenable — resuelve tanto `await chain.method()` como `await chain.method().terminal()` en un solo mock

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

1. D13 — E2E tests + chaos drills
2. D14 — Ramp-up 5→30 DMs/día + RUNBOOK + eliminar Apify legacy
