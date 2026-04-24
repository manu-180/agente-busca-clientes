# SESSION-09 — Test E2E DRY_RUN completo + checklist pre-launch

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión
> **Prerequisitos:** SESSION-08 completada — tablas `instagram_leads` + `instagram_conversations` creadas, `run-cycle` implementado, `/boceto` deployado en Vercel, rows en `instagram_leads_raw` provenientes de Apify.

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
- Scheduler Railway: deployado con `NEXT_APP_URL` + `CRON_SECRET` ✅
- Next.js Vercel: deployado, run-cycle implementado, `/boceto` live ✅
- Apify: E2E confirmado, rows en `instagram_leads_raw` ✅
- Tablas `instagram_leads` + `instagram_conversations`: creadas ✅
- `DRY_RUN=true` en Vercel — **no se han enviado DMs reales todavía**

El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Objetivo de esta sesión

El objetivo es **validar el pipeline completo sin enviar ningún DM real** y dejar todo listo para que SESSION-10 encienda el primer DM en vivo con confianza.

1. **Mejorar el modo DRY_RUN** — en lugar de return early, que el ciclo procese toda la lógica (clasificación, scoring, selección de template) y loguee qué *haría*, sin llamar a `sendDM`
2. **Correr el ciclo simulado** con datos reales de Apify y verificar los resultados en Supabase
3. **Validar datos de leads** — revisar que los scores y clasificaciones son correctos sobre datos reales
4. **Smoke test del sidecar** — verificar que el sidecar en Railway responde correctamente antes del primer DM real
5. **Checklist pre-launch** — dejar todas las env vars, límites y configuraciones listas para SESSION-10
6. Actualizar `PROGRESS.md`

---

## Paso 1 — Mejorar modo DRY_RUN en run-cycle

### Problema actual

El `run-cycle` actual con `DRY_RUN=true` hace un return anticipado:
```typescript
if (igConfig.DRY_RUN) {
  return NextResponse.json({ ok: true, dry_run: true })
}
```

Esto no permite validar nada del pipeline — clasificación, scoring, templates, lógica de follow-up.

### Solución: DRY_RUN como "simulate mode"

Modificar `apex-leads/src/app/api/ig/run-cycle/route.ts` para que DRY_RUN procese todo pero **skip únicamente la llamada a `sendDM`** y en cambio loguee lo que enviaría:

```typescript
// ANTES — return early
if (igConfig.DRY_RUN) {
  return NextResponse.json({ ok: true, dry_run: true })
}

// DESPUÉS — dry_run controla solo el sendDM, no el procesamiento
// Eliminar el bloque de return early.
// En el lugar donde estaba sendDM(ig_username, text):

let dmResult: { message_id?: string } | null = null
if (!igConfig.DRY_RUN) {
  dmResult = await sendDM(ig_username, text)
} else {
  console.log(`[DRY_RUN] Would send DM to @${ig_username}: "${text.slice(0, 80)}..."`)
  dmResult = { message_id: `dry-run-${Date.now()}` }
}
```

Mismo ajuste para los follow-ups:

```typescript
// En la fase de follow-up, reemplazar sendDM directo por:
if (!igConfig.DRY_RUN) {
  await sendDM(ig_username, followupText)
} else {
  console.log(`[DRY_RUN] Would send follow-up to @${ig_username}`)
}
```

### Resultado esperado

Con `DRY_RUN=true`, el ciclo ahora:
- Procesa leads de `instagram_leads_raw`
- Clasifica y scorea cada lead
- Selecciona templates
- **Inserta rows en `instagram_leads`** (para poder verificar los datos)
- **Inserta rows en `instagram_conversations`** (con `message_id = "dry-run-..."`)
- NO llama al sidecar Railway
- Retorna métricas reales: `{ok:true, dry_run:true, outreach:{sent:N, skipped:M}, followup:{...}}`

> **Importante:** los rows insertados en DRY_RUN tienen `message_id` con prefijo `dry-run-`. Antes de SESSION-10 (Paso 5 de esta sesión), hacer `DELETE FROM instagram_leads WHERE true` para limpiar los datos de prueba y empezar SESSION-10 con tablas vacías.

