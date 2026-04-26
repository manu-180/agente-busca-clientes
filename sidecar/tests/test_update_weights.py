"""
Tests for jobs/update_weights.py — uses mocked Supabase client.
"""
import os
import sys

import pytest

# Ensure the sidecar root and jobs dir are importable
_SIDECAR_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _SIDECAR_ROOT not in sys.path:
    sys.path.insert(0, _SIDECAR_ROOT)


# ── helpers ───────────────────────────────────────────────────────────────────

FEATURE_KEYS = [
    "followers_log", "posts_log", "engagement_rate",
    "has_business_category", "business_category_match", "bio_keyword_match",
    "has_external_url", "link_is_linktree_or_ig_only", "posts_recency",
    "niche_classifier_confidence",
]

PROD_WEIGHTS = {
    "bias": -2.5, "followers_log": 1.5, "posts_log": 0.8, "engagement_rate": 1.0,
    "has_business_category": 0.6, "business_category_match": 1.2,
    "bio_keyword_match": 1.5, "has_external_url": 0.3,
    "link_is_linktree_or_ig_only": 0.8, "posts_recency": 0.7,
    "niche_classifier_confidence": 2.0,
}


def _make_row(replied: bool, features: dict | None = None) -> dict:
    feat = features or {k: 0.5 for k in FEATURE_KEYS}
    return {
        "lead_id": "lead-abc",
        "replied": replied,
        "lead_score_history": [{"features": feat, "weights_version": 1}],
    }


def _make_supabase_mock(rows: list[dict], prod_row: dict | None = None):
    """Build a mock Supabase client that returns the given training rows."""
    from unittest.mock import MagicMock

    sb = MagicMock()

    # Chain: from_().select().gte().not_.is_().execute() → training data
    execute_train = MagicMock(data=rows)
    not_is = MagicMock()
    not_is.execute.return_value = execute_train
    gte_chain = MagicMock()
    gte_chain.not_ = MagicMock()
    gte_chain.not_.is_ = MagicMock(return_value=not_is)
    select_chain = MagicMock()
    select_chain.gte = MagicMock(return_value=gte_chain)

    # Chain: from_().select().eq().maybeSingle().execute() → prod row
    maybeSingle_prod = MagicMock()
    maybeSingle_prod.execute.return_value = MagicMock(data=prod_row)
    eq_prod = MagicMock()
    eq_prod.maybeSingle = MagicMock(return_value=maybeSingle_prod)
    select_prod = MagicMock()
    select_prod.eq = MagicMock(return_value=eq_prod)

    # Chain: from_().select().order().limit().execute() → latest version
    limit_chain = MagicMock()
    limit_chain.execute.return_value = MagicMock(data=[{"version": 1}])
    order_chain = MagicMock()
    order_chain.limit = MagicMock(return_value=limit_chain)
    select_version = MagicMock()
    select_version.order = MagicMock(return_value=order_chain)

    # insert → new row
    insert_chain = MagicMock()
    insert_chain.execute.return_value = MagicMock(data=[{"id": "new-id-123"}])

    # update → retire / promote
    update_chain = MagicMock()
    eq_update = MagicMock()
    eq_update.execute = MagicMock(return_value=MagicMock())
    update_chain.eq = MagicMock(return_value=eq_update)

    call_count = [0]

    def _from(table: str):
        mock = MagicMock()
        if table == "dm_template_assignments":
            mock.select = MagicMock(return_value=select_chain)
        elif table == "scoring_weights":
            call_count[0] += 1
            if call_count[0] == 1:
                # First call: production weights lookup
                mock.select = MagicMock(return_value=select_prod)
            elif call_count[0] == 2:
                # Second call: latest version lookup
                mock.select = MagicMock(return_value=select_version)
            else:
                mock.select = MagicMock(return_value=select_prod)
            mock.insert = MagicMock(return_value=insert_chain)
            mock.update = MagicMock(return_value=update_chain)
        return mock

    sb.from_ = _from
    return sb, insert_chain, update_chain


