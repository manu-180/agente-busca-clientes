# SESSION-03 — Sidecar Python: instagrapi integration

**Modelo recomendado:** `claude-opus-4-7`
**Permisos recomendados:** edit, write, bash (para pip install, pytest, uvicorn, docker build opcional)
**Duración estimada:** 60–90 min

---

## Rol y contexto

Sos un ingeniero backend senior con experiencia en FastAPI, Python 3.11, instagrapi y automatizaciones anti-ban. Seguís trabajando en "Agente Instagram APEX" de Manuel.

**Trabajo previo:**
- SESSION-01 — auditoría + `apex-leads/src/lib/ig/config.ts` + contrato sidecar (`docs/ig/SIDECAR-CONTRACT.md`).
- SESSION-02 — `sidecar/` scaffolding con FastAPI + middleware HMAC + 4 endpoints STUB + 8 pytest cases + Dockerfile + railway.toml. Los endpoints responden con datos hardcodeados.

**Además:** en la raíz del repo existe `ig-sidecar/` (draft de una iteración previa). Contiene fragmentos útiles que debés portar a `sidecar/app/`: `humanize.py` (dwell/jitter/typing sim), `exceptions_map.py` (map de excepciones instagrapi → event), `session.py` (wrap de login + persistencia), lógica real de `/dm/send`, `/inbox/poll`, `/profile/enrich`. Al final de SESSION-03 **borrás `ig-sidecar/`** para evitar duplicación.

## Paso 0 — Orientación (OBLIGATORIO)

Antes de tocar código:

1. Leé `docs/ig/MASTER-PLAN.md` (plan inmutable).
2. Leé `docs/ig/PROGRESS.md` completo (estado vivo).
3. Leé `docs/ig/SIDECAR-CONTRACT.md` completo (contrato HTTP, tabla de errores, notas de implementación).
4. Leé este prompt (SESSION-03.md) entero.
5. Leé `sidecar/app/main.py`, `sidecar/app/auth.py` y los 4 routes de `sidecar/app/routes/` para entender el scaffolding ya en pie.
6. Leé `ig-sidecar/main.py`, `ig-sidecar/humanize.py`, `ig-sidecar/exceptions_map.py`, `ig-sidecar/session.py` para ver qué vale la pena portar.
7. Confirmá al usuario en 1–2 oraciones que entendés el scope antes de arrancar.

## Scope de SESSION-03

### Objetivo único
Reemplazar los stubs por integración real con **instagrapi**: login con sesión persistida en `/data`, circuit breaker obligatorio antes de cada acción, y los 3 endpoints POST devolviendo datos reales. Tests de integración corren contra una cuenta de prueba personal (NO la cuenta de producción). Al final, el sidecar está listo para deploy (SESSION-04).

### Tareas concretas

#### 1. Agregar dependencias a `sidecar/requirements.txt`
- `instagrapi` (última estable)
- `supabase` (client Python para `account_health_log`)
- `python-dotenv` solo si es necesario para `.env` local (opcional)

#### 2. `sidecar/app/session_store.py` — persistencia JSON en `/data`
- `load() -> dict | None` lee `/data/session.json` si existe.
- `save(payload: dict) -> None` escribe atómicamente (write a temp + `os.replace`).
- Respetar permisos del volumen Railway montado en `/data`. Fallback a `./data/` si la variable `SIDECAR_DATA_DIR` está seteada (útil para testing local).

#### 3. `sidecar/app/ig_client.py` — wrapper de instagrapi
- Clase `IGClient` con:
  - `login()` — carga sesión de disco; si no existe o es inválida, login con `IG_USERNAME` + `IG_PASSWORD` + 2FA via `IG_TOTP_SEED` si está definido; guarda sesión resultante en disco.
  - `send_dm(username, text, simulate_human) -> (thread_id, message_id)` — integra `humanize` (dwell time 3–15s, typing sim) cuando `simulate_human=True`.
  - `poll_inbox(since_ts) -> list[InboxMessage]` — itera threads, filtra por timestamp, incluye outbound para dedupe.
  - `enrich_profiles(usernames) -> (profiles, errors)` — batch de máximo 20, pausa 30s entre batches, maneja `UserNotFound`/`PrivateAccountError` inline como errores del dict.
