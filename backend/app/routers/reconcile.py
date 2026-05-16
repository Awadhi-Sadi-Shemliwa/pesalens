"""Cross-source reconciliation endpoint.

Pairs every statement debit with the receipts and manual entries that
plausibly explain it, plus rolls up a "blind spot" KPI and (for ranges
≥30 days) retrospective patterns.

The response is the deterministic shape from
`app/schemas/reconciliation.py`. LLM coaching notes are best-effort —
if both providers fail the deterministic table + KPIs still ship and
`llm_status="unavailable"` lets the UI hide the insight slot.

Note: `from __future__ import annotations` is intentionally omitted —
FastAPI's body-parameter resolver needs the request-body Pydantic class
to be a real class object, not a forward-ref string, otherwise it falls
through to query-parameter parsing and 500s.
"""

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.config import settings
from app.db import User, get_db
from app.deps import require_active_plan
from app.rate_limit import limiter
from app.schemas.response import APIResponse
from app.services.reconciliation import build_reconciliation
from app.utils.logger import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["reconcile"])


_MAX_RANGE_DAYS = 365


class ReconcileRequest(BaseModel):
    start_date: date
    end_date: date
    scope: Literal["personal", "business"] = Field(default="personal")

    @model_validator(mode="after")
    def _validate_range(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if (self.end_date - self.start_date).days > _MAX_RANGE_DAYS:
            raise ValueError(f"date range cannot exceed {_MAX_RANGE_DAYS} days")
        return self


@router.post("/reconcile", response_model=APIResponse)
@limiter.limit(settings.rate_limit_default)
async def reconcile(
    request: Request,
    payload: ReconcileRequest,
    user: User = Depends(require_active_plan),
    db: Session = Depends(get_db),
):
    """Build the reconciliation view for a date range.

    The matching + LLM call is CPU + network bound; we run it on the
    threadpool so the FastAPI event loop stays responsive while a busy
    user with months of statements waits up to ~30 s for the LLM step.
    """
    started = datetime.utcnow()
    try:
        response = await run_in_threadpool(
            build_reconciliation,
            db,
            user.id,
            payload.start_date,
            payload.end_date,
            payload.scope,
        )
    except Exception as exc:
        log.exception("Reconciliation failed for user=%s", user.id)
        raise HTTPException(status_code=500, detail="Reconciliation failed") from exc

    log.info(
        "Reconciliation user=%s scope=%s range=%s..%s groups=%d in %.1fs (llm=%s)",
        user.id, payload.scope, payload.start_date, payload.end_date,
        len(response.groups),
        (datetime.utcnow() - started).total_seconds(),
        response.llm_status,
    )
    return APIResponse(success=True, message="ok", data=response.model_dump())
