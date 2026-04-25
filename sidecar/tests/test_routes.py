"""
Integration tests for route behavior using mocked IGClient and circuit breaker.

All tests use the module-level mocks from conftest.py (no real IG/Supabase calls).
"""

import json
from unittest.mock import MagicMock, patch, call

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


# ── /discover/competitor-followers ───────────────────────────────────────────

def _make_supabase_mock(run_id: str = "run-d03-001") -> MagicMock:
    """Return a mock Supabase client that satisfies discover route usage."""
    sb = MagicMock()
    # discovery_runs insert
    sb.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": run_id}]
    )
    # instagram_leads_raw select (dedup check) — no existing rows
    sb.table.return_value.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=[]
    )
    return sb


def test_competitor_followers_happy_path(client, sign, mock_ig):
    """Successful call returns run_id, users_seen, users_new, next_cursor."""
    mock_ig.discover_competitor_followers.return_value = {
        "users": [
            {"ig_username": "boutique_a", "ig_user_id": "11", "raw": {"is_private": False, "is_verified": False}},
            {"ig_username": "boutique_b", "ig_user_id": "22", "raw": {"is_private": False, "is_verified": False}},
        ],
        "next_cursor": "cursor_abc",
    }

    with patch("app.routes.discover.check_and_mark", return_value=True), \
         patch("app.routes.discover.get_supabase_client", return_value=_make_supabase_mock()):
        body = json.dumps({"username": "tiendas_rival", "max_users": 50}).encode()
        res = client.post(
            "/discover/competitor-followers",
            content=body,
            headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
        )

    assert res.status_code == 200
    data = res.json()
    assert data["users_seen"] == 2
    assert data["users_new"] == 2
    assert data["next_cursor"] == "cursor_abc"
    assert "run_id" in data


def test_competitor_followers_rate_limited(client, sign, mock_ig):
    """Second call within cooldown → 429 with retry_after_seconds."""
    with patch("app.routes.discover.check_and_mark", return_value=False), \
         patch("app.routes.discover.get_supabase_client", return_value=_make_supabase_mock()):
        body = json.dumps({"username": "tiendas_rival"}).encode()
        res = client.post(
            "/discover/competitor-followers",
            content=body,
            headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
        )

    assert res.status_code == 429
    assert res.json()["detail"]["error"] == "rate_limited"
    assert res.json()["detail"]["retry_after_seconds"] == 3600


def test_competitor_followers_no_next_cursor_when_exhausted(client, sign, mock_ig):
    """When instagrapi returns empty cursor, next_cursor is None."""
    mock_ig.discover_competitor_followers.return_value = {
        "users": [{"ig_username": "u1", "ig_user_id": "1", "raw": {}}],
        "next_cursor": None,
    }

    with patch("app.routes.discover.check_and_mark", return_value=True), \
         patch("app.routes.discover.get_supabase_client", return_value=_make_supabase_mock()):
        body = json.dumps({"username": "rival", "cursor": "prev_cursor"}).encode()
        res = client.post(
            "/discover/competitor-followers",
            content=body,
            headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
        )

    assert res.status_code == 200
    assert res.json()["next_cursor"] is None


def test_competitor_followers_circuit_open(client, sign, mock_circuit):
    """Circuit open → 503 before any IG call."""
    mock_circuit(open=True, cooldown_until="2026-04-30T12:00:00Z")

    body = json.dumps({"username": "rival"}).encode()
    res = client.post(
        "/discover/competitor-followers",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )

    assert res.status_code == 503
    assert res.json()["detail"]["error"] == "circuit_open"


# ── /discover/post-engagers ───────────────────────────────────────────────────

def test_post_engagers_likers_happy_path(client, sign, mock_ig):
    """kind=likers returns deduplicated users."""
    mock_ig.discover_post_engagers.return_value = {
        "users": [
            {"ig_username": "fan_1", "ig_user_id": "100", "raw": {}},
            {"ig_username": "fan_2", "ig_user_id": "200", "raw": {}},
        ]
    }

    with patch("app.routes.discover.check_and_mark", return_value=True), \
         patch("app.routes.discover.get_supabase_client", return_value=_make_supabase_mock()):
        body = json.dumps({"media_pk": "123456789", "kind": "likers"}).encode()
        res = client.post(
            "/discover/post-engagers",
            content=body,
            headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
        )

    assert res.status_code == 200
    data = res.json()
    assert data["users_seen"] == 2
    assert data["users_new"] == 2
    assert "run_id" in data


def test_post_engagers_commenters_happy_path(client, sign, mock_ig):
    """kind=commenters is accepted and forwarded to IGClient."""
    mock_ig.discover_post_engagers.return_value = {"users": []}

    with patch("app.routes.discover.check_and_mark", return_value=True), \
         patch("app.routes.discover.get_supabase_client", return_value=_make_supabase_mock()):
        body = json.dumps({"media_pk": "987654321", "kind": "commenters"}).encode()
        res = client.post(
            "/discover/post-engagers",
            content=body,
            headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
        )

    assert res.status_code == 200
    mock_ig.discover_post_engagers.assert_called_with("987654321", "commenters")


def test_post_engagers_invalid_kind_returns_422(client, sign):
    """kind not in ['likers','commenters'] → 422 Pydantic validation error."""
    body = json.dumps({"media_pk": "123456789", "kind": "shares"}).encode()
    res = client.post(
        "/discover/post-engagers",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )
    assert res.status_code == 422


def test_post_engagers_rate_limited(client, sign):
    """Second call within 30min cooldown → 429."""
    with patch("app.routes.discover.check_and_mark", return_value=False), \
         patch("app.routes.discover.get_supabase_client", return_value=_make_supabase_mock()):
        body = json.dumps({"media_pk": "111222333"}).encode()
        res = client.post(
            "/discover/post-engagers",
            content=body,
            headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
        )

    assert res.status_code == 429
    assert res.json()["detail"]["retry_after_seconds"] == 1800


def test_post_engagers_invalid_media_pk_returns_422(client, sign):
    """media_pk with non-numeric chars → 422 (Pydantic pattern validator)."""
    body = json.dumps({"media_pk": "not_a_number"}).encode()
    res = client.post(
        "/discover/post-engagers",
        content=body,
        headers={"Content-Type": "application/json", "X-Sidecar-Signature": sign(body)},
    )
    assert res.status_code == 422
