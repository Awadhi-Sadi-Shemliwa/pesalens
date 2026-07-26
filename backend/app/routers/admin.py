"""Owner/admin dashboard API — system-wide visibility for allowlisted operators.

Gated by `require_system_admin` — the DEDICATED owner-console allowlist
(ADMIN_EMAILS, falling back to BILLING_ADMINS), kept separate from billing
rights so confirming a payment never silently grants full-system read access.
Everything here is READ-ONLY reporting: who the users are, what crashed (with
timestamps + the stage/percentage a job died at), what people deleted, what
they told us, and recent account activity across the whole system.

The design rule for this module: **an operator should be able to answer "what
happened to this user, and in what order" without opening a database client.**
That is why every list joins the account's email in (a bare `user_id` sends the
reader to another screen to resolve it), why activity carries its `details`
blob, and why `/admin/users/{id}/timeline` interleaves that user's actions and
failures into a single ordered story.

Read-only is a boundary, not an oversight. A console that can also mutate is one
misclick from becoming the incident it was built to explain.
"""

import json
import time
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db import AuditLog, ErrorLog, Feedback, Upload, User, get_db
from app.deps import require_system_admin
from app.schemas.response import APIResponse
from app.utils.logger import get_logger
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["admin"], prefix="/admin")

# Events that destroyed something. Counted separately in the KPI row and
# filterable as a group, because "who deleted what" is the first question asked
# when a user reports that their data is missing — and the answer is usually
# "they did, on Tuesday", which nobody could previously prove.
DESTRUCTIVE_EVENTS = (
    "receipt_deleted",
    "personal_entry_deleted",
    "business_entry_deleted",
    "statement_delete",
    "data_start_over",
    "account_deleted",
)

# Events that represent something going wrong for a user, as opposed to an
# error the server raised. Kept here (not in the client) so every surface
# agrees on what counts as a failure.
FAILURE_EVENTS = (
    "upload_failed",
    "receipt_scan_failed",
    "signin_failure",
    "client_error",
    "refresh_reuse_detected",
)


def _emails_for(db: Session, user_ids: list[int]) -> dict[int, str]:
    """id -> email for a page of rows, chunked for SQLite's ~999 bound-variable
    limit. One query per chunk instead of one per row: the alternative is an
    N+1 that turns a 500-row error list into 500 round-trips."""
    out: dict[int, str] = {}
    ids = [i for i in {*user_ids} if i is not None]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for uid, email in db.query(User.id, User.email).filter(User.id.in_(chunk)).all():
            out[uid] = email
    return out


