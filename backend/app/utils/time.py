"""Timezone-safe replacements for the deprecated `datetime.utcnow()`.

`datetime.utcnow()` is deprecated in Python 3.12+ and returns a naive
datetime (no tz info). The DB columns in PesaLens are stored naive
(SQLite has no timezone awareness), so we keep the wire format naive
but obtain it from the non-deprecated `datetime.now(timezone.utc)`.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC `datetime.now()` — drop-in for `datetime.utcnow()`."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utcfromtimestamp(ts: float) -> datetime:
    """Naive UTC datetime from a unix timestamp — drop-in for
    `datetime.utcfromtimestamp(ts)`."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
