"""API response wrapper models."""

from typing import Any, Optional

from pydantic import BaseModel


class APIResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    message: str
    data: Optional[Any] = None
    errors: list[str] = []


class UploadResponse(BaseModel):
    """Response after uploading a PDF."""

    job_id: str
    filename: str
    status: str = "processing"
    message: str = "File uploaded successfully"


class JobStatusResponse(BaseModel):
    """Live status of an extraction job (polled by the upload UI).

    Carries a REAL stage label + percentage so the client can render honest
    progress, and — on failure — the stage/percentage where it stopped, a
    classified code, a human reason, and the timestamp it finished.
    """

    job_id: str
    status: str                       # queued|processing|done|failed
    progress: int = 0                 # 0..100, real, monotonic
    stage: Optional[str] = None       # human stage label
    message: str = ""
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    failed_stage: Optional[str] = None
    failed_progress: Optional[int] = None
    finished_at: Optional[str] = None  # ISO-8601 timestamp
    total_transactions: Optional[int] = None