def _details(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001 — a malformed blob must not break the page
        return None


# Cache for the filter-chip vocabularies (distinct error codes, distinct audit
# events).
#
# Both clients re-fetch the whole list endpoint on every chip tap — the filter
# state is a useEffect dependency — so an uncached DISTINCT ran once per click.
# Postgres has no index skip-scan, so DISTINCT over ~15 values in an
# append-only table is a full index scan every time, and these tables only grow.
# The vocabularies themselves change when a new failure mode or audit event
# ships, i.e. at deploy time, so minutes of staleness is invisible to an
# operator. Caching server-side fixes web and mobile at once.
_DISTINCT_TTL_SECONDS = 300
_distinct_cache: dict[str, tuple[float, list[str]]] = {}


def _distinct_cached(db: Session, column, key: str, limit: int) -> list[str]:
    """Sorted distinct values of `column`, recomputed at most once per TTL."""
    now = time.monotonic()
    hit = _distinct_cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    values = sorted(v for (v,) in db.query(column).distinct().limit(limit).all() if v)
    _distinct_cache[key] = (now + _DISTINCT_TTL_SECONDS, values)
    return values


@router.get("/stats", response_model=APIResponse)
def admin_stats(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    """Headline system KPIs for the dashboard hero row.

    The 24-hour counts matter more than the all-time ones for the job this
    console does: a total error count that only ever goes up tells you nothing
    about whether the thing is broken *right now*, which is the question an
    operator opens this page to answer.
    """
    now = utcnow()
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)

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
    errors_24h = (
        db.query(func.count(ErrorLog.id))
        .filter(ErrorLog.created_at >= day_ago).scalar() or 0
    )
    active_24h = (
        db.query(func.count(func.distinct(AuditLog.user_id)))
        .filter(AuditLog.created_at >= day_ago).scalar() or 0
    )
    deletions_7d = (
        db.query(func.count(AuditLog.id))
        .filter(AuditLog.created_at >= week_ago,
                AuditLog.event.in_(DESTRUCTIVE_EVENTS)).scalar() or 0
    )
    # The feedback FUNNEL, read off the user rows rather than the response
    # table. Counting responses alone answers "what did people say" but not the
    # question that decides whether the prompt is worth its interruption:
    # of everyone we could have asked, how many answered. `feedback_count`
    # stays a count of RESPONSES (one person may send several); the rest count
    # PEOPLE, which is what a rate needs on both sides of the division.
    #
    # Still filtered on `skipped == 0` even though skips are no longer written
    # here: the legacy rows from the first design are real rows in this table,
    # and counting them would inflate the headline while the Feedback tab —
    # which filters them out — showed a smaller number. A KPI that disagrees
    # with the list under it is worse than no KPI.
    feedback_count = (
        db.query(func.count(Feedback.id)).filter(Feedback.skipped == 0).scalar() or 0
    )
    responders = (
        db.query(func.count(User.id))
        .filter(User.feedback_submitted_at.isnot(None)).scalar() or 0
    )
    feedback_declined = (
        db.query(func.count(User.id))
        .filter(User.feedback_declines > 0, User.feedback_submitted_at.is_(None))
        .scalar() or 0
    )
    asked = responders + feedback_declined
    avg_rating = (
        db.query(func.avg(Feedback.rating)).filter(Feedback.rating.isnot(None)).scalar()
    )
    return APIResponse(success=True, message="ok", data={
        "total_users": total_users,
        "active_pro": active_pro,
        "total_uploads": total_uploads,
        "failed_uploads": failed_uploads,
        "total_errors": total_errors,
        "errors_24h": errors_24h,
        "active_24h": active_24h,
        "deletions_7d": deletions_7d,
        "feedback_count": feedback_count,
        "feedback_responders": responders,
        "feedback_declined": feedback_declined,
        # Of the people who have actually engaged with the prompt either way,
        # what share answered. None (not 0) when nobody has been asked yet —
        # "0%" would read as a failing prompt rather than an untested one.
        "feedback_rate": round(responders / asked * 100) if asked else None,
        "avg_rating": round(float(avg_rating), 2) if avg_rating is not None else None,
    })


@router.get("/users", response_model=APIResponse)
def admin_users(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(200, ge=1, le=1000),
    q: Optional[str] = Query(None, max_length=120),
):
    """All users with plan + upload counts + last activity + failure counts."""
    query = db.query(User)
    if q:
        needle = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            func.lower(User.email).like(needle),
            func.lower(func.coalesce(User.full_name, "")).like(needle),
        ))
    users = query.order_by(User.created_at.desc()).limit(limit).all()
    user_ids = [u.id for u in users]
    # Upload counts + last-activity + error counts per user, constrained to the
    # page of users we actually return. Without the `.in_(user_ids)` filter
    # these GROUP BYs scan the ENTIRE (append-only, ever-growing) uploads +
    # audit_log + error_log tables on every Users-tab load. Chunked because
    # `limit` can be up to 1000 and a single IN(...) of that size can exceed
    # SQLite's bound-variable limit (~999).
    counts: dict = {}
    last_activity: dict = {}
    error_counts: dict = {}
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
        error_counts.update(
            db.query(ErrorLog.user_id, func.count(ErrorLog.id))
            .filter(ErrorLog.user_id.in_(chunk))
            .group_by(ErrorLog.user_id).all()
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
            "errors": error_counts.get(u.id, 0),
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
    source: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    hours: Optional[int] = Query(None, ge=1, le=8760),
):
    """System error log — what crashed, where, why, with a timestamp and (for
    extraction jobs) the stage + percentage it stopped at.

    Filterable by code, source ('server' | 'pipeline' | 'handled' | 'web' |
    'mobile'), user and recency, because the useful question is never "show me
    every error ever" — it is "what has been failing in the last day", or "what
    keeps happening to this one account".
    """
    q = db.query(ErrorLog).order_by(ErrorLog.created_at.desc())
    if code:
        q = q.filter(ErrorLog.error_code == code)
    if source:
        if source == "server":
            # Rows written before `source` existed were all unhandled server
            # errors, so NULL belongs in this bucket rather than nowhere.
            q = q.filter(or_(ErrorLog.source == "server", ErrorLog.source.is_(None)))
        else:
            q = q.filter(ErrorLog.source == source)
    if user_id is not None:
        q = q.filter(ErrorLog.user_id == user_id)
    if hours:
        q = q.filter(ErrorLog.created_at >= utcnow() - timedelta(hours=hours))
    rows = q.limit(limit).all()
    emails = _emails_for(db, [r.user_id for r in rows])
    items = [{
        "id": r.id,
        "ref": f"ERR-{r.id}",
        "user_id": r.user_id,
        "user_email": emails.get(r.user_id),
        "path": r.path,
        "method": r.method,
        "error_code": r.error_code,
        "message": r.message,
        "stage": r.stage,
        "progress": r.progress,
        "source": r.source or "server",
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    # The distinct codes present, so the client can build its filter chips from
    # what actually exists instead of a hardcoded list that silently goes stale
    # the first time a new failure mode ships.
    codes = _distinct_cached(db, ErrorLog.error_code, "error_code", 60)
    return APIResponse(success=True, message="ok",
                       data={"errors": items, "codes": codes})


@router.get("/activity", response_model=APIResponse)
def admin_activity(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    event: Optional[str] = Query(None, max_length=60),
    user_id: Optional[int] = Query(None),
    hours: Optional[int] = Query(None, ge=1, le=8760),
    group: Optional[str] = Query(None, pattern="^(destructive|failure)$"),
):
    """Recent account activity across ALL users (newest first).

    `group=destructive` answers "who deleted something", `group=failure`
    answers "who hit a problem" — the two questions this console exists for,
    each one filter away instead of a manual scan through a mixed feed.
    """
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if event:
        q = q.filter(AuditLog.event == event)
    if group == "destructive":
        q = q.filter(AuditLog.event.in_(DESTRUCTIVE_EVENTS))
    elif group == "failure":
        q = q.filter(AuditLog.event.in_(FAILURE_EVENTS))
    if user_id is not None:
        q = q.filter(AuditLog.user_id == user_id)
    if hours:
        q = q.filter(AuditLog.created_at >= utcnow() - timedelta(hours=hours))
    rows = q.limit(limit).all()
    emails = _emails_for(db, [r.user_id for r in rows])
    items = [{
        "id": r.id,
        "user_id": r.user_id,
        "user_email": emails.get(r.user_id),
        "event": r.event,
        "destructive": r.event in DESTRUCTIVE_EVENTS,
        "failure": r.event in FAILURE_EVENTS,
        "ip": r.ip,
        # WHAT was deleted / uploaded, not merely that something was. This is
        # the difference between an audit trail and a list of verbs.
        "details": _details(r.details),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    events = _distinct_cached(db, AuditLog.event, "audit_event", 80)
    return APIResponse(success=True, message="ok",
                       data={"activity": items, "events": events})


@router.get("/feedback", response_model=APIResponse)
def admin_feedback(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    include_skipped: bool = Query(False),
):
    """What testers said, newest first.

    Skips are excluded by default — they carry no text and would bury the
    responses that do. They stay countable in /stats, which is where the
    response rate belongs.
    """
    q = db.query(Feedback).order_by(Feedback.created_at.desc())
    if not include_skipped:
        q = q.filter(Feedback.skipped == 0)
    rows = q.limit(limit).all()
    items = [{
        "id": r.id,
        "user_id": r.user_id,
        "user_email": r.user_email,
        "skipped": bool(r.skipped),
        "rating": r.rating,
        "experience": r.experience,
        "improvements": r.improvements,
        "problem_solved": r.problem_solved,
        "audience": r.audience,
        "referrals": r.referrals,
        "client": r.client,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    # Rating histogram over ALL rated responses, not just this page — a
    # distribution computed from one page would change as you paginate.
    histogram = {
        str(score): count
        for score, count in db.query(Feedback.rating, func.count(Feedback.id))
        .filter(Feedback.rating.isnot(None))
        .group_by(Feedback.rating).all()
    }
    return APIResponse(success=True, message="ok",
                       data={"feedback": items, "histogram": histogram})


@router.get("/users/{user_id}/timeline", response_model=APIResponse)
def admin_user_timeline(
    user_id: int,
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
    limit: int = Query(150, ge=1, le=500),
):
    """One user's actions and failures, interleaved into a single story.

    This is the view that answers "how did it fail?" rather than "what
    failed?". Seeing `upload_failed` next to the `server_error` that caused it
    and the `receipt_deleted` the user did in frustration afterwards is the
    whole point — those three rows live in two tables and no ordering existed
    across them.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    audit_rows = (
        db.query(AuditLog).filter(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc()).limit(limit).all()
    )
    error_rows = (
        db.query(ErrorLog).filter(ErrorLog.user_id == user_id)
        .order_by(ErrorLog.created_at.desc()).limit(limit).all()
    )
    uploads = (
        db.query(Upload).filter(Upload.user_id == user_id)
        .order_by(Upload.created_at.desc()).limit(50).all()
    )

    items: list[dict] = []
    for r in audit_rows:
        items.append({
            "id": f"a{r.id}",
            "kind": "activity",
            "event": r.event,
            "destructive": r.event in DESTRUCTIVE_EVENTS,
            "failure": r.event in FAILURE_EVENTS,
            "ip": r.ip,
            "details": _details(r.details),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    for e in error_rows:
        items.append({
            "id": f"e{e.id}",
            "kind": "error",
            "ref": f"ERR-{e.id}",
            "event": e.error_code,
            "failure": True,
            "message": e.message,
            "path": e.path,
            "method": e.method,
            "stage": e.stage,
            "progress": e.progress,
            "source": e.source or "server",
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    # ISO-8601 UTC is fixed-width, so lexical order IS chronological order.
    items.sort(key=lambda i: i.get("created_at") or "", reverse=True)

    now = utcnow()
    return APIResponse(success=True, message="ok", data={
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "account_type": user.account_type,
            "plan": user.plan,
            "pro_active": bool(user.pro_until and user.pro_until > now),
            "email_verified": bool(user.email_verified_at),
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "uploads": [{
            "job_id": u.job_id,
            "filename": u.filename,
            "status": u.status,
            "stage": u.failed_stage or u.stage,
            "progress": u.failed_progress if u.failed_progress is not None else u.progress,
            "error_code": u.error_code,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        } for u in uploads],
        "timeline": items[:limit],
    })
