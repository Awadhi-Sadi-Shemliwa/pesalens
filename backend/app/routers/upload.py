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
from app.db import ErrorLog, PersonalEntry, SessionLocal, Upload, User, get_db
from app.deps import get_current_user, require_active_plan
from app.rate_limit import limiter
from app.schemas.response import APIResponse, JobStatusResponse, UploadResponse
from app.services.activity import record_error
from app.services.analytics import _infer_period
from app.services.auth_security import audit
from app.services.ocr_extractor import OcrPageLimitExceeded
from app.services.pipeline import run_extraction_pipeline
from app.utils.logger import get_logger
from app.utils.pdf_unlock import (
    PdfPasswordIrrecoverable,
    PdfUnlockUnsupported,
    is_encrypted,
    unlock_pdf,
)
from app.utils.storage import (
    delete_debug_dir,
    delete_receipt_files,
    delete_result,
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
    "ocr_unavailable": (
        "This statement is a scan and needs OCR to read, but OCR isn't available "
        "on the server right now. Please try again later, or upload a digital "
        "(text-based) copy exported from your bank's app or website."
    ),
    "ocr_empty": (
        "This statement is a scan — we ran OCR on every page but couldn't "
        "recognize any transactions. Try a clearer scan (flat, well-lit, 300 DPI) "
        "or a digital copy exported from your bank's app or website."
    ),
    "garbled_text_layer": (
        "This PDF contains a broken text layer from a previous scan, and we "
        "couldn't recover the transactions from the page images either. Please "
        "re-download the statement from your bank's app or website and upload "
        "that copy."
    ),
    "ocr_page_limit": (
        "This statement has more scanned pages than we can process in one job. "
        "Please split the PDF into smaller parts and upload them separately."
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
                source="pipeline",
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
        try:
            result = run_extraction_pipeline(job_id, file_path, progress_cb=_progress)
        except OcrPageLimitExceeded as exc:
            _fail("ocr_page_limit", str(exc))
            return
        result.processing_time_seconds = round(time.time() - start, 2)

        # A statement we couldn't read a single transaction from is a FAILURE, not
        # a success with zeros. Persisting an empty result would poison the
        # dashboard with "0" KPIs and an "unknown" bank; fail transparently
        # instead and leave any previously-good result untouched. The code is
        # picked from the OCR diagnostics so the user learns WHY it was empty,
        # not just that it was.
        if (result.total_transactions or 0) <= 0:
            if result.ocr_unavailable and result.scanned_pages > 0:
                code = "ocr_unavailable"
            elif result.scanned_pages > 0 and result.garbled_pages > 0:
                code = "garbled_text_layer"
            elif result.scanned_pages > 0:
                code = "ocr_empty"
            else:
                code = "extraction_empty"
            _fail(
                code,
                f"Pipeline read 0 transactions from {result.total_pages} page(s) "
                f"(scanned={result.scanned_pages}, garbled={result.garbled_pages}, "
                f"ocr_unavailable={result.ocr_unavailable})",
            )
            return

        # Categorize before persisting: keyword pass for every row, LLM batch
        # pass for whatever keywords leave as "Other Expenses" (cached, best-
        # effort — a failure here must never fail the extraction).
        try:
            from app.services.llm_categorizer import apply_llm_categories
            apply_llm_categories(result.transactions)
        except Exception:  # noqa: BLE001
            log.warning("LLM categorization failed for %s", job_id, exc_info=True)

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
                source="pipeline",
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


# --------------------------------------------------------------------------
# Deleting a statement
#
# A user who can see that an extraction read their statement badly needs a way
# to clear it out and start again — otherwise the bad numbers sit in their
# dashboard forever. Deleting is therefore a first-class action, and it has to
# take the things that were derived FROM that statement with it: the receipt
# scans filed against it and the manual entries scoped to it. Leaving those
# behind would keep the spend totals wrong after the "fix".
#
# THE SAFETY RULE, and it is not obvious: match `statement_job_id == job_id`
# and NOTHING else. personal.py's READ path deliberately treats entries with a
# NULL statement_job_id as belonging to the newest statement — a convenience so
# legacy rows still show up somewhere. Applying that same rule here would mean
# deleting the newest statement silently wipes every entry the user ever typed
# in by hand outside a statement context. A read-time convenience must never
# become a delete-time claim of ownership.
# --------------------------------------------------------------------------

def _owned_upload(job_id: str, user: User, db: Session) -> Upload:
    owned = (
        db.query(Upload)
        .filter(Upload.job_id == job_id, Upload.user_id == user.id)
        .first()
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Statement not found")
    return owned


def _load_user_receipts(user_id: int) -> list[dict]:
    """Every saved receipt for this user; [] if they can't be read.

    Local import: receipts.py imports storage helpers this module also uses, so
    importing it at module scope would create a cycle.
    """
    from app.routers.receipts import _load_receipts
    try:
        return _load_receipts(user_id)
    except Exception:  # noqa: BLE001 - a bad receipt file must not block delete
        log.warning("Could not enumerate receipts for user %s", user_id, exc_info=True)
        return []


def _linked_receipts(user_id: int, job_id: str) -> list[dict]:
    """Receipts filed against this statement. Explicit match only."""
    return [
        r for r in _load_user_receipts(user_id)
        if r.get("statement_job_id") == job_id
    ]


@router.get("/uploads/{job_id}/impact", response_model=APIResponse)
async def delete_impact(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """What deleting this statement would remove.

    The confirm dialog states real counts rather than a vague warning — a user
    about to destroy 12 hand-typed entries deserves to know that before they
    type DELETE, not after.
    """
    owned = _owned_upload(job_id, user, db)
    entries = (
        db.query(PersonalEntry)
        .filter(
            PersonalEntry.user_id == user.id,
            PersonalEntry.statement_job_id == job_id,  # explicit only — see above
        )
        .count()
    )
    return APIResponse(
        success=True, message="ok",
        data={
            "job_id": job_id,
            "filename": owned.filename,
            "bank": owned.bank,
            "status": owned.status,
            "transactions": owned.total_transactions or 0,
            "receipts": len(_linked_receipts(user.id, job_id)),
            "personal_entries": entries,
        },
    )


@router.delete("/uploads/{job_id}", response_model=APIResponse)
async def delete_statement(
    request: Request,
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a statement and everything derived from it. Owner only.

    The DB row is the source of truth, so it goes FIRST: delete the linked
    `PersonalEntry` rows and the `uploads` row, then commit. Only after that
    commit succeeds do we touch the filesystem. This makes the irreversible
    step (unlinking receipt/result/PDF files) always follow the point of no
    return — a failed commit destroys nothing, because nothing on disk has been
    removed yet; the user retries against unchanged state.

    File cleanup after the commit is best-effort. The receipt files, result
    JSON, debug dir and source PDF are all reachable only through data we have
    just deleted, so a leftover is unreachable garbage, not data loss — worst
    case a sweep reclaims it later. We therefore log a failed unlink rather than
    raise, since the statement is already gone and the user has been told the
    delete succeeded. (The earlier ordering deleted receipt files BEFORE the
    commit to avoid gallery orphans, but that meant a failed commit permanently
    destroyed the user's receipts while leaving the statement intact — the
    opposite of the safety this docstring used to claim.)
    """
    owned = _owned_upload(job_id, user, db)

    # A worker thread still owns this job and will write its result after we
    # finish — deleting now would resurrect the files we just removed.
    if owned.status in ("queued", "processing"):
        raise HTTPException(
            status_code=409,
            detail=(
                "This statement is still being processed. Wait for it to finish "
                "(or fail) before deleting it."
            ),
        )

    # Read what the audit trail needs BEFORE the row is deleted. Attribute
    # access on a deleted instance happens to still work today, but that is a
    # detail of SQLAlchemy's detached-instance handling, not a guarantee.
    filename = owned.filename

    # Listed BEFORE the commit (a read), removed AFTER it (a write). We need the
    # list and count now for the audit trail and response; the irreversible file
    # unlink waits until the DB delete is durable.
    receipts = _linked_receipts(user.id, job_id)

    entries_removed = (
        db.query(PersonalEntry)
        .filter(
            PersonalEntry.user_id == user.id,
            PersonalEntry.statement_job_id == job_id,  # explicit only — see above
        )
        .delete(synchronize_session=False)
    )
    db.delete(owned)
    db.commit()

    counts = {
        "receipts": len(receipts),
        "personal_entries": int(entries_removed or 0),
    }
    # Recorded before the file cleanup below so the destructive act is on the
    # audit trail even if that cleanup dies part-way.
    audit(
        db, "statement_delete", user_id=user.id,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        details={"job_id": job_id, "filename": filename, **counts},
    )

    # Now unreachable (the `uploads` row is gone), so these are best-effort:
    # each logs and swallows its own error rather than failing a delete the
    # user has already been told succeeded. A leftover file is reclaimable
    # garbage, not the permanent data loss a pre-commit unlink would have been.
    for receipt in receipts:
        for failure in delete_receipt_files(user.id, receipt):
            log.warning(
                "Orphaned receipt file after deleting statement %s: %s",
                job_id, failure,
            )
            # Also into the error ledger: this is disk the user believes is
            # gone and is still paying for in their quota. It never raised, so
            # stdout was the only trace and nobody was ever going to read it.
            record_error(
                "receipt_file_orphaned", f"{job_id}: {failure}",
                user_id=user.id, path="/uploads/{job_id}", method="DELETE",
                source="handled",
            )
    delete_result(job_id, user.id)
    delete_debug_dir(job_id, user_id=user.id)
    delete_upload_by_job(job_id, user_id=user.id)
    log.info(
        "User %s deleted statement %s (%d receipts, %d entries)",
        user.id, job_id, counts["receipts"], counts["personal_entries"],
    )
    return APIResponse(
        success=True, message="Statement deleted", data={"job_id": job_id, **counts},
    )


# --------------------------------------------------------------------------
# "Start over" — the escape hatch for data that predates statement scoping.
#
# `statement_job_id` only exists from 2026-07-14. Everything captured before
# that carries NULL, and NULL is deliberately excluded from the delete cascade
# (it would take hand-typed entries with it). The result: early users have
# receipts and entries that NOTHING can remove — deleting every statement
# leaves them untouched, which is exactly the "that looks impossible" report
# this was built for.
#
# It is a blunt instrument, so it is fenced three ways: it refuses when any
# data IS attached (the normal cascade is the right tool then), it is limited
# to once per 30 days, and the client requires type-to-confirm. Statements and
# BUSINESS entries are never touched — `BusinessEntry` has no statement_job_id
# at all, so "unattached" is its permanent normal state and clearing it here
# would destroy ledgers that were never statement-derived.
# --------------------------------------------------------------------------

_ORPHAN_RESET_COOLDOWN_DAYS = 30


def _start_over_state(user: User, db: Session) -> dict:
    """Counts + whether a bulk clear is currently permitted, and why not."""
    receipts = _load_user_receipts(user.id)
    attached_receipts = sum(1 for r in receipts if r.get("statement_job_id"))
    # COUNT, not .all(): this runs on every Settings/Profile load and the two
    # numbers below are the only thing the rows were ever used for — no reason
    # to materialise a whole ledger as ORM objects to measure it.
    mine = db.query(func.count(PersonalEntry.id)).filter(PersonalEntry.user_id == user.id)
    entry_count = mine.scalar() or 0
    attached_entries = mine.filter(PersonalEntry.statement_job_id.isnot(None)).scalar() or 0

    # Read the cooldown from `db` rather than off the User instance — the
    # instance can be stale (or from another session) and this gate must be
    # decided on committed state.
    last = (
        db.query(User.last_orphan_reset_at)
        .filter(User.id == user.id)
        .scalar()
    )
    next_at = last + timedelta(days=_ORPHAN_RESET_COOLDOWN_DAYS) if last else None
    on_cooldown = bool(next_at and next_at > utcnow())

    # Order matters for the message the user reads: an empty account is told
    # "nothing to clear", not "already used" — the cooldown is irrelevant when
    # there is nothing the action would do.
    if attached_receipts or attached_entries:
        reason = "attached"
    elif not receipts and not entry_count:
        reason = "nothing_to_clear"
    elif on_cooldown:
        reason = "cooldown"
    else:
        reason = None

    return {
        "eligible": reason is None,
        "reason": reason,
        "receipts": len(receipts),
        "personal_entries": entry_count,
        "attached_receipts": attached_receipts,
        "attached_entries": attached_entries,
        "cooldown_days": _ORPHAN_RESET_COOLDOWN_DAYS,
        "last_reset_at": last.isoformat() if last else None,
        "next_available_at": next_at.isoformat() if on_cooldown else None,
    }


@router.get("/data/start-over/eligibility", response_model=APIResponse)
async def start_over_eligibility(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Whether "start over" is available, with the counts it would remove."""
    return APIResponse(success=True, message="ok", data=_start_over_state(user, db))


@router.post("/data/start-over", response_model=APIResponse)
async def start_over(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear every receipt and manual personal entry. Statements are kept."""
    state = _start_over_state(user, db)

    if state["reason"] == "attached":
        raise HTTPException(
            status_code=409,
            detail=(
                "Some of your receipts or entries are linked to a statement. "
                "Delete that statement instead — it removes its own data with it."
            ),
        )
    if state["reason"] == "cooldown":
        raise HTTPException(
            status_code=429,
            detail=(
                f"Start over is available once every {_ORPHAN_RESET_COOLDOWN_DAYS} "
                f"days. You can do this again after "
                f"{state['next_available_at'][:10]}."
            ),
        )
    if state["reason"] == "nothing_to_clear":
        raise HTTPException(
            status_code=409, detail="There is nothing to clear.",
        )

    # Listed BEFORE the commit (a read); the irreversible file unlink waits until
    # the DB delete is durable.
    receipts = _load_user_receipts(user.id)

    # DB is the source of truth, so it goes FIRST and must be durable before we
    # touch the filesystem — the same ordering delete_statement documents. The
    # previous version unlinked every receipt file BEFORE this commit: a commit
    # (or cooldown UPDATE) failure then left the user's receipts permanently
    # destroyed while their entries survived and the 30-day allowance was NOT
    # consumed — the exact inversion of the safety guarantee. Now a failed commit
    # destroys nothing on disk and the user retries against unchanged state.
    entries_removed = (
        db.query(PersonalEntry)
        .filter(PersonalEntry.user_id == user.id)
        .delete(synchronize_session=False)
    )
    # Stamp the cooldown by query, not `db.add(user)`: the User instance may
    # belong to a different session than `db` (it does under a dependency
    # override), and attaching it across sessions raises.
    db.query(User).filter(User.id == user.id).update(
        {"last_orphan_reset_at": utcnow()}, synchronize_session=False,
    )
    db.commit()

    counts = {"receipts": len(receipts), "personal_entries": int(entries_removed or 0)}
    # Recorded before the file cleanup so the destructive act is on the audit
    # trail even if that cleanup dies part-way.
    audit(
        db, "data_start_over", user_id=user.id,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        details=counts,
    )

    # Files come AFTER the durable commit and are best-effort. A receipt file is
    # reachable only by this user and its entries are already gone, so a leftover
    # is a reclaimable gallery orphan a later start-over or sweep clears — not the
    # permanent data loss a pre-commit unlink would have been. Log, don't raise:
    # the destructive DB act is done and has been reported as success.
    for receipt in receipts:
        for failure in delete_receipt_files(user.id, receipt):
            log.warning(
                "Orphaned receipt file after start over for user %s: %s",
                user.id, failure,
            )
            record_error(
                "receipt_file_orphaned", str(failure),
                user_id=user.id, path="/data/start-over", method="POST",
                source="handled",
            )

    log.info(
        "User %s started over (%d receipts, %d entries)",
        user.id, counts["receipts"], counts["personal_entries"],
    )
    return APIResponse(success=True, message="Cleared", data=counts)
