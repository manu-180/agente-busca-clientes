# PROGRESS — Agente Instagram APEX

> **Documento vivo.** Actualizado al final de cada sesión. Esta es la "memoria" del proyecto entre sesiones limpias.

---

## Estado actual

**Última sesión completada:** SESSION-03 — Sidecar instagrapi integration + circuit breaker (2026-04-24)
**Próxima sesión:** SESSION-04 — Sidecar deploy Railway + login real
**Siguiente prompt a usar:** `docs/ig/prompts/SESSION-04.md`

---

## Progreso por tanda

### TANDA 0 — Auditoría y Prep
- [x] SESSION-01 (Sonnet) · Audit + config hardening + docs contrato sidecar

### TANDA 1 — Core Infraestructura
- [x] SESSION-02 (Opus) · Sidecar scaffolding + HMAC + stubs
- [x] SESSION-03 (Opus) · Sidecar instagrapi integration + circuit breaker
- [ ] SESSION-04 (Opus) · Sidecar deploy Railway + login real
- [ ] SESSION-05 (Sonnet) · Scheduler Python en Railway
- [ ] SESSION-06 (Sonnet) · Deploy Next.js a Vercel

### TANDA 2 — Integración + Agente
- [ ] SESSION-07 (Sonnet) · Apify setup + webhook test
- [ ] SESSION-08 (Opus) · Agente templates + links demo/portfolio

### TANDA 3 — Testing E2E
- [ ] SESSION-09 (Opus) · Test E2E DRY_RUN
- [ ] SESSION-10 (Opus) · First live DM + ramp-up setup

### TANDA 4 — Launch
- [ ] SESSION-11 (Sonnet) · Ramp-up y monitoreo

---

## Decisiones tomadas

### SESSION-03 (2026-04-24)

**Session persistence: disco local `/data`, no Supabase Storage**
- `session_store.py` usa JSON local con escritura atómica (temp + os.replace).
- El ig-sidecar draft usaba Supabase Storage + Fernet encryption. Elegimos la variante más simple (disco Railway) porque el volumen persistente ya sobrevive reinicios y elimina una dependencia de red en el boot path crítico.
- `SIDECAR_DATA_DIR` env var permite redirigir a `./data/` en local (tests, dev).

**Circuit breaker fail-open**
- Si Supabase no está disponible durante `check()`, el circuito se considera cerrado (fail-open). Es preferible intentar la acción IG que bloquear todo por un hiccup de DB.
- `open_circuit()` logea el error pero no re-raise — el evento puede perderse, pero el cliente Next.js verá el 503 de todas formas por la excepción IG.

**Exception mapping portado de ig-sidecar/exceptions_map.py con extensiones**
- Añadidos: `ActionBlocked`, `SentryBlock`, `ClientForbiddenError`, `ReloginAttemptExceeded`.
- `UserNotFound` y `PrivateAccountError` nunca abren el circuit — son errores inline del endpoint `/profile/enrich`.

**Tests: 8 HMAC/contract + 7 nuevos con mocks = 15 passed**
- `test_dm_send_stub_response` y `test_inbox_poll_stub_response` renombrados y actualizados a verificar schema/tipos en lugar de valores stub hardcodeados (los stubs ya no existen).
- Mocking de módulo en `conftest.py` con `unittest.mock.patch` aplicado antes de que se importe la app — evita cualquier llamada real a IG o Supabase durante tests.

**`ig-sidecar/` eliminado**
- Código útil portado a `sidecar/app/`: `humanize.py`, lógica de `exceptions_map.py` integrada en `circuit_breaker.py`, implementación de endpoints portada y mejorada.

**`last_action_at` como variable global en `app.main`**
- Las routes hacen `import app.main as _main` y llaman `_main.update_last_action()` post-acción exitosa.
- `/health` lee `_main.last_action_at` directamente.

---

### SESSION-02 (2026-04-24)

**Carpeta canónica = `sidecar/` (no `ig-sidecar/`)**
- SESSION-02 creó `sidecar/` desde cero siguiendo el prompt. La carpeta previa `ig-sidecar/` quedó como **referencia**: contenía fragmentos útiles para SESSION-03. SESSION-03 portó lo útil y borró `ig-sidecar/`.

**Middleware HMAC vía `BaseHTTPMiddleware`**
- Lee raw body una vez, verifica firma, reinyecta body via `request._receive` para que los endpoints lo deserialicen. Skippea únicamente `GET /health`.
- `IG_SIDECAR_SECRET` requerida en boot (fail-fast si falta o < 32 chars).

**Stack de tests**
- `pytest` + `TestClient` de FastAPI (síncrono). 8 casos cubren: firma válida/inválida/ausente/sin prefijo, `/health` sin auth, schemas de los 3 endpoints con datos stub.
- `.venv` local en `sidecar/.venv/` (gitignoreable). Corrida: `IG_SIDECAR_SECRET=... python -m pytest tests/ -v` → 8 passed.

**Docker build NO ejecutado en esta sesión**
- Docker daemon no corría en la máquina de Manuel durante SESSION-02. El smoke test se hizo contra uvicorn local (equivalente funcional). Pendiente: un `docker build` en la máquina de Manuel o directamente al momento del deploy (SESSION-04 en Railway).

---

### SESSION-01 (2026-04-24)

