# SESSION-02 — Sidecar Python: scaffolding + HMAC + stubs

**Modelo recomendado:** `claude-opus-4-7`
**Permisos recomendados:** edit, write, bash (para docker build, pytest, curl)
**Duración estimada:** 45–60 min

---

## Rol y contexto

Sos un ingeniero backend senior con experiencia en FastAPI, Python 3.11, Docker y Railway. Vas a trabajar en el proyecto "Agente Instagram APEX" de Manuel.

**Trabajo previo:** SESSION-01 completó la auditoría del código Next.js, creó el módulo de validación de env vars (`apex-leads/src/lib/ig/config.ts`) y documentó el contrato HTTP del sidecar. Empezás SESSION-02 (TANDA 1).

## Paso 0 — Orientación (OBLIGATORIO)

Antes de escribir NADA de código, ejecutá en orden:

1. Leé `docs/ig/MASTER-PLAN.md` completo (plan inmutable)
2. Leé `docs/ig/PROGRESS.md` completo (estado vivo)
3. Leé `docs/ig/SIDECAR-CONTRACT.md` completo (contrato HTTP que debés implementar)
4. Leé este prompt (SESSION-02.md) entero
5. Confirmá con el usuario en 1–2 oraciones que entendés el scope de esta sesión antes de arrancar

## Scope de SESSION-02

### Objetivo único
Crear la carpeta `sidecar/` en la raíz del repo con FastAPI + Dockerfile + railway.toml, implementar el middleware HMAC funcionando, y los 4 endpoints devolviendo datos **stub** (hardcodeados) con el schema correcto. Al final, los tests de pytest pasan y se puede probar con curl.

### Tareas concretas

#### 1. Crear estructura `sidecar/`

```
sidecar/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI app, lifespan, middleware HMAC
│   ├── auth.py           # verify_signature() — HMAC-SHA256
│   ├── ig_client.py      # STUB vacío — solo placeholder para SESSION-03
│   ├── session_store.py  # STUB vacío — solo placeholder para SESSION-03
│   ├── circuit_breaker.py# STUB — siempre retorna "circuit closed"
│   └── routes/
│       ├── __init__.py
│       ├── dm.py         # POST /dm/send
│       ├── inbox.py      # POST /inbox/poll
│       ├── profile.py    # POST /profile/enrich
│       └── health.py     # GET /health
├── tests/
│   ├── __init__.py
│   ├── conftest.py       # fixtures: test_client, valid_signature()
│   └── test_auth.py      # pytest para middleware HMAC
├── Dockerfile
├── requirements.txt
└── railway.toml
```

#### 2. Implementar `app/auth.py`

Función `verify_signature(body: bytes, secret: str, header: str) -> bool`.
Algoritmo exacto: ver `docs/ig/SIDECAR-CONTRACT.md` — sección "Autenticación".
Usar `hmac.compare_digest` para timing safety.

#### 3. Implementar middleware HMAC en `app/main.py`

- Middleware FastAPI que intercepta todos los requests excepto `GET /health`.
- Lee el raw body, verifica la firma del header `X-Sidecar-Signature`.
- Si inválida o ausente → responde `401 {"error": "invalid_signature"}` antes de llegar al endpoint.
- `IG_SIDECAR_SECRET` se lee de env vars (requerida, sin default).

#### 4. Implementar endpoints STUB

Todos devuelven datos hardcodeados pero con el schema correcto según `SIDECAR-CONTRACT.md`.

**`POST /dm/send`** — stub response:
```json
{ "thread_id": "stub-thread-001", "message_id": "stub-msg-001" }
```
(sin simular dwell time en stub — SESSION-03 lo agrega)

**`POST /inbox/poll`** — stub response:
```json
{
  "messages": [
    {
      "thread_id": "stub-thread-001",
      "message_id": "stub-msg-inbound-001",
      "ig_username": "boutique_test",
      "text": "Hola! Me interesa el boceto",
      "timestamp": 1714050000,
      "is_outbound": false
    }
  ]
}
```

