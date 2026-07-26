"""
Document classifier: detects if PDF is digital or scanned,
and identifies the bank format from text content.

Bank detection strategy (in priority order):
  1. STRONG header patterns — bank name in the first page's title/header area
     (the portion *before* the transactions begin). This prevents false
     positives where a bank name is mentioned inside a transaction
     description (e.g. "Sent to ... AIRTEL MONEY" on a Selcom statement).
  2. SECONDARY product-name patterns — unique product/feature names that
     only one bank uses (e.g. "Kibubu" for Selcom, "Mixx By Yas" for Yas).
  3. STRUCTURAL fingerprints — combinations of phrasing, column headers,
     USSD codes, and transaction-reference formats that are unique to
     one provider's statement layout. Catches PDFs where the brand name
     only appears as a logo image (no extractable text).
  4. WEAK description patterns — full-text brand-word search.
  5. FILENAME hints — last resort: many providers export with their brand
     in the filename (e.g. "Airtel Money Statement-...pdf").
"""

import re
from pathlib import Path

import pdfplumber

from app.schemas.transaction import (
    BankFormat,
    ClassificationResult,
    DocumentType,
)
from app.utils.logger import get_logger

log = get_logger(__name__)

# Minimum characters on a page to consider it "digital" (has embedded text)
MIN_TEXT_LENGTH = 50

# --- Embedded-text-layer quality gate -------------------------------------
# Some scans ship with a text layer produced by the scanner's own (bad) OCR:
# the page renders fine visually but extract_text() yields mojibake like
# "CL}STOM HR AGC*{J $-;? STATE F*I H}dT". Such pages pass the MIN_TEXT_LENGTH
# check and would be treated as digital, feeding garbage to the row builder
# and bank detector. The quality score below separates them: it is the ratio
# of tokens that look like real content (words, dates, amounts). Mojibake
# scores ~0.25-0.35; clean statement text scores 0.75+.
_GOOD_WORD_RX = re.compile(r"^[A-Za-z]{2,}$")
_GOOD_DATE_RX = re.compile(r"^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$")
_GOOD_AMT_RX = re.compile(r"^-?[\d,]+(?:\.\d{1,2})?$")
# Reference codes, account numbers and product names are real statement
# content even though they are neither words nor amounts: "FT26183ABCD01",
# "M-PESA", "A/C", "01-2345-6789". They are recognised by what they DON'T
# contain — mojibake is distinguished by stray symbols ("H}dT", "q@w", "*{J"),
# so a token built only from letters, digits and the separators a bank
# actually prints counts as content. Without this a reference-dense statement
# scores as junk and has its perfectly good text layer thrown away.
_GOOD_CODE_RX = re.compile(r"^[A-Za-z0-9]+(?:[/\-][A-Za-z0-9]+)+$|^[A-Za-z0-9]{3,}$")
_TOKEN_TRIM = ".,:;()[]{}%*'\"«»"

# Below this the page's text layer is junk regardless of anything else.
GARBLED_QUALITY_MIN = 0.45
# Below this AND the page is dominated by a single full-page image (i.e. it is
# visually a scan), the text layer is not trusted either.
GARBLED_BORDERLINE = 0.65
FULL_PAGE_IMAGE_COVERAGE = 0.80
# Scores need a minimum token count to be meaningful.
_MIN_QUALITY_TOKENS = 10


def text_quality(text: str) -> float:
    """Score an embedded text layer 0..1 by the ratio of recognizable tokens.

    A token counts as recognizable when (after trimming surrounding
    punctuation) it is a plain alphabetic word, a date, an amount, or a
    reference/account code. Returns 1.0 for very short inputs
    (< _MIN_QUALITY_TOKENS tokens) — too little signal to condemn a page, and
    short pages are cheap to parse anyway.

    Erring towards "readable" is deliberate: a false GARBLED verdict discards
    a page's real text, and if OCR is unavailable that turns a statement which
    used to extract into one that fails.
    """
    tokens = text.split()
    if len(tokens) < _MIN_QUALITY_TOKENS:
        return 1.0
    good = 0
    for tok in tokens:
        tok = tok.strip(_TOKEN_TRIM)
        if not tok:
            continue
        if (
            _GOOD_WORD_RX.match(tok)
            or _GOOD_DATE_RX.match(tok)
            or _GOOD_AMT_RX.match(tok)
            or _GOOD_CODE_RX.match(tok)
        ):
            good += 1
    return good / len(tokens)


