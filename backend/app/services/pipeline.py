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
    BankFormat,
    DocumentType,
    ExtractionResult,
    StatementMetadata,
    Transaction,
)
from app.services.analytics import compute_metrics
from app.services.classifier import _detect_bank, classify_document, text_quality
from app.services.digital_extractor import extract_digital_pdf, PageExtraction
from app.services.llm_repair import repair_transactions
from app.services.normalizer import normalize_transactions
from app.services.ocr_extractor import extract_scanned_pdf, is_ocr_available
from app.services.row_builder import (
    ColumnMap,
    WordColumnMap,
    build_rows,
    finalize_carried_word_txn,
)
from app.services.validator import validate_transactions
from app.utils.logger import get_logger
from app.utils.storage import save_debug

log = get_logger(__name__)


# Rounding tolerance when comparing two balances/amounts (TZS).
_AMOUNT_EQ_TOL = 1.0

# How much cleaner the embedded text must be than OCR's before we reinstate a
# garbled page's embedded layer (text_quality units, 0..1). A margin keeps true
# scanner-junk pages — where OCR is the better layer — on OCR, and only rescues
# pages OCR clearly degraded.
_RECOVERY_QUALITY_MARGIN = 0.15


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


def _compute_extraction_metrics(
    transactions: list[Transaction], metadata: StatementMetadata,
) -> dict:
    """Self-check numbers stored on the result: do the rows add up to the
    balance movement the statement itself claims?

    Thin adapter over `analytics.compute_metrics`, which owns the arithmetic so
    the review-queue PATCH recomputes exactly the same numbers this pipeline
    wrote. Model → dict here rather than dict → model there, because the
    review queue reads results back off disk as plain JSON.
    """
    return compute_metrics(
        [t.model_dump(mode="json") for t in transactions],
        metadata.model_dump(mode="json"),
    )


def _recover_garbled_pages(
    file_path: Path,
    garbled_pages: list[int],
    extractions: list[PageExtraction],
) -> None:
    """Reinstate the embedded text of garbled pages wherever it beats OCR.

    Mutates `extractions` in place. A page is flagged garbled when its embedded
    text scores below the quality bar and is then routed to OCR. But that bar
    false-positives on dense digital pages (reference-number columns,
    single-letter headers): their embedded layer is actually fine. On such a
    page OCR can come back EMPTY or as *worse* text, and blindly keeping OCR's
    output would degrade a page that parsed cleanly before.

    So we re-extract the embedded (pdfplumber) text for every garbled page and
    restore it wherever it is at least as good as what OCR produced — either OCR
    read nothing, or the embedded text is clearly higher quality (a false garbled
    flag). OCR wins only when it is genuinely better, e.g. a real scanner-junk
    layer, which `text_quality` — the same metric that flagged the page — scores
    above the rejected embedded layer.

    A reinstated page is marked `is_scanned=True` even though the text came from
    pdfplumber: it stays on the OCR-tolerant row-building path (fuzzy amount/date
    parsing, amount-column calibration) and participates in balance-chain
    reconciliation — not the strict digital path, which would parse any residual
    mojibake as-is.
    """
    if not garbled_pages:
        return
    garbled = set(garbled_pages)

    # OCR's own result for each garbled page, to compare against below.
    ocr_by_page = {
        e.page_result.page_number: e
        for e in extractions
        if e.page_result.page_number in garbled
    }

    # Re-extract the embedded text for every garbled page: mark them DIGITAL and
    # everything else SCANNED so the extractor skips the rest. The list must span
    # the WHOLE document — extract_digital_pdf treats an out-of-range index as
    # "not scanned" and re-extracts it, so a list sized to max(garbled) would
    # leave every page after the last garbled one re-extracted (then discarded)
    # on each recovery. Size to the real page count so trailing pages are
    # explicitly SCANNED and skipped.
    total_pages = max(
        (e.page_result.page_number for e in extractions), default=max(garbled)
    )
    with_text = [
        DocumentType.DIGITAL if (i + 1) in garbled else DocumentType.SCANNED
        for i in range(total_pages)
    ]
    try:
        recovered = extract_digital_pdf(file_path, with_text)
    except Exception:  # noqa: BLE001 - a failed rescue must not fail the job
        log.warning("Could not recover garbled page text", exc_info=True)
        return

    embedded_by_page = {
        e.page_result.page_number: e
        for e in recovered
        if e.page_result.page_number in garbled
        and (e.page_result.raw_text or "").strip()
    }
    if not embedded_by_page:
        return

    # Per page, decide whether the embedded layer should replace OCR's output.
    restore: dict[int, tuple[PageExtraction, str]] = {}
    for page, embedded in embedded_by_page.items():
        ocr = ocr_by_page.get(page)
        ocr_txt = (ocr.page_result.raw_text or "").strip() if ocr else ""
        ocr_structured = bool(ocr and (ocr.words or ocr.tables))
        if not ocr_txt and not ocr_structured:
            # OCR read nothing at all — the embedded layer is all we have.
            restore[page] = (embedded, "OCR read nothing")
            continue
        # OCR produced output; keep it UNLESS the embedded layer is clearly the
        # better one (a false garbled flag on a dense digital page). A genuine
        # scanner-junk layer scores below its OCR, so it never wins here.
        emb_q = text_quality(embedded.page_result.raw_text or "")
        ocr_q = text_quality(ocr_txt) if ocr_txt else 0.0
        if emb_q >= ocr_q + _RECOVERY_QUALITY_MARGIN:
            restore[page] = (
                embedded,
                f"embedded text cleaner than OCR (quality {emb_q:.2f} vs {ocr_q:.2f})",
            )

    if not restore:
        return

    index_by_page = {
        e.page_result.page_number: i for i, e in enumerate(extractions)
    }
    for page, (embedded, reason) in restore.items():
        idx = index_by_page.get(page)
        if idx is None:
            continue
        embedded.page_result.errors.append(
            f"Text layer looked garbled but was reinstated — {reason}"
        )
        embedded.page_result.confidence = min(
            embedded.page_result.confidence, 0.5
        )
        # Garbled/reinstated text: route through the OCR-tolerant build/solve path.
        embedded.page_result.is_scanned = True
        extractions[idx] = embedded
    log.info(
        "Reinstated embedded text for %d garbled page(s): %s",
        len(restore), sorted(restore),
    )