**Zod v4 elegido para validación de env vars**
- Se instaló `zod@^4.3.6` (última versión estable).
- Se creó `apex-leads/src/lib/ig/config.ts` con schema Zod, fail-fast en boot, modo build-tolerante via `NEXT_PHASE === 'phase-production-build'`.

**Bug HIGH documentado en ig-discover (webhook Apify)**
- `payloadTemplate` embeds `APIFY_WEBHOOK_SECRET` como texto plano en el body; el handler del webhook verifica firma en el header `apify-webhook-signature` que Apify no envía automáticamente.
- Resultado probable: todos los webhooks devuelven 401 en producción.
- **Pendiente SESSION-07**: testear con Apify real y alinear mecanismo de auth (opciones: body field check, query param, o signing key real).

**`demos_rubro` slug moda limpiado en Supabase**
- Row `id=8f88a21e-596b-44b1-832d-7fcad08139c4` actualizado.
- `strong_keywords` tenía tokens rotos (`"de"`, `"femenina,"`, etc.) — corregido a 6 keywords semánticas.

---

## Variables de entorno capturadas

### Vercel (Next.js)
- `NEXT_PUBLIC_SUPABASE_URL` = `https://hpbxscfbnhspeckdmkvu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (ya existente)
- `ANTHROPIC_API_KEY` = (ya existente, validado via `igConfig`)
- `IG_SIDECAR_URL` = **pendiente (SESSION-04)**
- `IG_SIDECAR_SECRET` = **pendiente (generar valor REAL de 32+ chars antes de SESSION-04; SESSION-02 usó `testsecreto1234567890123456789012` solo para tests locales)**
- `IG_SENDER_USERNAME` = **pendiente (Manuel proveer)**
- `CRON_SECRET` = **pendiente (SESSION-05, generar y compartir con scheduler)**
- `APIFY_TOKEN` = **pendiente (SESSION-07)**
- `APIFY_WEBHOOK_SECRET` = **pendiente (SESSION-07)**
- `DRY_RUN` = `true` hasta SESSION-10
- `DAILY_DM_LIMIT` = `3` (warmup inicial)
- `FOLLOWUP_HOURS` = `48` (default)
- `IG_WARMUP_MODE` = `true` (durante primeras semanas)

### Railway — ig-sidecar
- `IG_USERNAME` = **pendiente (SESSION-04)**
- `IG_PASSWORD` = **pendiente (SESSION-04)**
- `IG_TOTP_SEED` = **opcional — solo si la cuenta tiene 2FA por app activado**
- `IG_SIDECAR_SECRET` = (mismo que Vercel — generar valor real antes de SESSION-04)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` = (copiar de Vercel)
- `SIDECAR_DATA_DIR` = (NO setear en Railway — usa el default `/data` del volumen)

### Railway — ig-scheduler
- `NEXT_APP_URL` = **pendiente (SESSION-06)**
- `CRON_SECRET` = (mismo que Vercel)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` = (copiar)

---

## URLs y endpoints operativos

- Vercel app: **pendiente (SESSION-06)**
- Railway sidecar: **pendiente (SESSION-04)**
- Railway scheduler: **pendiente (SESSION-05)**
- Supabase project: `hpbxscfbnhspeckdmkvu`
- Apify actor: **pendiente (SESSION-07)**

---

## Bloqueos / Pendientes humanos

- **Manuel debe proveer antes de SESSION-04:**
  - `IG_USERNAME` + `IG_PASSWORD` de la cuenta bot real de Instagram.
  - Decisión: ¿activar 2FA por app (TOTP) en esa cuenta? Si sí, el seed `IG_TOTP_SEED`.
  - Cuenta Railway lista (el proyecto ya debería existir si SESSION-02 lo creó, si no, crear ahora).
- **Manuel debe proveer**: `IG_SENDER_USERNAME` (la cuenta de Instagram que va a enviar DMs).

---

## Notas importantes entre sesiones

- El módulo IG de Next.js ahora falla fast en boot si faltan env vars críticas. Antes de SESSION-06 (deploy Vercel), asegurarse de que TODAS las env vars del schema de `ig/config.ts` estén seteadas en el dashboard de Vercel.
- El contrato HTTP del sidecar está en `docs/ig/SIDECAR-CONTRACT.md` — SESSION-03 lo respeta exactamente.
- La auditoría completa está en `docs/ig/AUDIT-2026-04-23.md`.
- `ig-sidecar/` fue eliminado en SESSION-03. La única carpeta canónica es `sidecar/`.
- Cómo correr el sidecar en local (SESSION-03+):
  ```bash
  cd sidecar
  # Crear sidecar/.env.local con: IG_USERNAME, IG_PASSWORD, IG_SIDECAR_SECRET,
  #   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SIDECAR_DATA_DIR=./data
  python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
  IG_SIDECAR_SECRET=<tu_secret> IG_USERNAME=<user> IG_PASSWORD=<pass> \
    SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> SIDECAR_DATA_DIR=./data \
    .venv/Scripts/python -m uvicorn app.main:app --port 8000
  # Smoke test manual: curl localhost:8000/health
  ```
- Cómo correr los tests:
  ```bash
  cd sidecar
  IG_SIDECAR_SECRET=testsecreto1234567890123456789012 .venv/Scripts/python -m pytest tests/ -v
  # → 15 passed
  ```
