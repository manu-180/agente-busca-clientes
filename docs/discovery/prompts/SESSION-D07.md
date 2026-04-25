# SESSION-D07 — Scoring v2 (features ampliados, weights versionados)

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión (~2h)
> **Prerequisitos:** D01–D06 ✅

---

## Contexto

Lectura: `MASTER-PLAN.md` § 6, `ARCHITECTURE.md` § 4.4, § 4.5, § 8. Leer también `apex-leads/src/lib/ig/score.ts` (v1).

Hoy el scoring es 100% hardcoded. v2 introduce:
- 10 features (vs 5 en v1)
- pesos versionados en DB
- sigmoid en vez de suma directa
- log de cada cómputo en `lead_score_history` para auditar drift

Esta sesión NO implementa el self-learning loop (eso es D12). Solo el motor + seed de pesos iniciales.

---

## Objetivo

1. `lib/ig/score/features.ts` extrae features del profile + classification.
2. `lib/ig/score/v2.ts` aplica pesos + sigmoide.
3. Seedear `scoring_weights` v1 con pesos manuales razonables, status `production`.
4. Modificar `run-cycle` para usar v2 + escribir history.
5. Backfill opcional: re-scorear leads existentes con v2 y guardar history (no overwrite si no se quiere).
6. Tests.

---

## Paso 1 — Branch

```bash
git checkout -b feat/discovery-d07-scoring-v2
```

---

## Paso 2 — Features

`lib/ig/score/features.ts`:

```typescript
const NICHE_WHITELIST_KEYWORDS = ['moda','indumentaria','ropa','boutique','showroom','fashion','clothes','wear','tienda','shop','beauty','belleza','estetica','accesorios','joyeria','calzado','zapatos']

const TARGET_BUSINESS_CATEGORIES = ['Clothing (Brand)','Shopping & retail','Personal Goods & General Merchandise Stores','Beauty, cosmetic & personal care']

export interface Features {
  followers_log: number; posts_log: number; engagement_rate: number;
  has_business_category: number; business_category_match: number;
  bio_keyword_match: number; has_external_url: number;
  link_is_linktree_or_ig_only: number; posts_recency: number;
  niche_classifier_confidence: number;
}

export function extractFeatures(profile: Profile, niche: ClassificationResult | null, linkVerdict: string): Features {
  const fol = Number(profile.followers_count ?? 0)
  const pst = Number(profile.posts_count ?? 0)
  const bio = (profile.biography ?? '').toLowerCase()
  const bioHits = NICHE_WHITELIST_KEYWORDS.filter(k => bio.includes(k)).length
  const cat = profile.business_category ?? ''
  const lastPostDays = profile.last_post_at
    ? Math.floor((Date.now() - new Date(profile.last_post_at).getTime()) / 86400000)
    : 90
  // engagement rate: si tenemos avg likes (futuro), por ahora 0
  const engagement = (profile as any).engagement_rate ?? 0

  return {
    followers_log: Math.min(Math.log10(fol + 1) / 5, 1),
    posts_log: Math.min(Math.log10(pst + 1) / 4, 1),
    engagement_rate: Math.min(engagement * 5, 1),
    has_business_category: cat ? 1 : 0,
    business_category_match: TARGET_BUSINESS_CATEGORIES.some(t => cat.includes(t)) ? 1 : 0,
    bio_keyword_match: Math.min(bioHits / 5, 1),
    has_external_url: profile.external_url ? 1 : 0,
    link_is_linktree_or_ig_only: linkVerdict !== 'own_site' ? 1 : 0,
    posts_recency: 1 - Math.min(lastPostDays / 90, 1),
    niche_classifier_confidence: niche && ['moda_femenina','moda_masculina','indumentaria_infantil','accesorios','calzado','belleza_estetica','joyeria'].includes(niche.niche) ? niche.confidence : 0,
  }
}
```

---

## Paso 3 — Scoring engine

`lib/ig/score/v2.ts`:

