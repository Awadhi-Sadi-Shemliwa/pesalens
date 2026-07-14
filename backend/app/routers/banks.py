"""Per-bank spending intelligence endpoint — the "money map" (Epic-2, Slice 3).

Rolls the user's statements up by service and surfaces per-provider spend,
fees, fee-rate and deterministic saving suggestions, plus an optional LLM
coaching summary. The deterministic shape always ships; if the LLM is down
`llm_status="unavailable"` lets the UI hide the coach slot.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.db import User
from app.deps import require_active_plan
from app.rate_limit import limiter
from app.schemas.response import APIResponse
from app.services.bank_intel import build_bank_intel
from app.utils.logger import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["banks"])


@router.get("/banks/intel", response_model=APIResponse)
@limiter.limit(settings.rate_limit_default)
async def banks_intel(
    request: Request,
    user: User = Depends(require_active_plan),
):
    """Per-service money map: spend, fees, fee-rate + suggestions per provider.

    Aggregation + the optional LLM call are CPU/network bound, so they run on
    the threadpool to keep the event loop responsive.
    """
    started = datetime.utcnow()
    try:
        response = await run_in_threadpool(build_bank_intel, user.id)
    except Exception as exc:
        log.exception("Bank-intel failed for user=%s", user.id)
        raise HTTPException(status_code=500, detail="Could not build the money map") from exc

    log.info(
        "Bank-intel user=%s banks=%d in %.1fs (llm=%s)",
        user.id, len(response.banks),
        (datetime.utcnow() - started).total_seconds(),
        response.llm_status,
    )
    return APIResponse(success=True, message="ok", data=response.model_dump())
