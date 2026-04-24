# SESSION-10 — Primer DM en vivo + ramp-up setup

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión
> **Prerequisitos:** SESSION-09 completada — DRY_RUN simulate mode funcionando, checklist pre-launch completo, tablas limpiadas, `instagram_leads_raw` con ≥ 20 rows `processed=false`, sidecar Railway smoke test pasado.

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
- Scheduler Railway: deployado, cron `0 12 * * *` (9 AM ART) ✅
- Next.js Vercel: deployado, run-cycle en simulate mode ✅
- `instagram_leads_raw`: ≥ 20 rows con `processed=false` ✅
- `instagram_leads` + `instagram_conversations`: vacías (limpiadas en SESSION-09) ✅
- `DRY_RUN=true` — **este es el último estado; esta sesión lo apaga**

El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Objetivo de esta sesión

El objetivo es **enviar los primeros DMs reales y validar el pipeline de punta a punta con datos reales de Instagram**.

1. **Apagar DRY_RUN** — setear `DRY_RUN=false` en Vercel
2. **Verificar sidecar** — smoke test rápido antes del primer DM
3. **Disparar el primer ciclo en vivo** — `run-cycle` real, confirmar message_ids reales en Supabase
4. **Verificar entrega en Instagram** — revisar inbox de `@apex.stack` manualmente
5. **Implementar inbox polling** — `/api/ig/poll-inbox` para capturar respuestas de leads
6. **Configurar plan de ramp-up** — tabla de límites semana a semana en env vars
7. **Smoke test del scheduler** — confirmar que el cron de Railway dispara correctamente
8. Actualizar `PROGRESS.md`

---

## Paso 1 — Apagar DRY_RUN en Vercel

### 1a. Cambio en dashboard Vercel

En el dashboard de Vercel → proyecto `apex-leads` → Settings → Environment Variables:

| Variable | Valor anterior | Valor nuevo |
|----------|---------------|-------------|
| `DRY_RUN` | `true` | `false` |
| `DAILY_DM_LIMIT` | `3` | `3` (mantener para warmup) |
| `IG_WARMUP_MODE` | `true` | `true` (mantener) |

> **Importante:** Vercel requiere un redeploy para que las env vars cambien. Después de editar, ir a Deployments → Redeploy (o hacer un `git push` vacío).

### 1b. Confirmar cambio via API

Después del redeploy:

```bash
VERCEL_URL=https://<tu-app>.vercel.app
CRON_SECRET=cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab

# El ciclo ahora debería procesar leads reales
curl -s -X POST "$VERCEL_URL/api/ig/run-cycle" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Si la respuesta incluye `"dry_run": false` (o el campo no aparece), el cambio está activo.

---

## Paso 2 — Smoke test del sidecar antes del primer DM

Verificar que el sidecar Railway está vivo y la sesión de Instagram sigue activa:

```bash
# Health check
curl -s https://ig-sidecar-production.up.railway.app/health | python -m json.tool
```

Respuesta esperada:
```json
{
  "status": "ok",
  "session": "loaded",
  "last_action_at": "2026-04-XX..."
}
```

Si `"session": "missing"` o error:
1. Regenerar sesión: `python sidecar/tools/login_local.py`
2. Codificar: `python -c "import base64; print(base64.b64encode(open('sidecar/session_export.json','rb').read()).decode())"`
3. Actualizar `IG_SESSION_B64` en Railway ig-sidecar → Redeploy
4. Verificar nuevamente el `/health`

> **NO continuar al Paso 3 si el sidecar no responde `"session": "loaded"`** — el run-cycle fallará silenciosamente.

---

## Paso 3 — Primer ciclo en vivo

### 3a. Disparar manualmente

```bash
VERCEL_URL=https://<tu-app>.vercel.app
CRON_SECRET=cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab

curl -s -X POST "$VERCEL_URL/api/ig/run-cycle" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Respuesta esperada (primer ciclo real):
```json
{
  "ok": true,
  "dry_run": false,
  "outreach": { "sent": 3, "skipped": 17 },
  "followup": { "sent": 0, "ghosted_closed": 0 }
}
```

