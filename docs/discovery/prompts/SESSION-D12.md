# SESSION-D12 — Self-learning scoring (weight updater + shadow A/B)

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión (~3h)
> **Prerequisitos:** D07 ✅, D11 ✅, ≥ 200 leads contactados con outcome (`replied_at` poblado o NULL ≥ 7d después de send).

---

## Contexto

Lectura: `MASTER-PLAN.md` § 6, `ARCHITECTURE.md` § 8 (algoritmo update semanal). Leer también el código de D07.

Esta es la sesión más sofisticada del plan. Entrenamos pesos nuevos con logistic regression sobre outcomes reales, los ponemos en shadow durante 1 semana (computamos AMBAS scores pero solo `production` decide DM), y después del shadow promovemos si staging gana significativamente.

**Pre-condición:** sin ≥ 200 leads contactados con outcome estable, el modelo no puede entrenar nada útil. Si los datos no alcanzan, esta sesión queda parcial: implementamos la infra pero el primer training real espera más data.

---

## Objetivo

1. Worker Python `sidecar/jobs/update_weights.py` (sklearn LogisticRegression).
2. Cron Railway semanal lunes 04:00 ART → corre worker.
3. Worker inserta nuevo `scoring_weights` con `status='staging'`.
4. `lib/ig/score/v2.ts` modificado: si existe staging, computa ambas y guarda ambas en `lead_score_history`.
5. Cron lunes 04:30 ART → `/api/cron/promote-weights` evalúa shadow y promueve si gana.
6. Manual override desde admin: botón "Promote staging now" / "Reject staging".

---

## Paso 1 — Branch + setup

```bash
git checkout -b feat/discovery-d12-self-learning
cd sidecar && pip install scikit-learn pandas
# Agregar a requirements.txt: scikit-learn==1.5.*, pandas==2.2.*
```

---

## Paso 2 — Worker Python

`sidecar/jobs/update_weights.py`:

```python
"""
Cron weekly job: re-train scoring weights from outcomes of last 14-21 days.
Inserta nueva versión en scoring_weights status='staging'.
Manual o cron promueve a 'production' después de shadow A/B (D12 step 5).
"""
import os, json
import pandas as pd
from datetime import datetime, timedelta, timezone
from sklearn.linear_model import LogisticRegression
from supabase import create_client

LOOKBACK_DAYS = 21
OUTCOME_WINDOW_DAYS = 7   # un lead "no respondió" si pasaron ≥ 7d sin reply

def main():
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    cutoff_outcome = (datetime.now(timezone.utc) - timedelta(days=OUTCOME_WINDOW_DAYS)).isoformat()
    cutoff_lookback = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()

    # leads contactados en la ventana, con tiempo suficiente para haber respondido
    leads = sb.table("instagram_leads").select("id, replied_at, contacted_at").gte("contacted_at", cutoff_lookback).lte("contacted_at", cutoff_outcome).execute().data
    if len(leads) < 100:
        print(f"insufficient data ({len(leads)}); skipping training")
        return

    # Buscar features de cada lead en lead_score_history (la última entry pre-DM)
    rows = []
    for l in leads:
        hist = sb.table("lead_score_history").select("features").eq("lead_id", l["id"]).order("computed_at", desc=False).limit(1).execute().data
        if not hist: continue
        feats = hist[0]["features"]
        outcome = 1 if l["replied_at"] else 0
        rows.append({**feats, "_outcome": outcome})

    if len(rows) < 100:
        print(f"insufficient features rows ({len(rows)}); skipping")
        return

    df = pd.DataFrame(rows)
    feature_cols = [c for c in df.columns if c != "_outcome"]
    X = df[feature_cols].fillna(0).values
    y = df["_outcome"].values

    model = LogisticRegression(max_iter=1000, C=1.0)
    model.fit(X, y)

    weights = {"bias": float(model.intercept_[0])}
    for c, w in zip(feature_cols, model.coef_[0]):
        weights[c] = float(w)

    # next version number
    last = sb.table("scoring_weights").select("version").order("version", desc=True).limit(1).execute().data
    next_version = (last[0]["version"] + 1) if last else 2

    sb.table("scoring_weights").insert({
        "version": next_version,
        "status": "staging",
        "weights": weights,
        "trained_on_n": len(rows),
        "notes": f"trained on outcomes between {cutoff_lookback[:10]} and {cutoff_outcome[:10]}",
    }).execute()
    print(f"inserted weights v{next_version} from {len(rows)} samples")

if __name__ == "__main__":
    main()
```

