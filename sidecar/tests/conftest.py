"""
Test configuration and shared fixtures.

Strategy:
- Set all required env vars BEFORE any app module is imported.
- Patch get_ig_client() and circuit_breaker.check() at module level so
  the FastAPI app never tries to talk to Instagram or Supabase.
- Individual tests can override via monkeypatch when needed.
"""

import hashlib
import hmac
import os
from unittest.mock import MagicMock, patch

import pytest

# ── env vars must be set before importing app ─────────────────────────────────
TEST_SECRET = "testsecreto1234567890123456789012"  # 32 chars
os.environ.setdefault("IG_SIDECAR_SECRET", TEST_SECRET)
os.environ.setdefault("IG_USERNAME", "test_bot")
os.environ.setdefault("IG_PASSWORD", "test_pass")
os.environ.setdefault("SUPABASE_URL", "https://fake.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role-key")
os.environ.setdefault("SIDECAR_DATA_DIR", "/tmp/sidecar-test-data")


# ── module-level mocks (applied once for all tests) ───────────────────────────

def _make_mock_ig_client() -> MagicMock:
    """Return a MagicMock that satisfies all IGClient usages in routes."""
    from app.ig_client import InboxMessage
    from app.circuit_breaker import CircuitState

    mock = MagicMock()
    mock.session_valid = True
    mock.send_dm.return_value = ("mock-thread-001", "mock-msg-001")
    mock.poll_inbox.return_value = [
        InboxMessage(
            thread_id="mock-thread-001",
            message_id="mock-msg-inbound-001",
            ig_username="boutique_test",
            text="Hola! Me interesa",
            timestamp=1714050000,
            is_outbound=False,
        )
    ]
    mock.enrich_profiles.return_value = (
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
    return mock


_mock_ig = _make_mock_ig_client()
_mock_circuit_closed = MagicMock(open=False, cooldown_until=None)

# Patch before the app module tree is imported
_ig_patch = patch("app.ig_client.get_ig_client", return_value=_mock_ig)
_cb_patch = patch("app.circuit_breaker.check", return_value=_mock_circuit_closed)
_ig_patch.start()
_cb_patch.start()


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def secret() -> str:
    return TEST_SECRET


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app)


@pytest.fixture()
def sign():
    from app.auth import sign as _sign

    def _do(body: bytes) -> str:
        return _sign(body, TEST_SECRET)

    return _do


@pytest.fixture()
def mock_ig() -> MagicMock:
    """Expose the shared mock IGClient for per-test overrides."""
    return _mock_ig


@pytest.fixture()
def mock_circuit():
    """Helper to temporarily set circuit state in a test."""
    from app.circuit_breaker import CircuitState

    def _set(open: bool, cooldown_until: str | None = None):
        _mock_circuit_closed.open = open
        _mock_circuit_closed.cooldown_until = cooldown_until

    yield _set

    # Reset to closed after each test
    _mock_circuit_closed.open = False
    _mock_circuit_closed.cooldown_until = None
