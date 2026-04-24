# SESSION-07 — Apify setup + webhook fix + test E2E

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión
> **Prerequisitos:** SESSION-06 completada — Vercel deploy listo, smoke test `POST /api/ig/run-cycle` → `{"ok": true, "dry_run": true}` confirmado

---

## Contexto del proyecto

Estamos construyendo un agente de Instagram para boutiques de moda en Argentina. El stack es:
- **Next.js** (`apex-leads`) en Vercel — API routes, UI
- **FastAPI sidecar** (`ig-sidecar`) en Railway — instagrapi, sesión Instagram
- **Supabase** — DB, auth, storage
- **Python scheduler** (`ig-scheduler`) en Railway — dispara el ciclo de outreach diario
- **Apify** — scraper de Instagram por hashtag (actor `apidojo~instagram-scraper`)

Estado al inicio de esta sesión:
- Sidecar Railway: `https://ig-sidecar-production.up.railway.app` ✅
- Scheduler Railway: código en `sidecar/scheduler/`, pendiente de confirmar deploy ✅
- Next.js Vercel: URL obtenida en SESSION-06, smoke test pasado ✅
- Apify: `APIFY_TOKEN` y `APIFY_WEBHOOK_SECRET` son **placeholders** — esta sesión los reemplaza

El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Bug crítico documentado en SESSION-01

### Síntoma

El endpoint `GET /api/cron/ig-discover` lanza el actor de Apify con un webhook que **nunca va a autenticarse**:

```
webhooks/apify/route.ts:
  verifica header `apify-webhook-signature` via HMAC-SHA256

ig-discover/route.ts:
  payloadTemplate embeds { signature: APIFY_WEBHOOK_SECRET } en el BODY
```

Apify **no envía** el header `apify-webhook-signature` automáticamente. El handler siempre devuelve 401.

### Fix elegido: query param token

La solución más limpia es mover el secret a un **query param en la URL del webhook**:

1. `ig-discover`: `requestUrl: \`${APP_URL}/api/webhooks/apify?token=${APIFY_WEBHOOK_SECRET}\``
2. Handler: comparar `req.nextUrl.searchParams.get('token')` con `APIFY_WEBHOOK_SECRET` usando `timingSafeEqual`
3. Eliminar la verificación HMAC del header y el campo `signature` del `payloadTemplate`

Ventajas: simple, no poluciona el payload, fácil de rotar.

---

## Objetivo de esta sesión

1. **Aplicar el fix del bug de auth** en los dos archivos TypeScript
2. **Crear cuenta Apify** y obtener token real (acción manual del usuario)
3. **Verificar que la tabla Supabase existe** (`instagram_leads_raw`)
4. **Test E2E del webhook**: disparar una corrida real de Apify y confirmar que los datos llegan a Supabase
5. **Actualizar env vars** en Vercel con valores reales de Apify
6. Actualizar `PROGRESS.md`

---

## Paso 1 — Fix webhook auth

### 1a. `apex-leads/src/app/api/webhooks/apify/route.ts`

Reemplazar la función `verifyApifySignature` y su uso:

```typescript
// ANTES — header HMAC que Apify no envía
function verifyApifySignature(req: NextRequest, rawBody: string): boolean {
  const signature = req.headers.get('apify-webhook-signature')
  if (!signature || !APIFY_WEBHOOK_SECRET) return false
  const expected = crypto
    .createHmac('sha256', APIFY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}

// DESPUÉS — query param token con comparación de tiempo constante
function verifyApifyToken(req: NextRequest): boolean {
  const token = req.nextUrl.searchParams.get('token')
  if (!token || !APIFY_WEBHOOK_SECRET) return false
  const tokBuf = Buffer.from(token)
  const secBuf = Buffer.from(APIFY_WEBHOOK_SECRET)
  if (tokBuf.length !== secBuf.length) return false
  return crypto.timingSafeEqual(tokBuf, secBuf)
}
```

Y en el handler POST:

```typescript
// ANTES
if (!verifyApifySignature(req, rawBody)) {

// DESPUÉS
if (!verifyApifyToken(req)) {
```

También eliminar el `import crypto` si ya no se usa en otra parte (verificar — todavía se usa para el HMAC del sidecar? No, este archivo no usa sidecar.ts). Mantener el import si hay otro uso; si no, eliminarlo.

