"""Dashboard + analysis aggregation endpoints (auth-scoped)."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import Upload, User, get_db
from app.deps import get_current_user
from app.schemas.response import APIResponse
from app.services.analytics import (
    build_analysis_payload,
    build_dashboard_summary,
    statement_index,
)

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary", response_model=APIResponse)
def dashboard_summary(
    job_id: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate KPIs/issues/series for this user.

    With `job_id`, the view is scoped to that uploaded statement (owner-checked);
    without it, it reflects the latest upload — unchanged default behaviour.
    """
    if job_id:
        owned = (
            db.query(Upload)
            .filter(Upload.job_id == job_id, Upload.user_id == user.id)
            .first()
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Statement not found")
        # A queued/processing/failed upload has no extraction result to scope to;
        # silently falling back to a DIFFERENT statement's KPIs would render wrong
        # numbers under the requested statement's id. Surface it instead.
        if owned.status != "done":
            raise HTTPException(
                status_code=409,
                detail="This statement is still processing or failed to extract.",
            )
    summary = build_dashboard_summary(user_id=user.id, job_id=job_id)
    return APIResponse(success=True, message="ok", data=summary)


@router.get("/statements/index", response_model=APIResponse)
def statements_index(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List every uploaded statement (bank, period, recency, counts) for the
    Dashboard statement selector / history."""
    return APIResponse(
        success=True, message="ok",
        data={"statements": statement_index(user_id=user.id, db=db)},
    )


@router.get("/analysis/{job_id}", response_model=APIResponse)
def analysis(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return analysis-page payload for a single uploaded statement (owner only)."""
    owned = (
        db.query(Upload)
        .filter(Upload.job_id == job_id, Upload.user_id == user.id)
        .first()
    )
    if not owned:
        raise HTTPException(status_code=404, detail="No result found")

    payload = build_analysis_payload(job_id, user_id=user.id)
    if payload is None:
        raise HTTPException(status_code=404, detail="No result found")
    return APIResponse(success=True, message="ok", data=payload)
