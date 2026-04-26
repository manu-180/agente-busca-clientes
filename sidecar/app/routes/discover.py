import logging
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app import circuit_breaker
from app.ig_client import get_ig_client
from app.db import get_supabase_client
from app.rate_limits import check_and_mark

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/discover", tags=["discover"])


class HashtagReq(BaseModel):
    tag: str = Field(min_length=1, max_length=100)
    limit: int = Field(default=50, ge=1, le=100)


class LocationReq(BaseModel):
    location_pk: int
    limit: int = Field(default=50, ge=1, le=100)


class CompetitorReq(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    max_users: int = Field(default=200, ge=10, le=500)
    cursor: str | None = Field(default=None, min_length=1)


class EngagersReq(BaseModel):
    media_pk: str = Field(pattern=r"^\d+$")
    kind: Literal["likers", "commenters"] = "likers"


class DiscoverResponse(BaseModel):
    run_id: str
    users_seen: int
    users_new: int


class CompetitorResponse(BaseModel):
    run_id: str
    users_seen: int
    users_new: int
    next_cursor: str | None = None


@router.post("/hashtag", response_model=DiscoverResponse)
def discover_hashtag(req: HashtagReq) -> DiscoverResponse:
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(503, detail={"error": "circuit_open", "cooldown_until": state.cooldown_until})

    ig = get_ig_client()
    if not ig.session_valid:
        raise HTTPException(503, detail={"error": "ig_session_invalid"})

    sb = get_supabase_client()
    run = sb.table("discovery_runs").insert({
        "kind": "hashtag", "ref": req.tag, "status": "running",
    }).execute()
    if not run.data:
        raise HTTPException(500, detail={"error": "failed_to_create_discovery_run"})
    run_id = str(run.data[0]["id"])

    try:
        result = ig.discover_by_hashtag(req.tag, req.limit)
        users_new = _upsert_leads(sb, result["users"], source="hashtag", source_ref=req.tag)
        sb.table("discovery_runs").update({
            "status": "ok",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "users_seen": len(result["users"]),
            "users_new": users_new,
        }).eq("id", run_id).execute()
        return DiscoverResponse(run_id=run_id, users_seen=len(result["users"]), users_new=users_new)
    except HTTPException:
        _mark_run_error(sb, run_id, "http_exception")
        raise
    except Exception as exc:
        _mark_run_error(sb, run_id, str(exc)[:500])
        circuit_breaker.map_and_raise(exc)
        raise


@router.post("/location", response_model=DiscoverResponse)
def discover_location(req: LocationReq) -> DiscoverResponse:
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(503, detail={"error": "circuit_open", "cooldown_until": state.cooldown_until})

    ig = get_ig_client()
    if not ig.session_valid:
        raise HTTPException(503, detail={"error": "ig_session_invalid"})

    sb = get_supabase_client()
    run = sb.table("discovery_runs").insert({
        "kind": "location", "ref": str(req.location_pk), "status": "running",
    }).execute()
    if not run.data:
        raise HTTPException(500, detail={"error": "failed_to_create_discovery_run"})
    run_id = str(run.data[0]["id"])

    try:
        result = ig.discover_by_location(req.location_pk, req.limit)
        users_new = _upsert_leads(sb, result["users"], source="location", source_ref=str(req.location_pk))
        sb.table("discovery_runs").update({
            "status": "ok",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "users_seen": len(result["users"]),
            "users_new": users_new,
        }).eq("id", run_id).execute()
        return DiscoverResponse(run_id=run_id, users_seen=len(result["users"]), users_new=users_new)
    except HTTPException:
        _mark_run_error(sb, run_id, "http_exception")
        raise
    except Exception as exc:
        _mark_run_error(sb, run_id, str(exc)[:500])
        circuit_breaker.map_and_raise(exc)
        raise


@router.post("/competitor-followers", response_model=CompetitorResponse)
def discover_competitor(req: CompetitorReq) -> CompetitorResponse:
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(503, detail={"error": "circuit_open", "cooldown_until": state.cooldown_until})

    ig = get_ig_client()
    if not ig.session_valid:
        raise HTTPException(503, detail={"error": "ig_session_invalid"})

    if not check_and_mark("competitor_followers", req.username, 3600):
        raise HTTPException(429, detail={"error": "rate_limited", "retry_after_seconds": 3600})

    sb = get_supabase_client()
    run = sb.table("discovery_runs").insert({
        "kind": "competitor_followers", "ref": req.username, "status": "running",
    }).execute()
    if not run.data:
        raise HTTPException(500, detail={"error": "failed_to_create_discovery_run"})
    run_id = str(run.data[0]["id"])

    try:
        result = ig.discover_competitor_followers(req.username, req.max_users, req.cursor)
        users_new = _upsert_leads(sb, result["users"], source="competitor_followers", source_ref=req.username)
        sb.table("discovery_runs").update({
            "status": "ok",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "users_seen": len(result["users"]),
            "users_new": users_new,
        }).eq("id", run_id).execute()
        return CompetitorResponse(
            run_id=run_id,
            users_seen=len(result["users"]),
            users_new=users_new,
            next_cursor=result.get("next_cursor"),
        )
    except HTTPException:
        _mark_run_error(sb, run_id, "http_exception")
        raise
    except Exception as exc:
        _mark_run_error(sb, run_id, str(exc)[:500])
        circuit_breaker.map_and_raise(exc)
        raise


@router.post("/post-engagers", response_model=DiscoverResponse)
def discover_engagers(req: EngagersReq) -> DiscoverResponse:
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(503, detail={"error": "circuit_open", "cooldown_until": state.cooldown_until})

    ig = get_ig_client()
    if not ig.session_valid:
        raise HTTPException(503, detail={"error": "ig_session_invalid"})

    if not check_and_mark("post_engagers", req.media_pk, 1800):
        raise HTTPException(429, detail={"error": "rate_limited", "retry_after_seconds": 1800})

    sb = get_supabase_client()
    run = sb.table("discovery_runs").insert({
        "kind": "post_engagers", "ref": req.media_pk, "status": "running",
    }).execute()
    if not run.data:
        raise HTTPException(500, detail={"error": "failed_to_create_discovery_run"})
    run_id = str(run.data[0]["id"])

    try:
        result = ig.discover_post_engagers(req.media_pk, req.kind)
        users_new = _upsert_leads(sb, result["users"], source="post_engagers", source_ref=req.media_pk)
        sb.table("discovery_runs").update({
            "status": "ok",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "users_seen": len(result["users"]),
            "users_new": users_new,
        }).eq("id", run_id).execute()
        return DiscoverResponse(run_id=run_id, users_seen=len(result["users"]), users_new=users_new)
    except HTTPException:
        _mark_run_error(sb, run_id, "http_exception")
        raise
    except Exception as exc:
        _mark_run_error(sb, run_id, str(exc)[:500])
        circuit_breaker.map_and_raise(exc)
        raise


def _mark_run_error(sb, run_id: str, message: str) -> None:
    try:
        sb.table("discovery_runs").update({
            "status": "error",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "error_message": message,
        }).eq("id", run_id).execute()
    except Exception as update_err:
        logger.warning(f"Failed to update discovery_run {run_id}: {update_err}")


def _upsert_leads(sb, users: list[dict], source: str, source_ref: str) -> int:
    if not users:
        return 0
    usernames = [u["ig_username"] for u in users]
    existing = sb.table("instagram_leads_raw").select("ig_username").in_("ig_username", usernames).execute()
    existing_set = {row["ig_username"] for row in (existing.data or [])}
    rows = [
        {
            "ig_username": u["ig_username"],
            "raw_profile": u["raw"],
            "source": source,
            "source_ref": source_ref,
        }
        for u in users
    ]
    sb.table("instagram_leads_raw").upsert(rows, on_conflict="ig_username", ignore_duplicates=True).execute()
    return len(usernames) - len(existing_set)
