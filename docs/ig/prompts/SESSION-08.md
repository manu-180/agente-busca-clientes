# SESSION-08 — Run-cycle completo + landing page /boceto

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión
> **Prerequisitos:** SESSION-07 completada — Apify webhook funciona, rows en `instagram_leads_raw` confirmados, fix auth de webhook deployado en Vercel.

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
- Next.js Vercel: deployado, smoke tests pasados ✅
- Apify: token real seteado, webhook E2E confirmado ✅
- `instagram_leads_raw`: tiene rows de Apify ✅
- `instagram_leads` + `instagram_conversations`: **pendiente de crear (este paso)**

El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Objetivo de esta sesión

1. **Crear tablas Supabase** `instagram_leads` + `instagram_conversations`
2. **Implementar `run-cycle` completo** — procesar leads, enviar DMs, manejar follow-ups
3. **Crear landing page `/boceto`** — página pública que boutiques ven al visitar el perfil de IG
4. **Test local en DRY_RUN** — verificar que el ciclo corre sin errores
5. **Deploy y smoke test en Vercel**
6. Actualizar `PROGRESS.md`

> **Nota sobre links en DMs:** El sistema prompt del agente (`system.ts`) prohíbe explícitamente enviar links externos en mensajes de Instagram (activan filtros de spam). La página `/boceto` es para el perfil de IG del sender (`apex.stack`) y búsqueda orgánica, NO para incluir en los DMs.

---

## Paso 1 — Tablas Supabase

### 1a. `instagram_leads`

Verificar si existe. Si no existe, crear con el MCP de Supabase (`apply_migration` en proyecto `hpbxscfbnhspeckdmkvu`) o desde el SQL Editor del dashboard:

```sql
CREATE TABLE IF NOT EXISTS instagram_leads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_username       text        NOT NULL UNIQUE,
  ig_user_id        text,
  full_name         text,
  biography         text,
  external_url      text,
  followers_count   int,
  posts_count       int,
  is_business       boolean,
  business_category text,
  source_ref        text,                          -- hashtag de origen (ej: "modaargentina")
  score             int         NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'dm_sent'
                                CHECK (status IN (
                                  'dm_sent',
                                  'interested',
                                  'closed_positive',
                                  'closed_negative',
                                  'closed_ghosted',
                                  'owner_takeover',
                                  'blacklisted'
                                )),
  first_dm_at       timestamptz,
  last_dm_at        timestamptz,
  followup_count    int         NOT NULL DEFAULT 0,
  owner_takeover_at timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status        ON instagram_leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_last_dm_at    ON instagram_leads (last_dm_at);
CREATE INDEX IF NOT EXISTS idx_leads_first_dm_at   ON instagram_leads (first_dm_at);
```

### 1b. `instagram_conversations`

```sql
CREATE TABLE IF NOT EXISTS instagram_conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid        NOT NULL REFERENCES instagram_leads(id) ON DELETE CASCADE,
  ig_thread_id    text,
  ig_message_id   text,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL,
  direction       text        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sent_at         timestamptz,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_convos_lead_id      ON instagram_conversations (lead_id);
CREATE INDEX IF NOT EXISTS idx_convos_created_at   ON instagram_conversations (created_at);
```

### 1c. Trigger `updated_at` en `instagram_leads`

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON instagram_leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON instagram_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Paso 2 — Landing page `/boceto`

Crear `apex-leads/src/app/boceto/page.tsx` — una página pública, sin auth, que funciona como portfolio/demo de la agencia para boutiques.

### Objetivo de la página

Cuando una boutique recibe un DM de `@apex.stack` y va a ver el perfil de Instagram, puede hacer click en el link de la bio del perfil. Esta página muestra ejemplos de páginas web para boutiques y tiene un CTA de WhatsApp para pedir el boceto.

### Contenido de la página

La página debe incluir:

1. **Hero section:**
   - Título: "Páginas web para boutiques y tiendas de ropa"
   - Subtítulo: "Diseñamos tu sitio con el estilo de tu marca — te mostramos un boceto gratis antes de decidir nada"
   - CTA principal: botón WhatsApp "Quiero mi boceto gratis" → link `https://wa.me/549XXXXXXXXXX` (placeholder, el usuario lo completa con su número real)

2. **Sección "Así quedan las páginas":**
   - 3–4 cards con mockups o screenshots (placeholder images de Unsplash usando URLs de imágenes de ropa/moda)
   - Cada card con nombre ficticio de boutique: "Valentina Moda", "Rosé Boutique", "La Vitrina"

3. **Sección "¿Cómo funciona?":**
   - 3 pasos numerados:
     1. "Nos mandás tu IG o nos contás tu estilo"
     2. "En 48h te enviamos el boceto — sin costo"
     3. "Si te gusta, coordinamos cómo hacerlo realidad"

