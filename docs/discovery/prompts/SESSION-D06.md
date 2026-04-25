# SESSION-D06 — Niche classifier (Claude Haiku) + cache

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión (~2h)
> **Prerequisitos:** D01–D05 ✅

---

## Contexto

Lectura: `MASTER-PLAN.md` § 7, `ARCHITECTURE.md` § 4.3, § 7. PROGRESS.md.

Cada lead enriquecido pasa por Claude Haiku que lo etiqueta con uno de 9 nichos + confidence. Solo los que matchean el target (moda femenina/masculina/infantil/calzado/accesorios/belleza/joyería) y confidence ≥ 0.6 siguen a DM.

Esta es la PRIMERA sesión que toca Anthropic API → asegurar `ANTHROPIC_API_KEY` en Vercel antes de codear.

---

## Objetivo

1. Helper `lib/ig/classify/niche.ts` con función `classifyNiche(profile) -> ClassificationResult`.
2. Cache vía tabla `niche_classifications` (lookup por hash de bio+category, válido 30 días).
3. Endpoint interno `POST /api/internal/classify-niche` para usar manualmente o desde admin.
4. Integración en `run-cycle/route.ts` después de enrich, antes de score.
5. Costo monitoreado: si gasto/día estimado > $1, log en `alerts_log` (D10 lo conecta a Discord).
6. Tests con SDK Anthropic mockeado.

---

## Paso 1 — Branch + setup

```bash
git checkout -b feat/discovery-d06-niche-classifier
pnpm add @anthropic-ai/sdk
```

Verificar que `ANTHROPIC_API_KEY` esté en Vercel (Production + Preview). Si no está: setearlo via REST API o dashboard.

Agregar a `lib/ig/config.ts`:
```typescript
ANTHROPIC_API_KEY: z.string().min(1),
CLAUDE_HAIKU_MODEL: z.string().default('claude-haiku-4-20250514'),
```

---

## Paso 2 — Prompt

`lib/ig/classify/prompts.ts`:

```typescript
export const NICHE_SYSTEM_PROMPT = `Sos un clasificador de cuentas de Instagram para un agente que vende sitios web a boutiques argentinas.

Devolvé EXACTAMENTE JSON: {"niche": "<categoria>", "confidence": <0.0-1.0>, "reason": "<máx 80 chars>"}

Categorías permitidas:
- moda_femenina         (ropa para mujer adulta)
- moda_masculina        (ropa para hombre adulto)
- indumentaria_infantil
- accesorios            (carteras, bijouterie no-fina, lentes, gorros)
- calzado
- belleza_estetica      (centros estéticos, productos beauty, peluquería)
- joyeria               (joyería fina, plata/oro)
- otro                  (comercio pero no es ninguno de los anteriores)
- descartar             (cuenta personal, política, spam, sin actividad comercial)

Confidence: qué tan seguro estás. <0.6 marca para revisión.

Si la bio menciona "envíos a todo el país" + ropa → confianza alta.
Si dice "showroom" + categoría textil → confianza alta.
Si es solo nombre + foto sin más datos → confianza <0.5.
NO inventes — si no hay datos, devolvé descartar con confianza alta.`

export function buildUserPrompt(p: Profile): string {
  return `Username: @${p.ig_username}
Nombre: ${p.full_name ?? '—'}
Categoría IG: ${p.business_category ?? '—'}
Bio:
"""
${(p.biography ?? '').slice(0, 500)}
"""
Followers: ${p.followers_count}  Posts: ${p.posts_count}
External URL: ${p.external_url ?? '—'}`
}
```

---

## Paso 3 — Cache hash

```typescript
import { createHash } from 'crypto'

export function promptHash(p: Profile): string {
  const key = `${p.biography ?? ''}|${p.business_category ?? ''}|${p.full_name ?? ''}`
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}
```

Cache lookup:
```typescript
const hash = promptHash(profile)
const { data: cached } = await supabase
  .from('niche_classifications')
  .select('*')
  .eq('ig_username', profile.ig_username)
  .gt('expires_at', new Date().toISOString())
  .order('classified_at', { ascending: false })
  .limit(1).maybeSingle()

if (cached && cached.prompt_hash === hash) return cached  // hit
```

