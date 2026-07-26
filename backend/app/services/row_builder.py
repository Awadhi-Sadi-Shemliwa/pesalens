"""
Adaptive Row Reconstruction Engine

Two-tier strategy, both fully adaptive (no hardcoded bank formats):

  TIER 1 — TABLE MODE (pdfplumber tables):
    - Detect header row automatically (may not be row 0)
    - Learn column roles from header keywords
    - Persist roles across pages for continuation tables
    - Handle multi-line cells, currency prefixes, various date formats

  TIER 2 — WORD-POSITION MODE (pdfplumber words with coordinates):
    - Extract words with bounding boxes
    - Detect header row and learn column x-boundaries
    - Assign each word to its column by x-position
    - Group words into rows by y-position
    - Merge continuation lines (same transaction, no date)

Design principles:
  - Zero hardcoded bank-specific logic
  - Column roles are LEARNED from the header, not assumed
  - Date parsing tries ALL common formats automatically
  - Phone numbers / references are distinguished from amounts by column position
  - Confidence scoring reflects extraction quality
"""

import difflib
import re
from datetime import date
from dataclasses import dataclass, field

from app.schemas.transaction import PageResult, Transaction
from app.utils.logger import get_logger

log = get_logger(__name__)

# ────────────────────────────────────────────────────────────────────
# DATE PARSING — tries all formats, no hardcoding
# ────────────────────────────────────────────────────────────────────

MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_DATE_REGEXES = [
    # YYYY-MM-DD
    (re.compile(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})"), "ymd"),
    # DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    (re.compile(r"(\d{1,2})[-./](\d{1,2})[-./](\d{4})"), "dmy"),
    # DD/MM/YY or DD-MM-YY or DD.MM.YY
    (re.compile(r"(\d{1,2})[-./](\d{1,2})[-./](\d{2})\b"), "dmy_short"),
    # DD Mon YYYY or DD-Mon-YYYY
    (re.compile(r"(\d{1,2})[\s\-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-](\d{4})", re.I), "dmon"),
]


def parse_date(text: str) -> date | None:
    """Try all date formats. Returns first successful parse or None."""
    if not text:
        return None
    # Take only the first line (cells can have date\ntime)
    first_line = text.strip().split("\n")[0].strip()

    for rx, fmt in _DATE_REGEXES:
        m = rx.search(first_line)
        if not m:
            continue
        try:
            g = m.groups()
            if fmt == "ymd":
                return date(int(g[0]), int(g[1]), int(g[2]))
            elif fmt == "dmy":
                return date(int(g[2]), int(g[1]), int(g[0]))
            elif fmt == "dmy_short":
                y = int(g[2])
                return date(y + 2000 if y < 100 else y, int(g[1]), int(g[0]))
            elif fmt == "dmon":
                month = MONTH_MAP.get(g[1].lower()[:3])
                if month:
                    return date(int(g[2]), month, int(g[0]))
        except ValueError:
            continue
    return None


# Time-of-day token: 24h "13:40" or 12h "1:40 pm" (optional seconds). Anchored
# on a colon between an hour and minute so it doesn't grab commas/periods from
# amounts or the dots in reference codes (e.g. CI260327.1413.K25607).
_TIME_RX = re.compile(
    r"\b(?P<h>[01]?\d|2[0-3]):(?P<m>[0-5]\d)(?::[0-5]\d)?\s*(?P<ap>[ap]\.?m\.?)?",
    re.I,
)


def parse_time(text: str) -> str | None:
    """Extract a 24h "HH:MM" time-of-day from a cell / raw row, or None.

    Mobile-money statements (M-Pesa/Airtel/Selcom/Tigo/Halo/Yas) print a
    "Date & Time" column; most banks omit it. Best-effort — the value is only a
    reconciliation tiebreaker, so a miss (or a rare false positive on a colon in
    a description) is harmless. Handles 24h ("13:40") and 12h am/pm ("1:40 pm").
    """
    if not text:
        return None
    for m in _TIME_RX.finditer(text):
        h = int(m.group("h"))
        minute = int(m.group("m"))
        ap = (m.group("ap") or "").lower().replace(".", "")
        if ap == "pm" and h < 12:
            h += 12
        elif ap == "am" and h == 12:
            h = 0
        if 0 <= h <= 23 and 0 <= minute <= 59:
            return f"{h:02d}:{minute:02d}"
    return None


# ────────────────────────────────────────────────────────────────────
# AMOUNT PARSING — strips currency prefixes, handles commas
# ────────────────────────────────────────────────────────────────────

_CURRENCY_PREFIX = re.compile(r"^[A-Z]{2,4}\s*", re.I)
_CLEAN_AMOUNT = re.compile(r"[^\d.\-]")


def parse_amount(text: str) -> float | None:
    """Parse monetary amount from text. Handles 'TZS 1,234.00', '1234', '0.00'.

    Strict: a dot is always a decimal point. This is the DIGITAL path, where the
    cell is machine-readable and '1.234' means one-point-two-three-four. The
    dot-as-thousands-separator repairs live in `parse_amount_ocr`, which is the
    only place a period can be assumed to be a misread comma.
    """
    return _parse_amount(text, ocr_grouping=False)


def _parse_amount(text: str, *, ocr_grouping: bool) -> float | None:
    """Shared amount parse. `ocr_grouping` enables dot-as-thousands repair.

    With `ocr_grouping`, a period may be a comma that OCR misread, so
    '51.266.685.17' reads as 51,266,685.17 and '366.100' as 366,100. Applying
    that to a digital cell would silently multiply a genuine 3-decimal value
    (a unit price, an FX rate) by 1000 — hence the flag.
    """
    if not text:
        return None
    # Take first line only
    cleaned = text.strip().split("\n")[0].strip()
    cleaned = _CURRENCY_PREFIX.sub("", cleaned)
    cleaned = cleaned.replace(",", "").strip()
    if not cleaned or cleaned == "-" or cleaned == "—":
        return None
    if ocr_grouping and cleaned.count(".") > 1:
        parts = cleaned.split(".")
        # Genuine thousands grouping: every middle group has exactly 3 digits
        # ("51.266.685.17"). Anything else (e.g. the date "07.06.2026") is NOT
        # an amount — bail out rather than fabricate a number.
        has_decimals = len(parts[-1]) <= 2
        groups = parts[1:-1] if has_decimals else parts[1:]
        if not all(len(g) == 3 and g.isdigit() for g in groups):
            return None
        cleaned = (
            "".join(parts[:-1]) + "." + parts[-1] if has_decimals
            else "".join(parts)
        )
    elif ocr_grouping and cleaned.count(".") == 1:
        # "366.100": statement amounts never carry 3 decimal places, so a
        # single dot followed by exactly 3 digits is a thousands separator
        # (OCR reads the grouping comma as a period).
        whole, frac = cleaned.split(".")
        if len(frac) == 3 and frac.isdigit() and whole.lstrip("-").isdigit():
            cleaned = whole + frac
    try:
        val = float(cleaned)
        return val if val != 0.0 else None
    except ValueError:
        return None


# ────────────────────────────────────────────────────────────────────
# OCR-TOLERANT PRIMITIVES — used only on scanned pages (is_scanned=True)
# ────────────────────────────────────────────────────────────────────

# OCR letter→digit confusions seen in scanned Tanzanian statements.
_OCR_DIGIT_FIX = str.maketrans({
    "O": "0", "o": "0", "l": "1", "I": "1", "S": "5",
    "Z": "2", "B": "8", "G": "6", "q": "9",
})

# '0310712026' — OCR read the two '/' of 03/07/2026 as '1'. Search (not
# fullmatch) so dates buried in merged blobs are found too:
# '021071202602107/2026' = "02/07/2026 02/07/2026" with lost separators.
_SLASH_AS_ONE_RX = re.compile(r"(\d{2})[1/](\d{2})[1/](\d{4})")

_NUMERIC_TOKEN_RX = re.compile(r"^-?[\d.,]+$")

# A COMPLETE grouped integer — thousands separators placed with every group
# terminated ('1,000', '12,345', '1,000,000'). A number OCR split mid-value
# leaves an *incomplete* left fragment instead (e.g. '2,00', a comma group of
# only two digits), so a fragment matching this is a finished number that needs
# no more digits appended.
_COMPLETE_GROUPED_INT_RX = re.compile(r"^-?\d{1,3}(?:,\d{3})+$")


def _plausible_date(d: date | None) -> date | None:
    """Clamp fuzzy-recovered dates to a sane statement window."""
    if d is None:
        return None
    from datetime import date as _date, timedelta
    if _date(2000, 1, 1) <= d <= _date.today() + timedelta(days=31):
        return d
    return None


