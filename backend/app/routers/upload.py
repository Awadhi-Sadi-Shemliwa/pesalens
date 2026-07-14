"""Upload endpoint for bank statement PDFs (auth-required, scoped per user).

Extraction runs as a polled BACKGROUND JOB, not inside the request. `POST
/upload` validates the file, creates an `Upload` row (status=queued) and returns
a job_id immediately; a worker thread runs the pipeline, writing a real stage +
percentage to the row as it advances, and — on failure — the stage/percentage it
stopped at plus a classified reason and timestamp. The client polls
`GET /upload/status/{job_id}` for honest progress.
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.db import ErrorLog, SessionLocal, Upload, User, get_db
from app.deps import get_current_user, require_active_plan
from app.rate_limit import limiter
from app.schemas.response import APIResponse, JobStatusResponse, UploadResponse
from app.services.analytics import _infer_period
from app.services.auth_security import audit
from app.services.pipeline import run_extraction_pipeline
from app.utils.logger import get_logger
from app.utils.pdf_unlock import (
    PdfPasswordIrrecoverable,
    PdfUnlockUnsupported,
    is_encrypted,
    unlock_pdf,
)
from app.utils.storage import (
    delete_upload,
    delete_upload_by_job,
    is_pdf,
    result_path_for,
    save_result,
    save_upload,
)
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["upload"])

# Bounded pool for CPU-heavy extraction so concurrent uploads don't thrash the
# box. Jobs queue here; the request returns immediately with a job_id.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="extract")

# Human "what happened" copy per classified failure code. The technical detail
# is kept in ErrorLog.message; this is what the user is shown.
_ERROR_COPY = {
    "pdf_unlock_failed": (
        "We couldn't unlock this PDF automatically. Most bank statements use a "
        "6-digit numeric password — if yours uses something else, open it on your "
        "device first and re-upload the unlocked copy."
    ),
    "pdf_unlock_unsupported": (
        "This PDF uses an encryption format we don't yet support. Open it with the "
        "password on your device and re-upload the unlocked copy."
    ),
    "extraction_empty": (
        "We opened this file but couldn't find any transactions to read. Make sure "
        "you uploaded a bank statement PDF (not a receipt, a summary page, or a "
        "scanned image), and that it covers a period with activity — then try again."
    ),
    "server_error": (
        "Something went wrong while reading this statement. The issue has been "
        "logged with a timestamp — please try again, and contact support if it repeats."
    ),
}


def _set_job(db: Session, job_id: str, *, retries: int = 1, **fields) -> bool:
    """Update the Upload job row. Returns True on success.

    Progress pings are best-effort (retries=1), but the terminal done/failed
    write passes retries>1: under SQLite's single-writer lock a transient
    'database is locked' must not strand the job in 'processing' forever, so we
    briefly retry before giving up.
    """
    for attempt in range(retries):
        try:
            db.query(Upload).filter(Upload.job_id == job_id).update(fields)
            db.commit()
            return True
        except Exception:  # noqa: BLE001
            db.rollback()
            if attempt + 1 < retries:
                time.sleep(0.4)
            else:
                log.debug("job update failed for %s", job_id, exc_info=True)
    return False


def _run_extraction_job(job_id: str, file_path: Path, user_id: int) -> None:
    """Worker body (runs in a thread with its own DB session).

    Unlocks the PDF if needed, runs the pipeline with a progress callback that
    persists real stage/percentage, and records a decisive done/failed terminal
    state. On failure it writes a classified reason + the stage/% it stopped at
    to the Upload row AND an ErrorLog row — both timestamped.
    """
    db = SessionLocal()
    # Track the last real progress so a failure can report where it stopped and
    # so the persisted percentage stays monotonic (never goes backwards).
    state = {"stage": "Queued", "progress": 0}
    start = time.time()

    def _progress(stage: str, pct: int) -> None:
        pct = max(state["progress"], min(int(pct), 100))
        state["stage"], state["progress"] = stage, pct
        # Stamp the heartbeat on every ping so startup orphan-recovery can see
        # this job is alive and NOT fail it out from under us.
        _set_job(db, job_id, status="processing", stage=stage, progress=pct,
                 heartbeat_at=utcnow())

    def _fail(code: str, technical: str) -> None:
        human = _ERROR_COPY.get(code, _ERROR_COPY["server_error"])
        now = utcnow()
        _set_job(
            db, job_id, retries=4,
            status="failed", error_code=code, error_message=human,
            failed_stage=state["stage"], failed_progress=state["progress"],
            finished_at=now,
        )
        try:
            db.add(ErrorLog(
                user_id=user_id, path=f"job:{job_id}", method="EXTRACT",
                error_code=code, message=technical[:2000],
                stage=state["stage"], progress=state["progress"],
            ))
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
        audit(db, "upload_failed", user_id=user_id,
              details={"job_id": job_id, "code": code, "stage": state["stage"],
                       "progress": state["progress"]})

    try:
        now = utcnow()
        _set_job(db, job_id, status="processing", stage="Queued", progress=0,
                 started_at=now, heartbeat_at=now)

        # --- Unlock encrypted PDFs transparently (in the worker, off the event loop) ---
        content = file_path.read_bytes()
        if is_encrypted(content):
            _progress("Unlocking PDF", 8)
            try:
                unlocked = unlock_pdf(content)
                file_path.write_bytes(unlocked)
                log.info("Unlocked encrypted PDF for job %s (%d bytes)", job_id, len(unlocked))
            except PdfPasswordIrrecoverable as exc:
                _fail("pdf_unlock_failed", str(exc))
                return
            except PdfUnlockUnsupported as exc:
                log.warning("Unsupported PDF encryption for job %s: %s", job_id, exc)
                _fail("pdf_unlock_unsupported", str(exc))
                return

        # --- Run the pipeline with real progress reporting ---
        result = run_extraction_pipeline(job_id, file_path, progress_cb=_progress)
        result.processing_time_seconds = round(time.time() - start, 2)

        # A statement we couldn't read a single transaction from is a FAILURE, not
        # a success with zeros. Persisting an empty result would poison the
        # dashboard with "0" KPIs and an "unknown" bank; fail transparently
        # instead and leave any previously-good result untouched.
        if (result.total_transactions or 0) <= 0:
            _fail(
                "extraction_empty",
                f"Pipeline read 0 transactions from {result.total_pages} page(s)",
            )
            return

        dumped = result.model_dump()
        save_result(job_id, dumped, user_id=user_id)

        metadata = result.metadata.model_dump() if result.metadata else {}
        # Persist the statement period NOW so the selector / null-association
        # resolver can run as one indexed DB query instead of re-parsing every
        # result JSON per request (see analytics.statement_index).
        period = _infer_period(dumped.get("transactions") or [], metadata)
        _set_job(
            db, job_id, retries=4,
            status="done", stage="Done", progress=100,
            bank=metadata.get("bank"),
            total_transactions=result.total_transactions,
            period_start=period.get("start"),
            period_end=period.get("end"),
            finished_at=utcnow(),
        )
        audit(db, "upload_succeeded", user_id=user_id,
              details={"job_id": job_id, "transactions": result.total_transactions,
                       "bank": metadata.get("bank")})
        log.info("=== Job %s complete: %d transactions ===", job_id, result.total_transactions)
    except Exception as exc:  # noqa: BLE001 - terminal safety net
        log.exception("Pipeline failed for job %s", job_id)
        _fail("server_error", f"{type(exc).__name__}: {exc}")
    finally:
        if settings.delete_pdf_after_extraction:
            delete_upload(file_path)
        db.close()


# A PROCESSING job must be silent for this long before startup recovery fails
# it. It must exceed the largest gap between a live worker's progress pings
# (vision / LLM steps can run ~1-2 min), so recovery NEVER touches a job a
# sibling gunicorn worker is still processing — only genuinely dead ones.
_ORPHAN_STALE_SECONDS = 600
# A QUEUED job has no heartbeat yet (it hasn't started), so we can't tell a live
# worker's executor BACKLOG from a job orphaned before it started using a short
# window. Use a much longer one: given the upload throughput a live backlog
# always clears well within an hour, so a row still 'queued' after this long is
# genuinely orphaned (its owning process died before picking it up).
_ORPHAN_QUEUED_STALE_SECONDS = 3600


def recover_orphaned_jobs() -> int:
    """Fail extraction jobs that were STRANDED by a dead process.

    Extraction runs in an in-memory ThreadPoolExecutor whose queue does NOT
    survive a process restart. Without recovery, a job that was mid-pipeline when
    its worker crashed/redeployed would report `status='processing'` forever, and
    leave its PDF on disk.

    CRITICAL (multi-worker safety): production runs several gunicorn workers on
    ONE database, and each worker runs this on startup. We must NOT fail a job a
    *live sibling worker* still owns. A processing job bumps `heartbeat_at` on
    every progress ping, so we only fail it after `_ORPHAN_STALE_SECONDS` of
    silence. A queued job has no heartbeat, and a busy sibling's executor backlog
    can legitimately hold a job for a while, so queued rows use the much longer
    `_ORPHAN_QUEUED_STALE_SECONDS`. Called once from the app lifespan after
    init_db(). Returns rows recovered.
    """
    db = SessionLocal()
    recovered: list[tuple[int, str]] = []
    try:
        now = utcnow()
        proc_cutoff = now - timedelta(seconds=_ORPHAN_STALE_SECONDS)
        queued_cutoff = now - timedelta(seconds=_ORPHAN_QUEUED_STALE_SECONDS)
        rows = (
            db.query(Upload)
            .filter(
                or_(
                    and_(
                        Upload.status == "processing",
                        func.coalesce(
                            Upload.heartbeat_at, Upload.started_at, Upload.created_at
                        ) < proc_cutoff,
                    ),
                    and_(
                        Upload.status == "queued",
                        func.coalesce(Upload.heartbeat_at, Upload.created_at)
                        < queued_cutoff,
                    ),
                )
            )
            .all()
        )
        for row in rows:
            row.status = "failed"
            row.error_code = "server_error"
            row.error_message = _ERROR_COPY["server_error"]
            row.failed_stage = row.stage or "Queued"
            row.failed_progress = row.progress or 0
            row.finished_at = now
            db.add(ErrorLog(
                user_id=row.user_id, path=f"job:{row.job_id}", method="EXTRACT",
                error_code="server_error",
                message="Extraction was interrupted by a server restart before it finished.",
                stage=row.stage, progress=row.progress,
            ))
            recovered.append((row.user_id, row.job_id))
        if recovered:
            db.commit()
    except Exception:  # noqa: BLE001 — recovery must never block boot
        db.rollback()
        log.exception("Orphaned-job recovery failed")
        recovered = []
    finally:
        db.close()

    # Clean up the orphans' PDFs (the worker's finally-block never ran for them).
    if settings.delete_pdf_after_extraction:
        for user_id, job_id in recovered:
            delete_upload_by_job(job_id, user_id=user_id)
    if recovered:
        log.warning("Recovered %d orphaned extraction job(s) on startup", len(recovered))
    return len(recovered)


@router.post("/upload", response_model=APIResponse)
@limiter.limit(settings.rate_limit_upload)
async def upload_statement(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_active_plan),
    db: Session = Depends(get_db),
):
    """Accept a bank statement PDF and start a background extraction job.

    Fast client-input checks (filename, size, magic bytes) run here and return
    HTTP 4xx immediately. Everything slow — password unlock (CRDB / NMB last-6-
    digit passwords are brute-forced transparently) and the extraction pipeline
    — runs in a worker thread that writes real progress to the job row. Returns
    a job_id the client polls via GET /upload/status/{job_id}. The password is
    never persisted or logged.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename missing")

    content = await file.read()
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds {settings.max_file_size_mb}MB limit",
        )
    if not is_pdf(content):
        # Magic-byte check — extension alone is trivial to spoof.
        raise HTTPException(status_code=400, detail="File is not a valid PDF")

    job_id, file_path = save_upload(file.filename, content, user_id=user.id)
    del content  # free the in-memory copy; the worker reads from disk

    # Create the job row up front so the client can poll immediately.
    db.add(Upload(
        user_id=user.id,
        job_id=job_id,
        filename=file.filename[:255],
        status="queued",
        progress=0,
        stage="Queued",
    ))
    db.commit()

    log.info("Queued extraction job %s for user=%s (%s)", job_id, user.id, file.filename)
    _executor.submit(_run_extraction_job, job_id, file_path, user.id)

    return APIResponse(
        success=True,
        message="Upload received — extraction started.",
        data=UploadResponse(job_id=job_id, filename=file.filename, status="processing").model_dump(),
    )


