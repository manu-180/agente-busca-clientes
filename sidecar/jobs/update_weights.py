"""
update_weights.py — weekly self-learning scoring job.

Fetches ground-truth replies from the last 90 days, trains a Logistic
Regression on lead features, and inserts a candidate row in scoring_weights.
Auto-promotes if the new model is significantly better (p < 0.05).
Sends a Discord alert in both outcomes.

Minimum positives required: MIN_POSITIVES = 50
"""

import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(asctime)s [update_weights] %(levelname)s %(message)s"))
logger.addHandler(_handler)

MIN_POSITIVES = 50
FEATURE_KEYS = [
    "followers_log",
    "posts_log",
    "engagement_rate",
    "has_business_category",
    "business_category_match",
    "bio_keyword_match",
    "has_external_url",
    "link_is_linktree_or_ig_only",
    "posts_recency",
    "niche_classifier_confidence",
]


def _discord_alert(webhook_url: str | None, title: str, message: str) -> None:
    if not webhook_url:
        logger.info("Discord webhook not set — skipping alert: %s", title)
        return
    try:
        import httpx
        payload = {"embeds": [{"title": title, "description": message, "color": 0x4A90E2}]}
        httpx.post(webhook_url, json=payload, timeout=10)
    except Exception as exc:
        logger.warning("Discord alert failed: %s", exc)


