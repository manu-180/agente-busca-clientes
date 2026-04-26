# RUNBOOK — Discovery System v2

> Referencia operacional para producción. Última actualización: 2026-04-25.

---

## 1. Launch checklist

Acciones manuales a realizar en el panel de Vercel antes de activar producción.

### Env vars a setear / actualizar

| Variable | Valor | Notas |
|---|---|---|
| `DRY_RUN` | `false` | Cambiar de `true` → activa envío real de DMs |
| `IG_RAMP_START` | `YYYY-MM-DD` | Fecha de hoy al lanzar (ej. `2026-04-25`). Activa ramp-up automático 5→30 DMs/día. Omitir si se prefiere límite fijo. |
| `DAILY_DM_LIMIT` | `5` (o el que corresponda) | Solo si **no** se usa `IG_RAMP_START`. Con ramp-up activo, este valor se ignora. |
| `DISCORD_ALERT_WEBHOOK` | URL del webhook | Para recibir alertas críticas en Discord |
| `IG_SIDECAR_URL` | URL Railway del sidecar | `https://ig-sidecar-production.up.railway.app` |
| `IG_SIDECAR_SECRET` | Secret compartido HMAC | Min 32 chars, mismo valor en Railway |
| `IG_SENDER_USERNAME` | `apex.stack` | Username de la cuenta IG emisora |
| `CRON_SECRET` | Secret para crons Vercel | Min 32 chars |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Para clasificación de nicho con Claude Haiku |

### Verificación post-deploy

1. Hacer un POST manual a `/api/ig/run-cycle` con `Authorization: Bearer <CRON_SECRET>` y confirmar `dry_run: false` en el response.
2. Revisar tabla `dm_daily_quota` en Supabase: debe aparecer una fila con `dms_sent > 0` si había leads en cola.
3. Verificar que Discord recibe el webhook de prueba (si aplica).

---

## 2. Env vars legacy a eliminar de Vercel

Estas variables corresponden al sistema Apify que fue abandonado. **Borrarlas manualmente desde el panel de Vercel → Settings → Environment Variables:**

| Variable | Por qué eliminar |
|---|---|
| `APIFY_TOKEN` | Apify abandonado en favor de instagrapi nativo |
| `APIFY_WEBHOOK_SECRET` | Idem — route `/api/webhooks/apify` eliminada |

> Los archivos que usaban estas variables ya fueron eliminados del repo (D14).

---

## 3. Monitoreo diario

### Tablas clave en Supabase (project `hpbxscfbnhspeckdmkvu`)

| Tabla | Qué revisar | Frecuencia |
|---|---|---|
| `dm_daily_quota` | `dms_sent` vs límite del día. Debe haber una fila por día activo. | Diaria |
| `instagram_leads` | Nuevos leads con `status='contacted'` y `lead_score`. | Diaria |
| `instagram_leads_raw` | Filas con `processed=false` acumuladas = backlog de discovery. | Diaria |
| `alerts_log` | Alertas `severity IN ('warning','critical')` de las últimas 24h. | Diaria |
| `discovery_runs` | Runs con `status='error'` indican fallo en orchestrator. | Diaria |

### Admin dashboard

- URL: `https://leads.theapexweb.com/admin/ig`
- KPIs clave: **Reply Rate** (target ≥3%), **DMs Today**, **Pipeline Health** (leads con score ≥60 en cola).

### Alertas Discord automáticas

| Trigger | Severidad | Fuente |
|---|---|---|
| Circuit breaker del sidecar se abre | `critical` | run-cycle |
| Reply rate 7d < 3% (con ≥30 DMs) | `warning` | cron check-reply-rate (18:00 UTC) |
| Quota diaria < 50% del límite | `info` | cron check-reply-rate |
| Template dominado auto-pausado | `info` | cron auto-pause-templates |
| Costo Claude > $1/día | `warning` | classify-niche |

---

## 4. Escalación

### Circuit breaker abierto (sidecar caído)

1. Revisar Railway logs: `https://railway.app` → proyecto `ig-sidecar-production`.
2. Verificar sesión IG: el sidecar puede haber sido bloqueado por Instagram. Reiniciar el servicio en Railway.
3. Si el bloqueo persiste más de 1h: setear `DISCOVERY_ENABLED=false` en Vercel para pausar el orchestrator mientras se resuelve.
4. Una vez restaurado el sidecar, volver a `DISCOVERY_ENABLED=true`.

### Reply rate < 3%

1. Revisar templates activos en `/admin/ig/templates` — ¿alguno tiene CTR muy bajo?
2. Considerar pausar templates con CI beta muy bajo o crear variantes nuevas via "New Template".
3. Revisar niche gate — puede que el pool de leads sea demasiado restrictivo (ajustar `TARGET_NICHES` o `MIN_CONFIDENCE`).
4. Si el problema persiste >3 días: reducir `MIN_SCORE_FOR_DM` de 60 a 50 para ampliar el pool.

### Leads sin procesar acumulados (instagram_leads_raw backlog grande)

1. Verificar que el cron `discover-orchestrator` (06:00 UTC) está corriendo — ver Vercel → Cron Jobs.
2. Disparar `run-cycle` manualmente si hay urgencia.
3. Si el backlog supera 500 filas y el sidecar está OK, probablemente hay un rate limit temporal de IG. Esperar 2-4h.

---

## 5. Rollback

### Pausa inmediata de DMs (sin deploy)

**Opción A — Límite cero:** Setear `DAILY_DM_LIMIT=0` en Vercel. El run-cycle retornará `daily_limit_reached` inmediatamente sin enviar nada.

**Opción B — Kill switch discovery:** Setear `DISCOVERY_ENABLED=false` en Vercel. Detiene el orchestrator (no descubre leads nuevos), pero run-cycle sigue procesando los leads ya en cola.

**Opción C — DRY_RUN:** Setear `DRY_RUN=true` en Vercel. El sistema simula todo pero no envía DMs reales. Útil para debugging.

> Vercel aplica env vars al próximo request después de guardarlas — sin redeploy necesario.

### Rollback de pesos de scoring

Si los nuevos pesos (auto-promovidos por D12) degradan la calidad:

```sql
-- En Supabase SQL Editor — revertir a producción anterior
UPDATE scoring_weights SET status = 'archived' WHERE status = 'production' AND version != 'v1';
UPDATE scoring_weights SET status = 'production' WHERE version = 'v1';
```

---

## 6. Contacto y accesos

| Recurso | Identificador / URL |
|---|---|
| **Vercel** | proyecto `apex-leads` — `https://leads.theapexweb.com` |
| **Railway** | servicio `ig-sidecar-production` — `https://railway.app` |
| **Supabase** | project ID `hpbxscfbnhspeckdmkvu` — `https://supabase.com/dashboard/project/hpbxscfbnhspeckdmkvu` |
| **GitHub** | repo `agente_busca_clientes` — branch `master` |
| **Admin IG** | `https://leads.theapexweb.com/admin/ig` (cookie `apex_auth`) |