@router.get("/upload/status/{job_id}", response_model=APIResponse)
async def upload_status(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Poll extraction progress for an owned job (honest stage + percentage)."""
    row = (
        db.query(Upload)
        .filter(Upload.job_id == job_id, Upload.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    status = JobStatusResponse(
        job_id=row.job_id,
        status=row.status or "queued",
        progress=int(row.progress or 0),
        stage=row.stage,
        message=row.error_message if row.status == "failed" else (row.stage or ""),
        error_code=row.error_code,
        error_message=row.error_message,
        failed_stage=row.failed_stage,
        failed_progress=row.failed_progress,
        finished_at=row.finished_at.isoformat() if row.finished_at else None,
        total_transactions=row.total_transactions if row.status == "done" else None,
    )
    return APIResponse(success=True, message="ok", data=status.model_dump())


@router.get("/results/{job_id}", response_model=APIResponse)
async def get_result(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieve a previously extracted result by job ID (owner only)."""
    owned = (
        db.query(Upload)
        .filter(Upload.job_id == job_id, Upload.user_id == user.id)
        .first()
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Result not found")

    path = result_path_for(job_id, user.id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Result not found")

    data = json.loads(path.read_text(encoding="utf-8"))
    return APIResponse(success=True, message="Result found", data=data)


@router.get("/uploads", response_model=APIResponse)
async def list_uploads(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List uploads for the authenticated user.

    Rows are now created at QUEUE time, so this table also holds in-flight and
    failed jobs. Every row carries `status`; statement-listing consumers should
    pass `?status=done` (or filter client-side) so a failed/queued row — which
    has no result JSON and would 404 on /analysis — is never treated as an
    extracted statement.
    """
    q = db.query(Upload).filter(Upload.user_id == user.id)
    if status:
        q = q.filter(Upload.status == status)
    rows = q.order_by(Upload.created_at.desc()).all()
    return APIResponse(
        success=True,
        message="ok",
        data={
            "uploads": [
                {
                    "job_id": row.job_id,
                    "filename": row.filename,
                    "bank": row.bank,
                    "total_transactions": row.total_transactions,
                    "status": row.status,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        },
    )
