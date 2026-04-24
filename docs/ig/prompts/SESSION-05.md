# SESSION-05 — Scheduler Python en Railway

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión
> **Prerequisitos:** SESSION-04 completada — ig-sidecar Online en Railway con `session_valid: true`

---

## Contexto del proyecto

Estamos construyendo un agente de Instagram para boutiques de moda en Argentina. El stack es:
- **Next.js** (apex-leads) en Vercel — API routes, UI
- **FastAPI sidecar** (ig-sidecar) en Railway — instagrapi, sesión Instagram
- **Supabase** — DB, auth, storage
- **Python scheduler** (ig-scheduler) en Railway — dispara el ciclo de outreach diario

El sidecar (`github.com/manu-180/ig-sidecar`) está 100% operativo:
- URL pública: `https://ig-sidecar-production.up.railway.app`
- `GET /health` → `{"status":"ok","session_valid":true}`
- Secret HMAC: `5fc09c661fef80402d773e7d10a1e2ff9d478aeaf12129feba2b273202a84160`

El contrato completo del sidecar está en `docs/ig/SIDECAR-CONTRACT.md`.
El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Objetivo de esta sesión

Crear el **scheduler Python** como servicio separado en Railway que:
1. Corre en un cron (`0 9 * * *` — 9 AM hora Argentina, UTC-3 → `0 12 * * *` UTC)
2. Llama `POST /api/ig/run-cycle` en el Next.js de Vercel
3. Vercel ejecuta el ciclo: busca leads nuevos en Supabase → llama al sidecar → envía DMs

El scheduler es intencionalmente simple: **solo un HTTP call autenticado con `CRON_SECRET`**.

---

## Estructura esperada

```
scheduler/
├── Dockerfile
├── railway.toml
├── requirements.txt
├── scheduler.py          # script principal
└── README.md
```

---

## Especificaciones técnicas

### `scheduler.py`
```python
"""
Dispara POST /api/ig/run-cycle en Vercel.
Autenticado con Authorization: Bearer <CRON_SECRET>.
Loguea resultado y exitea 0 (éxito) o 1 (error).
"""
```

- Usa `httpx` (sync, no async — es un script one-shot)
- Timeout: 120s (el ciclo puede tardar procesando DMs)
- Respuesta esperada: `200 OK` con JSON `{"ok": true, ...}`
- Si status != 200: log del body + exit(1)
- Variables de entorno requeridas: `NEXT_APP_URL`, `CRON_SECRET`
- Fail-fast si faltan env vars

### `railway.toml`
```toml
[build]
builder = "DOCKERFILE"

[deploy]
cronSchedule = "0 12 * * *"   # 9 AM ART = 12 UTC
restartPolicyType = "never"    # cron job, no es un server
```

### `Dockerfile`
- `FROM python:3.11-slim`
- Solo instala `httpx` y `httpx[http2]` (liviano)
- `CMD ["python", "scheduler.py"]`

---

## Variables de entorno en Railway (scheduler service)

| Variable | Valor |
|----------|-------|
| `NEXT_APP_URL` | URL de Vercel (ej: `https://apex-leads.vercel.app`) |
| `CRON_SECRET` | Generar: `python -c "import secrets; print(secrets.token_hex(32))"` |

El mismo `CRON_SECRET` debe agregarse en Vercel como env var.

---

## API route en Next.js que debe existir

`POST /api/ig/run-cycle` — verificar que existe en `apex-leads/src/app/api/ig/run-cycle/route.ts`.
Si NO existe, crearlo con:
- Verificación de `Authorization: Bearer <CRON_SECRET>`
- Llamada a la lógica de outreach (stub `{"ok": true, "leads_processed": 0}` si aún no está implementada)
- Guard `DRY_RUN=true` → solo loguea, no envía DMs reales

---

## Criterios de éxito (smoke test)

1. `railway run --service ig-scheduler python scheduler.py` → logs muestran `200 OK` y `{"ok": true}`
2. Railway muestra el servicio como cron (ícono de reloj en canvas)
3. Primera ejecución automática programada correctamente

---

## Notas importantes

- **NO crear lógica de DM en el scheduler** — el scheduler es solo un trigger. La lógica vive en Next.js `/api/ig/run-cycle`.
- El scheduler no necesita volumen persistente.
- Railway cron jobs: el container corre, ejecuta el script, y termina. `restartPolicyType = "never"` es correcto.
- Si `DRY_RUN=true` en Vercel, el ciclo corre pero no envía DMs reales. Mantener así hasta SESSION-10.

---

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, todas las decisiones
- `docs/ig/SIDECAR-CONTRACT.md` — contrato HTTP del sidecar
- `apex-leads/src/app/api/ig/` — routes existentes en Next.js
- `sidecar/app/main.py` — sidecar FastAPI app