- Singleton cacheado (lazy) para reusar la misma sesión.

#### 4. `sidecar/app/humanize.py` — portar de `ig-sidecar/humanize.py`
- `dwell(min_s, max_s)`, `jitter(base)`, `typing_sim(text)` con random entre CPS.

#### 5. `sidecar/app/circuit_breaker.py` — implementación real
- `check()` consulta `account_health_log` (Supabase) para el `IG_USERNAME` y retorna `CircuitState(open=bool, cooldown_until=ISO-8601)` si hay cooldown vigente.
- `open(event, cooldown_hours, payload)` inserta una fila en `account_health_log`.
- `map_and_raise(exc)` inspecciona la excepción (helper portado de `ig-sidecar/exceptions_map.py`):
  - `ChallengeRequired` → `open("challenge_required", 48, ...)` → `HTTPException(503)`
  - `FeedbackRequired` → `open("feedback_required", 48, ...)` → 503
  - `LoginRequired` → `open("login_required", 1, ...)` → 503
  - `PleaseWaitFewMinutes` → `open("rate_limited", 0.25, ...)` → 503
  - `UserNotFound` / `PrivateAccountError` → NO circuit, se propagan hacia arriba como excepciones específicas para que `/profile/enrich` las meta en `errors`.
  - Otra `ClientError` → 500.

#### 6. Cambios en `sidecar/app/main.py`
- Lifespan: llamar `IGClient().login()` al boot (blocking). Si falla, loggear + continuar con `session_valid=False` (no matar el proceso — el health check va a reportar `degraded` y Railway va a reintentar).
- Tracking de `last_action_at` en memoria (updated desde los routes después de cada acción exitosa) para el `/health`.

#### 7. Endpoints reales
- Reemplazar stubs de `dm.py`, `inbox.py`, `profile.py` por llamadas a `IGClient` + check de circuit antes.
- `/dm/send` y `/inbox/poll` → si circuit abierto → 503 con `{"error": "circuit_open", "cooldown_until": "..."}`.
- `/health` → lee estado de sesión + último cooldown de circuit para calcular `status: "ok" | "degraded"`.

#### 8. Tests
- Mantener los 8 tests de HMAC/stub (NO se rompen — si las rutas cambian contrato, los tests te avisan).
- Nuevos tests (todos con `IGClient` mockeado vía `monkeypatch`):
  - `test_dm_send_calls_client` — verifica que llama `client.send_dm` con los args correctos.
  - `test_dm_send_circuit_open_returns_503` — mock circuit.check → open; espera 503 con `cooldown_until`.
  - `test_profile_enrich_handles_user_not_found` — mock `client.enrich_profiles` → retorna errors dict; valida que la respuesta tiene el username en `errors`.
  - `test_health_reports_degraded_when_session_invalid`.
  - Para los tests de ChallengeRequired → log a `account_health_log`, mockear el supabase client (no hacer la llamada real).

#### 9. Test local contra cuenta personal
- Manuel provee credenciales de una cuenta IG **personal** de prueba (NO la cuenta del bot real):
  - `IG_USERNAME`, `IG_PASSWORD`, opcional `IG_TOTP_SEED`.
- Crear `sidecar/.env.local` (gitignored) con esas vars + `IG_SIDECAR_SECRET` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Correr local: `uvicorn app.main:app --port 8000`.
- Smoke test manual:
  1. GET /health → espera `session_valid=true`.
  2. POST /profile/enrich contra un username real conocido → espera datos reales.
  3. POST /dm/send a otra cuenta personal tuya → verificar que el DM llegó.
  4. POST /inbox/poll → debe ver el DM outbound.
