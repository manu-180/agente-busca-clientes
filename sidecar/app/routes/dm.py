from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import circuit_breaker
from app.ig_client import get_ig_client
import app.main as _main

router = APIRouter()


class SendDMRequest(BaseModel):
    ig_username: str
    text: str
    simulate_human: bool = True


class SendDMResponse(BaseModel):
    thread_id: str
    message_id: str


@router.post("/dm/send", response_model=SendDMResponse)
def send_dm(req: SendDMRequest) -> SendDMResponse:
    # 1. Circuit check — abort immediately if a cooldown is active
    state = circuit_breaker.check()
    if state.open:
        raise HTTPException(
            status_code=503,
            detail={"error": "circuit_open", "cooldown_until": state.cooldown_until},
        )

    # 2. Call instagrapi — let exceptions bubble to the mapper
    client = get_ig_client()
    try:
        thread_id, message_id = client.send_dm(
            req.ig_username, req.text, req.simulate_human
        )
    except HTTPException:
        raise  # already mapped by circuit_breaker.map_and_raise in ig_client
    except Exception as exc:
        circuit_breaker.map_and_raise(exc)

    # 3. Track last successful action (for /health)
    _main.update_last_action()

    return SendDMResponse(thread_id=thread_id, message_id=message_id)
