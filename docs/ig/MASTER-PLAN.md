# MASTER PLAN — Agente Instagram APEX

> **Documento inmutable.** Este es el plan de construcción completo. Si algo necesita cambiar, se documenta en `PROGRESS.md` como decisión, NO se edita este archivo salvo errores de tipeo o clarificaciones puntuales.

Autor: Manuel · Fecha: 2026-04-23 · Stack: Next.js + Supabase + Railway (Python sidecar + scheduler) + Apify + Anthropic

---

## 1. OBJETIVO

Construir un agente que:
1. **Descubre** cuentas de Instagram de boutiques/tiendas de ropa femenina en Argentina (vía Apify hashtag scraping)
2. **Filtra** las que NO tienen página web propia (excluye `own_site`, acepta `no_link`/`aggregator`/`marketplace`/`social_only`)
3. **Envía DM inicial personalizado** por Instagram usando Claude (tono rioplatense, sin links en el primer mensaje)
4. **Mantiene toda la conversación** por DM, con clasificación de intención
5. **Menciona el demo** `https://moda.theapexweb.com/` y el portfolio `https://www.theapexweb.com/` cuando el lead muestra interés explícito
6. **Coordina una llamada** de 10 min si hay interés real

Objetivo de performance: 30–40 DMs/día sostenible, >5% reply rate, >1 llamada coordinada/semana.

---

## 2. ARQUITECTURA

```
┌────────────────────── RAILWAY ──────────────────────┐
│  ┌──────────────────┐       ┌──────────────────┐    │
│  │ ig-sidecar       │       │ ig-scheduler     │    │
│  │ FastAPI+instagrapi│◄──────│ APScheduler      │    │
│  │ Volumen persist.  │       │ hit Next cron    │    │
│  └──────────────────┘       └────────┬─────────┘    │
└──────┬──────────────────────────────┬┘              │
       │ HMAC                         │ Bearer         │
       ▼                              ▼                │
┌──────────────── VERCEL (Hobby free) ──────────────┐  │
│  Next.js: API routes + Admin UI                   │  │
│  /api/cron/ig-*                                   │  │
│  /api/webhooks/apify                              │  │
│  /admin/ig                                        │  │
└────┬────────────┬────────────────────────────────┘   │
     │            │                                     │
  Supabase     Apify                 Anthropic Sonnet  │
  (shared)    IG scraper             (msg generation)  │
```

### Decisiones arquitectónicas
- **Scheduler separado del sidecar** — si el sidecar entra en cooldown, el scheduler sigue vivo y registra fallos.
- **Sidecar con volumen persistente** en Railway — la sesión de instagrapi (cookies + settings) sobrevive reinicios. Crítico para evitar re-login → challenge → ban.
- **HMAC en TODO** — endpoints internos firmados con `IG_SIDECAR_SECRET` y `CRON_SECRET`.
- **DRY_RUN a nivel env var** — mismo código, dos modos.
- **Cron logs en `cron_runs` (Supabase)** — observabilidad gratis.

---

## 3. SERVICIOS Y RESPONSABILIDADES

| Servicio | Runtime | Rol |
|----------|---------|-----|
| Next.js app | Vercel Hobby | Webhooks, admin UI, API routes `/api/cron/ig-*` (disparadas externamente), `/api/webhooks/apify` |
| ig-sidecar | Railway | FastAPI con instagrapi. Expone `/dm/send`, `/inbox/poll`, `/profile/enrich`, `/health` con firma HMAC |
| ig-scheduler | Railway | Proceso Python con APScheduler. Dispara endpoints cron de Next.js con Bearer CRON_SECRET. Loggea a `cron_runs` |
| Supabase | Hosted | Tablas ya creadas: `instagram_leads`, `instagram_leads_raw`, `instagram_conversations`, `dm_queue`, `dm_daily_quota`, `account_health_log`, `cron_runs`, `demos_rubro` |
| Apify | Hosted | Actor `apify/instagram-scraper`, webhook a Vercel en `ACTOR.RUN.SUCCEEDED` |
| Anthropic | API | Claude Sonnet 4.6 — generación del primer DM + respuestas |

---

## 4. CONTRATO HTTP DEL SIDECAR

Autenticación: todos los requests llevan header `X-Sidecar-Signature: sha256=<hmac(body, IG_SIDECAR_SECRET)>`.

### `POST /dm/send`
```json
Req:  { "ig_username": "boutique_abc", "text": "...", "simulate_human": true }
Resp: { "thread_id": "...", "message_id": "..." }
Err 503: circuit open (body: { "cooldown_until": "ISO-8601" })
```

### `POST /inbox/poll`
```json
Req:  { "since_ts": 1714000000 | null }
Resp: { "messages": [{ "thread_id", "message_id", "ig_username", "text", "timestamp", "is_outbound" }] }
```

### `POST /profile/enrich`
```json
Req:  { "usernames": ["a", "b", ...] }
Resp: { "profiles": [{ ig_user_id, ig_username, full_name, biography, external_url, bio_links, followers_count, ... }], "errors": { "username": "msg" } }
```

