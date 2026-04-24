# SIDECAR CONTRACT — ig-sidecar HTTP API

> **Referencia canónica** para SESSION-02/03 (scaffolding + instagrapi real).
> Los tipos TypeScript del cliente viven en `apex-leads/src/lib/ig/sidecar.ts` y **deben matchear exactamente** este documento.

Autor: SESSION-01 · Fecha: 2026-04-24

---

## Autenticación

Todos los endpoints (excepto `/health`) requieren el header:

```
X-Sidecar-Signature: sha256=<hmac>
```

Donde `<hmac>` es:

```
HMAC-SHA256(key=IG_SIDECAR_SECRET, message=<raw_request_body_bytes>)
```

expresado en hexadecimal lowercase.

### Algoritmo exacto (Python — lado sidecar)

```python
import hmac, hashlib

def verify_signature(body: bytes, secret: str, header: str) -> bool:
    if not header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)
```

### Algoritmo exacto (TypeScript — lado Next.js, en `sidecar.ts`)

```typescript
import crypto from 'crypto'
function sign(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}
```

### Reglas

- El body que se firma es el **raw bytes** del request (antes de deserializar JSON).
- Si la firma no es válida o el header falta → responder `401 { "error": "invalid_signature" }`.
- Usar **comparación timing-safe** para prevenir timing attacks.
- `IG_SIDECAR_SECRET` mínimo 32 caracteres (validado en `ig/config.ts`).

---

## Endpoints

### `POST /dm/send`

Envía un DM a un usuario de Instagram. Incluye dwell time aleatorio (3–15s) para simular comportamiento humano.

**Request**
```json
{
  "ig_username": "boutique_abc",
  "text": "Hola! Vi tu perfil...",
  "simulate_human": true
}
```

| campo | tipo | requerido | descripción |
|---|---|---|---|
| `ig_username` | string | sí | Username IG del destinatario (sin @) |
| `text` | string | sí | Texto del DM |
| `simulate_human` | boolean | no (default: true) | Si true, aplica dwell time aleatorio antes de enviar |

**Response 200**
```json
{
  "thread_id": "340282366841710300949128132705209799680",
  "message_id": "29041234567890123456789"
}
```

| campo | tipo | descripción |
|---|---|---|
| `thread_id` | string | ID del thread de Instagram (persiste entre mensajes) |
| `message_id` | string | ID del mensaje enviado |

**Response 503 — Circuit open**
```json
{
  "error": "circuit_open",
  "cooldown_until": "2026-04-24T15:30:00Z"
}
```

Significa que instagrapi detectó un evento crítico (challenge, feedback, rate limit). El cliente Next.js interpreta 503 como circuit open y pausa el outbound.

**Errores**
| status | body | causa |
|---|---|---|
| 401 | `{ "error": "invalid_signature" }` | HMAC inválido o ausente |
| 422 | `{ "error": "validation_error", "detail": "..." }` | Campo faltante o tipo incorrecto |
| 503 | `{ "error": "circuit_open", "cooldown_until": "ISO-8601" }` | Circuit breaker activo |
| 500 | `{ "error": "internal_error", "detail": "..." }` | Error inesperado de instagrapi |

---

### `POST /inbox/poll`

Obtiene mensajes recibidos desde un timestamp dado. Incluye mensajes outbound del bot para contexto de deduplicación.

**Request**
```json
{
  "since_ts": 1714000000
}
```

| campo | tipo | requerido | descripción |
|---|---|---|---|
| `since_ts` | number (unix epoch en segundos) \| null | sí | Si null, devuelve los últimos 50 mensajes |

**Response 200**
```json
{
  "messages": [
    {
      "thread_id": "340282366841710300949128132705209799680",
      "message_id": "29041234567890123456789",
      "ig_username": "boutique_abc",
      "text": "Hola! Me interesa el boceto",
      "timestamp": 1714050000,
      "is_outbound": false
    }
  ]
}
```

| campo | tipo | descripción |
|---|---|---|
| `messages` | array | Lista de mensajes ordenados por timestamp ASC |
| `thread_id` | string | ID del thread |
| `message_id` | string | ID único del mensaje (usar para deduplicación) |
| `ig_username` | string | Username del interlocutor |
| `text` | string | Texto del mensaje |
| `timestamp` | number | Unix epoch en segundos |
| `is_outbound` | boolean | true si fue enviado por el bot, false si fue recibido |