---

## Paso 2 — Correr ciclo simulado localmente

Levantar el servidor Next.js local:

```bash
cd apex-leads
# Verificar que DRY_RUN=true en .env.local
npm run dev
```

Disparar el ciclo:

```bash
curl -s -X POST http://localhost:3000/api/ig/run-cycle \
  -H "Authorization: Bearer cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Respuesta esperada (DRY_RUN mejorado):
```json
{
  "ok": true,
  "dry_run": true,
  "outreach": { "sent": 3, "skipped": 12 },
  "followup": { "sent": 0, "ghosted_closed": 0 }
}
```

Si `outreach.sent = 0` y hay rows en `instagram_leads_raw`, investigar:
- ¿Los leads pasan `isTargetLead()`?
- ¿El score supera `MIN_SCORE = 40`?
- ¿`processed = false` en los rows de `instagram_leads_raw`?

---

## Paso 3 — Validar datos en Supabase

### 3a. Verificar leads procesados

Desde el MCP de Supabase (proyecto `hpbxscfbnhspeckdmkvu`) o el SQL Editor:

```sql
-- Ver leads insertados por el ciclo DRY_RUN
SELECT
  ig_username,
  score,
  status,
  first_dm_at,
  followup_count,
  business_category,
  source_ref
FROM instagram_leads
ORDER BY score DESC
LIMIT 20;
```

Verificar que:
- `score` tiene valores razonables (40–100) para boutiques de moda
- `status = 'dm_sent'` en los procesados
- `business_category` refleja categorías de moda/ropa cuando Instagram las provee

### 3b. Verificar leads descartados

```sql
-- Ver cuántos leads de raw fueron procesados (skipped por clasificación/score)
SELECT
  processed,
  COUNT(*) as total
FROM instagram_leads_raw
GROUP BY processed;
```

Si `processed=true` pero no hay rows en `instagram_leads`, esos leads fueron descartados por `isTargetLead()` o score bajo — es comportamiento correcto.

### 3c. Verificar conversations

```sql
-- Ver los mensajes que se "enviaron" en DRY_RUN
SELECT
  c.direction,
  c.role,
  LEFT(c.content, 100) as content_preview,
  c.metadata->>'message_id' as message_id,
  l.ig_username
FROM instagram_conversations c
JOIN instagram_leads l ON l.id = c.lead_id
ORDER BY c.created_at DESC
LIMIT 10;
```

Verificar que:
- Los `message_id` tienen prefijo `dry-run-` (confirma que no se usó el sidecar real)
- El contenido de los mensajes es coherente con el rubro boutique
- No hay textos duplicados (el template picker debe variar)

### 3d. Revisar templates generados manualmente

Extraer los primeros 5 mensajes y revisarlos visualmente:

```sql
SELECT
  l.ig_username,
  l.score,
  c.content
FROM instagram_conversations c
JOIN instagram_leads l ON l.id = c.lead_id
WHERE c.direction = 'outbound'
ORDER BY c.created_at DESC
LIMIT 5;
```

Criterios de calidad:
- Tono natural, no robótico
- No incluye links externos (regla del system prompt)
- Menciona el rubro (moda, boutique) sin ser genérico
- Termina con pregunta abierta o CTA suave

Si algún mensaje no cumple, ajustar los templates en `apex-leads/src/lib/ig/prompts/templates.ts` antes de continuar.

---

## Paso 4 — Smoke test del sidecar Railway

Antes de SESSION-10 (primer DM real), verificar que el sidecar está vivo y la sesión de Instagram sigue activa:

### 4a. Health check

```bash
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

Si `"session": "missing"` o el endpoint da error, la sesión en el volumen de Railway se perdió. En ese caso:
1. Hacer login local con `sidecar/tools/login_local.py`
2. Regenerar `IG_SESSION_B64`
3. Setear en Railway y rebotar el servicio

### 4b. Test de DM stub (sin enviar a un usuario real)