def parse_date_fuzzy(text: str) -> tuple[date | None, bool]:
    """Parse a date from possibly OCR-garbled text.

    Returns (date, fuzzy) — fuzzy=True when recovery needed OCR digit fixes
    or separator reconstruction, so the caller can lower the row confidence.
    Strict parses are returned untouched (fuzzy=False) and NOT plausibility-
    clamped here (the normalizer's guard covers those).
    """
    strict = parse_date(text)
    if strict is not None:
        return strict, False
    if not text:
        return None, False

    token = text.strip().split("\n")[0].strip()
    fixed = token.translate(_OCR_DIGIT_FIX)
    d = _plausible_date(parse_date(fixed))
    if d is not None:
        return d, True

    # Separators read as '1' (or dropped into digit blobs): scan each
    # whitespace chunk for a dd?mm?yyyy pattern.
    for chunk in fixed.split():
        if len(chunk) < 8:
            continue
        for m in _SLASH_AS_ONE_RX.finditer(chunk):
            try:
                d = _plausible_date(date(int(m.group(3)), int(m.group(2)), int(m.group(1))))
            except ValueError:
                d = None
            if d is not None:
                return d, True
    return None, False


def _merge_numeric_fragments(texts: list[str]) -> str:
    """Join amount fragments that OCR split across boxes ('2,00' + '0.000').

    Only fires when every token is numeric-like AND the tokens plausibly form
    ONE amount: at most one fragment may carry a decimal point, and it must be
    the last (a real split number is grouping fragments left of a single
    decimal tail). Otherwise returns the plain space-join, so descriptions that
    strayed into an amount cell — or two genuinely separate numeric cells
    (a reference count and an amount) — keep their pieces separate rather than
    being concatenated into a bogus, inflated value. Concatenating '2,000' with
    a separate '.000' would otherwise synthesise '2,000.000' -> 2,000,000.
    """
    if len(texts) <= 1:
        return texts[0] if texts else ""
    if not all(_NUMERIC_TOKEN_RX.match(t) for t in texts):
        return " ".join(texts)
    # A single split amount has its decimal point only in the trailing piece;
    # any dot in an earlier fragment (or dots in two of them) means these are
    # not one number's grouped fragments — don't fuse them.
    if any("." in t for t in texts[:-1]):
        return " ".join(texts)
    # If the trailing piece carries the decimal point, its fractional part must
    # look like a real decimal tail (1-2 digits). A 3-digit tail ('0.000') is
    # grouping-shaped: concatenating '2,000' with a separate '0.000' would make
    # '2,000.000', which parse_amount_ocr then promotes to 2,000,000 — a 1000x
    # inflation from what are almost certainly two separate cells. Keep them
    # apart and let the chain solver derive the real amount.
    last = texts[-1]
    if "." in last:
        frac = last.split(".", 1)[1]
        if len(frac) not in (1, 2):
            return " ".join(texts)
    elif any(_COMPLETE_GROUPED_INT_RX.match(t) for t in texts):
        # No decimal point anywhere to key the split on: these are integer
        # fragments. A fragment that is already a complete grouped integer
        # ('1,000') is a finished number needing no more digits — concatenating
        # it with a neighbouring numeric (a stray '500' -> '1,000500' ->
        # 1,000,500) inflates it ~1000x. That is two separate amount cells that
        # snapped to the same column, not one split number, so keep them apart
        # and let the chain solver derive the real amount. (Checked across ALL
        # fragments so the guard fires regardless of which side the complete
        # number landed on; a genuine split has only incomplete fragments.)
        return " ".join(texts)
    return "".join(texts)


def parse_amount_ocr(text: str) -> float | None:
    """OCR-tolerant amount parse: strict first, then mixed-separator repair.

    Handles '56.846,403.27' (OCR mixes '.' and ',' as grouping) by treating
    the LAST separator as the decimal point iff it is followed by 1-2
    digits, and the rest as grouping iff the resulting groups are 1-3
    digits (first) / exactly 3 (rest) — which still rejects dates like
    '07.06.2026'. Unrepairable numbers ('52.5223576') return None and are
    left to the balance-chain solver.
    """
    if not text:
        return None
    probe = _CURRENCY_PREFIX.sub("", text.strip().split("\n")[0].strip())
    # 4+ digits after a lone decimal point is never a real money amount —
    # it's a balance whose separators OCR dropped ('52.5223576'). Reject so
    # the chain solver derives the true value instead of trusting 52.52.
    # Test the numeric CORE (drop any trailing suffix like ' CR'/' DR'): the
    # strict parse below strips such suffixes too, so keying the guard on the
    # full probe would let '52.5223576 CR' slip past the $-anchor and be
    # truncated to 52.52 instead of rejected.
    core = re.sub(r"[^\d.,\-].*$", "", probe).strip()
    if re.match(r"^-?\d+\.\d{4,}$", core):
        return None
    # Dot-as-thousands repair is enabled here and ONLY here: on a scanned page
    # a period is as likely to be a misread comma as a decimal point.
    strict = _parse_amount(text, ocr_grouping=True)
    if strict is not None:
        return strict
    cleaned = probe.translate(_OCR_DIGIT_FIX)
    if not re.match(r"^-?[\d.,]+$", cleaned):
        return None
    neg = cleaned.startswith("-")
    digits_seps = cleaned.lstrip("-")
    # Split on BOTH separators, preserving order.
    parts = re.split(r"[.,]", digits_seps)
    if len(parts) < 2 or not all(p.isdigit() for p in parts if p != ""):
        return None
    if any(p == "" for p in parts):
        return None
    decimal = None
    groups = parts
    if len(parts[-1]) <= 2:
        decimal = parts[-1]
        groups = parts[:-1]
    if not (1 <= len(groups[0]) <= 3) or not all(len(g) == 3 for g in groups[1:]):
        return None
    joined = "".join(groups) + (f".{decimal}" if decimal is not None else "")
    try:
        val = float(joined)
    except ValueError:
        return None
    if neg:
        val = -val
    return val if val != 0.0 else None


# ────────────────────────────────────────────────────────────────────
# SKIP DETECTION
# ────────────────────────────────────────────────────────────────────

_SKIP_RE = re.compile(
    r"|".join([
        r"^\s*page\s+\d+",
        r"^\s*statement\s+(of|for|date)",
        r"^\s*account\s*(number|name|holder|no|type|summary|statement)",
        r"^\s*opening\s+balance",
        r"^\s*closing\s+balance",
        r"^\s*(total\s+(debit|credit|balance))",
        r"^\s*printed\s+as\s+of",
        r"^\s*period\s+of\s+statement",
        r"^\s*branch\s*:",
        r"^\s*currency\s",
        r"^\s*(mobile|email|phone)\s*(number|address)?",
        r"^\s*-{3,}",
        r"^\s*={3,}",
        r"^\s*$",
    ]),
    re.IGNORECASE,
)

# Page-footer / legal text that pdfplumber sometimes pulls into the last
# transaction when its word lies inside a column's x-range. These rows sit
# in the page margin and must be dropped before the continuation-merge step.
_FOOTER_RE = re.compile(
    r"^\s*[©®]"                    # leading © or ®
    r"|^\s*\(c\)\s*\d{2,4}\b"                # (c) 2017
    r"|^\s*copyright\b"
    r"|^\s*page\s+\d+\s*(of|/)\s*\d+\s*$"    # "Page 1 of 5"
    r"|^\s*\d+\s*(of|/)\s*\d+\s*$"           # "1 / 5", "1 of 5"
    r"|^\s*\d{1,2}\s*$"                      # lone small page number
    r"|\ball\s+rights\s+reserved\b",
    re.IGNORECASE,
)


def is_skip_line(text: str) -> bool:
    stripped = text.strip()
    if _SKIP_RE.match(stripped):
        return True
    if _FOOTER_RE.search(stripped):
        return True
    return False


# ────────────────────────────────────────────────────────────────────
# COLUMN ROLE DETECTION — adaptive, keyword-based
# ────────────────────────────────────────────────────────────────────

