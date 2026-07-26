"""
Normalizer: cleans and standardizes extracted transactions.

Responsibilities:
- Normalize dates to consistent format
- Clean description text
- Ensure amounts are positive floats
- Detect and assign debit vs credit correctly
- Remove duplicate rows
"""

import datetime as dt
import re

from app.schemas.transaction import Transaction
from app.utils.logger import get_logger

log = get_logger(__name__)

# Plausible statement-date window. OCR misreads a year digit easily
# ("2026" → "8125"); such dates are impossible, not merely unusual, and must
# not survive into results (they corrupt the statement-period inference).
_MIN_TXN_DATE = dt.date(2000, 1, 1)


def _max_txn_date() -> dt.date:
    # Statements can't post transactions meaningfully in the future; allow a
    # small grace window for timezone edges.
    return dt.date.today() + dt.timedelta(days=31)


def normalize_transactions(transactions: list[Transaction]) -> list[Transaction]:
    """Clean and standardize a list of transactions."""
    normalized = []
    seen_keys: set[str] = set()
    max_date = _max_txn_date()

    for txn in transactions:
        txn = _clean_description(txn)
        txn = _normalize_amounts(txn)
        txn = _ensure_debit_credit(txn)

        # Impossible dates (OCR-garbled year etc.) are dropped, not kept:
        # a wrong-but-plausible date is worse than a flagged missing one.
        if txn.txn_date is not None and not (_MIN_TXN_DATE <= txn.txn_date <= max_date):
            log.info(
                "Row %d: dropping implausible date %s", txn.row_index, txn.txn_date
            )
            txn.txn_date = None
            txn.needs_review = True
            txn.review_reason = txn.review_reason or "Implausible date removed"
            txn.confidence = min(txn.confidence, 0.6)

        # Deduplicate: only true duplicates (identical date + description +
        # amounts + balance + reference). Balance and reference differ between
        # legitimately-repeating same-day rows (e.g., multiple identical fee
        # charges posted on the same day), so including them prevents real
        # transactions from being collapsed into one.
        key = (
            f"{txn.txn_date}|{txn.description[:60]}|{txn.debit}|{txn.credit}"
            f"|{txn.balance}|{txn.reference}"
        )
        if key in seen_keys:
            log.info("Skipping duplicate row %d: %s", txn.row_index, key)
            continue
        seen_keys.add(key)

        normalized.append(txn)

    _drop_outlier_dates(normalized)

    log.info(
        "Normalized %d transactions (from %d raw)",
        len(normalized),
        len(transactions),
    )
    return normalized


# A run of this many transaction-free days splits one block of statement
# activity from the next. Inside a statement's real period the gaps between
# consecutive transaction dates are days, not months.
_PERIOD_GAP_DAYS = 31

# A detached block this small (relative to all dated rows) is a misread rather
# than a genuine stretch of the statement.
_OUTLIER_SHARE = 0.10


def _drop_outlier_dates(transactions: list[Transaction]) -> None:
    """Remove dates that belong to no part of the document's own period.

    The plausibility window above only rejects impossible dates; this pass
    rejects merely *inconsistent* ones — a garbled day or year that still
    parses (2026-08-18 read for 2026-06-18, or 2020 read for 2026). Without
    it, one bad date drags the reported statement period across months.

    The test is SEPARATION, not distance from a centre. Dates are grouped into
    blocks split by gaps of more than a month, and a block is discarded only
    when it is both detached from the main body and holds under a tenth of the
    dated rows. An earlier version used the 10th-90th percentile plus a month
    of slack, which over-trims: percentiles describe where transactions are
    DENSE, but a statement period is a contiguous RANGE. On a quarterly
    statement whose activity piles up on paydays the 90th percentile collapses
    onto the pile, and genuine month-end rows fell outside the slack — their
    dates silently deleted and the rows flagged for review. Grouping by gaps
    keeps those (no gap separates them) while still isolating a lone date
    stranded weeks past every other row.

    A sparse account is protected by the share test: if its rows are spread
    thinly enough that every block is small, no block is a clear minority and
    nothing is dropped. The largest block is never dropped.
    """
    dated = [t for t in transactions if t.txn_date is not None]
    if len(dated) < 5:
        return  # too little signal to call anything an outlier

    # Group into blocks of activity, splitting wherever a month passes with no
    # transaction at all.
    blocks: list[list[Transaction]] = []
    for t in sorted(dated, key=lambda x: x.txn_date):
        if blocks and (t.txn_date - blocks[-1][-1].txn_date).days > _PERIOD_GAP_DAYS:
            blocks.append([])
        elif not blocks:
            blocks.append([])
        blocks[-1].append(t)
    if len(blocks) < 2:
        return  # one contiguous period: nothing is detached from anything

    main = max(blocks, key=len)
    cutoff = len(dated) * _OUTLIER_SHARE
    for block in blocks:
        if block is main or len(block) >= cutoff:
            continue
        for t in block:
            log.info(
                "Row %d: dropping out-of-period date %s (statement body %s..%s)",
                t.row_index, t.txn_date, main[0].txn_date, main[-1].txn_date,
            )
            t.txn_date = None
            t.needs_review = True
            t.review_reason = t.review_reason or "Date outside statement period"
            t.confidence = min(t.confidence, 0.6)


def _clean_description(txn: Transaction) -> Transaction:
    """Clean up the description text."""
    desc = txn.description

    # Remove extra whitespace
    desc = re.sub(r"\s+", " ", desc).strip()

    # Remove common noise patterns
    desc = re.sub(r"^\d+\s+", "", desc)  # leading row numbers
    desc = re.sub(r"\s*-{2,}\s*", " ", desc)  # dashes used as separators

    txn.description = desc
    return txn


def _normalize_amounts(txn: Transaction) -> Transaction:
    """Ensure amounts are positive (or None)."""
    if txn.debit is not None:
        txn.debit = abs(txn.debit)
        if txn.debit == 0:
            txn.debit = None
    if txn.credit is not None:
        txn.credit = abs(txn.credit)
        if txn.credit == 0:
            txn.credit = None
    if txn.balance is not None:
        txn.balance = abs(txn.balance)
    return txn


def _ensure_debit_credit(txn: Transaction) -> Transaction:
    """
    If a transaction has both debit and credit as None but has a balance,
    flag it for review.
    """
    if txn.debit is None and txn.credit is None:
        txn.needs_review = True
        txn.review_reason = txn.review_reason or "No debit or credit amount"
        txn.confidence = min(txn.confidence, 0.4)
    return txn
