"""
Triggers POST /api/ig/run-cycle on Vercel.
Authenticated with Authorization: Bearer <CRON_SECRET>.
Exits 0 on success, 1 on error.
"""
import os
import sys
import httpx

NEXT_APP_URL = os.environ.get("NEXT_APP_URL", "").rstrip("/")
CRON_SECRET = os.environ.get("CRON_SECRET", "")

if not NEXT_APP_URL:
    print("[scheduler] ERROR: NEXT_APP_URL env var is required", flush=True)
    sys.exit(1)

if not CRON_SECRET:
    print("[scheduler] ERROR: CRON_SECRET env var is required", flush=True)
    sys.exit(1)

url = f"{NEXT_APP_URL}/api/ig/run-cycle"
headers = {
    "Authorization": f"Bearer {CRON_SECRET}",
    "Content-Type": "application/json",
}

print(f"[scheduler] Calling {url}", flush=True)

try:
    response = httpx.post(url, headers=headers, timeout=280.0)
except httpx.TimeoutException:
    print("[scheduler] ERROR: request timed out after 280s", flush=True)
    sys.exit(1)
except httpx.RequestError as exc:
    print(f"[scheduler] ERROR: request failed — {exc}", flush=True)
    sys.exit(1)

print(f"[scheduler] Response status: {response.status_code}", flush=True)

if response.status_code != 200:
    print(f"[scheduler] ERROR: unexpected status {response.status_code}", flush=True)
    print(f"[scheduler] Body: {response.text}", flush=True)
    sys.exit(1)

try:
    body = response.json()
    print(f"[scheduler] OK — {body}", flush=True)
except Exception:
    print(f"[scheduler] OK — (non-JSON body) {response.text}", flush=True)

sys.exit(0)