def run(supabase_client=None) -> dict:
    """
    Main entry point. Returns a status dict.
    Pass supabase_client for testing; if None, creates one from env vars.
    """
    if supabase_client is None:
        from app.db import get_supabase_client
        supabase_client = get_supabase_client()

    webhook = os.environ.get("DISCORD_ALERT_WEBHOOK")
    now = datetime.now(timezone.utc)

    logger.info("update_weights: starting at %s", now.isoformat())

    # ── 1. Fetch training data ────────────────────────────────────────────────
    # Join dm_template_assignments (ground truth) with lead_score_history (features)
    # Only rows from the last 90 days that have features
    cutoff = "now() - interval '90 days'"

    resp = (
        supabase_client
        .from_("dm_template_assignments")
        .select(
            "lead_id, replied, "
            "lead_score_history!inner(features, weights_version)"
        )
        .gte("assigned_at", "now() - interval '90 days'")
        .not_.is_("lead_score_history.features", "null")
        .execute()
    )

    rows = resp.data or []
    logger.info("update_weights: fetched %d training rows", len(rows))

    X, y = [], []
    for row in rows:
        history = row.get("lead_score_history")
        if not history:
            continue
        # lead_score_history is an array (one-to-many), take the latest entry
        if isinstance(history, list):
            history = history[-1] if history else None
        if not history:
            continue
        features = history.get("features") or {}
        vec = [float(features.get(k, 0.0)) for k in FEATURE_KEYS]
        label = 1 if row.get("replied") else 0
        X.append(vec)
        y.append(label)

    n_positive = sum(y)
    n_total = len(y)
    logger.info("update_weights: %d total samples, %d positives", n_total, n_positive)

    if n_positive < MIN_POSITIVES:
        logger.info(
            "update_weights: not enough positives (%d < %d) — skipping training",
            n_positive,
            MIN_POSITIVES,
        )
        return {"status": "skipped", "reason": "not_enough_positives", "n_positive": n_positive}

    # ── 2. Train Logistic Regression ─────────────────────────────────────────
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import cross_val_score
    import numpy as np

    X_arr = np.array(X, dtype=float)
    y_arr = np.array(y, dtype=int)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_arr)

    model = LogisticRegression(C=1.0, max_iter=500, random_state=42)
    model.fit(X_scaled, y_arr)

    # Accuracy via cross-val (5-fold) on the training set
    cv_scores = cross_val_score(model, X_scaled, y_arr, cv=5, scoring="accuracy")
    candidate_accuracy = float(cv_scores.mean())
    logger.info("update_weights: candidate CV accuracy = %.4f", candidate_accuracy)

    # Map sklearn coef_ back to weight dict (bias + feature keys)
    coef = model.coef_[0]  # shape (n_features,)
    bias = float(model.intercept_[0])
    weights: dict[str, float] = {"bias": bias}
    for k, c in zip(FEATURE_KEYS, coef):
        weights[k] = float(c)

    # ── 3. Fetch current production weights accuracy for comparison ───────────
    prod_resp = (
        supabase_client
        .from_("scoring_weights")
        .select("id, version, weights, trained_on_n")
        .eq("status", "production")
        .maybeSingle()
        .execute()
    )
    prod_row = prod_resp.data

    production_accuracy: float | None = None
    if prod_row and prod_row.get("trained_on_n") and prod_row["trained_on_n"] > 0:
        # Re-evaluate production weights on current dataset to get comparable accuracy
        prod_w = prod_row["weights"]
        prod_preds = []
        for vec in X_arr:
            z = prod_w.get("bias", 0.0) + sum(
                prod_w.get(k, 0.0) * float(v) for k, v in zip(FEATURE_KEYS, vec)
            )
            sigmoid = 1 / (1 + np.exp(-z))
            prod_preds.append(1 if sigmoid >= 0.5 else 0)
        production_accuracy = float(np.mean(np.array(prod_preds) == y_arr))
        logger.info("update_weights: production re-eval accuracy = %.4f", production_accuracy)

    # ── 4. Insert candidate in scoring_weights ────────────────────────────────
    # Determine next version number
    version_resp = (
        supabase_client
        .from_("scoring_weights")
        .select("version")
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    latest_version = (version_resp.data[0]["version"] if version_resp.data else 0)
    new_version = latest_version + 1

    insert_resp = (
        supabase_client
        .from_("scoring_weights")
        .insert({
            "version": new_version,
            "weights": weights,
            "status": "candidate",
            "trained_on_n": n_total,
        })
        .execute()
    )
    new_id = insert_resp.data[0]["id"] if insert_resp.data else None
    logger.info("update_weights: inserted candidate id=%s version=%d", new_id, new_version)

    # ── 5. Statistical comparison & optional auto-promote ─────────────────────
    promoted = False
    p_value: float | None = None

    if production_accuracy is not None:
        from statsmodels.stats.proportion import proportions_ztest
        import numpy as np

        # Candidate predictions on same dataset
        candidate_preds = []
        for vec in X_scaled:
            z = model.intercept_[0] + float(np.dot(model.coef_[0], vec))
            sigmoid = 1 / (1 + np.exp(-z))
            candidate_preds.append(1 if sigmoid >= 0.5 else 0)

        n_correct_candidate = int(np.sum(np.array(candidate_preds) == y_arr))
        n_correct_production = int(production_accuracy * n_total)

        count = np.array([n_correct_candidate, n_correct_production])
        nobs = np.array([n_total, n_total])
        _, p_value = proportions_ztest(count, nobs, alternative="larger")
        p_value = float(p_value)
        logger.info(
            "update_weights: proportions_ztest p=%.4f "
            "(candidate=%.4f vs production=%.4f)",
            p_value,
            candidate_accuracy,
            production_accuracy,
        )

        if p_value < 0.05 and candidate_accuracy > production_accuracy:
            # Auto-promote: set new candidate to production, retire old one
            if prod_row:
                supabase_client.from_("scoring_weights").update(
                    {"status": "retired"}
                ).eq("id", prod_row["id"]).execute()
            supabase_client.from_("scoring_weights").update(
                {"status": "production"}
            ).eq("id", new_id).execute()
            promoted = True
            logger.info("update_weights: auto-promoted version %d to production", new_version)

    # ── 6. Discord alert ──────────────────────────────────────────────────────
    if promoted:
        title = f"✅ Scoring weights auto-promoted → v{new_version}"
        msg = (
            f"**Candidate v{new_version}** promoted to production.\n"
            f"Accuracy: candidate={candidate_accuracy:.3f}"
            + (f", production={production_accuracy:.3f}" if production_accuracy is not None else "")
            + (f", p={p_value:.4f}" if p_value is not None else "")
            + f"\nTrained on {n_total} samples ({n_positive} positives)."
        )
    else:
        title = f"🔵 Scoring weights candidate created — v{new_version}"
        msg = (
            f"**Candidate v{new_version}** inserted (status=candidate).\n"
            f"Accuracy: candidate={candidate_accuracy:.3f}"
            + (f", production={production_accuracy:.3f}" if production_accuracy is not None else " (no production baseline)")
            + (f", p={p_value:.4f}" if p_value is not None else "")
            + f"\nTrained on {n_total} samples ({n_positive} positives).\n"
            "Not promoted (p≥0.05 or not better than production)."
        )
    _discord_alert(webhook, title, msg)

    return {
        "status": "promoted" if promoted else "candidate",
        "version": new_version,
        "candidate_accuracy": candidate_accuracy,
        "production_accuracy": production_accuracy,
        "p_value": p_value,
        "n_total": n_total,
        "n_positive": n_positive,
    }