def _page_image_coverage(page) -> float:
    """Largest single embedded image's area as a fraction of the page area.

    A page that is one big photo (a scan) scores ~1.0; a digital statement
    with a small logo scores near 0.
    """
    try:
        page_area = float(page.width) * float(page.height)
        if page_area <= 0:
            return 0.0
        best = 0.0
        for img in page.images or []:
            w = abs(float(img.get("x1", 0)) - float(img.get("x0", 0)))
            h = abs(float(img.get("bottom", 0)) - float(img.get("top", 0)))
            best = max(best, (w * h) / page_area)
        return best
    except Exception:  # noqa: BLE001 - defensive: never let scoring break classify
        return 0.0

# Header area size: look for bank name in the first N chars of page 1
# (the part above the transaction table — usually logo, title, customer info).
HEADER_CHARS = 600

# ---------- STRONG patterns (scanned only within page-1 header) ----------
# These are statement titles / explicit bank mentions that a bank puts at
# the top of its own statement. They must NOT appear in rival banks'
# transaction descriptions.
STRONG_HEADER_PATTERNS: list[tuple[str, BankFormat]] = [
    (r"m[\-\s]*pesa\s*statement", BankFormat.MPESA),
    (r"airtel\s*money\s*statement", BankFormat.AIRTEL_MONEY),
    (r"tigo\s*pesa\s*statement", BankFormat.TIGO_PESA),
    (r"halo\s*pesa\s*statement", BankFormat.HALO_PESA),
    (r"mixx\s*by\s*yas|yas\s*pesa|\byas\b\s*(statement|wallet)", BankFormat.YAS),
    (r"selcom\s*(pesa|bank|microfinance)", BankFormat.SELCOM),
    (r"crdb\s*(bank|plc|microfinance)?", BankFormat.CRDB),
    (r"nmb\s*(bank|plc)?", BankFormat.NMB),
    (r"nbc\s*(bank|limited)?", BankFormat.NBC),
    (r"kcb\s*(bank)?", BankFormat.KCB),
    (r"absa\s*(bank)?", BankFormat.ABSA),
    (r"amana\s*(bank)?", BankFormat.AMANA),
    # Plain brand words — acceptable inside the header area
    (r"\bairtel\s*money\b", BankFormat.AIRTEL_MONEY),
    (r"\bm[\-\s]*pesa\b", BankFormat.MPESA),
    (r"\bhalo\s*pesa\b", BankFormat.HALO_PESA),
    (r"\btigo\s*pesa\b", BankFormat.TIGO_PESA),
    (r"\bselcom\b", BankFormat.SELCOM),
]

# ---------- SECONDARY patterns (product names unique to one bank) ----------
# Scanned across full text. These are distinctive enough that they won't
# appear in another bank's statement as a description.
SECONDARY_PATTERNS: list[tuple[str, BankFormat]] = [
    # Selcom products: "Kibubu" (savings), "SP TIPS" (Selcom Pesa TIPS),
    # "SP Kibubu", "SP-Primary" (product code), "SP Transaction Charge"
    (r"\bkibubu\b|sp\s*tips|sp[-\s]primary|sp\s*transaction\s*charge", BankFormat.SELCOM),
    # Yas / Mixx / Zantel products: Mixx wallet, Zantel branding, social handles
    (r"mixx\s*by\s*yas|tips[-\s]mixx|zantel|yas_tz|yas[_\s]*tanzania", BankFormat.YAS),
    # M-Pesa specific Swahili header keywords (Tarehe ya Muamala etc.
    # are generic; "Vodacom" brand word is the tell)
    (r"vodacom\s*m[\-\s]*pesa", BankFormat.MPESA),
]

