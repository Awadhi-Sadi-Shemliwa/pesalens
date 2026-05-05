"""Dashboard + analysis aggregation endpoints (auth-scoped)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import Upload, User, get_db
from app.deps import get_current_user
from app.schemas.response import APIResponse
from app.services.analytics import build_analysis_payload, build_dashboard_summary

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary", response_model=APIResponse)
def dashboard_summary(user: User = Depends(get_current_user)):
    """Aggregate KPIs/issues/series across this user's uploads."""
    summary = build_dashboard_summary(user_id=user.id)
    return APIResponse(success=True, message="ok", data=summary)


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
