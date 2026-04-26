import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import Message

from app.auth import verify_signature
from app.routes import dm, discover, health, inbox, jobs, profile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ig-sidecar")

# ── shared mutable state (module-level, not thread-safe but single-worker) ────
# Routes import this module and call update_last_action() after a successful action.
last_action_at: str | None = None


def update_last_action() -> None:
    from datetime import datetime, timezone
    global last_action_at
    last_action_at = datetime.now(timezone.utc).isoformat()


# ── secret loading ────────────────────────────────────────────────────────────

def _load_secret() -> str:
    secret = os.environ.get("IG_SIDECAR_SECRET")
    if not secret:
        raise RuntimeError("IG_SIDECAR_SECRET env var is required (min 32 chars).")
    if len(secret) < 32:
        raise RuntimeError("IG_SIDECAR_SECRET must be at least 32 chars long.")
    return secret


# ── HMAC middleware ───────────────────────────────────────────────────────────

class HMACMiddleware(BaseHTTPMiddleware):
    """Verifies X-Sidecar-Signature on every request except GET /health."""

    def __init__(self, app, secret: str) -> None:
        super().__init__(app)
        self._secret = secret

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return await call_next(request)

        body = await request.body()
        header = request.headers.get("X-Sidecar-Signature", "")

        if not verify_signature(body, self._secret, header):
            return JSONResponse({"error": "invalid_signature"}, status_code=401)

        # Re-inject body so downstream deserializers can read it
        async def receive() -> Message:
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive
        return await call_next(request)


# ── lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Boot: attempt Instagram login. Failure → degraded (not crash)."""
    from app.ig_client import get_ig_client

    logger.info("ig-sidecar starting — loading Instagram session…")
    try:
        client = get_ig_client()
        await asyncio.to_thread(client.login)
        if client.session_valid:
            logger.info("Instagram session ready.")
        else:
            logger.warning(
                "Instagram login failed at boot — /health will report 'degraded'. "
                "Railway will retry."
            )
    except Exception as exc:
        logger.error(f"Unexpected error during boot login: {exc}")

    yield
    logger.info("ig-sidecar shutting down.")


# ── app factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    secret = _load_secret()
    app = FastAPI(title="ig-sidecar", version="0.3.0", lifespan=lifespan)
    app.add_middleware(HMACMiddleware, secret=secret)

    app.include_router(health.router)
    app.include_router(dm.router)
    app.include_router(inbox.router)
    app.include_router(profile.router)
    app.include_router(discover.router)
    app.include_router(jobs.router)

    logger.info("ig-sidecar app created.")
    return app


app = create_app()
