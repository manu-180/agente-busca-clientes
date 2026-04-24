from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import circuit_breaker
from app.ig_client import get_ig_client
import app.main as _main

router = APIRouter()


class EnrichRequest(BaseModel):
    usernames: list[str] = Field(..., min_length=1, max_length=20)


class BioLink(BaseModel):
    url: str
    title: Optional[str] = None


class ProfileData(BaseModel):
    ig_user_id: str
    ig_username: str
    full_name: Optional[str]
    biography: Optional[str]
    external_url: Optional[str]
    bio_links: list[BioLink]
    followers_count: int
    following_count: int
    posts_count: int
    is_private: bool
    is_verified: bool
    is_business: bool
    business_category: Optional[str]
    profile_pic_url: Optional[str]
    last_post_at: Optional[str]


class EnrichResponse(BaseModel):
    profiles: list[ProfileData]
    errors: dict[str, str]


@router.post("/profile/enrich", response_model=EnrichResponse)
def enrich(req: EnrichRequest) -> EnrichResponse:
    # 1. Circuit check (UserNotFound/PrivateAccountError never open the circuit,
    #    but other exceptions like ChallengeRequired do)
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(
            status_code=503,
            detail={"error": "circuit_open", "cooldown_until": state.cooldown_until},
        )

    # 2. Enrich — ig_client handles UserNotFound/PrivateAccountError inline
    client = get_ig_client()
    try:
        raw_profiles, errors = client.enrich_profiles(req.usernames)
    except HTTPException:
        raise
    except Exception as exc:
        circuit_breaker.map_and_raise(exc)

    # 3. Update last action (partial success still counts)
    if raw_profiles:
        _main.update_last_action()

    profiles = [
        ProfileData(
            ig_user_id=p["ig_user_id"],
            ig_username=p["ig_username"],
            full_name=p.get("full_name"),
            biography=p.get("biography"),
            external_url=p.get("external_url"),
            bio_links=[BioLink(**bl) for bl in p.get("bio_links", [])],
            followers_count=p.get("followers_count", 0),
            following_count=p.get("following_count", 0),
            posts_count=p.get("posts_count", 0),
            is_private=p.get("is_private", False),
            is_verified=p.get("is_verified", False),
            is_business=p.get("is_business", False),
            business_category=p.get("business_category"),
            profile_pic_url=p.get("profile_pic_url"),
            last_post_at=p.get("last_post_at"),
        )
        for p in raw_profiles
    ]

    return EnrichResponse(profiles=profiles, errors=errors)