# ---------- STRUCTURAL fingerprints (statement-layout patterns) ----------
# Each entry: (list of regexes that must ALL match anywhere in the full text,
# bank, confidence). These catch PDFs where the brand name only exists as an
# image/logo. Patterns are chosen so they cannot reasonably co-occur in
# another provider's statement.
STRUCTURAL_PATTERNS: list[tuple[list[str], BankFormat, float]] = [
    # Airtel Money Tanzania: distinctive phrasing + columns + USSD + ref-code
    # format. The Airtel app exports with phrases like "Money Deposit to",
    # "Money Withdrawn from", "Money Sent to" combined with the column header
    # "Credited Debited Balance", USSD shortcode *000#, and reference IDs
    # like CI260327.1413.K25607 / CO.../MP.../PP...
    (
        [
            r"money\s+(deposit|withdrawn|sent)\s+(to|from)",
            r"credited\s+debited\s+balance",
        ],
        BankFormat.AIRTEL_MONEY, 0.9,
    ),
    (
        [r"\*000#", r"balance\s+statement\s+for\s+the\s+period"],
        BankFormat.AIRTEL_MONEY, 0.9,
    ),
    (
        [r"\b(?:CI|CO|MP|PP)\d{6}\.\d{4}\.[A-Z]\d{4,6}\b"],
        BankFormat.AIRTEL_MONEY, 0.85,
    ),
    # M-Pesa Tanzania: Vodacom-issued statements
    (
        [r"tarehe\s+ya\s+muamala|transaction\s+date.*receipt", r"vodacom"],
        BankFormat.MPESA, 0.85,
    ),
]

# ---------- WEAK fallback patterns (full-text, last resort) ----------
# Only used when STRONG, SECONDARY, and STRUCTURAL all fail. Ordered so that
# proper banks (CRDB, NMB, etc.) beat mobile-money brands that often appear
# in transaction descriptions on bank statements.
WEAK_PATTERNS: list[tuple[str, BankFormat]] = [
    (r"\bcrdb\b", BankFormat.CRDB),
    (r"\bnmb\b", BankFormat.NMB),
    (r"\bnbc\b", BankFormat.NBC),
    (r"\bkcb\b", BankFormat.KCB),
    (r"\babsa\b", BankFormat.ABSA),
    (r"\bamana\b", BankFormat.AMANA),
    (r"airtel\s*money|airtel\s*africa", BankFormat.AIRTEL_MONEY),
    (r"\bm[\-\s]*pesa\b", BankFormat.MPESA),
    (r"tigo\s*pesa|millicom", BankFormat.TIGO_PESA),
    (r"halo\s*pesa|\bviettel\b", BankFormat.HALO_PESA),
    (r"\bselcom\b", BankFormat.SELCOM),
]

# ---------- FILENAME hints ----------
# Many providers export with their brand in the filename. Used only after
# all text-based detection has failed.
FILENAME_PATTERNS: list[tuple[str, BankFormat]] = [
    (r"airtel\s*money|airtel[\s_-]+statement", BankFormat.AIRTEL_MONEY),
    (r"m[\-\s_]*pesa", BankFormat.MPESA),
    (r"tigo\s*pesa", BankFormat.TIGO_PESA),
    (r"halo\s*pesa", BankFormat.HALO_PESA),
    (r"mixx\s*by\s*yas|\byas\b", BankFormat.YAS),
    (r"\bselcom\b", BankFormat.SELCOM),
    (r"\bcrdb\b", BankFormat.CRDB),
    (r"\bnmb\b", BankFormat.NMB),
    (r"\bnbc\b", BankFormat.NBC),
    (r"\bkcb\b", BankFormat.KCB),
    (r"\babsa\b", BankFormat.ABSA),
    (r"\bamana\b", BankFormat.AMANA),
]


def _extract_header_area(page1_text: str) -> str:
    """
    Return the portion of the first page BEFORE the first transaction row.
    A transaction row is heuristically detected as a line that starts with
    a date pattern (e.g. "01/01/2026", "2026-04-02", "01-Sep-25").
    """
    if not page1_text:
        return ""

    date_rx = re.compile(
        r"^\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4}|"
        r"\d{4}[\-/.]\d{1,2}[\-/.]\d{1,2}|"
        r"\d{1,2}[\-\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))",
        re.I,
    )
    header_lines: list[str] = []
    for line in page1_text.splitlines():
        if date_rx.match(line):
            break
        header_lines.append(line)
    header = "\n".join(header_lines)
    # Also cap to a fixed prefix to avoid catching multi-screen headers
    return header[:HEADER_CHARS]