```typescript
const SIGMOID = (z: number) => 1 / (1 + Math.exp(-z))

export interface WeightsRecord { id: string; version: number; status: string; weights: Record<string, number> }

export async function loadProductionWeights(supabase): Promise<WeightsRecord> {
  const { data, error } = await supabase.from('scoring_weights').select('*').eq('status', 'production').maybeSingle()
  if (error || !data) throw new Error('no production weights found — seed scoring_weights first')
  return data
}

export function computeScore(features: Features, weights: Record<string, number>): { score: number; z: number } {
  let z = weights['bias'] ?? 0
  for (const k of Object.keys(features) as (keyof Features)[]) {
    z += (weights[k] ?? 0) * features[k]
  }
  const score = Math.round(SIGMOID(z) * 100)
  return { score, z }
}

export async function scoreAndPersist(supabase, leadId: string | null, profile: Profile, niche: any, linkVerdict: string): Promise<{ score: number; features: Features; version: number }> {
  const w = await loadProductionWeights(supabase)
  const features = extractFeatures(profile, niche, linkVerdict)
  const { score } = computeScore(features, w.weights)
  if (leadId) {
    await supabase.from('lead_score_history').insert({
      lead_id: leadId, weights_version: w.version, score, features,
    })
  }
  return { score, features, version: w.version }
}
```

---

## Paso 4 — Seed de pesos

Insertar via SQL (no migración, es seed):

```sql
INSERT INTO scoring_weights (version, status, weights, trained_on_n, notes, promoted_at) VALUES (
  1, 'production',
  '{
    "bias": -2.5,
    "followers_log": 1.5,
    "posts_log": 0.8,
    "engagement_rate": 1.0,
    "has_business_category": 0.6,
    "business_category_match": 1.2,
    "bio_keyword_match": 1.5,
    "has_external_url": 0.3,
    "link_is_linktree_or_ig_only": 0.8,
    "posts_recency": 0.7,
    "niche_classifier_confidence": 2.0
  }'::jsonb,
  0, 'manual seed v1', now()
);
```

Pesos elegidos para que un perfil ideal (boutique mediana, niche match alto) salga ~80, uno marginal ~50, uno malo <30. Verificar con tests.

---

## Paso 5 — Integración run-cycle

Reemplazar `import { scoreLead }` por `scoreAndPersist`. Eliminar lógica vieja de score / breakdown manual.

Antes del DM gate:
```typescript
const { score, features, version } = await scoreAndPersist(supabase, /*leadId aún null*/null, profile, classification, linkVerdict)
if (score < igConfig.MIN_SCORE_FOR_DM) {
  // marcar low_score, upsert lead con score
  ...
  continue
}
```

Después del upsert (que devuelve leadId):
```typescript
// re-insertar history con leadId real
await supabase.from('lead_score_history').insert({
  lead_id: leadRow.id, weights_version: version, score, features,
})
```

Update env var `MIN_SCORE_FOR_DM` (default 60 vs antiguo 25).

---

## Paso 6 — Backfill opcional

Endpoint admin `POST /api/internal/rescore-all`:
- Itera todos los leads en `instagram_leads`
- Reconstruye profile parcial desde columnas + niche desde `niche_classifications`
- Llama scoreAndPersist
- NO actualiza `lead_score` en `instagram_leads` (solo log para audit)

Si Manuel quiere overwrite: query manual.

---

## Paso 7 — Tests

`v2.test.ts`:
- Perfil ideal (boutique 5k followers, 100 posts, niche moda_femenina conf 0.9, bio "moda femenina envíos a todo el país", no own site) → score > 75
- Perfil marginal → score 40-60
- Perfil descartable → score < 30
- Si `scoring_weights production` no existe → throw claro

---

## Criterios de éxito

1. ✅ `scoring_weights` tiene 1 row production v1.
2. ✅ run-cycle usa v2, registra history.
3. ✅ Tests verdes con valores esperados.
4. ✅ MIN_SCORE_FOR_DM=60 → menos leads pasan a DM, calidad sube.
5. ✅ Backfill endpoint funciona (corrida en N leads).

---

## Cierre

- Update PROGRESS D07 → ✅, anotar % de leads que ahora pasan score gate vs antes.
- PR.