---

## Paso 4 — Llamada Anthropic

```typescript
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ apiKey: igConfig.ANTHROPIC_API_KEY })

async function callClaude(profile: Profile): Promise<ClassificationResult> {
  const resp = await client.messages.create({
    model: igConfig.CLAUDE_HAIKU_MODEL,
    max_tokens: 200,
    system: NICHE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(profile) }],
  })
  const text = resp.content[0].type === 'text' ? resp.content[0].text : ''
  // Parse JSON, retry 1× si fail
  const parsed = parseJsonLoose(text)
  return ClassificationSchema.parse(parsed)   // zod
}
```

Schema zod:
```typescript
const ClassificationSchema = z.object({
  niche: z.enum(['moda_femenina','moda_masculina','indumentaria_infantil','accesorios','calzado','belleza_estetica','joyeria','otro','descartar']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(120),
})
```

---

## Paso 5 — Función pública + persist

```typescript
export async function classifyNiche(supabase, profile: Profile): Promise<ClassificationResult> {
  const hash = promptHash(profile)
  const cached = await getCached(supabase, profile.ig_username, hash)
  if (cached) return cached

  const result = await callClaude(profile)
  await supabase.from('niche_classifications').insert({
    ig_username: profile.ig_username,
    niche: result.niche,
    confidence: result.confidence,
    reason: result.reason,
    classifier: igConfig.CLAUDE_HAIKU_MODEL,
    prompt_hash: hash,
  })
  return result
}
```

---

## Paso 6 — Endpoint interno

`apex-leads/src/app/api/internal/classify-niche/route.ts` con auth `CRON_SECRET` (uso interno + admin). POST `{ig_username}` → busca profile en `instagram_leads`, clasifica, devuelve resultado.

---

## Paso 7 — Integración run-cycle

Después del bloque enrich, antes del bloque score:

```typescript
import { classifyNiche } from '@/lib/ig/classify/niche'

const TARGET_NICHES = new Set(['moda_femenina','moda_masculina','indumentaria_infantil','accesorios','calzado','belleza_estetica','joyeria'])
const MIN_CONFIDENCE = 0.6

// Después de enriquedMap.set(...)
for (const [username, profile] of enrichedMap.entries()) {
  try {
    const cls = await classifyNiche(supabase, profile)
    profile.niche = cls.niche
    profile.niche_confidence = cls.confidence
  } catch (err) {
    console.error('[classify] failed', username, err)
    profile.niche = null
    profile.niche_confidence = 0
  }
}

// En el filter actual de target/score, agregar gate:
if (!profile.niche || !TARGET_NICHES.has(profile.niche) || profile.niche_confidence < MIN_CONFIDENCE) {
  // marcar processed con reason 'wrong_niche'
  continue
}
```

Y al hacer upsert de `instagram_leads`, incluir `niche` y `niche_confidence`.

---

## Paso 8 — Cost guard

Trackear gasto en memoria del cycle (`tokens_used * price`). Al final, si > umbral diario, insertar en `alerts_log`:

```typescript
const dailySpendKey = today + ':classify_spend'
// upsert en una tabla de counters o en alerts_log directamente al cruzar umbral
```

Simple: contar invocaciones (no-cached) en este cycle, multiplicar por costo estimado por call (~$0.0001), y si la suma del día (query a `niche_classifications WHERE classified_at > today` count) supera $1 → insertar warning en `alerts_log` (1× por día, dedup en query).

---

## Paso 9 — Tests

- Mock Anthropic SDK
- Cache hit no llama a Anthropic
- JSON inválido → retry 1× → si vuelve a fallar, throw
- niche fuera del enum → zod throw
- Integration test del endpoint

---

## Criterios de éxito

1. ✅ Endpoint `/api/internal/classify-niche` responde con clasificación.
2. ✅ Cache funciona (segunda llamada misma user → hit DB, no llama Claude).
3. ✅ run-cycle filtra wrong_niche correctamente.
4. ✅ `niche_classifications` se puebla.
5. ✅ Cost guard activo (verificable forzando spend en test).

---

## Cierre

- Update PROGRESS D06 → ✅, anotar costo estimado / 100 leads.
- PR.