Si `outreach.sent = 0`:
- Verificar que `instagram_leads_raw` tiene rows con `processed=false`
- Verificar que el score de los leads supera `MIN_SCORE` (default 40)
- Revisar logs en Vercel → Functions → `/api/ig/run-cycle`

### 3b. Verificar en Supabase (proyeto `hpbxscfbnhspeckdmkvu`)

```sql
-- Leads procesados con message_id REAL (sin prefijo dry-run-)
SELECT
  l.ig_username,
  l.score,
  l.status,
  l.first_dm_at,
  c.metadata->>'message_id' as message_id,
  LEFT(c.content, 100) as dm_preview
FROM instagram_leads l
JOIN instagram_conversations c ON c.lead_id = l.id
WHERE c.direction = 'outbound'
ORDER BY l.first_dm_at DESC;
```

Verificar:
- `message_id` es un string alfanumérico real (no `dry-run-...`)
- `status = 'dm_sent'`
- `dm_preview` tiene el mensaje de apertura correcto

### 3c. Verificar en Instagram

Abrir la app de Instagram con `@apex.stack` y revisar el inbox. Los DMs enviados deben aparecer como mensajes salientes a los usernames de la consulta anterior.

Si los DMs no aparecen en Instagram pero sí hay `message_id` en Supabase: el sidecar devolvió un ID pero el DM no se envió realmente — abrir un issue en el sidecar.

---

## Paso 4 — Implementar inbox polling

El sidecar tiene el endpoint `/inbox/poll` para leer mensajes nuevos. Necesitamos un route en Next.js que lo llame y persista las respuestas de leads en `instagram_conversations`.

### 4a. Crear `/api/ig/poll-inbox/route.ts`

```typescript
// apex-leads/src/app/api/ig/poll-inbox/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callSidecar } from '@/lib/ig/sidecar'
import { loadConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  if (token !== cronSecret) return unauthorized()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Pedir al sidecar los mensajes nuevos desde el último poll
  const { data: lastPoll } = await supabase
    .from('instagram_conversations')
    .select('created_at')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const since = lastPoll?.created_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  let inboxResult: { messages: Array<{ ig_username: string; text: string; timestamp: string; message_id: string }> }
  try {
    inboxResult = await callSidecar<typeof inboxResult>('/inbox/poll', { since })
  } catch (err) {
    console.error('[poll-inbox] sidecar error', err)
    return NextResponse.json({ ok: false, error: 'sidecar_error' }, { status: 502 })
  }

  const messages = inboxResult.messages ?? []
  let inserted = 0

  for (const msg of messages) {
    // Buscar el lead correspondiente
    const { data: lead } = await supabase
      .from('instagram_leads')
      .select('id')
      .eq('ig_username', msg.ig_username)
      .single()

    if (!lead) continue

    // Verificar que el mensaje no esté ya insertado
    const { data: existing } = await supabase
      .from('instagram_conversations')
      .select('id')
      .eq('metadata->>message_id', msg.message_id)
      .single()

    if (existing) continue

    await supabase.from('instagram_conversations').insert({
      lead_id: lead.id,
      direction: 'inbound',
      role: 'user',
      content: msg.text,
      metadata: { message_id: msg.message_id, timestamp: msg.timestamp },
    })

    // Actualizar status del lead a 'replied'
    await supabase
      .from('instagram_leads')
      .update({ status: 'replied', updated_at: new Date().toISOString() })
      .eq('id', lead.id)

    inserted++
  }

  return NextResponse.json({ ok: true, messages_found: messages.length, inserted })
}
```

### 4b. Agregar `/inbox/poll` al sidecar

Verificar si el sidecar ya tiene el endpoint:

```bash
curl -s https://ig-sidecar-production.up.railway.app/openapi.json \
  | python -m json.tool | grep -A 5 "/inbox"
```

Si no existe, agregar en `sidecar/app/main.py` (o en el router correspondiente):

