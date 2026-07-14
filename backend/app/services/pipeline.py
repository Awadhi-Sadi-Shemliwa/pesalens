"""
Pipeline orchestrator: runs the full extraction flow end-to-end.

Key design: column roles are learned from the FIRST page that has a header,
then reused across all subsequent pages. This handles continuation tables
where later pages omit the header row.
"""

import re
from pathlib import Path
from typing import Callable, Optional

from app.schemas.transaction import (
    DocumentType,
    ExtractionResult,
    StatementMetadata,
    Transaction,
)
from app.services.classifier import classify_document
from app.services.digital_extractor import extract_digital_pdf, PageExtraction
from app.services.llm_repair import repair_transactions
from app.services.normalizer import normalize_transactions
from app.services.ocr_extractor import extract_scanned_pdf
from app.services.row_builder import build_rows, ColumnMap, WordColumnMap
from app.services.validator import validate_transactions
from app.utils.logger import get_logger
from app.utils.storage import save_debug

log = get_logger(__name__)


# Rounding tolerance when comparing two balances/amounts (TZS).
_AMOUNT_EQ_TOL = 1.0


def _nearly_equal(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= _AMOUNT_EQ_TOL


def _drop_page_break_phantoms(extractions: list) -> int:
    """
    Remove pdfplumber page-break continuation artifacts.

    When a transaction's description wraps across a page boundary, pdfplumber
    can synthesise a full row at the top of the next page whose numeric
    columns duplicate the previous page's last row. Two independent signals
    identify this row; either is sufficient:

      (a) Exact-field duplicate — same (debit, credit, balance) triple as
          the immediately preceding transaction. Cannot occur in a valid
          statement: a real movement must shift the balance.

      (b) Balance-chain contradiction at the boundary — the row's balance
          equals the previous row's balance within rounding tolerance, yet
          the row claims a non-zero movement. Mathematically impossible:
          new_balance = prev_balance - debit + credit.

    Fully adaptive — derived from the running-balance invariant, no bank- or
    layout-specific keywords.

    Returns the number of phantom rows dropped.
    """
    dropped = 0
    prev_last = None
    for ext in extractions:
        page_txns = ext.page_result.transactions
        if not page_txns:
            continue

        if prev_last is not None:
            first = page_txns[0]
            movement = (first.debit or 0.0) + (first.credit or 0.0)

            exact_duplicate = (
                _nearly_equal(first.balance, prev_last.balance)
                and _nearly_equal(first.debit or 0.0, prev_last.debit or 0.0)
                and _nearly_equal(first.credit or 0.0, prev_last.credit or 0.0)
                and movement > 0
            )
            balance_frozen = (
                _nearly_equal(first.balance, prev_last.balance)
                and movement > 0
            )

            if exact_duplicate or balance_frozen:
                log.info(
                    "Dropping page-break phantom on page %d: D=%s C=%s B=%s "
                    "desc=%r (prev last: D=%s C=%s B=%s)",
                    ext.page_result.page_number,
                    first.debit, first.credit, first.balance,
                    (first.description or "")[:40],
                    prev_last.debit, prev_last.credit, prev_last.balance,
                )
                ext.page_result.transactions = page_txns[1:]
                dropped += 1
                page_txns = ext.page_result.transactions
                if not page_txns:
                    continue

        last_with_balance = next(
            (t for t in reversed(page_txns) if t.balance is not None),
            None,
        )
        if last_with_balance is not None:
            prev_last = last_with_balance
    return dropped


# Currency tokens that may sit between the label and the number
# (e.g. "OPENING BALANCE TZS 2,021,200.00", "Closing Balance KES 12,000").
_CCY = r"(?:tzs|usd|kes|ugx|tshs|ksh)?"

_AMOUNT = r"([\-+]?[\d,]+(?:\.\d+)?)"
# Greedy variant that captures every number on the rest of the line.
# Used for "Opening Balance" rows like NMB's `OPENING BALANCE 0 0 1,001`
# where the meaningful value is the LAST number (the balance column),
# not the first (the debit column showing zero).
_OPEN_BAL_LINE_RX = re.compile(
    rf"opening\s*balance[^\n\r]*", re.I,
)

_OPEN_BAL_RX = re.compile(
    rf"opening\s*balance[\s:]*{_CCY}\s*{_AMOUNT}", re.I,
)

# Closing balance — different banks call it different things. Matches:
#   "Closing Balance"            — generic / Amana / Airtel
#   "Current Balance"            — NMB footer
#   "Available Balance"          — NMB footer (treated as fallback)
#   "Ending Balance"             — some western banks
#   "Balance Carried Forward"    — older statements
_CLOSE_BAL_RX = re.compile(
    rf"(?:closing|current|available|ending)\s*balance[\s:]*{_CCY}\s*{_AMOUNT}",
    re.I,
)
_BAL_CF_RX = re.compile(
    rf"balance\s*(?:carried\s*forward|c/?f)[\s:]*{_CCY}\s*{_AMOUNT}", re.I,
)

_NUMBER_TOKEN = re.compile(r"[\-+]?[\d,]+(?:\.\d+)?")


def _last_number_on_line(line: str) -> float | None:
    """Return the LAST numeric token on a line (ignoring zeros), or None.

    For pseudo-rows like `OPENING BALANCE 0 0 1,001` the meaningful value
    is the trailing balance, not the leading zeros from the debit/credit
    columns. For a clean line like `OPENING BALANCE TZS 2,021,200.00`
    the only number is also the right answer.
    """
    nums: list[float] = []
    for tok in _NUMBER_TOKEN.findall(line):
        try:
            nums.append(float(tok.replace(",", "")))
        except ValueError:
            continue
    if not nums:
        return None
    non_zero = [n for n in nums if n != 0]
    return non_zero[-1] if non_zero else nums[-1]

# Reported totals that some banks print at the BOTTOM of the statement.
# NMB example: "Total Debit Amount: 23,598,395.75"
_TOTAL_DEBIT_RX = re.compile(
    rf"total\s*(?:debit|debits|money\s*debited|withdrawals?|paid\s*out)"
    rf"\s*(?:amount)?[\s:]*{_CCY}\s*{_AMOUNT}",
    re.I,
)
_TOTAL_CREDIT_RX = re.compile(
    rf"total\s*(?:credit|credits|money\s*credited|deposits?|paid\s*in)"
    rf"\s*(?:amount)?[\s:]*{_CCY}\s*{_AMOUNT}",
    re.I,
)


def _parse_balance(match: re.Match | None) -> float | None:
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except (ValueError, IndexError):
        return None


def _first_match_amount(rx: re.Pattern, text: str) -> float | None:
    """Return the amount from the first regex hit, or None."""
    return _parse_balance(rx.search(text))


def _extract_header_balances(
    extractions: list, metadata: StatementMetadata,
) -> None:
    """Find opening/closing balances and reported totals.

    Scans the FULL document text — banks like NMB print these summaries on
    the last page rather than in the page-1 header, so a page-1-only scan
    would miss them.
    """
    if not extractions:
        return
    full_text = "\n".join(
        (e.page_result.raw_text or "") for e in extractions
    )
    if not full_text:
        return

    if metadata.opening_balance is None:
        # Prefer the line-aware extractor: it picks the last numeric token
        # on the "Opening Balance" line, which correctly handles both
        # "OPENING BALANCE TZS 2,021,200.00" (single number) and the NMB
        # pseudo-row "OPENING BALANCE 0 0 1,001" (where 1,001 is the
        # balance and the leading zeros are the debit/credit columns).
        line_match = _OPEN_BAL_LINE_RX.search(full_text)
        if line_match:
            metadata.opening_balance = _last_number_on_line(line_match.group(0))
        if metadata.opening_balance is None:
            metadata.opening_balance = _first_match_amount(_OPEN_BAL_RX, full_text)

    if metadata.closing_balance is None:
        metadata.closing_balance = (
            _first_match_amount(_CLOSE_BAL_RX, full_text)
            or _first_match_amount(_BAL_CF_RX, full_text)
        )

    if metadata.reported_total_debits is None:
        metadata.reported_total_debits = _first_match_amount(_TOTAL_DEBIT_RX, full_text)
    if metadata.reported_total_credits is None:
        metadata.reported_total_credits = _first_match_amount(_TOTAL_CREDIT_RX, full_text)

    if metadata.opening_balance is not None:
        log.info("Parsed opening balance: %.2f", metadata.opening_balance)
    if metadata.closing_balance is not None:
        log.info("Parsed closing balance: %.2f", metadata.closing_balance)
    if metadata.reported_total_debits is not None:
        log.info("Parsed reported total debits: %.2f", metadata.reported_total_debits)
    if metadata.reported_total_credits is not None:
        log.info("Parsed reported total credits: %.2f", metadata.reported_total_credits)


# Progress callback: (stage_label, percent 0..100). Percentages are the REAL
# step boundaries; the client eases the *rendered* bar between them but clamps
# so it never exceeds the last reported value (honest-progress §89).
ProgressCallback = Callable[[str, int], None]


def _report(cb: Optional[ProgressCallback], stage: str, pct: int) -> None:
    """Best-effort progress ping — a failing callback must never break extraction."""
    if cb is None:
        return
    try:
        cb(stage, pct)
    except Exception:  # noqa: BLE001 - progress reporting is non-critical
        log.debug("progress_cb raised (ignored)", exc_info=True)


def run_extraction_pipeline(
    job_id: str,
    file_path: Path,
    progress_cb: Optional[ProgressCallback] = None,
) -> ExtractionResult:
    """Run the full extraction pipeline on a PDF file.

    `progress_cb(stage, pct)` (optional) is invoked at each step boundary so a
    caller can persist real progress for the client to poll.
    """
    log.info("=== Starting pipeline for job %s ===", job_id)

    # --- Step 1: Classify ---
    _report(progress_cb, "Reading document", 5)
    log.info("Step 1: Classifying document...")
    classification = classify_document(file_path)
    metadata = StatementMetadata(bank=classification.bank_format)

    # --- Step 2: Extract text + tables + words ---
    _report(progress_cb, "Extracting text & tables", 20)
    log.info("Step 2: Extracting text, tables, and words...")
    extractions: list[PageExtraction] = []

    if classification.document_type in (DocumentType.DIGITAL, DocumentType.MIXED):
        extractions = extract_digital_pdf(file_path, classification.page_types)

    # Scanned pages go through RapidOCR -> words+tables -> same row_builder path.
    # On MIXED PDFs this only processes pages classified as scanned; digital
    # pages stay with pdfplumber (faster and more accurate for embedded text).
    if classification.document_type in (DocumentType.SCANNED, DocumentType.MIXED):
        scanned_extractions = extract_scanned_pdf(file_path, classification.page_types)
        existing_nums = {e.page_result.page_number for e in extractions}
        for ext in scanned_extractions:
            if ext.page_result.page_number not in existing_nums:
                extractions.append(ext)

    extractions.sort(key=lambda e: e.page_result.page_number)

    # Parse opening/closing balance + reported totals. Scans the full
    # document, not just page 1, since some banks (NMB) print these
    # summaries on the LAST page rather than in the page-1 header.
    _extract_header_balances(extractions, metadata)

    # --- Step 3: Build transaction rows (with column persistence) ---
    _report(progress_cb, "Building transactions", 55)
    log.info("Step 3: Building transaction rows...")
    row_offset = 0
    table_cmap: ColumnMap | None = None
    word_cmap: WordColumnMap | None = None

    for ext in extractions:
        # Skip only pages with no extracted content (OCR unavailable or failed).
        # Scanned pages with successful OCR now carry words/tables and must flow
        # through row_builder just like digital pages.
        if ext.page_result.is_scanned and not ext.words and not ext.tables:
            continue

        ext.page_result, table_cmap, word_cmap = build_rows(
            ext.page_result,
            tables=ext.tables if ext.tables else None,
            words=ext.words if ext.words else None,
            row_offset=row_offset,
            known_table_columns=table_cmap,
            known_word_columns=word_cmap,
        )
        row_offset += len(ext.page_result.transactions)

        # Debug output per page
        save_debug(
            job_id,
            ext.page_result.page_number,
            {
                "tables_found": len(ext.tables) if ext.tables else 0,
                "words_found": len(ext.words) if ext.words else 0,
                "transactions": [t.model_dump() for t in ext.page_result.transactions],
                "skipped_lines": ext.page_result.skipped_lines[:20],
                "errors": ext.page_result.errors,
            },
        )

    # --- Step 4: Drop page-break phantom rows, then collect transactions ---
    # Runs after all pages have their rows built so we can compare each page's
    # first row against the previous page's last row. See _drop_page_break_phantoms.
    phantoms_dropped = _drop_page_break_phantoms(extractions)
    if phantoms_dropped:
        log.info("Dropped %d page-break phantom row(s)", phantoms_dropped)

    page_results = [e.page_result for e in extractions]
    all_transactions: list[Transaction] = []
    for pr in page_results:
        all_transactions.extend(pr.transactions)

    # Re-number row_index so it remains dense after phantom removal.
    for i, t in enumerate(all_transactions, start=1):
        t.row_index = i

    log.info("Collected %d raw transactions from %d pages", len(all_transactions), len(page_results))

    # --- Step 5: Normalize ---
    _report(progress_cb, "Normalizing", 72)
    log.info("Step 4: Normalizing...")
    all_transactions = normalize_transactions(all_transactions)

    # --- Step 6: Validate ---
    _report(progress_cb, "Validating balances", 82)
    log.info("Step 5: Validating...")
    all_transactions, validation_errors = validate_transactions(
        all_transactions, opening_balance=metadata.opening_balance,
    )

    # --- Step 7: LLM Repair ---
    _report(progress_cb, "Repairing & categorizing", 90)
    log.info("Step 6: LLM repair (if enabled)...")
    all_transactions = repair_transactions(all_transactions, metadata=metadata)

    # --- Build result ---
    # Report 98 (not 100) here: honest progress reserves 100% for the caller's
    # decisive completion once the result is persisted (§89 — never hit 100%
    # before the operation truly resolves).
    _report(progress_cb, "Finalizing", 98)
    result = ExtractionResult(
        job_id=job_id,
        filename=file_path.name,
        document_type=classification.document_type,
        metadata=metadata,
        pages=page_results,
        transactions=all_transactions,
        total_pages=classification.total_pages,
        total_transactions=len(all_transactions),
        validation_passed=len(validation_errors) == 0,
        validation_errors=validation_errors,
    )

    log.info(
        "=== Pipeline complete: %d transactions, %d errors ===",
        result.total_transactions, len(validation_errors),
    )
    return result
