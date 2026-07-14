"""File storage helpers for uploads, results, and debug output.

Result files are namespaced per-user to provide hard isolation: a job
belonging to user 7 lands in storage/results/7/<job_id>.json. Old
top-level result files (pre-auth) are ignored by user-scoped queries.
"""

import json
import uuid
from pathlib import Path
from typing import Optional

from app.config import settings
from app.utils.logger import get_logger

log = get_logger(__name__)

PDF_MAGIC = b"%PDF-"


def ensure_dirs() -> None:
    """Create storage directories if they don't exist."""
    for path in [settings.uploads_path, settings.results_path, settings.debug_path]:
        path.mkdir(parents=True, exist_ok=True)


def is_pdf(content: bytes) -> bool:
    """Magic-byte check — must start with %PDF-."""
    return bool(content) and content[: len(PDF_MAGIC)] == PDF_MAGIC


def _safe_filename(name: str) -> str:
    """Strip directory components and unsafe characters from a filename."""
    base = Path(name).name  # drop any path
    cleaned = "".join(c for c in base if c.isalnum() or c in "._- ")
    return (cleaned[:120] or "upload.pdf").strip() or "upload.pdf"


def _user_dir(root: Path, user_id: Optional[int]) -> Path:
    target = root / str(user_id) if user_id else root
    target.mkdir(parents=True, exist_ok=True)
    return target


def save_upload(filename: str, content: bytes, user_id: Optional[int] = None) -> tuple[str, Path]:
    """Save uploaded file and return (job_id, file_path)."""
    ensure_dirs()
    job_id = uuid.uuid4().hex[:12]
    safe_name = f"{job_id}_{_safe_filename(filename)}"
    file_path = _user_dir(settings.uploads_path, user_id) / safe_name
    file_path.write_bytes(content)
    log.info("Saved upload: %s (%d bytes)", file_path.name, len(content))
    return job_id, file_path


def save_result(job_id: str, data: dict, user_id: Optional[int] = None) -> Path:
    """Save extraction result as JSON, scoped to user."""
    ensure_dirs()
    result_path = _user_dir(settings.results_path, user_id) / f"{job_id}.json"
    result_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    log.info("Saved result: %s", result_path.name)
    return result_path


def result_path_for(job_id: str, user_id: int) -> Path:
    return _user_dir(settings.results_path, user_id) / f"{job_id}.json"


def list_user_results(user_id: int) -> list[Path]:
    target = settings.results_path / str(user_id)
    if not target.exists():
        return []
    return sorted(target.glob("*.json"))


def delete_upload(file_path: Path) -> None:
    """Best-effort delete of an uploaded PDF; never raises."""
    try:
        if file_path.exists():
            file_path.unlink()
    except OSError as exc:
        log.warning("Could not delete upload %s: %s", file_path, exc)


def delete_upload_by_job(job_id: str, user_id: Optional[int] = None) -> None:
    """Delete any saved PDF(s) for a job_id — used to clean up orphaned uploads
    whose worker never ran (e.g. a process restart). Best-effort; never raises.

    Saved files are named `{job_id}_{safe_name}` (see save_upload), so a glob on
    the prefix reliably finds the one file regardless of its original name.
    """
    try:
        target = settings.uploads_path / str(user_id) if user_id else settings.uploads_path
        if not target.exists():
            return
        for path in target.glob(f"{job_id}_*"):
            delete_upload(path)
    except OSError as exc:
        log.warning("Could not clean up upload for job %s: %s", job_id, exc)


def save_debug(job_id: str, page_num: int, data: dict, user_id: Optional[int] = None) -> Path:
    """Save per-page debug output."""
    ensure_dirs()
    debug_root = _user_dir(settings.debug_path, user_id)
    debug_dir = debug_root / job_id
    debug_dir.mkdir(exist_ok=True)
    debug_path = debug_dir / f"page_{page_num:03d}.json"
    debug_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    return debug_path