**Errores**
| status | body | causa |
|---|---|---|
| 401 | `{ "error": "invalid_signature" }` | HMAC inválido |
| 422 | `{ "error": "validation_error", "detail": "..." }` | Tipo incorrecto |
| 503 | `{ "error": "circuit_open", "cooldown_until": "ISO-8601" }` | Circuit breaker activo |

---

### `POST /profile/enrich`

Obtiene datos de perfil de Instagram para una lista de usernames. Rate limit interno: batch máx 20 perfiles, pausa 30s entre batches (en el sidecar).

**Request**
```json
{
  "usernames": ["boutique_abc", "moda_cba", "tienda_xyz"]
}
```

| campo | tipo | requerido | descripción |
|---|---|---|---|
| `usernames` | string[] | sí | Lista de usernames IG (sin @), máx 20 por request |

**Response 200**
```json
{
  "profiles": [
    {
      "ig_user_id": "12345678901",
      "ig_username": "boutique_abc",
      "full_name": "Boutique ABC",
      "biography": "Ropa de mujer ✨ Envíos a todo el país",
      "external_url": "https://linktr.ee/boutiqueabc",
      "bio_links": [
        { "url": "https://linktr.ee/boutiqueabc", "title": "Mis links" }
      ],
      "followers_count": 3450,
      "following_count": 812,
      "posts_count": 234,
      "is_private": false,
      "is_verified": false,
      "is_business": true,
      "business_category": "Clothing Store",
      "profile_pic_url": "https://cdn.instagram.com/...",
      "last_post_at": "2026-04-20T14:30:00Z"
    }
  ],
  "errors": {
    "moda_cba": "ProfileNotFound",
    "tienda_xyz": "PrivateProfile"
  }
}
```

| campo | tipo | descripción |
|---|---|---|
| `profiles` | array | Perfiles enriquecidos exitosamente |
| `ig_user_id` | string | ID numérico interno de Instagram |
| `ig_username` | string | Username |
| `full_name` | string \| null | Nombre completo del perfil |
| `biography` | string \| null | Texto de la bio |
| `external_url` | string \| null | URL en la bio (campo principal) |
| `bio_links` | `{url: string, title?: string}[]` | Links del link-in-bio (puede tener varios) |
| `followers_count` | number | Cantidad de seguidores |
| `following_count` | number | Cantidad de seguidos |
| `posts_count` | number | Total de posts |
| `is_private` | boolean | Si la cuenta es privada |
| `is_verified` | boolean | Si tiene tilde azul |
| `is_business` | boolean | Si tiene perfil de negocio |
| `business_category` | string \| null | Categoría del negocio en IG |
| `profile_pic_url` | string \| null | URL de la foto de perfil |
| `last_post_at` | string (ISO-8601) \| null | Fecha del último post |
| `errors` | `Record<string, string>` | Username → mensaje de error para los que fallaron |

**Errores**
| status | body | causa |
|---|---|---|
| 401 | `{ "error": "invalid_signature" }` | HMAC inválido |
| 422 | `{ "error": "validation_error", "detail": "..." }` | Lista vacía o > 20 items |
| 503 | `{ "error": "circuit_open", "cooldown_until": "ISO-8601" }` | Circuit breaker activo |

---

### `GET /health`

Verifica el estado del sidecar y la validez de la sesión de Instagram. No requiere firma HMAC (endpoint público).

**Request**: GET sin body.

**Response 200**
```json
{
  "status": "ok",
  "session_valid": true,
  "last_action_at": "2026-04-24T14:15:00Z"
}
```

| campo | tipo | descripción |
|---|---|---|
| `status` | `"ok"` \| `"degraded"` | `"degraded"` cuando la sesión no es válida o hay un circuit abierto |
| `session_valid` | boolean | Si la sesión de instagrapi está activa y autenticada |
| `last_action_at` | string (ISO-8601) \| null | Timestamp de la última acción exitosa |

---

## Tabla de errores de instagrapi → HTTP

El sidecar debe capturar estas excepciones y mapearlas correctamente:

| Excepción instagrapi | HTTP | body | acción adicional |
|---|---|---|---|
| `ChallengeRequired` | 503 | `{ "error": "circuit_open", "cooldown_until": "+48h" }` | POST a `account_health_log` event=`challenge_required`, pausa 48h |
| `FeedbackRequired` | 503 | `{ "error": "circuit_open", "cooldown_until": "+48h" }` | POST a `account_health_log` event=`feedback_required`, pausa 48h |
| `LoginRequired` | 503 | `{ "error": "circuit_open", "cooldown_until": "+1h" }` | POST a `account_health_log` event=`login_required`, intento de re-login |
| `PleaseWaitFewMinutes` | 503 | `{ "error": "circuit_open", "cooldown_until": "+15m" }` | POST a `account_health_log` event=`rate_limited` |
| `UserNotFound` | 200 (en `errors`) | campo en `errors.username` | Solo para `/profile/enrich` — no cierra el circuit |
| `PrivateAccountError` | 200 (en `errors`) | campo en `errors.username` | Solo para `/profile/enrich` |
| `ClientError` genérico | 500 | `{ "error": "internal_error", "detail": "..." }` | Log, no cierra circuit |
| `NetworkError` / timeout | 500 | `{ "error": "internal_error", "detail": "timeout" }` | Log, reintento automático en el caller |

### Campos de `account_health_log` (Supabase)

Cuando se detecta un evento crítico, el sidecar debe hacer POST directamente a Supabase via la tabla `account_health_log`:

```sql
INSERT INTO account_health_log (sender_ig, event, payload, cooldown_until)
VALUES (
  '<IG_USERNAME>',
  '<event_name>',
  '{ "exception": "...", "detail": "..." }',
  '<ISO-timestamp del cooldown>'
)
```

---

## Ejemplos curl con firma

> Reemplazar `$SECRET` con el valor de `IG_SIDECAR_SECRET` (min 32 chars) y `$URL` con la URL pública del sidecar.

### Health check (sin firma)

```bash
curl https://$URL/health
```

### Send DM

```bash
BODY='{"ig_username":"boutique_test","text":"Hola test","simulate_human":false}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST https://$URL/dm/send \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Signature: $SIG" \
  -d "$BODY"
```

### Poll inbox

```bash
BODY='{"since_ts":null}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST https://$URL/inbox/poll \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Signature: $SIG" \
  -d "$BODY"
```

### Enrich profiles

```bash
BODY='{"usernames":["boutique_abc","tienda_xyz"]}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST https://$URL/profile/enrich \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Signature: $SIG" \
  -d "$BODY"
```

### Test firma inválida (debe devolver 401)

```bash
curl -X POST https://$URL/dm/send \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Signature: sha256=invalida" \
  -d '{"ig_username":"test","text":"test"}'
# Esperado: 401 {"error":"invalid_signature"}
```

---

## Estructura recomendada del sidecar (SESSION-02)

```
sidecar/
├── app/
│   ├── main.py           # FastAPI app, lifespan, middleware HMAC
│   ├── auth.py           # verify_signature()
│   ├── ig_client.py      # instagrapi wrapper (SESSION-03)
│   ├── session_store.py  # persistencia JSON en /data (SESSION-03)
│   ├── circuit_breaker.py# detecta excepciones críticas (SESSION-03)
│   └── routes/
│       ├── dm.py         # POST /dm/send
│       ├── inbox.py      # POST /inbox/poll
│       ├── profile.py    # POST /profile/enrich
│       └── health.py     # GET /health
├── tests/
│   └── test_auth.py      # pytest para HMAC middleware (SESSION-02)
├── Dockerfile
├── requirements.txt
└── railway.toml
```

---

## Notas importantes para implementación

1. **Volumen Railway**: la sesión de instagrapi se persiste en `/data/session.json`. El Dockerfile debe declarar `VOLUME /data` y Railway debe montar un volumen persistente en ese path. Sin esto, cada redeploy requiere re-login → riesgo de challenge.

2. **Circuit breaker es obligatorio antes de cada acción**: antes de llamar a cualquier método de instagrapi, verificar si hay un circuit abierto activo. Si está abierto, devolver 503 inmediatamente sin hacer el request a Instagram.

3. **Timeout del endpoint `/dm/send`**: incluye el dwell time (3–15s random) + el tiempo de la llamada real a Instagram. El cliente Next.js espera hasta 60s (configurado en `sidecar.ts` via `AbortSignal.timeout(60_000)`).

4. **`/health` sin autenticación**: es llamado por Railway para health checks. No debe requerir firma.