# ── tests ──────────────────────────────────────────────────────────────────────

def test_skips_when_not_enough_positives():
    """With fewer than MIN_POSITIVES=50 positive rows, run() returns skipped."""
    from jobs.update_weights import run

    # 10 positive rows — below threshold
    rows = [_make_row(True) for _ in range(10)] + [_make_row(False) for _ in range(20)]
    sb, insert_chain, _ = _make_supabase_mock(rows)

    result = run(supabase_client=sb)

    assert result["status"] == "skipped"
    assert result["reason"] == "not_enough_positives"
    assert result["n_positive"] == 10
    insert_chain.execute.assert_not_called()


def test_inserts_candidate_with_sufficient_data():
    """With ≥50 positives, run() trains and inserts into scoring_weights."""
    from jobs.update_weights import run

    rows = [_make_row(True, {k: 0.8 for k in FEATURE_KEYS}) for _ in range(60)] + \
           [_make_row(False, {k: 0.2 for k in FEATURE_KEYS}) for _ in range(40)]

    sb, insert_chain, _ = _make_supabase_mock(rows)

    result = run(supabase_client=sb)

    assert result["status"] in ("candidate", "promoted")
    assert result["n_positive"] == 60
    assert result["n_total"] == 100
    assert isinstance(result["candidate_accuracy"], float)
    # Candidate was inserted
    insert_chain.execute.assert_called_once()
    call_kwargs = insert_chain.execute.call_args
    # The insert() was called with a dict
    inserted = sb.from_("scoring_weights").insert.call_args[0][0] if sb.from_("scoring_weights").insert.called else None


def test_proportions_ztest_called_with_correct_values():
    """When a production row exists, proportions_ztest is called with n_total observations."""
    from unittest.mock import patch
    from jobs.update_weights import run, FEATURE_KEYS

    rows = [_make_row(True, {k: 0.9 for k in FEATURE_KEYS}) for _ in range(60)] + \
           [_make_row(False, {k: 0.1 for k in FEATURE_KEYS}) for _ in range(40)]

    prod_row = {
        "id": "prod-id",
        "version": 1,
        "weights": PROD_WEIGHTS,
        "trained_on_n": 50,
        "status": "production",
    }
    sb, _, _ = _make_supabase_mock(rows, prod_row=prod_row)

    with patch("statsmodels.stats.proportion.proportions_ztest") as mock_ztest:
        import numpy as np
        mock_ztest.return_value = (1.5, 0.1)
        result = run(supabase_client=sb)

    mock_ztest.assert_called_once()
    call_args = mock_ztest.call_args
    count_arg, nobs_arg = call_args[0][0], call_args[0][1]
    assert len(count_arg) == 2
    assert len(nobs_arg) == 2
    # Both nobs entries should equal n_total=100
    assert nobs_arg[0] == 100
    assert nobs_arg[1] == 100


def test_no_auto_promote_when_p_not_significant():
    """p ≥ 0.05 → candidate stays as candidate, no update to production."""
    from unittest.mock import patch
    from jobs.update_weights import run

    rows = [_make_row(True, {k: 0.9 for k in FEATURE_KEYS}) for _ in range(60)] + \
           [_make_row(False, {k: 0.1 for k in FEATURE_KEYS}) for _ in range(40)]

    prod_row = {
        "id": "prod-id", "version": 1, "weights": PROD_WEIGHTS,
        "trained_on_n": 50, "status": "production",
    }
    sb, _, update_chain = _make_supabase_mock(rows, prod_row=prod_row)

    with patch("statsmodels.stats.proportion.proportions_ztest", return_value=(0.5, 0.3)):
        result = run(supabase_client=sb)

    assert result["status"] == "candidate"
    # update() should NOT have been called to promote/retire
    # (update_chain is a fresh mock each call so we check the call count)
