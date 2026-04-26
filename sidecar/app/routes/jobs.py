"""POST /jobs/update-weights — trigger the weekly self-learning scoring job."""
import logging

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger("ig-sidecar")


class UpdateWeightsResponse(BaseModel):
    status: str
    version: int | None = None
    candidate_accuracy: float | None = None
    production_accuracy: float | None = None
    p_value: float | None = None
    n_total: int | None = None
    n_positive: int | None = None
    reason: str | None = None


@router.post("/update-weights", response_model=UpdateWeightsResponse)
async def update_weights():
    """Run the self-learning scoring job synchronously and return the result."""
    import asyncio
    from jobs.update_weights import run

    logger.info("/jobs/update-weights triggered")
    result = await asyncio.to_thread(run)
    return result