# Each pattern list is tried in order. First match wins.
# NOTE: "direction" must be tried BEFORE "credit"/"debit" so that a header
# like "Credit/Debit" is detected as a direction-label column rather than
# matching the bare "credit" keyword.
_ROLE_KEYWORDS: dict[str, re.Pattern] = {
    "date": re.compile(
        r"(date|tarehe|book\s*date|value\s*date|entry\s*date|txn\s*date|posting\s*date|trans\s*date)", re.I
    ),
    "description": re.compile(
        # Synonyms used by different banks/wallets:
        #   desc(ription) — generic, Amana, Selcom
        #   narrat(ion)  — NMB, CRDB, NBC, KCB
        #   detail(s)    — Airtel Money, generic
        #   particular(s)— older bank statements
        #   remark(s)    — Equity, Standard Chartered
        #   memo         — informal / personal banking
        #   info / information — Tigo Pesa, M-Pesa variants
        #   maelezo      — Swahili for "description"
        #   transaction text/info/narrative — verbose layouts
        r"(desc|detail|particular|narrat|maelezo|remark|memo|"
        r"^info$|information|transaction\s*(text|info|narrative))",
        re.I,
    ),
    "reference": re.compile(
        r"(ref|txn\s*ref|reference|cheque|control)", re.I
    ),
    "direction": re.compile(
        r"(credit\s*/\s*debit|debit\s*/\s*credit|cr\s*/\s*dr|dr\s*/\s*cr|type|dc\s*flag|txn\s*type|trans\s*type)", re.I
    ),
    "debit": re.compile(
        r"(debit|money\s*out|withdraw|dr\b|paid\s*out)", re.I
    ),
    "credit": re.compile(
        r"(credit|money\s*in|deposit|cr\b|paid\s*in)", re.I
    ),
    "balance": re.compile(
        r"(balance|salio|book\s*bal)", re.I
    ),
    "seq": re.compile(r"^(sn|no\.?|#|s/n|seq)$", re.I),
    "from": re.compile(r"^(from|kutoka|sender)$", re.I),
    "to": re.compile(r"^(to|kwenda|receiver|beneficiary)$", re.I),
    "amount": re.compile(r"(amount|kiasi)", re.I),
}


# ────────────────────────────────────────────────────────────────────
# DIRECTION INFERENCE — when a table has a single "amount" column only
# ────────────────────────────────────────────────────────────────────

_DEBIT_KEYWORDS = re.compile(
    r"\b(pay\s*bill|paid\s*to|send\s*to|sent\s*to|sent\s*money|sendto|"
    r"withdraw|withdrawn|transfer\s*to|transfer:|payment\s*to|purchase|"
    r"paid|debited|out|cash\s*out|bill\s*payment|government\s*payment|"
    r"airtime|luku|ussd|charge|fee|vat|ex\s*duty)\b",
    re.I,
)
_CREDIT_KEYWORDS = re.compile(
    r"\b(received\s*from|receivedfrom|received\s*money|receive\s*money|"
    r"receive|credited|deposit|disburse|fsp\s*disburse|cash\s*in|"
    r"transfer\s*from|refund|reversal|reversed|bonus|wallet2sp|bank2sp|stash\s*to)\b",
    re.I,
)


def classify_direction_from_text(text: str) -> str | None:
    """
    Infer transaction direction from a description / direction-label cell.
    Returns "credit", "debit", or None if ambiguous.
    """
    if not text:
        return None
    t = text.strip().lower()
    if not t:
        return None

    # Explicit direction label (single word or start of cell)
    # Check debit FIRST — "credit/debit" column values are exactly "Credit"
    # or "Debit" and we want an exact-first-word match to win.
    if re.match(r"^(debit|dr|d)\b", t):
        return "debit"
    if re.match(r"^(credit|cr|c)\b", t):
        return "credit"

    # Keyword scan in narrative descriptions
    debit_hit = _DEBIT_KEYWORDS.search(t)
    credit_hit = _CREDIT_KEYWORDS.search(t)
    if credit_hit and not debit_hit:
        return "credit"
    if debit_hit and not credit_hit:
        return "debit"
    # If both match, prefer the one that starts earliest
    if debit_hit and credit_hit:
        return "credit" if credit_hit.start() < debit_hit.start() else "debit"
    return None


@dataclass
class ColumnMap:
    """Learned column roles for a statement. Reused across pages."""
    roles: dict[int, str] = field(default_factory=dict)
    col_count: int = 0

    @property
    def is_empty(self):
        return len(self.roles) == 0

    def has_role(self, role: str) -> bool:
        return role in self.roles.values()

    def get_col(self, role: str) -> int | None:
        for idx, r in self.roles.items():
            if r == role:
                return idx
        return None


def detect_column_roles(row: list[str | None]) -> ColumnMap:
    """
    Detect column roles from a header row using keyword matching.
    Returns a ColumnMap with identified roles.
    """
    cmap = ColumnMap(col_count=len(row))

    for i, cell in enumerate(row):
        if not cell:
            continue
        text = cell.strip()
        if not text:
            continue

        # Skip very long merged cells — handled separately
        if len(text) > 100:
            continue

        for role, pattern in _ROLE_KEYWORDS.items():
            if pattern.search(text):
                if role not in cmap.roles.values():
                    cmap.roles[i] = role
                break

    return cmap


def guess_roles_from_data(table: list[list[str | None]]) -> ColumnMap:
    """
    Guess column roles by analyzing data content patterns (no header needed).
    This is the adaptive fallback — works with any bank format.
    """
    if not table or len(table) < 2:
        return ColumnMap()

    ncols = max(len(row) for row in table)
    # Sample up to 5 data rows (skip first if it might be header)
    sample = table[1:6] if len(table) > 2 else table

    cmap = ColumnMap(col_count=ncols)
    date_col = None
    numeric_cols: list[int] = []
    text_cols: list[int] = []

    for col in range(ncols):
        has_date = 0
        is_numeric = 0
        total_len = 0
        non_empty = 0

        for row in sample:
            if col >= len(row):
                continue
            val = str(row[col] or "").strip()
            if not val:
                continue
            non_empty += 1
            if parse_date(val) is not None:
                has_date += 1
            # Check if it's a number (after stripping currency prefix)
            cleaned = _CURRENCY_PREFIX.sub("", val).replace(",", "").strip()
            try:
                float(cleaned)
                is_numeric += 1
            except ValueError:
                pass
            total_len += len(val)

        if non_empty == 0:
            continue

        if has_date > 0 and date_col is None:
            date_col = col
            cmap.roles[col] = "date"
        elif is_numeric == non_empty and non_empty > 0:
            numeric_cols.append(col)
        elif total_len / max(non_empty, 1) > 10:
            text_cols.append(col)

    # Must have a date column
    if date_col is None:
        return ColumnMap()

    # Assign text → description
    if text_cols:
        cmap.roles[text_cols[0]] = "description"

    # Assign numeric: last → balance, then debit, credit
    if len(numeric_cols) >= 3:
        cmap.roles[numeric_cols[-1]] = "balance"
        cmap.roles[numeric_cols[0]] = "debit"
        cmap.roles[numeric_cols[1]] = "credit"
    elif len(numeric_cols) == 2:
        cmap.roles[numeric_cols[-1]] = "balance"
        cmap.roles[numeric_cols[0]] = "debit"
    elif len(numeric_cols) == 1:
        cmap.roles[numeric_cols[0]] = "amount"

    return cmap


def find_header_in_table(table: list[list[str | None]]) -> tuple[int, ColumnMap]:
    """
    Search the first few rows of a table for a header.
    Falls back to data-content guessing if no header is found.
    Returns (header_row_index, column_map).
    """
    # Try explicit header detection first.
    # A valid transaction-table header MUST include a date column — this
    # distinguishes real transaction tables from summary tables (e.g.
    # "Count | Description | Amount") that would otherwise be misread as
    # transactions and cause the real rows on that page to be skipped.
    for i, row in enumerate(table[:5]):
        cmap = detect_column_roles(row)
        roles = set(cmap.roles.values())
        meaningful = {r for r in roles if r not in ("seq", "from", "to")}
        if "date" in roles and len(meaningful) >= 2:
            return i, cmap

    # Fallback: guess from data content
    guessed = guess_roles_from_data(table)
    if not guessed.is_empty:
        return -1, guessed  # -1 means no header row to skip

    return -1, ColumnMap()


# ────────────────────────────────────────────────────────────────────
# TIER 1 — TABLE-BASED EXTRACTION
# ────────────────────────────────────────────────────────────────────