4. **CTA final:**
   - "¿Querés ver cómo quedaría tu boutique?" + botón WhatsApp

### Implementación

Usar **solo Tailwind CSS** (ya está instalado en el proyecto). Sin componentes externos. Sin `use client` — es un Server Component estático.

Estructura del archivo:

```typescript
// apex-leads/src/app/boceto/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Boceto gratuito para tu boutique | Apex',
  description: 'Diseñamos un boceto gratis de tu página web. Sin compromiso. Tiendas de ropa y boutiques en Argentina.',
}

export default function BocetPage() {
  // ... JSX con Tailwind
}
```

El número de WhatsApp va en una constante al tope del archivo:
```typescript
const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER ?? '549XXXXXXXXXX'
const WA_URL = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hola! Vi el perfil de apex.stack en Instagram y me interesa ver cómo quedaría mi boutique 😊')}`
```

Agregar `NEXT_PUBLIC_WA_NUMBER` al schema de `config.ts` como opcional (sin fail-fast — la página funciona con placeholder si no está seteada):

```typescript
// En config.ts, en el schema:
NEXT_PUBLIC_WA_NUMBER: z.string().optional(),
```

Y en `BUILD_DEFAULTS`:
```typescript
NEXT_PUBLIC_WA_NUMBER: '',
```

---

## Paso 3 — Implementar `run-cycle` completo

Este es el paso central de la sesión. Reemplazar el stub actual de `apex-leads/src/app/api/ig/run-cycle/route.ts` con la implementación real.

### Lógica completa del ciclo

```
run-cycle POST handler:
  1. Verificar auth (Bearer CRON_SECRET) — ya existe
  2. Si DRY_RUN=true → return {ok:true, dry_run:true}  — ya existe
  3. Calcular cuántos DMs se enviaron HOY (first_dm_at >= inicio del día ART)
  4. Si count >= DAILY_DM_LIMIT → return {ok:true, skipped:'daily_limit_reached'}
  5. FASE OUTREACH — procesar leads nuevos:
     a. Fetch top N leads de instagram_leads_raw (processed=false), N = DAILY_DM_LIMIT - count
     b. Para cada lead:
        i.   Parsear raw_profile como IgProfile
        ii.  isTargetLead() → si false, marcar processed=true y SKIP
        iii. scoreLead() → si score < MIN_SCORE (40), marcar processed=true y SKIP
        iv.  Upsert a instagram_leads (ON CONFLICT ig_username DO NOTHING)
        v.   Si ya existía (conflict) → marcar processed=true y SKIP
        vi.  Elegir template con pickOpeningTemplate(lead)
        vii. sendDM(ig_username, text)
        viii.Update instagram_leads: status='dm_sent', first_dm_at=now(), last_dm_at=now()
        ix.  Insertar en instagram_conversations (role=assistant, direction=outbound)
        x.   Marcar instagram_leads_raw: processed=true, updated_at=now()
        xi.  Incrementar counter; si counter >= DAILY_DM_LIMIT → break
  6. FASE FOLLOW-UP — re-contactar leads sin respuesta:
     a. Fetch leads de instagram_leads donde:
        - status = 'dm_sent'
        - followup_count = 0
        - last_dm_at < now() - FOLLOWUP_HOURS horas
     b. Para cada lead (máx 2 follow-ups por ciclo — no comerse el límite diario):
        i.   text = pickFollowupTemplate()
        ii.  sendDM(ig_username, text)
        iii. Update instagram_leads: last_dm_at=now(), followup_count=followup_count+1
        iv.  Si followup_count llega a 1 → no marcar closed todavía (se cierra en ciclo posterior)
     c. Fetch leads con followup_count=1, last_dm_at < now() - FOLLOWUP_HOURS*2 (sin respuesta tras follow-up):
        i.   Update status='closed_ghosted', closed_at=now()
  7. Return {ok:true, outreach:{sent, skipped}, followup:{sent, ghosted_closed}}