- **NO** correr contra la cuenta de producción del bot — eso es SESSION-04 en Railway.

#### 10. Limpieza
- Borrar `ig-sidecar/` completo (después de confirmar que lo útil ya está en `sidecar/app/`).
- Verificar que no quedan imports hacia `ig-sidecar/` desde ningún lugar (grep).

### Fuera de scope (NO hacer ahora)
- Deploy a Railway (SESSION-04).
- Test contra la cuenta real del bot (SESSION-04 con ramp-up).
- Scheduler (SESSION-05).
- Integración con `apex-leads/src/lib/ig/sidecar.ts` — ya existe y debería matchear; si no, abrir ticket para ajustar en SESSION-06.

## Definición de "terminado"

- [ ] `sidecar/app/ig_client.py`, `session_store.py`, `circuit_breaker.py`, `humanize.py` implementados (no más stubs).
- [ ] Los 3 endpoints POST hacen llamadas reales a instagrapi.
- [ ] Circuit breaker consulta Supabase antes de cada acción; si abierto, devuelve 503.
- [ ] Mapa de excepciones instagrapi → HTTP status + `account_health_log` INSERT.
- [ ] Los 8 tests de SESSION-02 siguen verdes + los 4–5 nuevos con mocks pasan.
- [ ] Smoke test manual contra cuenta personal pasó (login + send + poll + enrich).
- [ ] `ig-sidecar/` eliminado.
- [ ] `PROGRESS.md` actualizado.
- [ ] `docs/ig/prompts/SESSION-04.md` creado.
- [ ] Commit: `feat(ig): session-03 sidecar instagrapi integration + circuit breaker`.

## Al terminar la sesión

Escribí `docs/ig/prompts/SESSION-04.md` con el mismo formato. Contenido:

**SESSION-04 — Sidecar: deploy Railway + login real**
- Modelo: `claude-opus-4-7`
- Scope: crear proyecto Railway (service `ig-sidecar`), Dockerfile build, volumen persistente en `/data`, env vars (`IG_USERNAME`, `IG_PASSWORD`, `IG_TOTP_SEED?`, `IG_SIDECAR_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), primera vez: shell de Railway para login interactivo con 2FA manual si hace falta, verificar que `/data/session.json` se creó, curl `/health` desde fuera con firma.
- Referencias obligatorias: `docs/ig/MASTER-PLAN.md` sección 5 (TANDA 1 SESSION-04), `sidecar/` completa.
- Fuera de scope: scheduler (SESSION-05), primera cron real (SESSION-06), ramp-up (SESSION-10/11).

Después, mensaje final al usuario:
1. Resumir en 3–5 bullets qué se hizo.
2. Listar bloqueos/inputs humanos para SESSION-04 (p.ej. credenciales de la cuenta real, decisión sobre 2FA app, cuenta Railway lista).
3. Mostrar el comando exacto:
   ```
   Nueva sesión de Claude Code → /model claude-opus-4-7 → copiar contenido de docs/ig/prompts/SESSION-04.md
   ```

## Reglas generales para TODA sesión de este proyecto

1. **Siempre leer MASTER-PLAN.md y PROGRESS.md primero**. No asumir nada.
2. **Actualizar PROGRESS.md al final**. Es la memoria.
3. **Escribir el SESSION-(XX+1).md al final**. Es el handoff.
4. **Commits atómicos** con prefijo `feat(ig):`, `fix(ig):`, `chore(ig):`, `docs(ig):` según corresponda.
5. **Nunca editar MASTER-PLAN.md** salvo erratas o clarificaciones.
6. **Stack fijo**: Next.js 14 + TypeScript strict + Supabase + Python 3.11 (sidecar/scheduler) + instagrapi. NO proponer alternativas.
7. **No emojis** en código ni docs (sí en conversación con Manuel si ayuda).
8. **Arquitectura limpia**: separación de concerns, funciones chicas, tests donde aporte, sin abstracciones prematuras.