def build_from_table(
    table: list[list[str | None]],
    page_number: int,
    row_offset: int,
    known_columns: ColumnMap | None = None,
) -> tuple[list[Transaction], list[str], ColumnMap | None]:
    """
    Build transactions from a pdfplumber table.

    If known_columns is provided (from a previous page), use those roles
    instead of requiring a header in this table.

    Returns (transactions, skipped_lines, learned_column_map).
    """
    if not table:
        return [], [], known_columns

    # Try to find header in this table
    header_idx, learned_cmap = find_header_in_table(table)

    if not learned_cmap.is_empty:
        # Found a header or guessed roles from this table
        cmap = learned_cmap
        data_start = header_idx + 1 if header_idx >= 0 else 0
    elif known_columns and not known_columns.is_empty:
        # No header here, but we have roles from a previous page
        cmap = known_columns
        data_start = 0
    else:
        # Can't identify columns
        return [], [], known_columns

    # Repair pdfplumber column-alignment errors: if the header said
    # "Withdrawal" belongs to col N but col N is empty in every data row
    # while an adjacent unnamed column carries the numeric values, move
    # the role to that adjacent column.
    _shift_role_to_adjacent_column(table, cmap, data_start)

    # Sanity check: a real transaction table must contain at least one
    # parseable date in the date column. This rejects summary tables
    # (e.g. Count|Description|Amount) that happen to align with a
    # previously-learned column map and would otherwise produce fake rows.
    date_col = cmap.get_col("date")
    if date_col is not None:
        has_any_date = any(
            date_col < len(row) and parse_date(str(row[date_col] or "")) is not None
            for row in table[data_start:]
        )
        if not has_any_date:
            return [], [], known_columns

    transactions: list[Transaction] = []
    skipped: list[str] = []
    row_idx = row_offset

    for row in table[data_start:]:
        row_text = " ".join(str(c or "") for c in row).strip()

        # Skip empty/null rows
        if not row_text or all(not str(c or "").strip() for c in row):
            continue
        if is_skip_line(row_text):
            skipped.append(row_text)
            continue

        txn = _row_to_transaction(row, cmap, row_idx + 1, page_number)
        if txn:
            row_idx += 1
            txn.row_index = row_idx
            transactions.append(txn)
        else:
            skipped.append(row_text)

    learned = learned_cmap if not learned_cmap.is_empty else known_columns
    return transactions, skipped, learned


def _row_to_transaction(
    row: list[str | None],
    cmap: ColumnMap,
    row_idx: int,
    page_number: int,
) -> Transaction | None:
    """Convert a table row into a Transaction using the column map."""

    def get(role: str) -> str:
        col = cmap.get_col(role)
        if col is not None and col < len(row):
            return str(row[col] or "").strip()
        return ""

    # Try to get date from the date column
    date_str = get("date")
    txn_date = parse_date(date_str)
    # Time-of-day usually shares the date cell ("Date & Time" column); fall back
    # to the whole row for layouts that split it out. Best-effort, tiebreaker only.
    txn_time = parse_time(date_str)

    # Get description
    description = get("description")
    # Clean multi-line: replace newlines with spaces
    description = re.sub(r"\s+", " ", description.replace("\n", " ")).strip()

    # Get amounts
    debit = parse_amount(get("debit"))
    credit = parse_amount(get("credit"))
    balance = parse_amount(get("balance"))

    # If there's a single "amount" column instead of debit/credit,
    # route it to debit or credit based on:
    #   1. An explicit "direction" column ("Credit" / "Debit" label), or
    #   2. Keywords inside the description.
    # Falling back to debit-by-default causes every credit to be classified
    # as a debit (total_credit=0) — worse than flagging for review.
    if debit is None and credit is None and cmap.has_role("amount"):
        amount = parse_amount(get("amount"))
        if amount:
            direction = None
            if cmap.has_role("direction"):
                direction = classify_direction_from_text(get("direction"))
            if direction is None:
                direction = classify_direction_from_text(description)
            if direction == "credit":
                credit = amount
            elif direction == "debit":
                debit = amount
            else:
                debit = amount  # Unknown — flagged via needs_review below

    # Get reference
    ref_str = get("reference")
    reference = ref_str if ref_str else None

    # If no reference column, try to extract from description
    if not reference and description:
        ref_match = re.search(r"\b([A-Z0-9]{8,})\b", description)
        reference = ref_match.group(1) if ref_match else None

    # A real transaction must carry at least a description or a debit/credit
    # amount. Reject rows that are effectively empty:
    #   • balance-only ghost rows — pdfplumber continuation fragments at
    #     page boundaries (e.g. row ['', '', '', '', '763'])
    #   • date-only header-leak rows — summary-table entries like
    #     STARTDATE / ENDDATE that align to a date column
    if not description and debit is None and credit is None:
        return None

    # Confidence scoring
    confidence = 1.0
    needs_review = False
    review_reason = None

    if txn_date is None:
        confidence -= 0.3
        needs_review = True
        review_reason = "Could not parse date"
    if debit is None and credit is None:
        confidence -= 0.2
        needs_review = True
        review_reason = review_reason or "No debit or credit"
    if balance is None:
        confidence -= 0.1

    row_text = " ".join(str(c or "") for c in row)
    if txn_time is None:
        txn_time = parse_time(row_text)

    return Transaction(
        row_index=row_idx,
        txn_date=txn_date,
        txn_time=txn_time,
        description=description,
        reference=reference,
        debit=debit,
        credit=credit,
        balance=balance,
        confidence=round(max(confidence, 0.0), 2),
        raw_text=row_text,
        needs_review=needs_review,
        review_reason=review_reason,
        page_number=page_number,
    )


# ────────────────────────────────────────────────────────────────────
# TIER 2 — WORD-POSITION MODE (for PDFs without table borders)
# ────────────────────────────────────────────────────────────────────

@dataclass
class AmountColumnCalibration:
    """Data-driven right edges of the amount columns on a scanned page.

    OCR'd statements right-align their numbers, so a value's x1 (right
    edge) clusters tightly per column while its x0 wanders with the number
    width — header-derived x0 territories systematically misassign wide
    amounts (a debit that starts past the debit/credit midpoint lands in
    credit). Clustering the observed right edges and snapping numeric words
    to the nearest cluster fixes direction assignment at the source.
    """
    edges: list[tuple[str, float]]  # (role, right_edge_x1), ascending x1
    snap_tol: float = 25.0

    def role_for_x1(self, x1: float) -> str | None:
        best_role, best_d = None, None
        for role, edge in self.edges:
            d = abs(x1 - edge)
            if best_d is None or d < best_d:
                best_role, best_d = role, d
        if best_d is not None and best_d <= self.snap_tol:
            return best_role
        return None


AMOUNT_ROLES = {"debit", "credit", "balance", "amount"}


