from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import circuit_breaker
from app.ig_client import get_ig_client
import app.main as _main

router = APIRouter()


class PollInboxRequest(BaseModel):
    since_ts: Optional[int] = None


class InboxMessage(BaseModel):
    thread_id: str
    message_id: str
    ig_username: str
    text: str
    timestamp: int
    is_outbound: bool


class PollInboxResponse(BaseModel):
    messages: list[InboxMessage]


@router.post("/inbox/poll", response_model=PollInboxResponse)
def poll_inbox(req: PollInboxRequest) -> PollInboxResponse:
    # 1. Circuit check
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(
            status_code=503,
            detail={"error": "circuit_open", "cooldown_until": state.cooldown_until},
        )

    # 2. Fetch messages
    client = get_ig_client()
    try:
        messages = client.poll_inbox(req.since_ts)
    except HTTPException:
        raise
    except Exception as exc:
        circuit_breaker.map_and_raise(exc)

    # 3. Update last action
    _main.update_last_action()

    return PollInboxResponse(
        messages=[
            InboxMessage(
                thread_id=m.thread_id,
                message_id=m.message_id,
                ig_username=m.ig_username,
                text=m.text,
                timestamp=m.timestamp,
                is_outbound=m.is_outbound,
            )
            for m in messages
        ]
    )