**`POST /profile/enrich`** — stub response con el username del primer item de `usernames`:
```json
{
  "profiles": [
    {
      "ig_user_id": "12345678901",
      "ig_username": "<username del request>",
      "full_name": "Boutique Stub",
      "biography": "Ropa de mujer ✨ Stub",
      "external_url": null,
      "bio_links": [],
      "followers_count": 1500,
      "following_count": 300,
      "posts_count": 45,
      "is_private": false,
      "is_verified": false,
      "is_business": true,
      "business_category": "Clothing Store",
      "profile_pic_url": null,
      "last_post_at": "2026-04-20T14:30:00Z"
    }
  ],
  "errors": {}
}
```

**`GET /health`** — stub response:
```json
{ "status": "ok", "session_valid": true, "last_action_at": null }
```

#### 5. Tests de pytest (`tests/test_auth.py`)

Casos mínimos requeridos:
- `test_valid_signature_passes` — request con firma válida → 200 (cualquier endpoint)
- `test_invalid_signature_returns_401` — firma incorrecta → 401
- `test_missing_signature_returns_401` — sin header → 401
- `test_health_no_auth_required` — GET /health sin firma → 200
- `test_dm_send_stub_response` — POST /dm/send con firma válida → 200 con schema correcto
- `test_inbox_poll_stub_response` — POST /inbox/poll con firma válida → 200 con schema correcto

Usar `httpx.AsyncClient` + `pytest-asyncio` o `TestClient` de FastAPI (sincrono).

#### 6. `Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### 7. `railway.toml`

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
```

#### 8. Test local con docker + curl

Al terminar, ejecutar:
```bash
cd sidecar
docker build -t ig-sidecar-test .
docker run -e IG_SIDECAR_SECRET=testsecreto1234567890123456789012 -p 8000:8000 ig-sidecar-test
```
Y verificar con curl (ver ejemplos en `SIDECAR-CONTRACT.md`):
- GET /health → 200
- POST /dm/send con firma válida → 200 con thread_id/message_id
- POST /dm/send con firma inválida → 401

### Fuera de scope (NO hacer ahora)
- NO conectar instagrapi real (va en SESSION-03)
- NO implementar session_store real (va en SESSION-03)
- NO deploy a Railway (va en SESSION-04)
- NO implementar circuit breaker real (va en SESSION-03)
- NO tocar código Next.js existente

## Definición de "terminado"

- [ ] `sidecar/` con la estructura completa creada
- [ ] Middleware HMAC implementado y testeado
- [ ] 4 endpoints responden con schema correcto (datos stub)
- [ ] `pytest tests/` pasa (al menos los 6 test cases requeridos)
- [ ] `docker build` exitoso sin errores
- [ ] Curl test manual: firma válida → 200, firma inválida → 401, /health → 200
- [ ] `PROGRESS.md` actualizado: marcar SESSION-02 done, agregar decisiones/notas
- [ ] `docs/ig/prompts/SESSION-03.md` creado con el prompt detallado para la próxima sesión
- [ ] Commit: `feat(ig): session-02 sidecar scaffolding + HMAC + stubs`

## Al terminar la sesión

Escribí `docs/ig/prompts/SESSION-03.md` siguiendo exactamente el formato de este archivo. El contenido de SESSION-03 debe ser:

**SESSION-03 — Sidecar Python: instagrapi integration**
- Modelo: `claude-opus-4-7`
- Scope: implementar instagrapi real en `ig_client.py`, `session_store.py` (persistencia en `/data`), login flow con 2FA, `/profile/enrich` real, `/inbox/poll` real, `/dm/send` real con humanize (dwell time 3–15s), `circuit_breaker.py` real (detecta ChallengeRequired/FeedbackRequired/LoginRequired/PleaseWaitFewMinutes y hace POST a `account_health_log` de Supabase).
- Referencias obligatorias: `docs/ig/MASTER-PLAN.md` secciones 3, 4 y 6, `docs/ig/SIDECAR-CONTRACT.md`, `sidecar/` creado en SESSION-02.
- Fuera de scope: deploy Railway (va en SESSION-04), test contra cuenta real del bot (usar cuenta de prueba personal).

Luego, como mensaje final al usuario:
1. Resumir en 3-5 bullets qué se hizo
2. Listar bloqueos o inputs humanos necesarios antes de SESSION-03
3. Mostrar el comando exacto para arrancar SESSION-03:
   ```
   Nueva sesión de Claude Code → /model claude-opus-4-7 → copiar contenido de docs/ig/prompts/SESSION-03.md
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
