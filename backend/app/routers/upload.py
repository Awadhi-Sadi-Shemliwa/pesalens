"""Upload endpoint for bank statement PDFs (auth-required, scoped per user)."""

import json
import time

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Upload, User, get_db
from app.deps import get_current_user, require_active_plan
from app.rate_limit import limiter
from app.schemas.response import APIResponse
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
    is_pdf,
    result_path_for,
    save_result,
    save_upload,
)

log = get_logger(__name__)
router = APIRouter(tags=["upload"])


@router.post("/upload", response_model=APIResponse)
@limiter.limit(settings.rate_limit_upload)
async def upload_statement(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_active_plan),
    db: Session = Depends(get_db),
):
    """Upload a bank statement PDF for extraction (per-authenticated-user).

    Password-protected PDFs (e.g. CRDB / NMB monthly statements whose
    open-password is the last 6 digits of the account number) are
    unlocked transparently in the background — the user never has to
    type the password. We try a tiny common-password list first, then
    sweep the 6-digit numeric keyspace across every CPU core. Once
    recovered, we save the unencrypted PDF in place and feed it to the
    extraction pipeline like any other upload. The password is never
    persisted or logged.
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

    if is_encrypted(content):
        try:
            unlock_started = time.time()
            content = await run_in_threadpool(unlock_pdf, content)
            log.info(
                "Unlocked encrypted PDF from user=%s in %.2fs (%s, %d bytes)",
                user.id, time.time() - unlock_started, file.filename, len(content),
            )
        except PdfPasswordIrrecoverable as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "pdf_unlock_failed",
                    "message": str(exc),
                },
            ) from exc
        except PdfUnlockUnsupported as exc:
            log.warning("Unsupported PDF encryption for user=%s: %s", user.id, exc)
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "pdf_unlock_unsupported",
                    "message": str(exc),
                },
            ) from exc

    log.info(
        "Received upload from user=%s: %s (%d bytes)",
        user.id, file.filename, len(content),
    )

    job_id, file_path = save_upload(file.filename, content, user_id=user.id)

    try:
        start = time.time()
        # Pipeline is CPU-bound and synchronous — keep it off the event loop.
        result = await run_in_threadpool(run_extraction_pipeline, job_id, file_path)
        result.processing_time_seconds = round(time.time() - start, 2)
        save_result(job_id, result.model_dump(), user_id=user.id)

        # Record in the database (scopes uploads to this user).
        metadata = result.metadata.model_dump() if result.metadata else {}
        record = Upload(
            user_id=user.id,
            job_id=job_id,
            filename=file.filename[:255],
            bank=metadata.get("bank"),
            total_transactions=result.total_transactions,
        )
        db.add(record)
        db.commit()

        return APIResponse(
            success=True,
            message=f"Extracted {result.total_transactions} transactions from {result.total_pages} pages",
            data=result.model_dump(),
        )
    except Exception as exc:  # noqa: BLE001 - surface generic error
        log.exception("Pipeline failed for job %s", job_id)
        return APIResponse(
            success=False,
            message="Extraction failed",
            errors=[type(exc).__name__],
        )
    finally:
        if settings.delete_pdf_after_extraction:
            delete_upload(file_path)


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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all uploads for the authenticated user."""
    rows = (
        db.query(Upload)
        .filter(Upload.user_id == user.id)
        .order_by(Upload.created_at.desc())
        .all()
    )
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
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        },
    )
