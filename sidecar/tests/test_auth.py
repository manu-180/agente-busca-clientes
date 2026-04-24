"""
Tests for HMAC middleware and endpoint response contracts.

These 8 tests verify:
  1-3. HMAC: missing / invalid / no-prefix signatures → 401
  4.   Valid signature passes through → 200
  5.   /health accessible without auth
  6.   POST /dm/send response shape (thread_id + message_id as strings)
  7.   POST /inbox/poll response shape (messages list with expected fields)
  8.   POST /profile/enrich echoes the requested username in profiles[0]
"""

import json


def test_health_no_auth_required(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] in ("ok", "degraded")
    assert isinstance(body["session_valid"], bool)
    assert "last_action_at" in body


def test_missing_signature_returns_401(client):
    res = client.post("/dm/send", json={"ig_username": "x", "text": "hola"})
    assert res.status_code == 401
    assert res.json() == {"error": "invalid_signature"}


def test_invalid_signature_returns_401(client):
    body = json.dumps({"ig_username": "x", "text": "hola"}).encode()
    res = client.post(
        "/dm/send",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": "sha256=deadbeef",
        },
    )
    assert res.status_code == 401
    assert res.json() == {"error": "invalid_signature"}


def test_valid_signature_passes(client, sign):
    body = json.dumps({"ig_username": "x", "text": "hola"}).encode()
    res = client.post(
        "/dm/send",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": sign(body),
        },
    )
    assert res.status_code == 200


def test_dm_send_response_shape(client, sign):
    """Response must have thread_id and message_id as non-empty strings."""
    body = json.dumps(
        {"ig_username": "boutique_test", "text": "hola", "simulate_human": False}
    ).encode()
    res = client.post(
        "/dm/send",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": sign(body),
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["thread_id"], str) and data["thread_id"]
    assert isinstance(data["message_id"], str) and data["message_id"]


def test_inbox_poll_response_shape(client, sign):
    """messages list must contain items with all required fields and correct types."""
    body = json.dumps({"since_ts": None}).encode()
    res = client.post(
        "/inbox/poll",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": sign(body),
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["messages"], list)
    assert len(data["messages"]) >= 1
    msg = data["messages"][0]
    assert set(msg.keys()) == {
        "thread_id",
        "message_id",
        "ig_username",
        "text",
        "timestamp",
        "is_outbound",
    }
    assert isinstance(msg["is_outbound"], bool)
    assert isinstance(msg["timestamp"], int)


def test_profile_enrich_echoes_requested_username(client, sign):
    """profiles[0].ig_username must be one of the requested usernames."""
    body = json.dumps({"usernames": ["moda_cba"]}).encode()
    res = client.post(
        "/profile/enrich",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": sign(body),
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["profiles"]) >= 1
    assert data["profiles"][0]["ig_username"] == "moda_cba"
    assert data["errors"] == {}


def test_signature_header_without_prefix_rejected(client):
    body = json.dumps({"since_ts": None}).encode()
    import hashlib
    import hmac as _hmac

    raw_hex = _hmac.new(
        b"testsecreto1234567890123456789012", body, hashlib.sha256
    ).hexdigest()
    res = client.post(
        "/inbox/poll",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Sidecar-Signature": raw_hex,  # missing "sha256=" prefix
        },
    )
    assert res.status_code == 401
