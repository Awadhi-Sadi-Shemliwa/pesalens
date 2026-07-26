"""One place to record what happened — activity and failures.

The owner console can only show what somebody bothered to write down, and
before this module the writing-down was scattered: `auth_security.audit` for
account events, a `db.add(ErrorLog(...))` inline in the pipeline, another in
main.py's exception handler, and nothing at all for the two things an operator
most needs to see — deletions, and failures that were handled politely instead
of crashing.

Two helpers, both **best-effort by contract**: they swallow their own errors and
never raise into the caller. A request must not fail because its audit trail
could not be written, and a failure path must not fail while it is reporting a
failure. That is also why `record_error` can open its own session: it is often
called from an `except` block where the request session is already poisoned by
the very error being reported, and reusing it would silently lose the row.

Naming: events are `noun_verb` in the past tense (`receipt_deleted`,
`entry_created`) so the admin activity feed reads as a log of things that have
already happened, and so filtering by prefix groups a whole subject area.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.utils.logger import get_logger

log = get_logger(__name__)

# Cap on a single stored detail blob. Details are operator context, not a data
# store — an unbounded dict here would let one pathological row bloat the table
# and the admin response that reads it.
_MAX_DETAILS = 2000


def record_activity(
    db: Optional[Session],
    event: str,
    user_id: Optional[int] = None,
    request: Any = None,
    details: Optional[dict] = None,
    ip: Optional[str] = None,
) -> None:
    """Append one row to the audit trail. Never raises.

    Pass `request` and the client IP / user-agent are lifted off it, so call
    sites do not each re-derive them (and none of them forget). An explicit
    `ip` wins, for the paths that already resolved it.

    `db=None` opens a short-lived session of its own — for the work that runs
    in a threadpool (the receipt scan) where no request-scoped session exists.
    """
    from app.db import AuditLog, session_scope

    ua = None
    if request is not None:
        try:
            if ip is None and getattr(request, "client", None):
                ip = request.client.host
            ua = request.headers.get("user-agent")
        except Exception:  # noqa: BLE001 - context is a bonus, never a blocker
            pass
    try:
        blob = None
        if details:
            blob = json.dumps(details, default=str)[:_MAX_DETAILS]
        row = dict(
            user_id=user_id,
            event=event[:60],
            ip=(ip or "")[:64] or None,
            user_agent=(ua or "")[:255] or None,
            details=blob,
        )
        if db is None:
            with session_scope() as own:
                own.add(AuditLog(**row))
            return
        db.add(AuditLog(**row))
        db.commit()
    except Exception:  # noqa: BLE001
        # The caller's real work may still be uncommitted in this session, so
        # roll back only far enough to leave the session usable.
        if db is not None:
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
        log.debug("Failed to record activity %s", event, exc_info=True)


def record_error(
    error_code: str,
    message: str,
    user_id: Optional[int] = None,
    path: Optional[str] = None,
    method: Optional[str] = None,
    stage: Optional[str] = None,
    progress: Optional[int] = None,
    source: str = "handled",
    db: Optional[Session] = None,
) -> None:
    """Append one row to the error ledger. Never raises.

    `source` separates the four kinds of failure the console shows apart:
    'server' (crashed), 'pipeline' (extraction died mid-job), 'handled' (we
    caught it and told the user something friendly — invisible before this) and
    'web'/'mobile' (the client reported its own crash).

    Opens its OWN session by default. Callers are usually inside an `except`
    block where the request session may be in a failed transaction; writing the
    error row there would be rolled back with everything else, losing exactly
    the record we are trying to keep. Pass `db` only when the session is known
    to be healthy.
    """
    from app.db import ErrorLog, session_scope

    row = dict(
        user_id=user_id,
        path=(path or "")[:255] or None,
        method=(method or "")[:10] or None,
        error_code=(error_code or "unknown")[:40],
        message=(message or "")[:2000] or None,
        stage=(stage or "")[:40] or None,
        progress=progress,
        source=(source or "handled")[:16],
    )
    try:
        if db is not None:
            db.add(ErrorLog(**row))
            db.commit()
            return
        with session_scope() as own:
            own.add(ErrorLog(**row))
    except Exception:  # noqa: BLE001 - reporting a failure must not fail
        if db is not None:
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
        log.debug("Failed to persist ErrorLog %s", error_code, exc_info=True)
