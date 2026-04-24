"""
Persistent session storage for instagrapi settings.

Saves/loads session.json from /data (Railway persistent volume).
Falls back to ./data/ when SIDECAR_DATA_DIR env var is set (useful for local testing).
Uses atomic write (temp file + os.replace) to avoid partial writes on crash.
"""

import json
import logging
import os
import tempfile

logger = logging.getLogger(__name__)


def _data_dir() -> str:
    return os.environ.get("SIDECAR_DATA_DIR", "/data")


def _session_path() -> str:
    return os.path.join(_data_dir(), "session.json")


def load() -> dict | None:
    """Read session JSON from disk. Returns None if file doesn't exist or is corrupt."""
    path = _session_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(f"Session loaded from {path}")
        return data
    except FileNotFoundError:
        logger.info(f"No session file at {path}, fresh login needed.")
        return None
    except Exception as exc:
        logger.warning(f"Failed to read session from {path}: {exc}")
        return None


def save(payload: dict) -> None:
    """Write session JSON atomically. Creates the directory if needed."""
    path = _session_path()
    dir_path = os.path.dirname(path)

    try:
        os.makedirs(dir_path, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=dir_path, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        os.replace(tmp_path, path)
        logger.info(f"Session saved to {path}")
    except Exception as exc:
        logger.error(f"Failed to save session to {path}: {exc}")
        raise
