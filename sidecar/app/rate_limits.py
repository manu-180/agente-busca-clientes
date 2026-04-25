from datetime import datetime, timezone
from dateutil.parser import parse


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def check_and_mark(endpoint: str, key: str, cooldown_seconds: int) -> bool:
    """Returns True if allowed, False if rate-limited."""
    from app.db import get_supabase_client
    supabase = get_supabase_client()
    try:
        row = supabase.table("sidecar_rate_limits").select("last_call_at").eq("endpoint", endpoint).eq("key", key).maybe_single().execute()
        row_data = row.data
    except Exception:
        row_data = None  # fail open on unexpected DB error

    if row_data:
        delta = (now_utc() - parse(row_data["last_call_at"])).total_seconds()
        if delta < cooldown_seconds:
            return False
    supabase.table("sidecar_rate_limits").upsert({
        "endpoint": endpoint, "key": key, "last_call_at": now_utc().isoformat(),
    }).execute()
    return True
