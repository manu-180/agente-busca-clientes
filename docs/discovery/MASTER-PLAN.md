# MASTER PLAN — Discovery System v2 (Native instagrapi)

> **Documento inmutable.** Refleja la visión completa del sistema de descubrimiento de leads.
> Cambios de scope se documentan en `PROGRESS.md`, NO acá.

---

## 1 · TL;DR

Reemplazamos Apify (free no devuelve datos, paid $49/mo + bloqueos de IG) por un sistema
**multi-fuente nativo** corriendo en el sidecar Railway con la sesión `apex.stack` ya
autenticada. Sin proxies adicionales, sin costo extra. Costo objetivo: **$0/mes en discovery**
hasta los 30-40 DMs/día (ramp-up techo).

El sistema descubre leads por **4 fuentes complementarias** (hashtag, location, competitor
followers, post engagers), los pre-filtra barato, los enriquece con instagrapi, los puntúa con
un scoring **Bayesiano que aprende solo**, los clasifica de nicho con Claude Haiku, y los
entrega a `run-cycle` listos para DM. Todo medible end-to-end, todo observable, todo
reversible.

---

## 2 · North Star Metrics

| Métrica | Baseline (hoy) | Target 90 días | Cómo se mide |
|---|---|---|---|
| **Reply Rate** | n/a (DRY_RUN) | ≥ 8% | replies / DMs enviados (7d rolling) |
| **Qualified Lead Rate** | n/a | ≥ 25% | leads con score ≥ 60 / leads enriquecidos |
| **Cost per Lead Discovered** | $0 | $0 | sin costo de proxies/scrapers |
| **Cost per Reply** | n/a | < $0.05 | (Claude tokens) / replies |
| **Discovery Throughput** | 0 | 500-1000 leads/día | rows nuevas en `instagram_leads_raw` |
| **Pipeline Health** | n/a | ≥ 95% | runs sin circuit-open (7d) |
| **Time-to-DM** | n/a | < 24h | descubrimiento → DM enviado (p50) |

Todo expuesto en `discovery_metrics_daily` y dashboard admin.

---

## 3 · Por qué descartamos Apify

| Aspecto | Apify Free | Apify $49/mo | instagrapi nativo |
|---|---|---|---|
| Datos reales | ❌ `{noResults: true}` | ✅ con residential proxy ($+) | ✅ session de cuenta real |
| Costo mensual | $0 | $49 + proxies | $0 |
| Riesgo de ban | bajo (no envía) | medio | medio (mitigable con humanize) |
| Control de fuentes | hashtag only | hashtag + location | hashtag + location + competitor + engagers |
| Latencia descubrimiento | 5-15 min/run | 5-15 min/run | seg-min, on-demand |
| Vendor lock-in | alto | alto | nulo |

La cuenta `apex.stack` es real, con historia. La sesión persistida en Railway volume sobrevive
reboots. instagrapi expone exactamente los endpoints que necesitamos
(`hashtag_medias_recent`, `location_medias_recent`, `user_followers`, `media_likers`,
`media_comments`).

---