def calibrate_amount_columns(
    words: list[dict],
    wcmap: "WordColumnMap",
    header_y: float | None,
    y_tolerance: float,
) -> AmountColumnCalibration | None:
    """Learn the amount columns' right edges from the page's own numbers.

    1-D gap clustering over the x1 of numeric-looking words below the
    header; the rightmost N clusters (N = amount roles in the header) map
    to those roles in x-order. Guarded: sparse clusters are dropped, and
    any geometric inconsistency returns None so the caller falls back to
    the existing x0-territory logic — a bad calibration must never be
    worse than no calibration.
    """
    amount_headers = sorted(
        [(role, x0) for role, x0, _ in wcmap.columns if role in AMOUNT_ROLES],
        key=lambda c: c[1],
    )
    if not amount_headers:
        return None
    leftmost_x0 = amount_headers[0][1]

    xs: list[float] = []
    for w in words:
        if header_y is not None and w["top"] <= header_y + y_tolerance:
            continue
        text = w["text"]
        if len(text) < 3 or not _NUMERIC_TOKEN_RX.match(text):
            continue
        if sum(ch.isdigit() for ch in text) < 3:
            continue
        if w["x1"] < leftmost_x0 - 15:
            continue  # dates/reference numerals living far left of the amounts
        xs.append(w["x1"])
    if len(xs) < 3 * len(amount_headers) // 2:
        return None

    xs.sort()
    clusters: list[list[float]] = [[xs[0]]]
    for x in xs[1:]:
        if x - clusters[-1][-1] > 12.0:
            clusters.append([x])
        else:
            clusters[-1].append(x)
    clusters = [c for c in clusters if len(c) >= 3]
    if len(clusters) < len(amount_headers):
        return None

    # Rightmost N clusters, in x-order, correspond to the amount roles in
    # header x-order (debit < credit < balance on every layout seen).
    chosen = clusters[-len(amount_headers):]
    edges: list[tuple[str, float]] = []
    for (role, role_x0), cluster in zip(amount_headers, chosen):
        edge = cluster[len(cluster) // 2]  # median
        if not (role_x0 - 10 <= edge <= role_x0 + 100):
            return None
        edges.append((role, edge))
    for (_, a), (_, b) in zip(edges, edges[1:]):
        if b - a < 20.0:
            return None

    gaps = [b - a for (_, a), (_, b) in zip(edges, edges[1:])]
    snap_tol = min(min(gaps) * 0.5, 25.0) if gaps else 25.0
    log.info(
        "Amount-column calibration: %s (snap tol %.1f)",
        [(r, round(e, 1)) for r, e in edges], snap_tol,
    )
    return AmountColumnCalibration(edges=edges, snap_tol=snap_tol)


@dataclass
class WordColumnMap:
    """Column boundaries detected from header words in text mode."""
    columns: list[tuple[str, float, float]] = field(default_factory=list)
    # Each entry: (role, x_start, x_end)
    # Data-driven right edges for amount columns on scanned pages (None on
    # digital pages / until calibrated). Rides page-to-page continuity.
    amount_calibration: AmountColumnCalibration | None = None

    @property
    def is_empty(self):
        return len(self.columns) == 0

    def assign_word(self, x0: float) -> str | None:
        """
        Find which column a word belongs to by its x-position.

        Territory model: midpoint between neighbouring header x0s by default,
        but TYPE-AWARE when the neighbours have different alignments:

          • Amount columns (debit, credit, balance, amount) hold right-aligned
            numbers that cluster near their header's x0 and extend LEFT. A
            text column to their left, by contrast, holds left-aligned words
            that can wrap far past their own header. Splitting the gap at the
            midpoint therefore lets description words cross into the amount
            column. For a text→amount boundary, pull the split toward the
            amount column's x0 (leaving only enough margin to the left to
            catch wide numbers like "1,234,567.89").

          • Between two amount columns the midpoint works fine — both are
            narrow and right-aligned.

        The first column extends a generous amount to the left so left-aligned
        data starting slightly before the header word still hits it. The last
        column extends to infinity on the right so long descriptions are
        captured.
        """
        if not self.columns:
            return None
        # Width reserve for wide right-aligned numbers (e.g. "1,234,567.89"
        # plus an optional currency prefix). Chosen to fit the widest amounts
        # we see in Tanzanian bank statements at 9–11pt rendering without
        # eating noticeably into description territory.
        NUMERIC_LEFT_RESERVE = 55.0
        AMOUNT_ROLES = {"debit", "credit", "balance", "amount"}

        cols = sorted(self.columns, key=lambda c: c[1])

        def boundary(left_idx: int, right_idx: int) -> float:
            left_role, left_x0, _ = cols[left_idx]
            right_role, right_x0, _ = cols[right_idx]
            mid = (left_x0 + right_x0) / 2.0
            if right_role in AMOUNT_ROLES and left_role not in AMOUNT_ROLES:
                # Reserve room to the LEFT of the amount's x0 for wide numbers,
                # but never cross past the midpoint (keeps small layouts safe).
                return max(mid, right_x0 - NUMERIC_LEFT_RESERVE)
            return mid

        for i, (role, cx0, _) in enumerate(cols):
            if i == 0:
                left = cx0 - 50.0
            else:
                left = boundary(i - 1, i)
            if i + 1 < len(cols):
                right = boundary(i, i + 1)
            else:
                right = float("inf")
            if left <= x0 < right:
                return role
        return None


def _group_header_cells(row_words: list[dict]) -> list[list[dict]]:
    """
    Cluster words on a single header line into cells by x-gap.

    Fully adaptive (no hardcoded column widths, no language assumptions):

    Step 1 — if every adjacent pair is already well separated (min gap is
    visibly larger than a word-space), treat each word as its own cell.
    That is the dominant case for headers like "Date | Ref | Description |
    Debit | Credit | Balance".

    Step 2 — otherwise the row contains multi-word cells (e.g. "Transaction
    Date", "Balance (TSH)", "Date & Time"). Gaps within a cell are near the
    width of a character space (1–4 units at 10pt); gaps between cells are
    noticeably larger. We anchor on the smallest gap (the intra-cell baseline)
    and treat any gap that is meaningfully larger as a cell boundary.

    A single "biggest jump" heuristic fails when a header mixes multi-word
    cells with several closely-spaced single-word cells. Example from an
    Airtel statement header:

        Date & Time    Details    ...    Credited Debited Balance
        gaps: [2.1, 2.1, 16.4, 207.8, 11.7, 12.6]

    Picking only the largest jump (207.8) collapses Credited/Debited/Balance
    into one cell and Time/Details into another, losing those column roles.
    Comparing each gap against the small-gap baseline correctly marks every
    inter-cell gap as a boundary regardless of how unevenly columns are
    distributed across the page.
    """
    if not row_words:
        return []
    if len(row_words) == 1:
        return [[row_words[0]]]

    gaps = [
        max(row_words[i]["x0"] - row_words[i - 1]["x1"], 0.0)
        for i in range(1, len(row_words))
    ]

    SMALL_GAP = 5.0  # typical PDF inter-word space is 1–4 units at 10pt

    if min(gaps) > SMALL_GAP:
        return [[w] for w in row_words]

    # Threshold = "anything more than ~2.5× the typical intra-cell space".
    # Floor at SMALL_GAP so a noisy min_gap of 0 doesn't collapse everything.
    min_gap = min(g for g in gaps if g > 0) if any(g > 0 for g in gaps) else 0.0
    threshold = max(SMALL_GAP, min_gap * 2.5)

    cells: list[list[dict]] = [[row_words[0]]]
    for i in range(1, len(row_words)):
        if gaps[i - 1] > threshold:
            cells.append([row_words[i]])
        else:
            cells[-1].append(row_words[i])
    return cells


# ── OCR-tolerant header detection ───────────────────────────────────
# OCR of scanned statements garbles header keywords ("Nartation" for
# Narration, "Groedit" for Credit, "Balanct" for Balance), so the exact
# regex patterns above miss them. The fuzzy pass below matches individual
# header words against a canonical vocabulary by string similarity. It is
# ONLY used when the strict pass finds nothing, and it demands a stronger
# signal (date + >=3 meaningful roles incl. an amount-ish one) so garbled
# non-header rows can't fake a header.
_FUZZY_ROLE_VOCAB: list[tuple[str, str]] = [
    ("date", "date"), ("tarehe", "date"),
    ("narration", "description"), ("description", "description"),
    ("details", "description"), ("particulars", "description"),
    ("maelezo", "description"), ("remarks", "description"),
    ("reference", "reference"), ("cheque", "reference"),
    ("debit", "debit"), ("withdrawal", "debit"),
    ("credit", "credit"), ("deposit", "credit"),
    ("balance", "balance"), ("salio", "balance"),
    ("amount", "amount"), ("kiasi", "amount"),
]
_FUZZY_MIN_RATIO = 0.72
_AMOUNTISH_ROLES = {"debit", "credit", "balance", "amount"}


def _fuzzy_role_for_word(text: str) -> str | None:
    """Best fuzzy role for a single (possibly OCR-garbled) header word."""
    t = re.sub(r"[^a-z]", "", (text or "").lower())
    if len(t) < 4:
        return None
    best_role, best_ratio = None, 0.0
    for vocab, role in _FUZZY_ROLE_VOCAB:
        ratio = difflib.SequenceMatcher(None, t, vocab).ratio()
        if ratio > best_ratio:
            best_role, best_ratio = role, ratio
    return best_role if best_ratio >= _FUZZY_MIN_RATIO else None


def _detect_header_words_fuzzy(
    words: list[dict], y_tolerance: float
) -> tuple[float | None, WordColumnMap]:
    """Fuzzy per-word header scan for OCR'd pages.

    Scans the same first rows as the strict pass, scores each row by how many
    distinct roles its words fuzzy-match, and picks the best row that has a
    date column, at least three meaningful roles, and at least one
    amount-like column. Per-word matching (instead of per-cell) sidesteps
    OCR's unreliable inter-word gaps entirely — each matched word's own x0
    anchors its column.
    """
    y_groups: dict[float, list[dict]] = {}
    for w in words:
        y_key = round(w["top"] / y_tolerance) * y_tolerance
        y_groups.setdefault(y_key, []).append(w)

    best: tuple[int, float, list[tuple[str, float, float]]] | None = None
    for y in sorted(y_groups.keys())[:30]:
        row_words = sorted(y_groups[y], key=lambda w: w["x0"])
        matched: list[tuple[str, float, float]] = []
        assigned: set[str] = set()
        for w in row_words:
            role = _fuzzy_role_for_word(w["text"])
            if role and role not in assigned:
                matched.append((role, w["x0"], w["x1"]))
                assigned.add(role)
        meaningful = {r for r, _, _ in matched if r not in ("seq", "from", "to")}
        if (
            "date" in assigned
            and len(meaningful) >= 3
            and meaningful & _AMOUNTISH_ROLES
        ):
            if best is None or len(meaningful) > best[0]:
                best = (len(meaningful), y, matched)

    if best is None:
        return None, WordColumnMap()
    _, y, matched = best
    log.info(
        "Fuzzy header detected at y=%.1f: %s",
        y, [(r, round(x, 1)) for r, x, _ in matched],
    )
    return y, WordColumnMap(columns=matched)


def detect_header_words(
    words: list[dict], y_tolerance: float = 5.0
) -> tuple[float | None, WordColumnMap]:
    """
    Find the header row in word-level extraction and build column boundaries.

    Strategy (fully adaptive — no bank- or language-specific hardcoding):
      1. Group words into horizontal rows by y-position.
      2. For each candidate row, cluster adjacent words into *cells* via an
         adaptive x-gap threshold derived from the row itself.
      3. For each cell, search the concatenated cell text for a role
         keyword (e.g. "Transaction Date" → date, "Balance (TSH)" → balance).
      4. Use the LEFTMOST word's x0 as the column anchor, so data rows
         that left-align to the cell start are correctly assigned.

    This handles:
      • single-word Swahili headers: "Tarehe", "Salio", "Maelezo"
      • multi-word English headers: "Transaction Date", "Transaction Amount",
        "Money In", "Paid Out", "Book Balance"
      • headers with unit suffixes: "Balance (TSH)", "Amount (USD)"
      • any mix the bank invents tomorrow — the logic is keyword-in-cell, not
        keyword-at-position.
    """
    # Group words by y-position
    y_groups: dict[float, list[dict]] = {}
    for w in words:
        y_key = round(w["top"] / y_tolerance) * y_tolerance
        if y_key not in y_groups:
            y_groups[y_key] = []
        y_groups[y_key].append(w)

    sorted_ys = sorted(y_groups.keys())

    for y in sorted_ys[:30]:
        row_words = sorted(y_groups[y], key=lambda w: w["x0"])
        cells = _group_header_cells(row_words)

        matched_roles: list[tuple[str, float, float]] = []
        assigned: set[str] = set()

        for cell in cells:
            cell_text = " ".join(w["text"] for w in cell).strip()
            if not cell_text:
                continue
            # Very long cells (more than a handful of words) are almost
            # always stray prose, not headers. Skip so we do not accidentally
            # assign "description" to a sentence that contains "detail".
            if len(cell) > 5:
                continue
            for role, pattern in _ROLE_KEYWORDS.items():
                if role in assigned:
                    continue
                if pattern.search(cell_text):
                    x0 = cell[0]["x0"]
                    x1 = cell[-1]["x1"]
                    matched_roles.append((role, x0, x1))
                    assigned.add(role)
                    break

        meaningful = {r for r, _, _ in matched_roles if r not in ("seq", "from", "to")}
        if "date" in assigned and len(meaningful) >= 2:
            return y, WordColumnMap(columns=matched_roles)

    # Strict pass found nothing — try the OCR-tolerant fuzzy pass (higher
    # role-count bar, so it can't misfire on pages the strict pass rightly
    # rejected as headerless).
    return _detect_header_words_fuzzy(words, y_tolerance)


def build_from_words(
    words: list[dict],
    page_number: int,
    row_offset: int,
    known_word_columns: WordColumnMap | None = None,
    is_scanned: bool = False,
    carry_in: dict | None = None,
) -> tuple[list[Transaction], list[str], WordColumnMap | None, dict | None]:
    """
    Build transactions using word-level extraction with x-coordinates.

    1. Detect header and column boundaries (or reuse from previous page)
    2. Group words into rows by y-position
    3. For each row, assign words to columns by x-position
    4. Merge continuation lines (rows without a date)

    Scanned pages (is_scanned=True) additionally get: data-driven amount-
    column calibration, OCR-tolerant amount/date parsing, and cross-page
    transaction continuity — `carry_in` is the still-open transaction from
    the previous page (its top-of-page continuation lines merge in), and
    the trailing open transaction is returned as the 4th element instead
    of being finalized, so the NEXT page (or the pipeline's final flush)
    completes it. Digital pages behave exactly as before (carry unused).
    """
    if not words:
        return [], [], known_word_columns, carry_in

    Y_TOLERANCE = 3.0  # Words within 3 units of y are on the same line

    # Find header
    header_y, wcmap = detect_header_words(words, y_tolerance=Y_TOLERANCE)

    if wcmap.is_empty:
        if known_word_columns and not known_word_columns.is_empty:
            wcmap = known_word_columns
            header_y = -1  # Process all words
        else:
            return [], [], known_word_columns, carry_in
    elif known_word_columns is not None and known_word_columns.amount_calibration:
        # A freshly-detected header on a later page starts uncalibrated —
        # inherit the document's calibration.
        wcmap.amount_calibration = known_word_columns.amount_calibration

    # Data-driven amount-column calibration (scanned pages only). Learned
    # once and carried across pages on the WordColumnMap.
    if is_scanned and wcmap.amount_calibration is None:
        wcmap.amount_calibration = calibrate_amount_columns(
            words, wcmap, header_y if (header_y or 0) >= 0 else None, Y_TOLERANCE,
        )
    calib = wcmap.amount_calibration if is_scanned else None

    # Group all words into rows by y-position
    y_groups: dict[float, list[dict]] = {}
    for w in words:
        y_key = round(w["top"] / Y_TOLERANCE) * Y_TOLERANCE
        if y_key not in y_groups:
            y_groups[y_key] = []
        y_groups[y_key].append(w)

    sorted_ys = sorted(y_groups.keys())

    # Skip rows up to and including the header
    if header_y is not None and header_y >= 0:
        sorted_ys = [y for y in sorted_ys if y > header_y + Y_TOLERANCE]

    # Process each row: assign words to columns
    raw_rows: list[dict[str, str]] = []  # Each: {role: text, "_y": y, "_raw": raw_text}
    for y in sorted_ys:
        row_words = sorted(y_groups[y], key=lambda w: w["x0"])
        raw_text = " ".join(w["text"] for w in row_words)

        if not raw_text.strip() or is_skip_line(raw_text):
            continue

        # Assign each word to a column. Numeric words on calibrated scanned
        # pages snap to the amount column whose observed right edge is
        # nearest their own right edge (right-aligned columns); everything
        # else uses the classic x0 territory.
        col_values: dict[str, list[str]] = {}
        for w in row_words:
            role = None
            if (
                calib is not None
                and len(w["text"]) >= 3
                and _NUMERIC_TOKEN_RX.match(w["text"])
                and sum(ch.isdigit() for ch in w["text"]) >= 3
            ):
                role = calib.role_for_x1(w["x1"])
            if role is None:
                role = wcmap.assign_word(w["x0"])
            if role:
                if role not in col_values:
                    col_values[role] = []
                col_values[role].append(w["text"])

        row_data = {
            role: (
                _merge_numeric_fragments(texts)
                if is_scanned and role in AMOUNT_ROLES
                else " ".join(texts)
            )
            for role, texts in col_values.items()
        }
        row_data["_y"] = str(y)
        row_data["_raw"] = raw_text
        raw_rows.append(row_data)

    # Merge rows into transactions
    # A new transaction starts when a row has a parseable date
    transactions: list[Transaction] = []
    skipped: list[str] = []
    current: dict | None = dict(carry_in) if carry_in else None
    row_idx = row_offset

    for row_data in raw_rows:
        if is_scanned:
            date_obj, date_fuzzy = parse_date_fuzzy(row_data.get("date", ""))
            has_date = date_obj is not None
        else:
            date_obj, date_fuzzy = None, False
            has_date = parse_date(row_data.get("date", "")) is not None

        if has_date:
            # Save previous transaction
            if current:
                txn = _finalize_word_txn(
                    current, row_idx + 1,
                    int(current.get("_page", page_number)), ocr=is_scanned,
                )
                if txn:
                    row_idx += 1
                    txn.row_index = row_idx
                    transactions.append(txn)

            current = dict(row_data)
            current["_page"] = str(page_number)
            if date_obj is not None:
                current["_date_obj"] = date_obj.isoformat()
                if date_fuzzy:
                    current["_date_fuzzy"] = "1"
        elif current:
            # Continuation line — merge description and back-fill any amount
            # columns that were empty on the date line. Some statements render
            # the date/time on one y-line and the debit/credit/balance on the
            # next (Selcom-style SP statements), so the date row alone has no
            # numeric values. Without this back-fill, the numbers get dragged
            # into the description on the next row and the transaction loses
            # its amounts entirely.
            #
            # Only extend the description with words that were assigned to
            # the description column on this line. Falling back to _raw here
            # would splice amount digits (which already went to their own
            # columns) into the narrative text — but only when this line
            # actually contributed amount data. If the line carried no
            # amount columns, its _raw is safe to use and preserves content
            # on statements where word-header detection missed the
            # description column entirely.
            # An amount COLLISION means this is not a continuation at all:
            # one transaction cannot carry two different debits (or two
            # credits/balances). It is the next transaction, whose date
            # column OCR couldn't read. Close the current row and open a
            # new dateless one so the movement isn't silently swallowed —
            # the chain solver dates and verifies it downstream.
            # Only a MOVEMENT collision proves a new transaction: a repeated
            # balance is usually OCR noise, and splitting on it would mint
            # movement-less phantom rows.
            if is_scanned and any(
                row_data.get(role) and current.get(role)
                and row_data[role] != current[role]
                for role in ("debit", "credit", "amount")
            ):
                txn = _finalize_word_txn(
                    current, row_idx + 1,
                    int(current.get("_page", page_number)), ocr=True,
                )
                if txn:
                    row_idx += 1
                    txn.row_index = row_idx
                    transactions.append(txn)
                current = dict(row_data)
                current["_page"] = str(page_number)
                current["_date_fuzzy"] = "1"
                continue

            extra_desc = row_data.get("description", "")
            if not extra_desc:
                line_has_amounts = any(
                    row_data.get(r)
                    for r in ("debit", "credit", "balance", "amount")
                )
                if not line_has_amounts:
                    extra_desc = row_data.get("_raw", "")
            if extra_desc:
                current["description"] = (current.get("description", "") + " " + extra_desc).strip()
            for role in ("debit", "credit", "balance", "amount", "reference", "direction"):
                val = row_data.get(role, "")
                if val and not current.get(role):
                    current[role] = val
            # Also merge raw
            current["_raw"] = current.get("_raw", "") + " " + row_data.get("_raw", "")
        else:
            skipped.append(row_data.get("_raw", ""))

    # Last transaction: on scanned pages the trailing open transaction is
    # RETURNED as carry (its continuation lines may sit atop the next page);
    # digital pages finalize at page end exactly as before.
    carry_out: dict | None = None
    if current:
        if is_scanned:
            carry_out = current
        else:
            txn = _finalize_word_txn(current, row_idx + 1, page_number)
            if txn:
                row_idx += 1
                txn.row_index = row_idx
                transactions.append(txn)

    learned = wcmap if not wcmap.is_empty else known_word_columns
    return transactions, skipped, learned, carry_out


def _prepend_carried_txn(
    all_txns: list[Transaction],
    carry: dict,
    row_offset: int,
    page_number: int,
) -> None:
    """Finalize a carried transaction and put it ahead of this page's rows.

    The carried transaction OPENED on an earlier page, so it sorts before
    everything built here. Inserting it shifts every following row by one, so
    the page is renumbered from `row_offset + 1` afterwards: without that the
    carried row keeps `row_offset`, which is the index the PREVIOUS page's last
    row already holds. The pipeline renumbers globally before anything reads
    these values, so today the duplicate is invisible — but handing out an
    index that is already taken is a trap for the next reader, and the fix
    costs one pass over a page's rows.
    """
    carried = _finalize_word_txn(
        carry, row_offset, int(carry.get("_page", page_number)), ocr=True,
    )
    if not carried:
        return
    all_txns.insert(0, carried)
    for i, txn in enumerate(all_txns, start=row_offset + 1):
        txn.row_index = i


def finalize_carried_word_txn(carry: dict, row_idx: int) -> Transaction | None:
    """Finalize the document's last open word-mode transaction (the carry
    left over after the final page). Pipeline calls this once after the
    per-page loop."""
    return _finalize_word_txn(
        carry, row_idx, int(carry.get("_page", 0)), ocr=True,
    )


def _finalize_word_txn(
    data: dict, row_idx: int, page_number: int, ocr: bool = False,
) -> Transaction | None:
    """Convert word-mode row data into a Transaction."""
    if data.get("_date_obj"):
        txn_date = date.fromisoformat(data["_date_obj"])
    else:
        txn_date = parse_date(data.get("date", ""))
    date_was_fuzzy = bool(data.get("_date_fuzzy"))
    # Time from the date field first (shared "Date & Time" cell), else the raw
    # row. Best-effort, tiebreaker only.
    txn_time = parse_time(data.get("date", "")) or parse_time(data.get("_raw", ""))
    description = re.sub(r"\s+", " ", data.get("description", "")).strip()

    # Handle single "amount" column
    parse_amt = parse_amount_ocr if ocr else parse_amount
    debit = parse_amt(data.get("debit", ""))
    credit = parse_amt(data.get("credit", ""))
    balance = parse_amt(data.get("balance", ""))

    if debit is None and credit is None:
        amount = parse_amt(data.get("amount", ""))
        if amount:
            direction = classify_direction_from_text(data.get("direction", ""))
            if direction is None:
                direction = classify_direction_from_text(description)
            if direction == "credit":
                credit = amount
            elif direction == "debit":
                debit = amount
            else:
                debit = amount

    if not description and txn_date is None and debit is None and credit is None:
        return None

    # Reference
    reference = None
    if description:
        ref_match = re.search(r"\b([A-Z0-9]{8,})\b", description)
        reference = ref_match.group(1) if ref_match else None

    # Confidence
    confidence = 1.0
    needs_review = False
    review_reason = None

    if txn_date is None:
        confidence -= 0.3
        needs_review = True
        review_reason = "Could not parse date"
    elif date_was_fuzzy:
        # A date RECONSTRUCTED from garbled OCR ('0310712026' -> 03/07/2026) is
        # a guess that happens to be plausible, so it is flagged like any other
        # guess. Recording the reason without the flag hid it twice over: the
        # review surface renders a reason only when `needs_review` is set, so
        # the user was never told the date was inferred — and the chain solver
        # would then overwrite the unguarded reason with None the moment the
        # segment's arithmetic checked out, erasing the provenance entirely.
        confidence = min(confidence, 0.85)
        needs_review = True
        review_reason = "Date recovered from OCR-garbled text"
    if debit is None and credit is None:
        confidence -= 0.2
        needs_review = True
        review_reason = review_reason or "No debit or credit"
    if balance is None:
        confidence -= 0.1

    return Transaction(
        row_index=row_idx,
        txn_date=txn_date,
        txn_time=txn_time,
        description=description,
        reference=reference,
        debit=debit,
        credit=credit,
        balance=balance,
        confidence=round(max(confidence, 0.0), 2),
        raw_text=data.get("_raw", ""),
        needs_review=needs_review,
        review_reason=review_reason,
        page_number=page_number,
    )


# ────────────────────────────────────────────────────────────────────
# PUBLIC API
# ────────────────────────────────────────────────────────────────────

def _is_numeric_like(cell: str | None) -> bool:
    if cell is None:
        return False
    t = str(cell).strip()
    if not t:
        return False
    t = _CURRENCY_PREFIX.sub("", t).replace(",", "").replace("-", "").strip()
    try:
        float(t)
        return True
    except ValueError:
        return False


def _merge_fragment_tables(
    tables: list[list[list[str | None]]],
) -> list[list[list[str | None]]]:
    """
    pdfplumber occasionally splits one logical column off into a separate
    single-column "fragment" table (e.g. the Deposit column extracted on
    its own). When the fragment's row count matches a sibling table's
    data-row count and the sibling has an all-None column with a known
    amount-like header, merge the fragment's values into that column.

    Returns a new list with fragments consumed.
    """
    if not tables or len(tables) < 2:
        return tables

    # Identify fragment tables: single-column, mostly numeric
    fragment_idxs: list[int] = []
    for i, t in enumerate(tables):
        if not t:
            continue
        max_cols = max(len(r) for r in t)
        if max_cols != 1:
            continue
        values = [r[0] for r in t if r]
        if not values:
            continue
        numeric = sum(1 for v in values if _is_numeric_like(v))
        if numeric / max(len(values), 1) >= 0.6:
            fragment_idxs.append(i)

    if not fragment_idxs:
        return tables

    out: list[list[list[str | None]]] = [list(t) for t in tables]
    consumed: set[int] = set()

    for frag_idx in fragment_idxs:
        frag = tables[frag_idx]
        frag_values = [r[0] if r else None for r in frag]

        # Find a host table whose data-row count matches the fragment
        for host_idx, host in enumerate(out):
            if host_idx == frag_idx or host_idx in consumed:
                continue
            if not host or len(host) < 2:
                continue

            host_cmap = detect_column_roles(host[0])
            if host_cmap.is_empty:
                continue

            # Check for an amount-like role column that is all-None in data rows
            for col_idx, role in host_cmap.roles.items():
                if role not in ("debit", "credit", "amount", "balance"):
                    continue
                data_rows = host[1:]
                col_vals = [
                    r[col_idx] if col_idx < len(r) else None for r in data_rows
                ]
                if any(v not in (None, "") for v in col_vals):
                    continue  # column already has data — not a merge candidate

                # Row counts must match (fragment maps 1:1 to data rows)
                if len(frag_values) != len(data_rows):
                    continue

                log.info(
                    "Merging fragment table %d → host %d col %d (%s)",
                    frag_idx, host_idx, col_idx, role,
                )
                for i, val in enumerate(frag_values):
                    row = list(data_rows[i])
                    while len(row) <= col_idx:
                        row.append(None)
                    row[col_idx] = val
                    out[host_idx][i + 1] = row
                consumed.add(frag_idx)
                break
            if frag_idx in consumed:
                break

    return [t for i, t in enumerate(out) if i not in consumed]


def _shift_role_to_adjacent_column(
    table: list[list[str | None]], cmap: ColumnMap, data_start: int,
) -> None:
    """
    If a role-bearing column is all-None in data rows but an adjacent
    column has no role and contains numeric-looking data, shift the role
    to the adjacent column. This repairs pdfplumber's off-by-one column
    alignment errors in misaligned tables.

    Mutates cmap.roles in place.
    """
    if cmap.is_empty or not table or data_start >= len(table):
        return
    data_rows = table[data_start:]
    if not data_rows:
        return

    assigned_cols = set(cmap.roles.keys())

    for col_idx, role in list(cmap.roles.items()):
        if role not in ("debit", "credit", "amount"):
            continue
        # Is this column all None / empty in data?
        col_vals = [
            r[col_idx] if col_idx < len(r) else None for r in data_rows
        ]
        if any(str(v or "").strip() for v in col_vals):
            continue

        # Find an adjacent unassigned column with numeric-looking data
        for adj in (col_idx + 1, col_idx - 1):
            if adj < 0 or adj in assigned_cols:
                continue
            adj_vals = [
                r[adj] if adj < len(r) else None for r in data_rows
            ]
            numeric = sum(1 for v in adj_vals if _is_numeric_like(v))
            if numeric >= max(1, len(adj_vals) // 3):
                log.info(
                    "Shifting role %s: col %d → col %d (col %d all-None)",
                    role, col_idx, adj, col_idx,
                )
                cmap.roles.pop(col_idx)
                cmap.roles[adj] = role
                assigned_cols.discard(col_idx)
                assigned_cols.add(adj)
                break


def build_rows(
    page_result: PageResult,
    tables: list[list[list[str | None]]] | None,
    words: list[dict] | None,
    row_offset: int = 0,
    known_table_columns: ColumnMap | None = None,
    known_word_columns: WordColumnMap | None = None,
    is_scanned: bool = False,
    word_carry_in: dict | None = None,
) -> tuple[PageResult, ColumnMap | None, WordColumnMap | None, dict | None]:
    """
    Build transaction rows for a page.

    Tier 1: Try table-based extraction
    Tier 2: Fall back to word-position extraction

    Returns:
        (updated PageResult, learned table ColumnMap, learned WordColumnMap,
        open word-mode transaction carried to the next page — scanned only)
        The learned maps (and carry) should be passed to the next page.
    """
    all_txns: list[Transaction] = []
    all_skipped: list[str] = []
    out_tcmap = known_table_columns
    out_wcmap = known_word_columns
    word_carry_out: dict | None = None

    # ── Tier 1: Tables ──
    if tables:
        tables = _merge_fragment_tables(tables)
        for table in tables:
            if not table or len(table) < 1:
                continue

            txns, skips, learned = build_from_table(
                table, page_result.page_number, row_offset + len(all_txns),
                known_columns=out_tcmap,
            )
            all_txns.extend(txns)
            all_skipped.extend(skips)
            if learned and not learned.is_empty:
                out_tcmap = learned

    # Eagerly learn the word-column map from this page's header, even when
    # Tier 1 succeeded. pdfplumber often renders only the FIRST page's
    # transaction table as a composite table and splits continuation pages
    # into single-column fragment tables (no repeat header), so Tier 1 on
    # later pages yields nothing. If we captured the word header while it
    # was visible, Tier 2 below can cover those later pages seamlessly.
    if words and (out_wcmap is None or out_wcmap.is_empty):
        _, learned_wcmap = detect_header_words(words)
        if not learned_wcmap.is_empty:
            out_wcmap = learned_wcmap

    # ── Tier 2: Word-position mode ──
    # Run as a *preview* when Tier 1 produced rows but looks weak (most
    # descriptions empty), so we can compare and pick the better output.
    # pdfplumber occasionally fails to capture the Details cell from the
    # transaction table even when the text is present — in that case
    # word-position extraction reads it directly from the coordinates and
    # wins. But the word-header detector sometimes misses columns too (short
    # headers, unusual spacing), and when it does, Tier 2 can produce worse
    # output than Tier 1. The only reliable call is to run both and compare.
    tier1_empty_desc = sum(
        1 for t in all_txns if not (t.description or "").strip()
    )
    needs_preview = (
        words
        and (
            not all_txns
            or (all_txns and tier1_empty_desc / len(all_txns) >= 0.5)
        )
    )

    if needs_preview:
        txns, skips, learned, carry = build_from_words(
            words, page_result.page_number, row_offset,
            known_word_columns=out_wcmap,
            is_scanned=is_scanned,
            carry_in=word_carry_in if is_scanned else None,
        )

        if not all_txns:
            # No Tier 1 output — take whatever Tier 2 produced.
            all_txns.extend(txns)
            all_skipped.extend(skips)
            word_carry_out = carry
            if learned and not learned.is_empty:
                out_wcmap = learned
        else:
            tier2_populated_desc = sum(
                1 for t in txns if (t.description or "").strip()
            )
            tier1_populated_desc = len(all_txns) - tier1_empty_desc
            # Swap only if word mode actually recovers more descriptions.
            # Requiring strictly more (not equal) prevents thrashing when
            # both tiers yield the same empty rows.
            if tier2_populated_desc > tier1_populated_desc and txns:
                log.info(
                    "Page %d: swapping table-mode (%d/%d populated desc) "
                    "for word-mode (%d/%d populated desc)",
                    page_result.page_number,
                    tier1_populated_desc, len(all_txns),
                    tier2_populated_desc, len(txns),
                )
                all_txns = list(txns)
                all_skipped = list(skips)
                word_carry_out = carry
                if learned and not learned.is_empty:
                    out_wcmap = learned
            elif is_scanned and word_carry_in:
                # Tier 2 output discarded but it consumed the incoming carry:
                # finalize the carried transaction so it isn't lost.
                #
                # Prefer Tier 2's carry over the one we came in with. When it
                # met no dated row (`txns` empty) its carry IS word_carry_in
                # with this page's continuation lines merged in — the same
                # transaction, only more complete. Flushing the raw incoming
                # carry instead would throw that description and any
                # back-filled amounts away. Once Tier 2 has closed a
                # transaction, though, its carry is a DIFFERENT row that lives
                # in the output we just discarded, so it must not be used.
                pending = carry if (carry and not txns) else word_carry_in
                _prepend_carried_txn(
                    all_txns, pending, row_offset, page_result.page_number,
                )
    elif is_scanned and word_carry_in:
        # Word mode didn't run on this page (tier 1 satisfied it) — flush the
        # incoming carry so the previous page's open transaction survives.
        _prepend_carried_txn(
            all_txns, word_carry_in, row_offset, page_result.page_number,
        )

    page_result.transactions = all_txns
    page_result.skipped_lines = all_skipped

    mode = "table" if tables and all_txns else ("words" if words and all_txns else "none")
    log.info(
        "Page %d: %d transactions (%s mode), %d skipped",
        page_result.page_number, len(all_txns), mode, len(all_skipped),
    )

    return page_result, out_tcmap, out_wcmap, word_carry_out
