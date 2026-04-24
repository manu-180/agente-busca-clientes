"""
Integration tests for route behavior using mocked IGClient and circuit breaker.

All tests use the module-level mocks from conftest.py (no real IG/Supabase calls).
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


# ── /dm/send ─────────────────────────────────────────────────────────────────

def test_dm_send_calls_client_with_correct_args(client, sign, mock_ig):
    """Route must pass ig_username, text, and simulate_human to client.send_dm."""
    mock_ig.send_dm.reset_mock()
    mock_ig.send_dm.return_value = ("thread-xyz", "msg-xyz")

    body = json.dumps(
        {"ig_username": "tienda_abc", "text": "Hola tienda!", "simulate_human": False}
    ).encode()
    res = client.post(
        "/dm/send",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["thread_id"] == "thread-xyz"
    assert data["message_id"] == "msg-xyz"

    mock_ig.send_dm.assert_called_once_with("tienda_abc", "Hola tienda!", False)


def test_dm_send_circuit_open_returns_503(client, sign, mock_circuit):
    """When circuit is open, /dm/send must return 503 without calling IGClient."""
    mock_circuit(open=True, cooldown_until="2026-04-26T12:00:00+00:00")

    body = json.dumps({"ig_username": "x", "text": "hola"}).encode()
    res = client.post(
        "/dm/send",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )

    assert res.status_code == 503
    data = res.json()
    assert data["detail"]["error"] == "circuit_open"
    assert "cooldown_until" in data["detail"]


def test_dm_send_challenge_opens_circuit(client, sign, mock_ig, monkeypatch):
    """ChallengeRequired exception → circuit_breaker.map_and_raise → 503."""
    from instagrapi.exceptions import ChallengeRequired

    mock_ig.send_dm.side_effect = ChallengeRequired("challenge needed")

    # mock map_and_raise to raise HTTPException directly (avoids Supabase call)
    def fake_map_and_raise(exc):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail={"error": "circuit_open", "cooldown_until": "2026-04-26T12:00:00Z"},
        )

    monkeypatch.setattr("app.routes.dm.circuit_breaker.map_and_raise", fake_map_and_raise)

    body = json.dumps({"ig_username": "boutique", "text": "hi"}).encode()
    res = client.post(
        "/dm/send",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )

    assert res.status_code == 503
    assert res.json()["detail"]["error"] == "circuit_open"

    # Reset side_effect for other tests
    mock_ig.send_dm.side_effect = None
    mock_ig.send_dm.return_value = ("mock-thread-001", "mock-msg-001")


# ── /profile/enrich ──────────────────────────────────────────────────────────

def test_profile_enrich_handles_user_not_found(client, sign, mock_ig):
    """UserNotFound for one username must appear in errors, others in profiles."""
    mock_ig.enrich_profiles.return_value = (
        [
            {
                "ig_user_id": "111",
                "ig_username": "boutique_ok",
                "full_name": "OK",
                "biography": None,
                "external_url": None,
                "bio_links": [],
                "followers_count": 100,
                "following_count": 50,
                "posts_count": 10,
                "is_private": False,
                "is_verified": False,
                "is_business": False,
                "business_category": None,
                "profile_pic_url": None,
                "last_post_at": None,
            }
        ],
        {"user_not_found": "UserNotFound"},
    )

    body = json.dumps({"usernames": ["boutique_ok", "user_not_found"]}).encode()
    res = client.post(
        "/profile/enrich",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )

    assert res.status_code == 200
    data = res.json()
    assert len(data["profiles"]) == 1
    assert data["profiles"][0]["ig_username"] == "boutique_ok"
    assert "user_not_found" in data["errors"]
    assert data["errors"]["user_not_found"] == "UserNotFound"

    # Restore default
    mock_ig.enrich_profiles.return_value = (
        [
            {
                "ig_user_id": "12345678901",
                "ig_username": "moda_cba",
                "full_name": "Moda CBA",
                "biography": "Ropa de mujer",
                "external_url": None,
                "bio_links": [],
                "followers_count": 1500,
                "following_count": 300,
                "posts_count": 45,
                "is_private": False,
                "is_verified": False,
                "is_business": True,
                "business_category": "Clothing Store",
                "profile_pic_url": None,
                "last_post_at": "2026-04-20T14:30:00Z",
            }
        ],
        {},
    )


# ── /health ───────────────────────────────────────────────────────────────────

def test_health_reports_ok_when_session_valid(client, mock_ig, mock_circuit):
    """session_valid=True + circuit closed → status ok."""
    mock_ig.session_valid = True
    mock_circuit(open=False)

    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["session_valid"] is True


def test_health_reports_degraded_when_session_invalid(client, mock_ig, mock_circuit):
    """session_valid=False → status degraded, regardless of circuit state."""
    mock_ig.session_valid = False
    mock_circuit(open=False)

    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "degraded"
    assert data["session_valid"] is False

    # Restore
    mock_ig.session_valid = True


def test_health_reports_degraded_when_circuit_open(client, mock_ig, mock_circuit):
    """session_valid=True but circuit open → status degraded."""
    mock_ig.session_valid = True
    mock_circuit(open=True, cooldown_until="2026-04-26T12:00:00Z")

    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "degraded"
