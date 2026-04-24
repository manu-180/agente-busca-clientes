from fastapi import APIRouter

from app import circuit_breaker
from app.ig_client import get_ig_client
import app.main as _main

router = APIRouter()


@router.get("/health")
def health() -> dict:
    """
    Returns sidecar health.

    status = "ok"       — session valid and no active circuit.
    status = "degraded" — session invalid OR active circuit breaker cooldown.
    """
    client = get_ig_client()
    session_valid = client.session_valid

    # Check for active cooldown without raising
    circuit_state = circuit_breaker.check()

    if session_valid and not circuit_state.open:
        status = "ok"
    else:
        status = "degraded"

    return {
        "status": status,
        "session_valid": session_valid,
        "last_action_at": _main.last_action_at,
    }