Llamar al endpoint `/dm/send` del sidecar con el HMAC correcto para verificar que responde (no que envía el DM — en este paso usamos un username claramente de test):

```bash
# Solo verificar que el sidecar acepta el request y la firma
# No ejecutar en producción con un username real
# Usar desde local con el sidecar levantado en modo SIDECAR_DATA_DIR=./data
python sidecar/tools/smoke_test_dm.py --dry
```

Si el script `smoke_test_dm.py` no existe, crearlo como parte de esta sesión (ver Paso 4c).

### 4c. Crear `sidecar/tools/smoke_test_dm.py`

Script de smoke test que verifica el contrato HMAC sin enviar DMs reales:

```python
#!/usr/bin/env python3
"""
Smoke test del sidecar: verifica HMAC, /health y /profile/enrich.
No envía DMs reales. Usar antes de SESSION-10.
"""
import os
import sys
import hmac
import hashlib
import json
import httpx

SIDECAR_URL = os.environ.get("IG_SIDECAR_URL", "http://localhost:8000")
SECRET = os.environ.get("IG_SIDECAR_SECRET", "")

def sign(body: bytes) -> str:
    return "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()

def post(path: str, payload: dict) -> dict:
    body = json.dumps(payload).encode()
    r = httpx.post(
        f"{SIDECAR_URL}{path}",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": sign(body),
        },
        timeout=15,
    )
    return {"status": r.status_code, "body": r.json()}

def main():
    dry = "--dry" in sys.argv

    # 1. Health
    r = httpx.get(f"{SIDECAR_URL}/health", timeout=10)
    print(f"[health] {r.status_code} {r.json()}")
    assert r.status_code == 200, "Health check failed"

    # 2. Profile enrich (cuenta pública cualquiera)
    result = post("/profile/enrich", {"ig_username": "instagram"})
    print(f"[profile/enrich] {result['status']}")
    assert result["status"] in (200, 404), f"Unexpected status: {result}"

    # 3. HMAC inválido
    body = json.dumps({"ig_username": "test"}).encode()
    r2 = httpx.post(
        f"{SIDECAR_URL}/profile/enrich",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": "sha256=bad"},
        timeout=10,
    )
    assert r2.status_code == 401, f"Expected 401 for bad HMAC, got {r2.status_code}"
    print("[hmac_invalid] 401 ✓")

    print("\n✅ Sidecar smoke test passed")

if __name__ == "__main__":
    main()
```

Ejecutar contra el sidecar local o Railway:

```bash
# Local
IG_SIDECAR_SECRET=<secret> python sidecar/tools/smoke_test_dm.py --dry

# Railway (sin --dry porque /profile/enrich no envía DMs)
IG_SIDECAR_URL=https://ig-sidecar-production.up.railway.app \
  IG_SIDECAR_SECRET=5fc09c661fef80402d773e7d10a1e2ff9d478aeaf12129feba2b273202a84160 \
  python sidecar/tools/smoke_test_dm.py
```

---

## Paso 5 — Limpiar datos DRY_RUN y checklist pre-launch

### 5a. Limpiar tablas de prueba

Los rows insertados durante DRY_RUN tienen `message_id` con prefijo `dry-run-` en conversations y `first_dm_at` de la sesión de prueba en leads. Limpiar antes de SESSION-10:

```sql
-- Limpiar en orden correcto (conversations referencia leads)
DELETE FROM instagram_conversations
WHERE metadata->>'message_id' LIKE 'dry-run-%';

DELETE FROM instagram_leads;

-- Resetear processed en instagram_leads_raw para que SESSION-10 los procese de nuevo
UPDATE instagram_leads_raw
SET processed = false, updated_at = now()
WHERE processed = true;
```

> **Alternativa conservadora:** no resetear `instagram_leads_raw`. SESSION-10 puede disparar un `ig-discover` fresco para obtener leads nuevos de Apify. Preferible si los leads actuales tienen más de 48h.

### 5b. Verificar env vars en Vercel

Confirmar que todas las variables críticas están seteadas correctamente antes de quitar DRY_RUN:

| Variable | Valor esperado | Estado |
|----------|---------------|--------|
| `DRY_RUN` | `true` (se cambia en SESSION-10) | ✅ |
| `DAILY_DM_LIMIT` | `3` | verificar |
| `FOLLOWUP_HOURS` | `48` | verificar |
| `IG_WARMUP_MODE` | `true` | verificar |
| `APIFY_TOKEN` | token real (no `__stub__`) | ✅ (SESSION-07) |
| `APIFY_WEBHOOK_SECRET` | valor real (no placeholder) | ✅ (SESSION-07) |
| `IG_SIDECAR_URL` | `https://ig-sidecar-production.up.railway.app` | ✅ |
| `NEXT_PUBLIC_WA_NUMBER` | número de WhatsApp real (o aceptar placeholder) | pendiente |

### 5c. Checklist pre-launch SESSION-10

Marcar cada ítem antes de cerrar esta sesión:

- [ ] `run-cycle` en modo DRY_RUN simulado procesa leads correctamente
- [ ] Al menos 5 leads con score ≥ 40 en `instagram_leads` (datos de prueba)
- [ ] Templates de DM revisados y aprobados manualmente (Paso 3d)
- [ ] Sidecar Railway responde `/health` con `"session": "loaded"`
- [ ] Smoke test HMAC del sidecar: 401 en firma inválida, 200 en firma válida
- [ ] Tablas DRY_RUN limpiadas (Paso 5a)
- [ ] `instagram_leads_raw` tiene al menos 20 rows con `processed=false` para SESSION-10
- [ ] `DAILY_DM_LIMIT=3` confirmado en Vercel
- [ ] `IG_WARMUP_MODE=true` confirmado en Vercel
- [ ] `PROGRESS.md` actualizado

---

## Paso 6 — Deploy y smoke test final

```bash
cd apex-leads
git add \
  src/app/api/ig/run-cycle/route.ts \
  sidecar/tools/smoke_test_dm.py \
  docs/ig/PROGRESS.md
git commit -m "feat(ig): dry_run simulate mode + sidecar smoke test + pre-launch checklist"
git push origin master
```

Smoke test en Vercel con DRY_RUN mejorado:

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
  "outreach": { "sent": 3, "skipped": 14 },
  "followup": { "sent": 0, "ghosted_closed": 0 }
}
```

---

## Criterios de éxito

1. `run-cycle` con `DRY_RUN=true` procesa leads completo y retorna `outreach.sent > 0` ✅
2. Rows en `instagram_leads` con scores reales y templates visibles en `instagram_conversations` ✅
3. Templates de DM revisados manualmente — tono natural, sin links, con pregunta final ✅
4. Sidecar Railway pasa smoke test: `/health` ok, HMAC inválido → 401 ✅
5. Checklist pre-launch completa (todos los ítems marcados) ✅
6. Tablas limpiadas y `instagram_leads_raw` reseteado para SESSION-10 ✅
7. `PROGRESS.md` actualizado ✅

---

## Archivos modificados en esta sesión

- `apex-leads/src/app/api/ig/run-cycle/route.ts` — dry_run como simulate mode (no return early)
- `sidecar/tools/smoke_test_dm.py` — script de smoke test del sidecar (nuevo)
- `docs/ig/PROGRESS.md` — actualizar estado SESSION-09

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, todas las decisiones
- `apex-leads/src/lib/ig/classify.ts` — `isTargetLead()` + `IgProfile` type
- `apex-leads/src/lib/ig/score.ts` — `scoreLead()`
- `apex-leads/src/lib/ig/sidecar.ts` — `sendDM()`, `SidecarError`
- `apex-leads/src/lib/ig/prompts/templates.ts` — `pickOpeningTemplate()`, `pickFollowupTemplate()`
- `apex-leads/src/lib/ig/prompts/system.ts` — system prompt (regla: sin links en DMs)
- `apex-leads/src/lib/ig/config.ts` — env vars y defaults
- `sidecar/tools/login_local.py` — bootstrap de sesión IG desde IP local (si hay que regenerar)