## 4 · Visión del sistema

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: DISCOVERY (sidecar /discover/*)                        │
│   hashtag → location → competitor-followers → post-engagers     │
│           ↓                                                      │
│   instagram_leads_raw  (dedup, source-tagged, jsonb raw)        │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: ENRICHMENT + CLASSIFICATION (run-cycle + workers)      │
│   pre-filter (free)   → enrich (instagrapi 20/batch)            │
│   classify niche (Claude Haiku, $0.0001/lead)                   │
│   score v2 (bayesian, self-learning weights)                    │
│           ↓                                                      │
│   instagram_leads  (status=discovered, score, niche, breakdown) │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: OUTREACH (run-cycle)                                   │
│   pick template (A/B Thompson sampling)                         │
│   send DM (humanize dwell+typing)                               │
│   log conversation, update quota                                │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: LEARNING LOOP                                          │
│   reply detected → update template stats + scoring weights      │
│   metrics_daily → admin dashboard → Manuel decide ramp-up       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5 · Arquitectura de fuentes de descubrimiento

Cada fuente es un **DiscoveryJob** con sus propias parámetros y cadencia. Definida en la tabla
`discovery_sources` (ver `ARCHITECTURE.md` § 4).

### 5.1 Hashtag

- Input: `#modaargentina`, `#boutiquebuenosaires`, `#indumentariafemenina`, etc.
- Endpoint sidecar: `POST /discover/hashtag {tag, limit}`
- instagrapi: `cl.hashtag_medias_recent(tag, amount=50)` → para cada media → `media.user`
- Volumen esperado: 30-50 leads útiles / hashtag / corrida
- Cadencia recomendada: 2× / día (mañana + noche)

### 5.2 Location

- Input: location_pk de IG (Buenos Aires, Palermo, Recoleta, Belgrano, Córdoba, Rosario)
- Endpoint sidecar: `POST /discover/location {location_pk, limit}`
- instagrapi: `cl.location_medias_recent(location_pk, amount=50)`
- Volumen esperado: 20-40 leads / location / corrida
- Cadencia: 1× / día por location

### 5.3 Competitor Followers

- Input: lista de cuentas semilla (boutiques exitosas que ya nos siguen estilo cliente ideal)
- Endpoint sidecar: `POST /discover/competitor-followers {username, limit, max_per_run=200}`
- instagrapi: `cl.user_followers(user_id, amount=200)` (paginado)
- **Cuidado anti-ban:** rate-limit estricto, máx 1 competidor / hora
- Volumen esperado: 100-200 leads / competidor / semana
- Cadencia: 1 competidor / hora (cron)

### 5.4 Post Engagers

- Input: post-IDs de competidores (likers + commenters de posts virales)
- Endpoint sidecar: `POST /discover/post-engagers {media_pk, kind: 'likers'|'commenters'}`
- instagrapi: `cl.media_likers(pk)` o `cl.media_comments(pk)`
- Volumen esperado: 50-100 leads / post / corrida
- Cadencia: ad-hoc (admin dashboard botón "discover from this post")

---

## 6 · Scoring v2 (self-learning)

El scoring v1 (`apex-leads/src/lib/ig/score.ts`) usa pesos hardcoded.
v2 introduce **pesos aprendidos** con actualización Bayesiana semanal.

### 6.1 Features (input)

| Feature | Tipo | Rango | Notas |
|---|---|---|---|
| followers_log | num | 0-5 | log10(followers) |
| posts_log | num | 0-4 | log10(posts) |
| engagement_rate | num | 0-0.2 | likes_avg / followers (últimos 5 posts) |
| has_business_category | bool | 0/1 | api flag |
| business_category_match | num | 0-1 | match con whitelist nichos moda/belleza |
| bio_keyword_match | num | 0-1 | n keywords moda en bio / 5 |
| has_external_url | bool | 0/1 | bio link |
| link_is_linktree_or_ig_only | bool | 0/1 | NO tiene web propia |
| posts_recency_days | num | 0-90 | días desde último post |
| niche_classifier_confidence | num | 0-1 | Claude Haiku confidence |

### 6.2 Modelo

`score = sigmoid(Σ w_i · normalize(feature_i)) · 100`

Pesos iniciales en `scoring_weights` (versionados). Actualización semanal:
- `outcome = 1` si lead respondió, `0` si no respondió en 7 días
- Logistic regression incremental (SGD, 1 paso por outcome)
- Versión nueva queda como `staging`, se promueve a `production` después de A/B (1 semana shadow)

Ver `ARCHITECTURE.md` § 8 para detalles del algoritmo.

---

## 7 · Niche Classifier (Claude Haiku)

Antes de scoring final, clasificamos cada lead en uno de los nichos:
`moda_femenina | moda_masculina | indumentaria_infantil | accesorios | calzado | belleza_estetica | joyeria | otro | descartar`

- Modelo: `claude-haiku-4` (más barato)
- Input: `{full_name, biography, business_category, last_3_post_captions}`
- Output: `{niche, confidence: 0-1, reason: string}`
- Costo: ~$0.0001 / lead (200 input + 50 output tokens)
- Cache: si bio + category no cambian, reusar clasificación 30 días
- Tabla: `niche_classifications`

Solo leads con `niche != 'otro' && niche != 'descartar' && confidence ≥ 0.6` pasan a DM.

---

## 8 · A/B Testing de Templates (Thompson Sampling)

Hoy tenemos un solo template (`pickOpeningTemplate`). v2 introduce:

- Tabla `dm_templates`: id, name, body, variables, status (active|paused|killed), created_at
- Tabla `dm_template_assignments`: lead_id → template_id + outcome (sent/replied)
- Selección: **Thompson sampling** sobre Beta(α=replies+1, β=non_replies+1)
- Mínimo 30 sends por template antes de evaluar dominancia
- Auto-pause si template tiene < 50% del CTR del mejor (con significancia 95%) tras 100 sends

Cada template tiene placeholders `{full_name}`, `{niche}`, `{first_name}`, `{city}` rellenados
desde el profile + classifier output.

---

## 9 · Observabilidad

### 9.1 Tablas de métricas

- `discovery_runs` (inmutable): cada llamada a `/discover/*` → started_at, ended_at, source, params, leads_found, errors
- `discovery_metrics_daily` (materializada): aggregated KPIs por día
- `lead_score_history`: cambios de score over time (para auditar drift)
- `dm_template_stats` (vista): sends, replies, CTR, beta params actualizados

### 9.2 Admin Dashboard (Next.js, ruta `/admin/ig`)

- KPI cards: Reply Rate, Qualified Rate, DMs Today, Pipeline Health
- Gráfico: leads descubiertos / día por fuente (stacked area)
- Gráfico: CTR por template (con CIs)
- Tabla: últimos 50 leads (sortable por score, niche, status)
- Acciones:
  - Pause source / Resume source
  - Kill template / Promote template
  - Re-classify lead manualmente
  - Trigger discovery on-demand (post engagers)
- Auth: cookie httpOnly + role check vs Supabase user (Manuel only por ahora)

### 9.3 Alertas

- Discord webhook (Manuel ya tiene): circuit breaker open > 10 min, reply rate < 3% (3d), daily quota no alcanzado por 2 días
- Tabla `alerts_log` para auditar disparos

---

## 10 · Plan de 14 sesiones

### Phase 1 — Foundation (D01-D03)

| ID | Título | Modelo | Output |
|---|---|---|---|
| **D01** | Schema cleanup + nuevas tablas | Sonnet | Migración Supabase aplicada, tipos TS generados |
| **D02** | Sidecar discovery endpoints (hashtag, location) | Sonnet | 2 endpoints + tests |
| **D03** | Sidecar discovery endpoints (competitor-followers, post-engagers) | Sonnet | 2 endpoints + rate-limit guards |

### Phase 2 — Orchestration & Intelligence (D04-D07)

| ID | Título | Modelo | Output |
|---|---|---|---|
| **D04** | Discovery orchestrator + cron Railway | Sonnet | Worker que recorre `discovery_sources` y llama sidecar |
| **D05** | Lead pre-filter v2 + dedup robusto | Sonnet | `pre-filter` job antes de enrich |
| **D06** | Niche classifier (Claude Haiku) + cache | Opus | Endpoint + integración con run-cycle |
| **D07** | Scoring v2 (features ampliados, weights versionados) | Opus | Migración pesos, calculator nuevo |

### Phase 3 — Observability & Admin (D08-D10)

| ID | Título | Modelo | Output |
|---|---|---|---|
| **D08** | Metrics layer (`discovery_metrics_daily`, vistas) | Sonnet | SQL functions + materialized view + cron refresh |
| **D09** | Admin dashboard read-only (Next.js `/admin/ig`) | Sonnet | UI con KPIs, tablas, charts (recharts) |
| **D10** | Admin dashboard actions + Discord alerts | Sonnet | Pause/resume, kill template, alert webhook |

### Phase 4 — Optimization (D11-D12)

| ID | Título | Modelo | Output |
|---|---|---|---|
| **D11** | A/B testing infra (templates + Thompson sampling) | Opus | `dm_templates`, selector, auto-pause |
| **D12** | Self-learning scoring (weight updater semanal) | Opus | Cron de update + shadow A/B de pesos |

### Phase 5 — Production (D13-D14)

| ID | Título | Modelo | Output |
|---|---|---|---|
| **D13** | E2E tests + chaos drills | Sonnet | Playwright + sidecar mock + alertas verificadas |
| **D14** | Ramp-up plan + monitoring runbook | Sonnet | DRY_RUN→live, 5→10→20→30/día, runbook ops |

---

## 11 · Costos detallados

| Concepto | Mensual estimado |
|---|---|
| Sidecar Railway (1 instance, ~512MB) | $5-10 (incluido en plan Railway de Manuel) |
| Scheduler Railway | $0 (mismo container) |
| Vercel Hobby | $0 |
| Supabase Free | $0 (storage < 500MB con cleanup) |
| Claude Haiku (clasificación: 1000 leads/día × $0.0001) | $3 |
| Claude Sonnet (DM gen + replies: ~50 conv/día × 4 turns × $0.003) | $18 |
| Discord webhook | $0 |
| **TOTAL** | **~$25-30/mes** vs $49+ Apify sin valor agregado |

---

## 12 · Decision Log

| Fecha | Decisión | Razón |
|---|---|---|
| 2026-04-24 | Apify out, instagrapi-native in | Free no devuelve datos, paid no justifica costo, perdemos control |
| 2026-04-24 | 4 fuentes (hashtag/location/competitor/engagers) | Diversifica risk, cubre embudo entero |
| 2026-04-24 | Niche classifier con Haiku, no regex | Bio formats varían, Haiku es 100x más preciso por <$5/mes |
| 2026-04-24 | Thompson sampling sobre A/B clásico | Optimiza durante el experimento, no después |
| 2026-04-24 | Bayesian scoring con shadow A/B | Evita degradación silenciosa de pesos |
| 2026-04-24 | Admin dashboard antes de live | Manuel necesita ver antes de aprobar ramp-up |

---

## 13 · Roadmap futuro (post D14, no en scope)

- Multi-cuenta (rotar entre 2-3 cuentas IG con sus sesiones)
- Auto-respuestas con Claude (cuando lead pide "más info")
- Integración con CRM (HubSpot / Notion DB)
- Discovery por **stories** (instagrapi soporta `cl.user_stories`)
- Reels engagement como señal de scoring
- Webhooks de Manuel ChatBot WhatsApp para handoff lead → ventas

---

## 14 · Cómo usar este plan

1. Leer este `MASTER-PLAN.md` UNA VEZ al arrancar el proyecto.
2. Cada sesión nueva de Claude: copiar el prompt de `prompts/SESSION-DXX.md` correspondiente.
3. Estado vivo en `PROGRESS.md` — actualizado al final de cada sesión.
4. Cambios de scope: documentar en `PROGRESS.md` § "Decisiones de scope" + actualizar `ARCHITECTURE.md` si afecta diseño. **Este archivo no se modifica.**
