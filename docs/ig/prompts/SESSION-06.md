# SESSION-06 — Deploy Next.js a Vercel

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión
> **Prerequisitos:** SESSION-05 completada — ig-scheduler creado en `sidecar/scheduler/`

---

## Contexto del proyecto

Estamos construyendo un agente de Instagram para boutiques de moda en Argentina. El stack es:
- **Next.js** (apex-leads) en Vercel — API routes, UI
- **FastAPI sidecar** (ig-sidecar) en Railway — instagrapi, sesión Instagram
- **Supabase** — DB, auth, storage
- **Python scheduler** (ig-scheduler) en Railway — dispara el ciclo de outreach diario

Estado al inicio de esta sesión:
- Sidecar Railway: `https://ig-sidecar-production.up.railway.app` ✅
- Scheduler Railway: creado en `sidecar/scheduler/`, pendiente de deploy ✅ (código listo)
- Next.js: **pendiente de deploy a Vercel**

El contrato completo del sidecar está en `docs/ig/SIDECAR-CONTRACT.md`.
El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Completado en esta sesión

### Fix config.ts — build local roto

El build de Next.js fallaba localmente porque `process.env` overrideaba los `BUILD_DEFAULTS`
con strings vacías. Fix en `apex-leads/src/lib/ig/config.ts`:

```ts
// Antes
const input = BUILD ? { ...BUILD_DEFAULTS, ...process.env } : process.env

// Después — filtra strings vacías antes del spread
const nonEmptyEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
)
const input = BUILD ? { ...BUILD_DEFAULTS, ...nonEmptyEnv } : process.env
```

`npm run build` en apex-leads: **✅ build limpio**

### CRON_SECRET generado

```
cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab
```

Setear en:
1. **Vercel** → Settings → Environment Variables → `CRON_SECRET`
2. **Railway ig-scheduler** → Variables → `CRON_SECRET`

---

## Objetivo de esta sesión

Deployar `apex-leads` a Vercel con todas las env vars correctas y verificar el endpoint
`POST /api/ig/run-cycle` responde `{"ok": true, "dry_run": true}`.

---

## Checklist de deploy Vercel

### 1. Conectar repo en Vercel (si no está conectado)

1. Ir a [vercel.com](https://vercel.com) → New Project
2. Importar `github.com/manu-180/apex-leads` (o el monorepo, seleccionar `apex-leads/` como root)
3. Framework preset: **Next.js**
4. Root directory: `apex-leads` (si es monorepo)

### 2. Variables de entorno en Vercel

Setear en Vercel → Settings → Environment Variables:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://hpbxscfbnhspeckdmkvu.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (del dashboard de Supabase) |
| `ANTHROPIC_API_KEY` | (tu API key — empieza con `sk-ant-`) |
| `IG_SIDECAR_URL` | `https://ig-sidecar-production.up.railway.app` |
| `IG_SIDECAR_SECRET` | `5fc09c661fef80402d773e7d10a1e2ff9d478aeaf12129feba2b273202a84160` |
| `IG_SENDER_USERNAME` | `apex.stack` |
| `CRON_SECRET` | `cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab` |
| `DRY_RUN` | `true` (hasta SESSION-10) |
| `DAILY_DM_LIMIT` | `3` |
| `FOLLOWUP_HOURS` | `48` |
| `IG_WARMUP_MODE` | `true` |
| `APIFY_TOKEN` | `__stub__` (placeholder hasta SESSION-07) |
| `APIFY_WEBHOOK_SECRET` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (placeholder hasta SESSION-07) |

> **Nota:** `APIFY_TOKEN` y `APIFY_WEBHOOK_SECRET` son requeridos por `igConfig` en runtime
> pero no los usa `run-cycle`. Los placeholders permiten que el server arranque.
> SESSION-07 los reemplaza con valores reales.

### 3. Deploy

Vercel hace auto-deploy al push a `main`. Si el repo ya está conectado, solo hacer push.

```bash
cd apex-leads
git push origin main
```

### 4. Smoke test post-deploy

Una vez que Vercel muestre el deploy como "Ready":

```bash
VERCEL_URL=https://<tu-app>.vercel.app
CRON_SECRET=cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab

curl -s -X POST "$VERCEL_URL/api/ig/run-cycle" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Respuesta esperada:
```json
{
  "ok": true,
  "dry_run": true,
  "leads_processed": 0
}
```

### 5. Actualizar Railway ig-scheduler

Una vez obtenida la URL de Vercel, setear en Railway → ig-scheduler → Variables:

| Variable | Valor |
|----------|-------|
| `NEXT_APP_URL` | `https://<tu-app>.vercel.app` |
| `CRON_SECRET` | `cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab` |

---

## Criterios de éxito

1. Vercel muestra el deploy como "Ready" sin errores de build
2. `GET https://<app>.vercel.app` → 200 (home page carga)
3. Smoke test de `POST /api/ig/run-cycle` → `{"ok": true, "dry_run": true, "leads_processed": 0}`
4. Railway ig-scheduler tiene `NEXT_APP_URL` seteado

---

## Notas importantes

- `DRY_RUN=true` hasta SESSION-10 — el ciclo corre pero no envía DMs reales.
- El scheduler Railway corre a las 12:00 UTC (9:00 AM ART). Con `DRY_RUN=true` solo loguea.
- `APIFY_TOKEN` placeholder se reemplaza en SESSION-07 con el token real de Apify.
- Middleware HMAC del sidecar: la secret nunca cambia entre sesiones.

---

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, todas las decisiones
- `docs/ig/SIDECAR-CONTRACT.md` — contrato HTTP del sidecar
- `apex-leads/src/lib/ig/config.ts` — validación Zod de env vars
- `apex-leads/src/app/api/ig/run-cycle/route.ts` — endpoint del ciclo
- `sidecar/scheduler/scheduler.py` — trigger del ciclo (Railway cron)