def _detect_bank(
    page1_text: str, full_text: str, filename: str = ""
) -> tuple[BankFormat, float]:
    """Run the 5-tier bank detection cascade."""
    header = _extract_header_area(page1_text)

    for pattern, bank in STRONG_HEADER_PATTERNS:
        if re.search(pattern, header, re.I):
            log.info("Bank matched by STRONG header pattern: %s", bank.value)
            return bank, 0.95

    for pattern, bank in SECONDARY_PATTERNS:
        if re.search(pattern, full_text, re.I):
            log.info("Bank matched by SECONDARY pattern: %s", bank.value)
            return bank, 0.8

    for patterns, bank, conf in STRUCTURAL_PATTERNS:
        if all(re.search(p, full_text, re.I) for p in patterns):
            log.info("Bank matched by STRUCTURAL fingerprint: %s", bank.value)
            return bank, conf

    for pattern, bank in WEAK_PATTERNS:
        if re.search(pattern, full_text, re.I):
            log.info("Bank matched by WEAK pattern: %s", bank.value)
            return bank, 0.5

    if filename:
        for pattern, bank in FILENAME_PATTERNS:
            if re.search(pattern, filename, re.I):
                log.info("Bank matched by FILENAME hint: %s", bank.value)
                return bank, 0.45

    return BankFormat.UNKNOWN, 0.0


def classify_document(file_path: Path) -> ClassificationResult:
    """
    Classify a PDF: determine if it's digital/scanned and identify the bank.
    """
    page_types: list[DocumentType] = []
    all_text_parts: list[str] = []
    garbled_pages: list[int] = []
    total_pages = 0

    try:
        with pdfplumber.open(file_path) as pdf:
            total_pages = len(pdf.pages)

            for i, page in enumerate(pdf.pages):
                try:
                    text = page.extract_text() or ""
                except Exception as e:
                    log.warning("Failed to extract text from page %d: %s", i + 1, e)
                    text = ""

                if len(text.strip()) >= MIN_TEXT_LENGTH:
                    quality = text_quality(text)
                    if quality < GARBLED_QUALITY_MIN or (
                        quality < GARBLED_BORDERLINE
                        and _page_image_coverage(page) >= FULL_PAGE_IMAGE_COVERAGE
                    ):
                        # Scanner-embedded junk text layer: route to OCR and
                        # keep the mojibake away from bank detection.
                        log.info(
                            "Page %d text layer is garbled (quality=%.2f) — "
                            "treating as scanned",
                            i + 1, quality,
                        )
                        page_types.append(DocumentType.SCANNED)
                        garbled_pages.append(i + 1)
                        all_text_parts.append("")
                    else:
                        page_types.append(DocumentType.DIGITAL)
                        all_text_parts.append(text)
                else:
                    page_types.append(DocumentType.SCANNED)
                    all_text_parts.append("")

    except Exception as e:
        log.error("Failed to open PDF: %s", e)
        return ClassificationResult(
            document_type=DocumentType.SCANNED,
            bank_format=BankFormat.UNKNOWN,
            confidence=0.0,
            total_pages=0,
        )

    # --- Determine overall document type ---
    digital_count = page_types.count(DocumentType.DIGITAL)
    scanned_count = page_types.count(DocumentType.SCANNED)

    if digital_count == total_pages:
        doc_type = DocumentType.DIGITAL
    elif scanned_count == total_pages:
        doc_type = DocumentType.SCANNED
    else:
        doc_type = DocumentType.MIXED

    # --- Detect bank format from text (with filename as last-resort hint) ---
    page1_text = all_text_parts[0] if all_text_parts else ""
    combined_text = "\n".join(all_text_parts)
    bank_format, bank_confidence = _detect_bank(
        page1_text, combined_text, file_path.name
    )

    # Overall confidence
    confidence = 1.0 if doc_type == DocumentType.DIGITAL else 0.7
    if bank_format == BankFormat.UNKNOWN:
        confidence *= 0.5

    sample_text = combined_text[:500] if combined_text else ""

    result = ClassificationResult(
        document_type=doc_type,
        bank_format=bank_format,
        confidence=round(confidence, 2),
        page_types=page_types,
        total_pages=total_pages,
        sample_text=sample_text,
        garbled_pages=garbled_pages,
    )

    log.info(
        "Classification: type=%s, bank=%s, pages=%d (digital=%d, scanned=%d, garbled=%d)",
        doc_type.value,
        bank_format.value,
        total_pages,
        digital_count,
        scanned_count,
        len(garbled_pages),
    )

    return result