**Nota:** el `rawBody` todavía se necesita para el `JSON.parse` posterior. No eliminarlo.

### 1b. `apex-leads/src/app/api/cron/ig-discover/route.ts`

En la configuración del webhook, cambiar `requestUrl` y limpiar `payloadTemplate`:

```typescript
// ANTES
webhooks: [
  {
    eventTypes: ['ACTOR.RUN.SUCCEEDED'],
    requestUrl: `${APP_URL}/api/webhooks/apify`,
    payloadTemplate: JSON.stringify({
      eventType: '{{eventType}}',
      eventData: { actorRunId: '{{actorRunId}}' },
      sourceRef: hashtag,
      signature: APIFY_WEBHOOK_SECRET,  // <-- plain text en body, bug
    }),
  },
],

// DESPUÉS
webhooks: [
  {
    eventTypes: ['ACTOR.RUN.SUCCEEDED'],
    requestUrl: `${APP_URL}/api/webhooks/apify?token=${APIFY_WEBHOOK_SECRET}`,
    payloadTemplate: JSON.stringify({
      eventType: '{{eventType}}',
      eventData: { actorRunId: '{{actorRunId}}' },
      sourceRef: hashtag,
    }),
  },
],
```

### 1c. Eliminar variable local `APIFY_WEBHOOK_SECRET` en ig-discover

Actualmente en ig-discover hay esta línea:
```typescript
const APIFY_WEBHOOK_SECRET = igConfig.APIFY_WEBHOOK_SECRET
```

Mantenerla — se sigue usando en el `requestUrl`.

---

## Paso 2 — Acción manual: crear cuenta Apify y obtener token

> **Acción del usuario — no automatizable.**