```python
from datetime import datetime
from typing import Optional

class InboxPollRequest(BaseModel):
    since: Optional[str] = None

@app.post("/inbox/poll")
async def inbox_poll(req: InboxPollRequest):
    """Devuelve mensajes recibidos desde `since` (ISO 8601). Default: últimas 24h."""
    cl = get_client()  # instagrapi client
    update_last_action()

    since_dt = datetime.fromisoformat(req.since) if req.since else None
    threads = cl.direct_threads(amount=20)

    messages = []
    for thread in threads:
        for msg in thread.messages:
            if msg.user_id == cl.user_id:
                continue  # skip mensajes propios
            if since_dt and msg.timestamp < since_dt:
                continue
            ig_username = cl.user_info(msg.user_id).username
            messages.append({
                "ig_username": ig_username,
                "text": msg.text or "",
                "timestamp": msg.timestamp.isoformat(),
                "message_id": str(msg.id),
            })

    return {"messages": messages}
```

> Si el sidecar requiere cambios, hacer el deploy en Railway después de commitear.

### 4c. Agregar cron de polling al scheduler

En `sidecar/scheduler/scheduler.py` o como servicio separado en Railway:

```python
# Opción A: Agregar al scheduler existente como segunda URL
POLL_INBOX_URL = f"{NEXT_APP_URL}/api/ig/poll-inbox"

# Después de run-cycle, llamar poll-inbox
r2 = httpx.post(POLL_INBOX_URL, headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=60)
print(f"[poll-inbox] {r2.status_code} {r2.text[:200]}")
```

O configurar una segunda entrada de cron en Railway para `/api/ig/poll-inbox` cada 30 minutos.

---

## Paso 5 — Plan de ramp-up

Con `IG_WARMUP_MODE=true` y `DAILY_DM_LIMIT=3`, el agente envía 3 DMs/día durante la primera semana. El plan de incremento gradual reduce el riesgo de que Instagram detecte actividad inusual.

### 5a. Tabla de ramp-up

| Semana | `DAILY_DM_LIMIT` | DMs totales | Acción |
|--------|-----------------|-------------|--------|
| 1 (hoy) | `3` | ~21 | Observar respuestas, ajustar templates si necesario |
| 2 | `5` | ~35 | Si no hay block/warning de IG, subir límite |
| 3 | `8` | ~56 | Revisar reply rate — apuntar a >5% |
| 4 | `12` | ~84 | Evaluar calidad de leads (score accuracy) |
| 5+ | `20` | ~140 | Estado de crucero — revisar semanalmente |

> **Señales de alerta para pausar:** acción bloqueada en sidecar (`ActionBlocked`), DMCA de IG, caída de reply rate <2%, o `circuit_breaker` en estado abierto por >2h.

### 5b. Cómo actualizar el límite

Cada transición de semana es un cambio de env var en Vercel + redeploy:

```bash
# Semana 2: subir a 5
# Vercel dashboard → DAILY_DM_LIMIT → 5 → Save → Redeploy
```

No hay código que cambiar — `run-cycle` lee `DAILY_DM_LIMIT` del config en runtime.

### 5c. Verificar endpoint `/api/ig/pause`

Confirmar que el endpoint de pausa de emergencia funciona:

```bash
curl -s -X POST "$VERCEL_URL/api/ig/pause" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"reason": "test pause"}' \
  | python -m json.tool
```

Si no existe o da error, revisar `apex-leads/src/app/api/ig/pause/route.ts`.

---

## Paso 6 — Smoke test del scheduler Railway

Verificar que el scheduler está configurado y disparará el ciclo diario:

### 6a. Trigger manual desde Railway

En Railway → proyecto `ig-scheduler` → cron service → "Run now" (botón de trigger manual si está disponible).

O verificar el último run en los logs de Railway:

```
[scheduler] POST https://<app>.vercel.app/api/ig/run-cycle
[scheduler] Response: 200 {"ok":true,"dry_run":false,"outreach":{"sent":3,...}}
[scheduler] Done.
```

### 6b. Confirmar horario

El scheduler usa `cronSchedule = "0 12 * * *"` (UTC) = 9 AM ART. Confirmar que es el horario deseado para la operación diaria. Si se quiere ajustar (ej. 10 AM ART = 13 UTC):

```toml
# sidecar/scheduler/railway.toml
[deploy]
cronSchedule = "0 13 * * *"  # 10 AM ART
```

---

