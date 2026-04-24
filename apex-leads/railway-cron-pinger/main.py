"""Railway Cron Job de vida corta: hace un GET a /api/cron/leads-pendientes en Vercel y termina.
Registra el resultado con logging estructurado en UTC y códigos de salida 0/1."""

import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import httpx


def load_config():
    return {
        "CRON_BASE_URL": os.environ.get("CRON_BASE_URL", "").strip(),
        "CRON_SECRET": os.environ.get("CRON_SECRET", "").strip(),
        "CRON_PATH": os.environ.get(
            "CRON_PATH", "/api/cron/leads-pendientes?force=true"
        ).strip(),
        "REQUEST_TIMEOUT_S": os.environ.get("REQUEST_TIMEOUT_S", "90").strip(),
    }


def _log(level, message):
    ts = datetime.now(timezone.utc).isoformat()
    print(f"{ts} [{level}] {message}", flush=True)


def run_ping(config):
    base = config["CRON_BASE_URL"]
    secret = config["CRON_SECRET"]
    path = config["CRON_PATH"]
    timeout_raw = config["REQUEST_TIMEOUT_S"]

    missing = []
    if not base:
        missing.append("CRON_BASE_URL")
    if not secret:
        missing.append("CRON_SECRET")
    if missing:
        _log(
            "FATAL",
            f"Variables de entorno faltantes: {', '.join(missing)}",
        )
        sys.exit(1)

    try:
        timeout = float(timeout_raw)
    except ValueError as e:
        _log("ERROR", f"Error inesperado: {type(e).__name__}: {e}")
        sys.exit(1)

    full_url = base.rstrip("/") + path
    parts = urlsplit(full_url)
    url_log = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    _log("INFO", f"Iniciando ping a {url_log}")

    try:
        response = httpx.get(
            full_url,
            headers={"Authorization": f"Bearer {secret}"},
            timeout=timeout,
        )
    except httpx.TimeoutException:
        _log("ERROR", f"Network timeout después de {timeout}s")
        sys.exit(1)
    except httpx.ConnectError as e:
        _log("ERROR", f"Connection error: {type(e).__name__}")
        sys.exit(1)
    except Exception as e:
        _log("ERROR", f"Error inesperado: {type(e).__name__}: {e}")
        sys.exit(1)

    body = (response.text or "")[:500]
    _log("INFO", f"Cuerpo de respuesta (truncado): {body}")

    status = response.status_code
    if status == 200:
        _log("SUCCESS", "Ping completado con éxito")
        sys.exit(0)
    if status == 401:
        _log("ERROR", "Auth error — revisar CRON_SECRET en Railway Dashboard")
        sys.exit(1)
    if status == 404:
        _log("ERROR", "404 Not Found — revisar CRON_BASE_URL y CRON_PATH")
        sys.exit(1)
    if 500 <= status <= 599:
        _log("ERROR", f"Server error {status} — el backend falló")
        sys.exit(1)
    _log("WARNING", f"Status inesperado: {status}")
    sys.exit(1)


if __name__ == "__main__":
    cfg = load_config()
    run_ping(cfg)
