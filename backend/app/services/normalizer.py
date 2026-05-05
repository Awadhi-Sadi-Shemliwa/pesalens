"""
Normalizer: cleans and standardizes extracted transactions.

Responsibilities:
- Normalize dates to consistent format
- Clean description text
- Ensure amounts are positive floats
- Detect and assign debit vs credit correctly
- Remove duplicate rows
"""

import re

from app.schemas.transaction import Transaction
from app.utils.logger import get_logger

log = get_logger(__name__)


def normalize_transactions(transactions: list[Transaction]) -> list[Transaction]:
    """Clean and standardize a list of transactions."""
    normalized = []
    seen_keys: set[str] = set()

    for txn in transactions:
        txn = _clean_description(txn)
        txn = _normalize_amounts(txn)
        txn = _ensure_debit_credit(txn)

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

    log.info(
        "Normalized %d transactions (from %d raw)",
        len(normalized),
        len(transactions),
    )
    return normalized


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
