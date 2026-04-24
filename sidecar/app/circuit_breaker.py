"""
Circuit breaker for Instagram account health.

check()      — queries Supabase account_health_log; returns CircuitState.
open_circuit() — inserts a row in account_health_log (cooldown active).
map_and_raise() — maps instagrapi exceptions → HTTP 503/500; skips non-fatal ones.

Non-fatal exceptions (UserNotFound, PrivateAccountError) are re-raised as-is
so /profile/enrich can catch them and put them in the `errors` dict.
"""

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ── env vars (resolved lazily so tests can set them before import) ──────────

def _supabase_client():
    from supabase import create_client  # imported lazily to allow test mocking

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    return create_client(url, key)


def _ig_username() -> str:
    return os.environ.get("IG_USERNAME", "")


# ── cooldown durations per event ─────────────────────────────────────────────

_COOLDOWN_HOURS: dict[str, float] = {
    "challenge_required": 48,
    "feedback_required": 48,
    "login_required": 1,
    "rate_limited": 0.25,   # 15 min
    "action_blocked": 48,
}

# ── exception → event mapping (substring match on class name or str) ─────────

_EXCEPTION_MAP: list[tuple[str, str]] = [
    ("FeedbackRequired",       "feedback_required"),
    ("ChallengeRequired",      "challenge_required"),
    ("LoginRequired",          "login_required"),
    ("PleaseWaitFewMinutes",   "rate_limited"),
    ("RateLimitError",         "rate_limited"),
    ("TooManyRequests",        "rate_limited"),
    ("ActionBlocked",          "action_blocked"),
    ("SentryBlock",            "action_blocked"),
    ("ClientForbiddenError",   "action_blocked"),
    ("ReloginAttemptExceeded", "login_required"),
]

# Exceptions that never open the circuit — propagate to caller for inline handling
_NON_CIRCUIT_SUBSTRINGS = ("UserNotFound", "PrivateAccountError", "UserError")


# ── public API ────────────────────────────────────────────────────────────────

@dataclass
class CircuitState:
    open: bool
    cooldown_until: Optional[str] = None


def check() -> CircuitState:
    """
    Query Supabase for an active cooldown row for the current IG account.
    Returns CircuitState(open=False) if Supabase isn't configured (e.g. tests).
    """
    username = _ig_username()
    if not username:
        return CircuitState(open=False)

    try:
        sb = _supabase_client()
    except RuntimeError:
        return CircuitState(open=False)

    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        result = (
            sb.table("account_health_log")
            .select("cooldown_until, event")
            .eq("sender_ig", username)
            .gt("cooldown_until", now_iso)
            .order("cooldown_until", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            row = result.data[0]
            return CircuitState(open=True, cooldown_until=row["cooldown_until"])
        return CircuitState(open=False)
    except Exception as exc:
        # Don't let a Supabase hiccup block all IG actions — fail open.
        logger.warning(f"Circuit breaker check failed (fail-open): {exc}")
        return CircuitState(open=False)


def open_circuit(event: str, cooldown_hours: float, payload: dict) -> str:
    """
    Insert an account_health_log row to activate cooldown.
    Returns the cooldown_until ISO string.
    """
    cooldown_until = (
        datetime.now(timezone.utc) + timedelta(hours=cooldown_hours)
    ).isoformat()

    username = _ig_username()
    try:
        sb = _supabase_client()
        sb.table("account_health_log").insert({
            "sender_ig": username,
            "event": event,
            "payload": payload,
            "cooldown_until": cooldown_until,
        }).execute()
        logger.warning(
            f"Circuit opened: event={event}, cooldown_until={cooldown_until}"
        )
    except Exception as exc:
        logger.error(f"Failed to write account_health_log: {exc}")

    return cooldown_until


def map_and_raise(exc: Exception) -> None:
    """
    Inspect an instagrapi exception and take the appropriate action:

    - Non-circuit exceptions (UserNotFound, PrivateAccountError) → re-raise as-is.
    - Known fatal exceptions → open circuit + raise HTTP 503.
    - Unknown ClientError → raise HTTP 500.
    """
    class_name = type(exc).__name__
    exc_str = str(exc)

    # Let non-circuit exceptions propagate for inline handling
    for substr in _NON_CIRCUIT_SUBSTRINGS:
        if substr.lower() in class_name.lower():
            raise exc

    # Map to known events
    for substring, event in _EXCEPTION_MAP:
        if (
            substring.lower() in class_name.lower()
            or substring.lower() in exc_str.lower()
        ):
            cooldown_hours = _COOLDOWN_HOURS.get(event, 24)
            cooldown_until = open_circuit(
                event, cooldown_hours, {"exception": class_name, "detail": exc_str}
            )
            raise HTTPException(
                status_code=503,
                detail={"error": "circuit_open", "cooldown_until": cooldown_until},
            )

    # Generic / unknown error
    logger.error(f"Unhandled instagrapi exception: {class_name}: {exc_str}")
    raise HTTPException(
        status_code=500,
        detail={"error": "internal_error", "detail": exc_str},
    )