## Paso 7 — Monitoreo básico post-primer DM

### 7a. Query de estado actual

Desde Supabase SQL Editor:

```sql
-- Resumen del estado del agente
SELECT
  status,
  COUNT(*) as leads,
  AVG(score)::int as avg_score,
  MIN(first_dm_at) as first_dm,
  MAX(first_dm_at) as last_dm
FROM instagram_leads
GROUP BY status
ORDER BY leads DESC;
```

### 7b. Verificar que el endpoint `/api/ig/stats` devuelve datos

```bash
curl -s "$VERCEL_URL/api/ig/stats" \
  -H "Authorization: Bearer $CRON_SECRET" \
  | python -m json.tool
```

Si el endpoint no tiene implementación real (solo stub), implementar un SELECT básico:

```typescript
// En /api/ig/stats/route.ts — si es stub, reemplazar con:
const { data } = await supabase
  .from('instagram_leads')
  .select('status, score, first_dm_at')

const stats = {
  total: data?.length ?? 0,
  by_status: data?.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>),
  avg_score: data?.length
    ? Math.round(data.reduce((s, r) => s + r.score, 0) / data.length)
    : 0,
}
return NextResponse.json({ ok: true, ...stats })
```

### 7c. Alerta manual de respuesta

Durante la primera semana, revisar manualmente el inbox de `@apex.stack` una vez por día. Una respuesta de un lead es señal para:
1. Verificar que aparece en `instagram_conversations` (si el polling está configurado)
2. Si el agente tiene respuesta automática, verificar que el follow-up es coherente
3. Si no hay respuesta automática, responder manualmente para validar el pitch

---

## Paso 8 — Deploy y cierre de sesión

```bash
cd apex-leads
git add \
  src/app/api/ig/poll-inbox/route.ts \
  src/app/api/ig/stats/route.ts \
  docs/ig/PROGRESS.md
git commit -m "feat(ig): poll-inbox + stats endpoint + ramp-up plan SESSION-10"
git push origin master
```

Si el sidecar fue modificado (nuevo endpoint `/inbox/poll`):

```bash
# El push al repo ig-sidecar dispara auto-deploy en Railway
cd <repo-sidecar>
git add sidecar/app/main.py
git commit -m "feat: add /inbox/poll endpoint"
git push origin main
```

---

## Criterios de éxito

1. `DRY_RUN=false` confirmado en Vercel ✅
2. Sidecar `/health` responde `"session": "loaded"` ✅
3. Al menos 1 DM real enviado — `message_id` sin prefijo `dry-run-` en `instagram_conversations` ✅
4. DM visible en inbox de Instagram de `@apex.stack` ✅
5. `/api/ig/poll-inbox` implementado y responde `{"ok": true}` ✅
6. Plan de ramp-up documentado — siguiente límite y fecha de cambio en `PROGRESS.md` ✅
7. Scheduler Railway confirmado — logs muestran último ciclo exitoso ✅
8. `PROGRESS.md` actualizado ✅

---

## Archivos modificados en esta sesión

- `apex-leads/src/app/api/ig/poll-inbox/route.ts` — endpoint de inbox polling (nuevo)
- `apex-leads/src/app/api/ig/stats/route.ts` — stats reales desde Supabase (si era stub)
- `sidecar/app/main.py` — endpoint `/inbox/poll` (si no existía)
- `docs/ig/PROGRESS.md` — actualizar con primer DM real, plan de ramp-up

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, env vars, decisiones
- `apex-leads/src/lib/ig/sidecar.ts` — `sendDM()`, `callSidecar()`, `SidecarError`
- `apex-leads/src/lib/ig/config.ts` — env vars y defaults (`DAILY_DM_LIMIT`, `DRY_RUN`, `IG_WARMUP_MODE`)
- `apex-leads/src/app/api/ig/run-cycle/route.ts` — ciclo principal de outreach
- `apex-leads/src/app/api/ig/pause/route.ts` — pausa de emergencia
- `sidecar/tools/login_local.py` — bootstrap de sesión IG (si hay que regenerar)
- `sidecar/tools/smoke_test_dm.py` — smoke test del sidecar (creado en SESSION-09)