```

### Constante MIN_SCORE

Definir en el archivo:
```typescript
const MIN_SCORE = 40
```

### Manejo de errores

- Si `sendDM` lanza `SidecarError` con `isCircuitOpen=true` → **abort** el ciclo completo (retornar error 503). El circuit breaker indica que Instagram bloqueó temporalmente.
- Si `sendDM` lanza otro error → **skip** ese lead (no marcar processed, volver a intentar en siguiente ciclo), loggear.
- Si Supabase falla → propagar el error (500).

### Imports necesarios

```typescript
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'
import { scoreLead } from '@/lib/ig/score'
import { isTargetLead, type IgProfile } from '@/lib/ig/classify'
import { sendDM, SidecarError } from '@/lib/ig/sidecar'
import { pickOpeningTemplate, pickFollowupTemplate } from '@/lib/ig/prompts/templates'
```

### Definición de "inicio del día ART"

Argentina no usa DST. UTC-3 siempre.

```typescript
function startOfDayART(): Date {
  const now = new Date()
  const artOffset = -3 * 60 // minutos
  const artMs = now.getTime() + artOffset * 60 * 1000
  const artDate = new Date(artMs)
  // Truncar a medianoche ART
  artDate.setUTCHours(0, 0, 0, 0)
  // Convertir de vuelta a UTC
  return new Date(artDate.getTime() - artOffset * 60 * 1000)
}
```

### Estructura de retorno del handler

```typescript
type RunCycleResult = {
  ok: boolean
  dry_run?: boolean
  skipped?: string
  outreach?: { sent: number; skipped: number }
  followup?: { sent: number; ghosted_closed: number }
  error?: string
}
```

---

## Paso 4 — Test local DRY_RUN

Levantar el servidor Next.js local y verificar que el ciclo corre sin errores en modo dry:

```bash
cd apex-leads
# Asegurarse de que DRY_RUN=true en .env.local
npm run dev
```

```bash
curl -s -X POST http://localhost:3000/api/ig/run-cycle \
  -H "Authorization: Bearer cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Respuesta esperada:
```json
{"ok": true, "dry_run": true}
```

Para testear el ciclo sin DRY_RUN (con sidecar local o mockeado):
```bash
# En otra terminal: levantar el sidecar local (ver instrucciones en PROGRESS.md)
# En .env.local: DRY_RUN=false, IG_SIDECAR_URL=http://localhost:8000
curl -s -X POST http://localhost:3000/api/ig/run-cycle \
  -H "Authorization: Bearer cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Si hay rows en `instagram_leads_raw` (de SESSION-07), debería devolver:
```json
{
  "ok": true,
  "outreach": {"sent": N, "skipped": M},
  "followup": {"sent": 0, "ghosted_closed": 0}
}
```

---

## Paso 5 — Deploy y smoke test

```bash
cd apex-leads
git add \
  src/app/api/ig/run-cycle/route.ts \
  src/app/boceto/page.tsx \
  src/lib/ig/config.ts \
  docs/ig/PROGRESS.md
git commit -m "feat(ig): run-cycle completo + landing /boceto + tablas Supabase"
git push origin master
```

Esperar deploy en Vercel (≈ 2 min), luego smoke test:

```bash
VERCEL_URL=https://<tu-app>.vercel.app
CRON_SECRET=cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab

# Con DRY_RUN=true en Vercel → debe retornar dry_run:true
curl -s -X POST "$VERCEL_URL/api/ig/run-cycle" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Verificar también que `/boceto` responde 200:
```bash
curl -s -o /dev/null -w "%{http_code}" "$VERCEL_URL/boceto"
# → 200
```

---

## Criterios de éxito

1. Tabla `instagram_leads` existe en Supabase con el schema correcto ✅
2. Tabla `instagram_conversations` existe en Supabase ✅
3. `GET /boceto` devuelve página HTML (200), con hero + mockups + CTA WhatsApp ✅
4. `POST /api/ig/run-cycle` con DRY_RUN=true → `{"ok":true,"dry_run":true}` ✅
5. `POST /api/ig/run-cycle` sin DRY_RUN → procesa leads de `instagram_leads_raw`, inserta en `instagram_leads`, llama sidecar, retorna `{outreach:{sent,skipped}}` ✅
6. Circuit breaker abort: si sidecar devuelve 503, el ciclo se detiene y retorna 503 ✅
7. `PROGRESS.md` actualizado ✅

---

## Archivos modificados en esta sesión

- `apex-leads/src/app/api/ig/run-cycle/route.ts` — implementación completa del ciclo
- `apex-leads/src/app/boceto/page.tsx` — landing page (nuevo)
- `apex-leads/src/lib/ig/config.ts` — agregar `NEXT_PUBLIC_WA_NUMBER` optional
- `docs/ig/PROGRESS.md` — actualizar estado SESSION-08

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, todas las decisiones
- `apex-leads/src/lib/ig/classify.ts` — `isTargetLead()` + `IgProfile` type
- `apex-leads/src/lib/ig/score.ts` — `scoreLead()`
- `apex-leads/src/lib/ig/sidecar.ts` — `sendDM()`, `SidecarError`
- `apex-leads/src/lib/ig/prompts/templates.ts` — `pickOpeningTemplate()`, `pickFollowupTemplate()`
- `apex-leads/src/lib/ig/prompts/system.ts` — system prompt (regla: sin links en DMs)
- `apex-leads/src/lib/ig/handle-reply.ts` — schema de `instagram_conversations` como referencia
- `apex-leads/src/lib/ig/config.ts` — env vars y defaults