### `GET /health`
```json
Resp: { "status": "ok" | "degraded", "session_valid": true, "last_action_at": "ISO" }
```

---

## 5. PLAN DE EJECUCIÓN — SESIONES

Cada sesión es un bloque de trabajo autocontenido. Al terminar, la sesión actualiza `PROGRESS.md` y genera el prompt de la siguiente en `docs/ig/prompts/SESSION-XX.md`.

### TANDA 0 — Auditoría y Prep

**SESSION-01** — `[Sonnet]` · Auditar código IG existente + hardening
- Scan de `apex-leads/src/lib/ig/*` y `apex-leads/src/app/api/{ig,cron/ig-*,webhooks/apify}/**` buscando bugs, TODOs, inconsistencias
- Crear `apex-leads/src/lib/ig/config.ts` con validación Zod de TODAS las env vars IG (fail-fast en boot)
- Limpiar `demos_rubro` (keywords basura en slug de moda)
- Documentar el contrato del sidecar en `docs/ig/SIDECAR-CONTRACT.md`
- Deliverables: 1 commit "chore(ig): audit + config hardening", PROGRESS actualizado

### TANDA 1 — Core Infraestructura

**SESSION-02** — `[Opus]` · Sidecar Python — scaffolding + endpoints stub
- Crear carpeta `sidecar/` en raíz del repo con estructura: `app/{main.py, ig_client.py, auth.py, routes/}`, `Dockerfile`, `requirements.txt`, `railway.toml`
- FastAPI + middleware HMAC funcionando
- Endpoints en modo STUB (devuelven datos falsos pero estructura correcta)
- Tests unitarios del middleware HMAC (pytest)
- Test local: `docker build` + `curl` con firma válida e inválida
- Deliverables: carpeta `sidecar/` con scaffolding, endpoints responden 200 con datos stub

**SESSION-03** — `[Opus]` · Sidecar Python — instagrapi integration
- Wire `instagrapi` en `ig_client.py`
- `session_store.py` con persistencia JSON en `/data` (volumen Railway)
- Login flow: primera vez pide username+password+2FA por env vars → guarda sesión. Siguientes veces carga de disco.
- Implementar `/profile/enrich` real
- Implementar `/inbox/poll` real (threading.last_message, filtra `since_ts`)
- Implementar `/dm/send` real con `humanize.py` (dwell time 3–15s random, typing simulation)
- `circuit_breaker.py` — detecta `ChallengeRequired`, `FeedbackRequired`, `LoginRequired`, `PleaseWaitFewMinutes` → POST a Supabase `account_health_log` + devuelve 503
- Test LOCAL contra una cuenta de prueba (no la real del bot todavía)
- Deliverables: sidecar funcional en local, cubre los 3 flows principales

**SESSION-04** — `[Opus]` · Sidecar — deploy Railway + login real
- Railway project: service "ig-sidecar" con Dockerfile
- Montar volumen en `/data`
- Env vars: `IG_USERNAME`, `IG_PASSWORD`, `IG_TOTP_SEED` (si activás 2FA por app), `IG_SIDECAR_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Primera vez: login interactivo vía Railway shell con 2FA manual si hace falta
- Test producción: `curl https://ig-sidecar-xxx.up.railway.app/health` con firma
- Deliverables: sidecar en producción, sesión persistida, URL pública lista para Next.js

**SESSION-05** — `[Sonnet]` · Scheduler Python en Railway
- Crear `sidecar/scheduler/` (mismo repo, 2do service Railway)
- APScheduler con los 6 jobs (ig-discover, ig-enrich, ig-send-pending, ig-poll-inbox, ig-followup, ig-daily)
- Cada job: POST a `NEXT_APP_URL/api/cron/<name>` con Bearer CRON_SECRET
- Loggea start/end/status a tabla `cron_runs` (Supabase client)
- Si Next devuelve 503, reintenta en 15 min
- Deploy Railway como 2do service
- Deliverables: scheduler corriendo, pero crons NO disparan todavía (Next.js no deployado aún)

**SESSION-06** — `[Sonnet]` · Deploy Next.js a Vercel
- Conectar repo `apex-leads/` a Vercel (Hobby free)
- Env vars producción: todas las del `.env.local` + `IG_SIDECAR_URL`, `IG_SIDECAR_SECRET`, `IG_SENDER_USERNAME`, `CRON_SECRET`, `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET`, `DRY_RUN=true`
- Eliminar cron config de `vercel.json` si existe (migramos a Railway)
- Smoke test: `/admin/ig` carga, `/api/webhooks/apify` responde 401 sin firma
- Confirmar al scheduler la `NEXT_APP_URL` real → empiezan a disparar crons
- Deliverables: Next.js en producción, scheduler apuntando a URL real

### TANDA 2 — Integración + Agente

