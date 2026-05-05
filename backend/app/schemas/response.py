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
    """Response for checking job status."""

    job_id: str
    status: str
    progress: float = 0.0
    message: str = ""