1. Ir a [apify.com](https://apify.com) → Sign up (plan Free es suficiente para testing)
2. Dashboard → Settings → API & Integrations → **API token** → Copy
3. El token tiene el formato `apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

Guardar el token — se usará en el Paso 4.

---

## Paso 3 — Verificar tabla Supabase `instagram_leads_raw`

El webhook inserta en `instagram_leads_raw`. Verificar que existe con las columnas correctas.

### 3a. Chequear en Supabase

Desde el MCP de Supabase (proyecto `hpbxscfbnhspeckdmkvu`) o desde el dashboard:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'instagram_leads_raw'
ORDER BY ordinal_position;
```

### 3b. Schema esperado

```sql
CREATE TABLE IF NOT EXISTS instagram_leads_raw (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_username   text NOT NULL UNIQUE,
  raw_profile   jsonb NOT NULL,
  source        text NOT NULL DEFAULT 'hashtag',
  source_ref    text,
  processed     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_raw_processed ON instagram_leads_raw (processed);
CREATE INDEX IF NOT EXISTS idx_leads_raw_source_ref ON instagram_leads_raw (source_ref);
```

### 3c. Si la tabla no existe — crearla

Usar el MCP de Supabase (`apply_migration`) o el SQL Editor del dashboard con el schema de arriba.

Si la tabla ya existe pero le faltan columnas, alterar con `ALTER TABLE`.

---

## Paso 4 — Actualizar env vars en Vercel

Una vez obtenido el token real de Apify (Paso 2):

1. Ir a Vercel → proyecto `apex-leads` → Settings → Environment Variables
2. Actualizar:

| Variable | Valor anterior | Valor nuevo |
|----------|---------------|-------------|
| `APIFY_TOKEN` | `__stub__` | `apify_api_xxxx...` (token real) |
| `APIFY_WEBHOOK_SECRET` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` | generar nuevo con `openssl rand -hex 32` |

3. Hacer redeploy (Vercel → Deployments → Redeploy latest, o `git push` con cualquier cambio)

> **Nota:** `APIFY_WEBHOOK_SECRET` es el token que protege el endpoint `/api/webhooks/apify`.
> Usar el mismo valor en Vercel y en la config de Apify (se embebe en la URL del webhook en runtime).
> No es necesario setearlo en Apify dashboard — el ig-discover lo incluye en el `requestUrl` al lanzar cada run.

---

## Paso 5 — Test E2E del webhook

### 5a. Deploy del fix

Después de aplicar los cambios de código (Paso 1) y actualizar env vars (Paso 4):

```bash
cd apex-leads
git add src/app/api/webhooks/apify/route.ts src/app/api/cron/ig-discover/route.ts
git commit -m "fix(apify): align webhook auth — query param token instead of HMAC header"
git push origin master
```

Esperar que Vercel complete el deploy.

### 5b. Test manual del webhook (sin Apify)

Antes de disparar un run real de Apify, verificar que el endpoint acepta el token:

```bash
VERCEL_URL=https://<tu-app>.vercel.app
WEBHOOK_SECRET=<tu-APIFY_WEBHOOK_SECRET>
RUN_ID=test-run-id-000

# Debe devolver 400 (falta actorRunId real) o 200, NO 401
curl -s -X POST \
  "$VERCEL_URL/api/webhooks/apify?token=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"eventType\":\"ACTOR.RUN.SUCCEEDED\",\"eventData\":{\"actorRunId\":\"$RUN_ID\"},\"sourceRef\":\"test\"}" \
  | python -m json.tool
```

Respuestas esperadas:
- `{"error": "Failed to fetch Apify dataset"}` (502) → **auth pasó**, Apify devolvió error porque el runId es falso ✅
- `{"error": "Invalid signature"}` (401) → auth sigue roto ❌ revisar token y env var

### 5c. Disparar ig-discover manualmente (run real de Apify)

```bash
CRON_SECRET=cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab

curl -s -X GET "$VERCEL_URL/api/cron/ig-discover" \
  -H "Authorization: Bearer $CRON_SECRET" \
  | python -m json.tool
```

Respuesta esperada:
```json
{
  "ok": true,
  "launched": [
    { "hashtag": "modaargentina", "runId": "abc123..." },
    { "hashtag": "boutiquebuenosaires", "runId": "def456..." },
    ...
  ]
}
```

Si algún hashtag devuelve `"error"`, revisar que `APIFY_TOKEN` esté seteado correctamente en Vercel.

### 5d. Monitorear Apify y esperar webhook

1. Ir a [console.apify.com](https://console.apify.com) → Runs
2. Esperar que el actor `apidojo~instagram-scraper` complete (5-15 minutos en plan Free)
3. Una vez completado, Apify llama al webhook automáticamente

### 5e. Verificar datos en Supabase

```sql
SELECT ig_username, source_ref, processed, created_at
FROM instagram_leads_raw
ORDER BY created_at DESC
LIMIT 20;
```

Si hay rows → **E2E completo** ✅

---

## Paso 6 — Deploy ig-scheduler en Railway (si no se hizo en SESSION-06)

Si el ig-scheduler todavía no está deployado en Railway:

1. Railway dashboard → New Service → GitHub repo (mismo repo `apex-leads` o el monorepo)
2. Root directory: `sidecar/scheduler`
3. Builder: **DOCKERFILE**
4. Variables:

| Variable | Valor |
|----------|-------|
| `NEXT_APP_URL` | `https://<tu-app>.vercel.app` |
| `CRON_SECRET` | `cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab` |

5. Settings → Cron: `0 12 * * *` (9 AM ART)

---

## Criterios de éxito

1. `POST /api/webhooks/apify?token=<secret>` con payload válido → **no 401** ✅
2. `GET /api/cron/ig-discover` → `{"ok": true, "launched": [...]}` con runIds reales de Apify ✅
3. Al menos un run de Apify completa sin error en el dashboard de Apify ✅
4. Rows en `instagram_leads_raw` luego del webhook ✅
5. ig-scheduler deployado en Railway con `NEXT_APP_URL` correcto ✅

---

## Archivos modificados en esta sesión

- `apex-leads/src/app/api/webhooks/apify/route.ts` — fix auth: query param token
- `apex-leads/src/app/api/cron/ig-discover/route.ts` — fix webhook URL + limpiar payloadTemplate
- `docs/ig/PROGRESS.md` — actualizar estado SESSION-07

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, todas las decisiones
- `docs/ig/SIDECAR-CONTRACT.md` — contrato HTTP del sidecar
- `apex-leads/src/lib/ig/config.ts` — validación Zod de env vars
- `apex-leads/src/app/api/ig/run-cycle/route.ts` — ciclo de outreach
- `sidecar/scheduler/scheduler.py` — trigger del ciclo (Railway cron)