**SESSION-07** — `[Sonnet]` · Apify setup + webhook test
- Cuenta Apify (plan free $5/mes crédito)
- Confirmar actor correcto: `apify/instagram-scraper` o `apidojo/instagram-scraper` (chequear cuál funciona hoy, el código apunta al 2do)
- `APIFY_TOKEN` + `APIFY_WEBHOOK_SECRET` en Vercel + Railway scheduler
- Manual run del scraper de 1 hashtag → verificar webhook llega a `/api/webhooks/apify`, aparecen filas en `instagram_leads_raw`
- Deliverables: Apify integrado, primer batch de leads raw en Supabase

**SESSION-08** — `[Opus]` · Agente — links + prompt refinement
- Modificar `apex-leads/src/lib/ig/prompts/system.ts`:
  - Mantener "no links en primer mensaje"
  - NUEVO: cuando el lead muestra interés explícito, mencionar `moda.theapexweb.com` (demo) y `www.theapexweb.com` (portfolio)
- Modificar `templates.ts`: `REPLY_TEMPLATES.interested_next_step` y `what_includes` incluyen links
- En `handle-reply.ts`: cuando `intent ∈ {interested, wants_call}`, fetchar `demos_rubro` (slug moda) y pasar URL como contexto del prompt
- Refactor: usar `src/lib/demo-match.ts` existente si aplica, o crear helper `ig/demo-lookup.ts`
- Tests: snapshot tests de los templates + mock de Claude para verificar que la URL aparece en outputs de intent `interested`
- Deliverables: agente ahora ofrece demo + portfolio en momento correcto

### TANDA 3 — Testing End-to-End

**SESSION-09** — `[Opus]` · Test E2E con DRY_RUN
Pasos secuenciales (si algo falla, debuggear, no avanzar):
1. POST a `/api/cron/ig-discover` con Bearer CRON_SECRET → run Apify → webhook → filas `instagram_leads_raw`
2. POST a `/api/cron/ig-enrich` → filas procesadas → `instagram_leads` con status `qualified`, `link_verdict`, `lead_score`
3. SQL manual: `INSERT INTO dm_queue (lead_id, scheduled_at) VALUES (<lead_test>, NOW())`
4. POST a `/api/cron/ig-send-pending` con `DRY_RUN=true` → log del mensaje generado por Claude en consola Vercel, marca queue como sent
5. INSERT manual en `instagram_conversations` con `role=user`, invocar `handleIncomingReply` via test endpoint o script → verificar respuesta generada con URL
- Deliverables: pipeline completo validado end-to-end sin enviar nada real a Instagram

**SESSION-10** — `[Opus]` · First live DM + ramp-up setup
- Setear `DRY_RUN=false` en Vercel
- Crear lead de test apuntando a una 2da cuenta de IG personal de Manuel
- Ejecutar `/api/cron/ig-send-pending` → DM real llega a esa cuenta
- Desde la cuenta test, responder → esperar 3 min (poll-inbox) → verificar que agente responde
- Probar intent `pricing_question`, `interested`, `declined` desde la cuenta test
- Configurar ramp-up en `configuracion`: `ig_max_dms_per_day = 5`
- Deliverables: sistema live validado, ramp-up activo en 5 DMs/día

### TANDA 4 — Launch

**SESSION-11** — `[Sonnet]` · Ramp-up y monitoreo
- Día 1: 5 DMs reales a leads qualified
- Monitoreo de `account_health_log` cada 6h
- Si 0 eventos críticos → día 2-3 sube a 10, día 4-7 a 20, día 8+ a 30-40
- Ajustes de templates según respuestas reales
- Deliverables: sistema operando sostenible, dashboard de métricas en `/admin/ig`

---

## 6. REGLAS DE SEGURIDAD / ANTI-BAN

1. Sesión persistida — nunca re-login innecesariamente
2. Circuit breaker obligatorio antes de cada send
3. Dwell time aleatorio (3–15s) antes de enviar DM
4. Máximo 40 DMs/día (ramp-up gradual)
5. Horario de envío: 9:30 – 21:30 ART únicamente (validación en `ig-send-pending`)
6. Jitter entre envíos: mínimo 90s, promedio 3 min
7. Si `account_health_log` registra challenge/feedback → pausa 48h
8. Rate limit en `/profile/enrich`: batch máx 20 perfiles, pausa 30s entre batches

---

## 7. COSTOS ESTIMADOS

| Servicio | Costo |
|----------|-------|
| Railway (sidecar + scheduler) | ~$5-10/mes |
| Vercel Hobby | $0 |
| Supabase | Existente (shared) |
| Apify free tier | $5 crédito/mes (suficiente) |
| Anthropic | ~$0.01-0.05/conversación completa |
| **Total marginal** | **~$10-15/mes** |

---

## 8. DEFINICIÓN DE "TERMINADO"

El proyecto está terminado cuando:
- [ ] Un lead nuevo descubierto por Apify termina con una llamada coordinada sin intervención manual
- [ ] 0 challenges/feedbacks de Instagram en 7 días consecutivos a 30+ DMs/día
- [ ] Logs completos de cada conversación accesibles en `/admin/ig`
- [ ] Sidecar y scheduler auto-reinician sin pérdida de sesión