def _flush_word_carry(carry: dict, last_built, row_offset: int) -> bool:
    """Finalize a carried word-mode transaction onto the page it belongs to.

    `last_built` is the most recent PageExtraction that went through
    build_rows — the carry started on (or merged through) that page, so
    appending there keeps chronological order in the flattened list.

    Returns whether a transaction was actually appended, because the caller
    advances `row_offset` and there are two paths that append nothing: no page
    has been built yet, and a carry too empty to finalize (no description, no
    date, no amounts). Incrementing unconditionally leaves a hole in the
    indices handed to the next build_rows. The pipeline renumbers row_index
    globally before anything reads it, so today the gap is invisible — but
    handing out a wrong offset is a trap for the next reader, the same one
    _prepend_carried_txn documents and closes.
    """
    if last_built is None:
        return False
    txn = finalize_carried_word_txn(carry, row_offset + 1)
    if not txn:
        return False
    last_built.page_result.transactions.append(txn)
    return True


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
    scanned_page_count = sum(
        1 for t in classification.page_types if t == DocumentType.SCANNED
    )
    ocr_was_unavailable = False
    if classification.document_type in (DocumentType.SCANNED, DocumentType.MIXED):
        scanned_extractions = extract_scanned_pdf(
            file_path,
            classification.page_types,
            progress_cb=lambda s, p: _report(progress_cb, s, p),
        )
        ocr_was_unavailable = not is_ocr_available()
        existing_nums = {e.page_result.page_number for e in extractions}
        for ext in scanned_extractions:
            if ext.page_result.page_number not in existing_nums:
                extractions.append(ext)

        # A page rejected as "garbled" was reclassified on the strength of its
        # text layer looking like mojibake — but that text still exists, and
        # the classifier's verdict is a heuristic. If OCR then read nothing
        # from the page (engine missing, or it recognised nothing), throwing
        # the layer away leaves the page with NO reading at all, and a
        # statement that used to extract fine fails outright. Put the rejected
        # text back in that case: a doubtful reading is worth more than none,
        # and every stage downstream is already built to flag what it can't
        # verify.
        if classification.garbled_pages:
            _recover_garbled_pages(
                file_path, classification.garbled_pages, extractions,
            )

    extractions.sort(key=lambda e: e.page_result.page_number)

    # OCR text is a second chance at bank identity: a fully-scanned statement
    # has no extractable text at classification time (or only a garbled
    # layer), so the cascade ran on empty input. Re-run it on what OCR read.
    if metadata.bank == BankFormat.UNKNOWN and extractions:
        ocr_full_text = "\n".join(
            (e.page_result.raw_text or "") for e in extractions
        )
        ocr_page1_text = next(
            (
                e.page_result.raw_text or ""
                for e in extractions
                if e.page_result.page_number == 1
            ),
            "",
        )
        bank, bank_conf = _detect_bank(ocr_page1_text, ocr_full_text, file_path.name)
        if bank != BankFormat.UNKNOWN:
            log.info(
                "Bank re-detected from OCR text: %s (%.2f)", bank.value, bank_conf
            )
            metadata.bank = bank

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
    # Open word-mode transaction spanning a page boundary (scanned docs):
    # its date line is on one page, continuation/amount lines on the next.
    word_carry: dict | None = None
    last_built = None

    for ext in extractions:
        # Skip only pages with no extracted content (OCR unavailable or failed).
        # Scanned pages with successful OCR now carry words/tables and must flow
        # through row_builder just like digital pages.
        if ext.page_result.is_scanned and not ext.words and not ext.tables:
            continue

        # A pending scanned-page carry must not leak into a digital page's
        # build — flush it into the page it started on.
        if word_carry and not ext.page_result.is_scanned:
            if _flush_word_carry(word_carry, last_built, row_offset):
                row_offset += 1
            word_carry = None

        ext.page_result, table_cmap, word_cmap, word_carry = build_rows(
            ext.page_result,
            tables=ext.tables if ext.tables else None,
            words=ext.words if ext.words else None,
            row_offset=row_offset,
            known_table_columns=table_cmap,
            known_word_columns=word_cmap,
            is_scanned=ext.page_result.is_scanned,
            word_carry_in=word_carry,
        )
        last_built = ext
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

    # Flush the document's final open word-mode transaction (scanned docs).
    if word_carry:
        _flush_word_carry(word_carry, last_built, row_offset)
        word_carry = None

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

    # --- Step 5b: Balance-chain reconciliation (scanned documents only) ---
    # The running balance is the statement's own checksum; the solver uses it
    # to confirm rows, fix flipped directions, repair OCR-truncated amounts,
    # and recover opening/closing balances that the garbled labels hid.
    #
    # Gate on the pages that actually PRODUCED rows, not on the classifier's
    # `scanned_page_count`. The solver mutates readings (flips directions,
    # rewrites amounts) to satisfy the chain, which is only ever right for OCR'd
    # rows — its contract is "digital extractions never enter here". On a MIXED
    # document a single scanned/garbled page must not drag correctly-read
    # DIGITAL rows onto that path, so we run it only when every row is
    # scanned-origin (the balance chain also needs a contiguous sequence, which
    # interleaved digital rows would break). Genuinely-mixed documents skip the
    # solver; their scanned OCR errors are surfaced by normal validation below.
    scanned_page_nums = {
        e.page_result.page_number
        for e in extractions
        if e.page_result.is_scanned
    }
    has_digital_rows = any(
        t.page_number not in scanned_page_nums for t in all_transactions
    )
    chain_solved = False
    if scanned_page_nums and not has_digital_rows and all_transactions:
        from app.services.chain_solver import solve_balance_chain
        outcome = solve_balance_chain(
            all_transactions, opening_balance=metadata.opening_balance,
        )
        all_transactions = outcome.transactions
        chain_solved = True
        if metadata.opening_balance is None:
            metadata.opening_balance = outcome.opening_balance
        if metadata.closing_balance is None:
            metadata.closing_balance = outcome.closing_balance

    # --- Step 6: Validate ---
    _report(progress_cb, "Validating balances", 82)
    log.info("Step 5: Validating...")
    all_transactions, validation_errors = validate_transactions(
        all_transactions, opening_balance=metadata.opening_balance,
        chain_already_solved=chain_solved,
    )

    # --- Step 7: LLM Repair ---
    _report(progress_cb, "Repairing & categorizing", 90)
    log.info("Step 6: LLM repair (if enabled)...")
    all_transactions = repair_transactions(all_transactions, metadata=metadata)

    # --- Self-check metrics: does the money add up? ---
    metrics = _compute_extraction_metrics(all_transactions, metadata)
    if metrics.get("net_vs_span_diff") is not None and abs(metrics["net_vs_span_diff"]) > _AMOUNT_EQ_TOL:
        validation_errors.append(
            f"Net flow {metrics['net_flow']:,.2f} differs from balance span "
            f"{metrics['balance_span']:,.2f} by {metrics['net_vs_span_diff']:,.2f}"
        )
    log.info("Extraction metrics: %s", metrics)

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
        metrics=metrics,
        scanned_pages=scanned_page_count,
        garbled_pages=len(classification.garbled_pages),
        ocr_unavailable=ocr_was_unavailable and scanned_page_count > 0,
        validation_passed=len(validation_errors) == 0,
        validation_errors=validation_errors,
    )

    log.info(
        "=== Pipeline complete: %d transactions, %d errors ===",
        result.total_transactions, len(validation_errors),
    )
    return result
