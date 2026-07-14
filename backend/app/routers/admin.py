"""Owner/admin dashboard API — system-wide visibility for allowlisted operators.

Gated by `require_system_admin` — the DEDICATED owner-console allowlist
(ADMIN_EMAILS, falling back to BILLING_ADMINS), kept separate from billing
rights so confirming a payment never silently grants full-system read access.
Everything here is READ-ONLY reporting: who the users are, what crashed (with
timestamps + the stage/percentage a job died at), and recent account activity
across the whole system. This is the transparency layer the product was missing.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import AuditLog, ErrorLog, Upload, User, get_db
from app.deps import require_system_admin
from app.schemas.response import APIResponse
from app.utils.logger import get_logger
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["admin"], prefix="/admin")


@router.get("/stats", response_model=APIResponse)
def admin_stats(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    """Headline system KPIs for the dashboard hero row."""
    now = utcnow()
    total_users = db.query(func.count(User.id)).scalar() or 0
    active_pro = (
        db.query(func.count(User.id))
        .filter(User.pro_until.isnot(None), User.pro_until > now)
        .scalar() or 0
    )
    total_uploads = db.query(func.count(Upload.id)).scalar() or 0
    failed_uploads = (
        db.query(func.count(Upload.id)).filter(Upload.status == "failed").scalar() or 0
    )
    total_errors = db.query(func.count(ErrorLog.id)).scalar() or 0
    return APIResponse(success=True, message="ok", data={
        "total_users": total_users,
        "active_pro": active_pro,
        "total_uploads": total_uploads,
        "failed_uploads": failed_uploads,
        "total_errors": total_errors,
    })


@router.get("/users", response_model=APIResponse)
def admin_users(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(200, ge=1, le=1000),
):
    """All users with plan + upload counts + last activity timestamp."""
    users = db.query(User).order_by(User.created_at.desc()).limit(limit).all()
    user_ids = [u.id for u in users]
    # Upload counts + last-activity per user, constrained to the page of users we
    # actually return. Without the `.in_(user_ids)` filter these GROUP BYs scan
    # the ENTIRE (append-only, ever-growing) uploads + audit_log tables on every
    # Users-tab load. Chunked because `limit` can be up to 1000 and a single
    # IN(...) of that size can exceed SQLite's bound-variable limit (~999).
    counts: dict = {}
    last_activity: dict = {}
    for i in range(0, len(user_ids), 500):
        chunk = user_ids[i:i + 500]
        counts.update(
            db.query(Upload.user_id, func.count(Upload.id))
            .filter(Upload.user_id.in_(chunk))
            .group_by(Upload.user_id).all()
        )
        last_activity.update(
            db.query(AuditLog.user_id, func.max(AuditLog.created_at))
            .filter(AuditLog.user_id.in_(chunk))
            .group_by(AuditLog.user_id).all()
        )
    now = utcnow()
    rows = []
    for u in users:
        pro_active = bool(u.pro_until and u.pro_until > now)
        la = last_activity.get(u.id)
        rows.append({
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "account_type": u.account_type,
            "plan": u.plan,
            "pro_active": pro_active,
            "pro_until": u.pro_until.isoformat() if u.pro_until else None,
            "email_verified": bool(u.email_verified_at),
            "uploads": counts.get(u.id, 0),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_activity": la.isoformat() if la else None,
        })
    return APIResponse(success=True, message="ok", data={"users": rows})


@router.get("/errors", response_model=APIResponse)
def admin_errors(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    code: Optional[str] = Query(None),
):
    """System error log — what crashed, where, why, with a timestamp and (for
    extraction jobs) the stage + percentage it stopped at."""
    q = db.query(ErrorLog).order_by(ErrorLog.created_at.desc())
    if code:
        q = q.filter(ErrorLog.error_code == code)
    rows = q.limit(limit).all()
    items = [{
        "id": r.id,
        "user_id": r.user_id,
        "path": r.path,
        "method": r.method,
        "error_code": r.error_code,
        "message": r.message,
        "stage": r.stage,
        "progress": r.progress,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    return APIResponse(success=True, message="ok", data={"errors": items})


@router.get("/activity", response_model=APIResponse)
def admin_activity(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
):
    """Recent account activity across ALL users (newest first)."""
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    items = [{
        "id": r.id,
        "user_id": r.user_id,
        "event": r.event,
        "ip": r.ip,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    return APIResponse(success=True, message="ok", data={"activity": items})