---

## Paso 3 — Cron Railway

En `sidecar/scheduler/scheduler.py` (o crear nuevo job), agregar:

```python
schedule.every().monday.at("04:00").do(run_update_weights)

def run_update_weights():
    subprocess.run(["python", "-m", "jobs.update_weights"], check=False)
```

(Ajustar a la convención del scheduler existente.)

---

## Paso 4 — Shadow scoring en TS

Modificar `lib/ig/score/v2.ts`:

```typescript
export async function loadStagingWeights(supabase): Promise<WeightsRecord | null> {
  const { data } = await supabase.from('scoring_weights').select('*').eq('status', 'staging').maybeSingle()
  return data ?? null
}

export async function scoreAndPersist(supabase, leadId: string | null, profile, niche, linkVerdict) {
  const prod = await loadProductionWeights(supabase)
  const staging = await loadStagingWeights(supabase)
  const features = extractFeatures(profile, niche, linkVerdict)
  const prodScore = computeScore(features, prod.weights).score
  const stagingScore = staging ? computeScore(features, staging.weights).score : null

  if (leadId) {
    await supabase.from('lead_score_history').insert([
      { lead_id: leadId, weights_version: prod.version, score: prodScore, features },
      ...(staging ? [{ lead_id: leadId, weights_version: staging.version, score: stagingScore, features }] : []),
    ])
  }
  return { score: prodScore, features, version: prod.version, shadow_score: stagingScore, shadow_version: staging?.version ?? null }
}
```

DM gate sigue usando `prodScore`. El shadow_score solo se loggea.

---

## Paso 5 — Promotion endpoint

`apex-leads/src/app/api/cron/promote-weights/route.ts`:

Lógica:
1. Cargar staging y production.
2. Si staging tiene `created_at` > 7 días atrás:
   - Para los leads con history en ambas versiones AND `contacted_at > staging.created_at`, calcular reply rate de los que tendrían score ≥ 60 con cada versión.
   - Test de proporciones (`z = (p1 - p2) / sqrt(p_pool * (1 - p_pool) * (1/n1 + 1/n2))`).
   - Si staging > production con p < 0.1 → promote.
3. Promote = transaction:
   ```sql
   UPDATE scoring_weights SET status='retired', retired_at=now() WHERE status='production';
   UPDATE scoring_weights SET status='production', promoted_at=now() WHERE id=<staging.id>;
   ```
4. Si staging perdió o empató → mantener production, marcar staging como `retired`.
5. Discord alert con resultado.

Cron Vercel: `30 4 * * 1` (lunes 04:30 UTC).

---

## Paso 6 — UI admin

En `/admin/ig` agregar sección "Scoring Models":
- Tabla con todas las versions de `scoring_weights` (status, version, trained_on_n, promoted_at, retired_at).
- Si hay staging: card destacado con "Promote now" (force) / "Reject" (mark retired sin promover).
- Endpoint `POST /api/admin/scoring/promote` y `/reject`.

---

## Paso 7 — Tests

- `update_weights.py` test con CSV mock (pytest).
- `scoreAndPersist` con production y staging → guarda 2 rows.
- Promotion logic: simular A wins → transition correcta. Simular B wins → no transition.

---

## Paso 8 — Smoke

Si hay datos suficientes:
```bash
# Trigger manual del worker
railway run python -m jobs.update_weights
# Verificar
SELECT version, status, trained_on_n, notes FROM scoring_weights ORDER BY version DESC;
```

Si no hay datos: simular insertando 200 rows de history+leads sintéticos en una branch Supabase, correr training, verificar que sale weights razonables.

---

## Criterios de éxito

1. ✅ Worker entrena y persiste staging weights.
2. ✅ Shadow scoring loggea ambas versions sin afectar DM gate.
3. ✅ Promotion endpoint con z-test correcto.
4. ✅ Admin UI permite force/reject.
5. ✅ Cron Railway + Vercel registrados.

---

## Cierre

- Update PROGRESS D12 → ✅, anotar si hubo training real o solo infra.
- PR
