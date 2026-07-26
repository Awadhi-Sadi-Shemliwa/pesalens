"""Cross-source reconciliation — join statements, receipts, and manual entries.

For a given date range we pull every "money out" event from the user's bank
statements (cash withdrawals, POS / direct debits, transfers) and try to
pair each one with the receipts and manual entries that plausibly explain
it. The output is a tabular grouping plus a rolled-up "blind-spot" KPI:

    | From statement              | Potential usage                    | Status  |
    |-----------------------------|------------------------------------|---------|
    | 400,000 withdrawal · Tue 14 | 200,000 supermarket (receipt)      | fully   |
    |                             | 200,000 oil filter (manual)        |         |

When the date range spans ≥30 days we also surface retrospective patterns:
recurring withdrawal leaks, top-vendor concentration, and monthly
blind-spot trend — these answer "what's the value of historical data?"
for users who upload months of past statements without ever scanning a
receipt.

The matching is deterministic. An LLM (Gemini → OpenRouter, mirroring
`app/routers/assistant.py`) is consulted at the end to add a 1–2-sentence
coaching note per group, but the deterministic part is what ships first
— if both providers fail the response still carries the table + KPIs.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Iterable, Literal, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.db import BusinessEntry, PersonalEntry, Upload
from app.routers.receipts import _load_receipts, _receipt_amount
from app.schemas.reconciliation import (
    ChargesSummary,
    HistoricalPatterns,
    MonthlyBlindSpot,
    ReconciliationCandidate,
    ReconciliationGroup,
    ReconciliationKpis,
    ReconciliationRange,
    ReconciliationResponse,
    RecurringWithdrawal,
    TopVendor,
)
from app.services.analytics import (
    _infer_period,
    category_for,
    charges_and_interest_in_range,
    effective_stmt,
    load_all_results,
    load_result,
    newest_job_id,
)
from app.utils.logger import get_logger

log = get_logger(__name__)


Scope = Literal["personal", "business"]

# Rounding tolerance (TZS) when comparing two amounts/budgets so float noise
# doesn't flip a sufficiency or remaining-budget test.
_AMOUNT_EQ_TOL = 1.0

# A cash withdrawal (or set of them) must be able to fund at least this share of
# a receipt before we attribute the receipt to it. Below this, the purchase was
# mostly paid from other funds, so the receipt stays in the unmatched ledger at
# full amount instead of being consumed behind a token credit.
_MIN_ATTRIB_FRACTION = 0.5


# ---------------------------------------------------------------------------
# Source loaders
# ---------------------------------------------------------------------------

def _parse_date(raw) -> Optional[date]:
    """Best-effort coercion of mixed-source date values (str, date, datetime)."""
    if raw is None:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return None
        # Statements / entries store ISO YYYY-MM-DD; receipts may carry full ISO.
        try:
            return datetime.fromisoformat(s.replace("Z", "")).date()
        except ValueError:
            try:
                return datetime.strptime(s[:10], "%Y-%m-%d").date()
            except ValueError:
                return None
    return None


def _txn_dedupe_key(t: dict) -> tuple:
    """Identity for collapsing duplicate transactions across overlapping uploads.

    Two uploads covering the same week would otherwise double-count every
    transaction in the overlap; we collapse on (date, debit, credit, head of
    description).
    """
    return (
        str(t.get("txn_date") or "")[:10],
        float(t.get("debit") or 0),
        float(t.get("credit") or 0),
        (t.get("description") or "")[:60].strip().lower(),
    )


def load_statement_txns_in_range(
    user_id: int, start: date, end: date, job_id: Optional[str] = None
) -> tuple[list[dict], int, int]:
    """All statement transactions for a user where txn_date ∈ [start, end].

    Returns `(transactions, upload_count, result_count)`. `upload_count` is
    the number of uploads in the user's `Upload` table; `result_count` is the
    number that actually have a result JSON on disk. The difference (e.g.
    encrypted PDFs that failed extraction) is surfaced in the response notes.

    When `job_id` is given, only that statement's result is scanned. This is
    load-bearing for statement-scoped reconciliation: the cross-upload dedupe
    below collapses identical rows and keeps the FIRST occurrence (oldest
    upload), so filtering by job_id AFTER a global dedupe would silently drop a
    target-statement row that an overlapping older statement already claimed.
    Restricting the result set up front makes the dedupe operate only within
    the one statement (whose rows are naturally unique) — and reads just that
    one JSON instead of scanning the whole archive.
    """
    if job_id is not None:
        one = load_result(user_id, job_id)
        results = [one] if one else []
    else:
        results = load_all_results(user_id)
    seen: set[tuple] = set()
    out: list[dict] = []
    for result in results:
        job_id = result.get("job_id")
        # Provider that issued this statement — lets the matcher attribute a
        # receipt to the right service and the UI show "NMB · 13:40".
        bank = (result.get("metadata") or {}).get("bank")
        for t in result.get("transactions") or []:
            txn_date = _parse_date(t.get("txn_date"))
            if not txn_date or not (start <= txn_date <= end):
                continue
            key = _txn_dedupe_key(t)
            if key in seen:
                continue
            seen.add(key)
            row = dict(t)
            row["_job_id"] = job_id
            row["_txn_date"] = txn_date
            row["_bank"] = bank
            row["_txn_time"] = t.get("txn_time")
            out.append(row)
    out.sort(key=lambda r: r["_txn_date"])
    return out, len(results), len(results)


def load_receipts_in_range(user_id: int, start: date, end: date) -> list[dict]:
    """Receipts whose effective date falls in [start, end].

    When a receipt's OCR'd `date` is missing we fall back to the upload-time
    `scanned_at` date and stamp `_date_inferred=True`; the UI uses this to
    show a "(scan date)" hint so the user knows the match is fuzzier.
    """
    raw = _load_receipts(user_id)
    out: list[dict] = []
    for r in raw:
        candidate = r.get("date")
        date_inferred = False
        d = _parse_date(candidate)
        if not d:
            scanned_at = r.get("scanned_at")
            d = _parse_date(scanned_at)
            date_inferred = bool(d)
        if not d or not (start <= d <= end):
            continue
        amount = _receipt_amount(r)
        if amount <= 0:
            continue
        out.append({
            "_date": d,
            "_date_inferred": date_inferred,
            "_amount": float(amount),
            "_stmt": r.get("statement_job_id"),
            "vendor": r.get("vendor"),
            "category": (r.get("category") or "").lower() or None,
            "id": r.get("id"),
        })
    out.sort(key=lambda r: r["_date"])
    return out


def load_manual_entries_in_range(
    db: Session, user_id: int, start: date, end: date, scope: Scope
) -> list[dict]:
    """Personal + business expense entries within [start, end].

    Entries are SQL-native, so this is a cheap indexed query. We always
    include both personal and business expense rows when scope=personal so
    users with a side hustle still see SME purchases against personal cash
    withdrawals; scope=business excludes PersonalEntry to keep the books
    clean.
    """
    s = start.isoformat()
    e = end.isoformat()
    out: list[dict] = []

    if scope == "personal":
        for row in (
            db.query(PersonalEntry)
            .filter(
                PersonalEntry.user_id == user_id,
                PersonalEntry.direction == "expense",
                PersonalEntry.entry_date >= s,
                PersonalEntry.entry_date <= e,
            )
            .all()
        ):
            d = _parse_date(row.entry_date)
            if not d:
                continue
            out.append({
                "_date": d,
                "_amount": float(row.amount or 0),
                "_source": "personal",
                "_stmt": row.statement_job_id,
                "vendor": row.vendor,
                "category": row.category,
                "id": row.id,
            })

    # Business entries — include for both scopes (business expenses still
    # consume the personal cash a sole-trader withdraws).
    for row in (
        db.query(BusinessEntry)
        .filter(
            BusinessEntry.user_id == user_id,
            BusinessEntry.account_class == "expense",
            BusinessEntry.entry_date >= s,
            BusinessEntry.entry_date <= e,
        )
        .all()
    ):
        d = _parse_date(row.entry_date)
        if not d:
            continue
        out.append({
            "_date": d,
            "_amount": float(row.amount or 0),
            "_source": "business",
            "_stmt": None,  # business entries carry no statement association
            "vendor": row.vendor,
            "category": row.category,
            "id": row.id,
        })

    out.sort(key=lambda r: r["_date"])
    return out


# ---------------------------------------------------------------------------
# Debit classification
# ---------------------------------------------------------------------------

_WITHDRAWAL_TOKENS = ("withdraw", "atm", "cash out", "cardless", "cash-out")
_POS_TOKENS = ("pos ", "lipa", "paid to", "purchase", "card payment", "merchant", "tigo lipa", "selcom")
_TRANSFER_TOKENS = ("transfer to", "ft to", "ft from", "to a/c", "from a/c", "send money")
_OWN_ACCOUNT_TOKENS = ("own account", "to self", "self-transfer", "between own")


def _has_token(text: str, tokens: Iterable[str]) -> bool:
    return any(tok in text for tok in tokens)


def classify_debits(txns: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Bucket debits into withdrawals, POS/direct, and transfers.

    Returns three lists in the same order as classification — credits are
    discarded since they don't represent money leaving the account.
    """
    withdrawals: list[dict] = []
    pos_direct: list[dict] = []
    transfers: list[dict] = []

    for t in txns:
        debit = float(t.get("debit") or 0)
        if debit <= 0:
            continue
        desc_lower = (t.get("description") or "").lower()
        category, _ = category_for(t)

        if _has_token(desc_lower, _WITHDRAWAL_TOKENS) or category.lower().startswith("withdrawal"):
            withdrawals.append(t)
        elif _has_token(desc_lower, _POS_TOKENS):
            pos_direct.append(t)
        elif _has_token(desc_lower, _TRANSFER_TOKENS):
            transfers.append(t)
        else:
            # Unclassified debits get bucketed into POS_DIRECT so they still
            # get the per-row matching pass — better to attempt a 1-1 link
            # than to drop them silently.
            pos_direct.append(t)
    return withdrawals, pos_direct, transfers


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

# Display names for BankFormat values — used in attribution notes. Acronym
# banks stay upper-case; mobile-money brands read as words.
BANK_LABEL = {
    "crdb": "CRDB", "nmb": "NMB", "nbc": "NBC", "kcb": "KCB", "absa": "Absa",
    "amana": "Amana", "mpesa": "M-Pesa", "airtel_money": "Airtel Money",
    "tigo_pesa": "Tigo Pesa", "halo_pesa": "Halo Pesa", "selcom": "Selcom",
    "yas": "Yas", "unknown": "Unknown",
}


def _bank_label(bank: Optional[str]) -> str:
    if not bank:
        return "this service"
    return BANK_LABEL.get(str(bank).lower(), str(bank).upper())


def _time_to_min(hhmm: Optional[str]) -> Optional[int]:
    """'HH:MM' -> minutes since midnight, or None when absent/unparseable."""
    if not hhmm:
        return None
    try:
        h, m = str(hhmm).split(":")[:2]
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def _time_sort_key(hhmm: Optional[str]) -> int:
    """Ascending sort key by time-of-day; untimed rows sort after timed ones."""
    m = _time_to_min(hhmm)
    return m if m is not None else 24 * 60 + 1


def _fmt_amt(v: float) -> str:
    return f"TZS {v:,.0f}"


def _make_candidate(c: dict) -> ReconciliationCandidate:
    if "_source" in c:
        source = c["_source"]
    else:
        source = "receipt"
    ref_id = c.get("id")
    return ReconciliationCandidate(
        source=source,
        date=c["_date"].isoformat(),
        date_inferred=bool(c.get("_date_inferred")),
        vendor=c.get("vendor"),
        category=c.get("category"),
        amount=float(c["_amount"]),
        ref_id=str(ref_id) if ref_id is not None else None,
    )


def _status(explained: float, debit: float) -> str:
    if debit <= 0:
        return "blind_spot"
    ratio = explained / debit
    if ratio >= 0.95:
        return "fully_explained"
    if ratio >= 0.30:
        return "partial"
    return "blind_spot"


def _attr_score(we: dict, c: dict) -> float:
    """Higher = a better cash withdrawal to attribute this candidate to.

    Feasibility (the withdrawal still has budget to fully cover the purchase) is
    enforced by the CALLER — this only ORDERS the survivors. So it rewards date
    proximity (same-day best, decaying across the window) and, on the same day,
    the most recent withdrawal (the fresher cash on hand). It does NOT compare
    the purchase's time-of-day: receipts and manual entries don't carry a
    reliable time, so any such comparison would be fabricated.
    """
    score = 0.0
    # Date proximity: same-day best, decaying across the window.
    days_gap = (c["_date"] - we["d"]).days
    score += max(0.0, 20.0 - days_gap)
    # Same-day tiebreak: prefer the later (more recent) withdrawal — it held the
    # freshest cash before the purchase. Uses only the withdrawal's OWN time.
    if days_gap == 0:
        w_min = _time_to_min(we.get("time"))
        if w_min is not None:
            score += w_min / 1440.0  # 0..~1, later in the day ranks higher
    return score


def _attribution_note(winner: dict, rival: dict, c: dict) -> Optional[str]:
    """One-line explanation of why `winner` claimed `c` over a rival provider.

    Two truthful cases: the rival was too SMALL to cover the purchase (the
    sufficiency rule the money-map is built around), or both could cover it and
    the winner was the more recent large-enough withdrawal.
    """
    vendor = (c.get("vendor") or c.get("category") or "this purchase")
    amt = _fmt_amt(float(c["_amount"]))
    wlabel = _bank_label(winner.get("bank"))
    rlabel = _bank_label(rival.get("bank"))
    wt = f" {winner['time']}" if winner.get("time") else ""
    if rival["amount"] + _AMOUNT_EQ_TOL < float(c["_amount"]):
        # Sufficiency drove it — the rival couldn't cover the purchase.
        return (
            f"{amt} {vendor} attributed to {wlabel}{wt} — {rlabel}'s "
            f"{_fmt_amt(rival['amount'])} withdrawal was too small to cover it."
        )
    # Both sufficient — the winner is the most recent withdrawal large enough
    # to cover it (see _attr_score for the ordering).
    rt = f" {rival['time']}" if rival.get("time") else ""
    return (
        f"{amt} {vendor} attributed to {wlabel}{wt} over {rlabel}{rt} — "
        "the most recent withdrawal large enough to cover it."
    )


def _match_withdrawals(
    withdrawals: list[dict],
    pool: list[dict],
    range_end: date,
) -> list[ReconciliationGroup]:
    """Attribute receipts/entries to the cash withdrawal that best explains them.

    Each withdrawal gets a window [date, min(next-withdrawal-1, +7d, range_end)]
    and a remaining-amount budget. Every candidate is assigned to the feasible
    withdrawal with the highest `_attr_score`, so when two same-day withdrawals
    from different services could both explain a purchase, the sufficient,
    closest-in-time one wins — and we record why in `attribution_note`.
    """
    sorted_w = sorted(
        withdrawals,
        key=lambda t: (_parse_date(t.get("txn_date")) or range_end,
                       _time_sort_key(t.get("_txn_time"))),
    )

    # Build each withdrawal's window + mutable remaining budget.
    wentries: list[dict] = []
    for i, w in enumerate(sorted_w):
        d_w = _parse_date(w.get("txn_date"))
        if not d_w:
            continue
        amount = float(w.get("debit") or 0)
        if amount <= 0:
            continue
        next_w_date = None
        for j in range(i + 1, len(sorted_w)):
            n = _parse_date(sorted_w[j].get("txn_date"))
            if n and n > d_w:
                next_w_date = n
                break
        upper = d_w + timedelta(days=7)
        if next_w_date:
            upper = min(upper, next_w_date - timedelta(days=1))
        upper = min(upper, range_end)
        if upper < d_w:
            upper = d_w
        wentries.append({
            "w": w, "d": d_w, "amount": amount, "remaining": amount,
            "upper": upper, "time": w.get("_txn_time"), "bank": w.get("_bank"),
            "picked": [], "explained": 0.0, "note": None,
        })

    # Attribute each candidate across the withdrawals whose window covers it
    # (oldest purchases claim budget first). We credit each withdrawal only by
    # the portion it can actually fund (`min(remaining, still-unattributed)`), so:
    #   • an exhausted withdrawal can't swallow a receipt and add ~0 to explained
    #     (the vanishing bug) — it simply contributes nothing;
    #   • a fresh withdrawal SMALLER than the receipt still gets partial credit
    #     (it's not a blind spot just because one purchase exceeded it) and the
    #     receipt spills onto the next withdrawal.
    # Guardrails:
    #   • a receipt is attributed only when the in-window withdrawals can fund a
    #     MEANINGFUL share of it (`_MIN_ATTRIB_FRACTION`); otherwise it's mostly
    #     other-funds spend and belongs in the unmatched ledger at full amount,
    #     not hidden behind a token credit;
    #   • each group shows the receipt at the CONTRIBUTED amount for that
    #     withdrawal (not the full amount), so a split receipt isn't double-shown.
    for c in sorted(
        (c for c in pool if not c.get("_consumed")), key=lambda c: c["_date"]
    ):
        c_amount = float(c["_amount"])
        # Withdrawals whose window contains the purchase date, best first.
        in_window = [
            we for we in wentries if we["d"] <= c["_date"] <= we["upper"]
        ]
        usable = sorted(
            (we for we in in_window if we["remaining"] > _AMOUNT_EQ_TOL),
            key=lambda we: _attr_score(we, c),
            reverse=True,
        )
        # Leave the receipt in the pool (→ unmatched ledger) when nothing can
        # fund it, or when the available budget can't explain a meaningful share.
        total_available = sum(we["remaining"] for we in usable)
        if not usable or total_available + _AMOUNT_EQ_TOL < c_amount * _MIN_ATTRIB_FRACTION:
            continue
        best = usable[0]
        remaining_to_attribute = c_amount
        for we in usable:
            if remaining_to_attribute <= _AMOUNT_EQ_TOL:
                break
            contribution = min(we["remaining"], remaining_to_attribute)
            if contribution <= _AMOUNT_EQ_TOL:
                continue
            we["remaining"] -= contribution
            we["explained"] += contribution
            # Show the portion THIS withdrawal funded, so a receipt split across
            # withdrawals isn't rendered at full amount in each group.
            we["picked"].append({**c, "_amount": contribution})
            remaining_to_attribute -= contribution
        # A meaningful share was funded → the receipt is accounted for; keep it
        # out of the unmatched ledger (its contributions are shown in the groups).
        c["_consumed"] = True
        # Explain the attribution only when `best` could FULLY cover the purchase
        # — then "attributed to X" is a whole-purchase claim we can defend. Cite a
        # different-service rival that was too small (the money-map case), else a
        # genuine budget-holding runner-up (so "most recent large enough" holds).
        if best.get("note") is None and best["amount"] + _AMOUNT_EQ_TOL >= c_amount:
            too_small = next(
                (we for we in in_window
                 if we is not best
                 and (we.get("bank") or "") != (best.get("bank") or "")
                 and we["amount"] + _AMOUNT_EQ_TOL < c_amount),
                None,
            )
            rival = too_small or next(
                (we for we in usable
                 if we is not best
                 and (we.get("bank") or "") != (best.get("bank") or "")),
                None,
            )
            if rival is not None:
                best["note"] = _attribution_note(best, rival, c)

    groups: list[ReconciliationGroup] = []
    for we in wentries:
        explained = min(we["explained"], we["amount"])
        groups.append(ReconciliationGroup(
            kind="withdrawal",
            txn_date=we["d"].isoformat(),
            description=(we["w"].get("description") or "").strip()[:200] or "Withdrawal",
            debit_amount=round(we["amount"], 2),
            explained_amount=round(explained, 2),
            status=_status(explained, we["amount"]),  # type: ignore[arg-type]
            candidates=[_make_candidate(c) for c in we["picked"]],
            bank=we.get("bank"),
            time=we.get("time"),
            attribution_note=we.get("note"),
        ))
    return groups


_VENDOR_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


def _vendor_tokens(text: Optional[str]) -> set[str]:
    if not text:
        return set()
    return {tok for tok in _VENDOR_TOKEN_SPLIT.split(text.lower()) if len(tok) >= 3}


def _match_pos_direct(
    pos_direct: list[dict],
    pool: list[dict],
) -> list[ReconciliationGroup]:
    """1-1 link of POS/direct debits to receipts/entries by amount + date + vendor."""

    groups: list[ReconciliationGroup] = []
    for t in pos_direct:
        d_t = _parse_date(t.get("txn_date"))
        if not d_t:
            continue
        amount = float(t.get("debit") or 0)
        if amount <= 0:
            continue
        desc_tokens = _vendor_tokens(t.get("description"))

        match: Optional[dict] = None
        match_score = 0.0
        for c in pool:
            if c.get("_consumed"):
                continue
            if abs((c["_date"] - d_t).days) > 1:
                continue
            ratio = abs(c["_amount"] - amount) / max(amount, 1.0)
            if ratio > 0.05:
                continue
            cand_tokens = _vendor_tokens(c.get("vendor")) | _vendor_tokens(c.get("category"))
            overlap = bool(desc_tokens & cand_tokens)
            score = (1.0 - ratio) + (0.4 if overlap else 0.0)
            if score > match_score:
                match = c
                match_score = score

        bank = t.get("_bank")
        t_time = t.get("_txn_time")
        if match:
            match["_consumed"] = True
            explained = min(float(match["_amount"]), amount)
            groups.append(ReconciliationGroup(
                kind="pos",
                txn_date=d_t.isoformat(),
                description=(t.get("description") or "").strip()[:200] or "Card / POS",
                debit_amount=round(amount, 2),
                explained_amount=round(explained, 2),
                status=_status(explained, amount),  # type: ignore[arg-type]
                candidates=[_make_candidate(match)],
                bank=bank,
                time=t_time,
            ))
        else:
            groups.append(ReconciliationGroup(
                kind="pos",
                txn_date=d_t.isoformat(),
                description=(t.get("description") or "").strip()[:200] or "Card / POS",
                debit_amount=round(amount, 2),
                explained_amount=0.0,
                status="blind_spot",
                candidates=[],
                bank=bank,
                time=t_time,
            ))
    return groups


def _match_transfers(transfers: list[dict], scope: Scope) -> list[ReconciliationGroup]:
    """Transfers are always blind-spots in v1 — we don't try to cross-link them."""
    out: list[ReconciliationGroup] = []
    for t in transfers:
        desc_lower = (t.get("description") or "").lower()
        # Suppress own-account moves — they're not real outflows.
        if scope == "business" and _has_token(desc_lower, _OWN_ACCOUNT_TOKENS):
            continue
        d_t = _parse_date(t.get("txn_date"))
        if not d_t:
            continue
        amount = float(t.get("debit") or 0)
        if amount <= 0:
            continue
        out.append(ReconciliationGroup(
            kind="transfer",
            txn_date=d_t.isoformat(),
            description=(t.get("description") or "").strip()[:200] or "Transfer",
            debit_amount=round(amount, 2),
            explained_amount=0.0,
            status="blind_spot",
            candidates=[],
            bank=t.get("_bank"),
            time=t.get("_txn_time"),
        ))
    return out


# ---------------------------------------------------------------------------
# Historical-pattern detection (range ≥ 30 days)
# ---------------------------------------------------------------------------

_WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _band_label(amount: float) -> str:
    band = int(amount // 50_000) * 50_000
    upper = band + 50_000
    return f"TZS {band/1000:.0f}K–{upper/1000:.0f}K"


def historical_patterns(
    txns: list[dict],
    receipts: list[dict],
    entries: list[dict],
    groups: list[ReconciliationGroup],
) -> HistoricalPatterns:
    # 1. Recurring withdrawals — bucketed by (weekday, 50k band).
    withdrawals = [t for t in txns if (t.get("debit") or 0) > 0
                   and any(tok in (t.get("description") or "").lower() for tok in _WITHDRAWAL_TOKENS)]
    buckets: dict[tuple, list[float]] = defaultdict(list)
    for w in withdrawals:
        d_w = _parse_date(w.get("txn_date"))
        if not d_w:
            continue
        amount = float(w.get("debit") or 0)
        buckets[(d_w.weekday(), int(amount // 50_000))].append(amount)
    recurring: list[RecurringWithdrawal] = []
    for (wd, band), amounts in buckets.items():
        if len(amounts) >= 4:
            recurring.append(RecurringWithdrawal(
                weekday=_WEEKDAY_NAMES[wd],
                band_label=_band_label(amounts[0]),
                occurrences=len(amounts),
                avg_amount=round(sum(amounts) / len(amounts), 2),
                total=round(sum(amounts), 2),
            ))
    recurring.sort(key=lambda r: r.total, reverse=True)

    # 2. Top vendors across receipts + entries.
    vendor_tot: dict[str, float] = defaultdict(float)
    vendor_count: dict[str, int] = defaultdict(int)
    vendor_sources: dict[str, set[str]] = defaultdict(set)
    for r in receipts:
        v = (r.get("vendor") or "").strip() or "(unknown vendor)"
        vendor_tot[v] += float(r["_amount"])
        vendor_count[v] += 1
        vendor_sources[v].add("receipt")
    for e in entries:
        v = (e.get("vendor") or "").strip() or "(unknown vendor)"
        vendor_tot[v] += float(e["_amount"])
        vendor_count[v] += 1
        vendor_sources[v].add(e["_source"])
    top_vendors = [
        TopVendor(
            vendor=v,
            total=round(tot, 2),
            occurrences=vendor_count[v],
            sources=sorted(vendor_sources[v]),
        )
        for v, tot in sorted(vendor_tot.items(), key=lambda kv: kv[1], reverse=True)[:3]
    ]

    # 3. Monthly blind-spot trend (groups already include all classified outflows).
    by_month: dict[str, dict[str, float]] = defaultdict(lambda: {"out": 0.0, "explained": 0.0})
    for g in groups:
        ym = g.txn_date[:7]
        by_month[ym]["out"] += g.debit_amount
        by_month[ym]["explained"] += g.explained_amount
    monthly = [
        MonthlyBlindSpot(
            month=ym,
            total_money_out=round(d["out"], 2),
            total_explained=round(d["explained"], 2),
            blind_spot_ratio=round(1 - (d["explained"] / d["out"]) if d["out"] > 0 else 0.0, 4),
        )
        for ym, d in sorted(by_month.items())
    ]

    return HistoricalPatterns(
        recurring_withdrawals=recurring,
        top_vendors=top_vendors,
        blind_spot_by_month=monthly,
    )


# ---------------------------------------------------------------------------
# LLM narrative — Gemini → OpenRouter, graceful fallback
# ---------------------------------------------------------------------------

_LLM_SYSTEM = (
    "You are PesaLens AI's reconciliation coach for a Tanzanian user. "
    "You receive a list of cash outflows from the user's bank / mobile-money "
    "statements, each tagged with the service (bank) and time it occurred, "
    "plus the receipts and manual entries that may explain each one. For every "
    "group, write a 1-2 sentence coaching note in TZS terms. Be specific "
    "(mention the service, vendor, amount, time, recurrence). When an "
    "attribution_note is present, it explains which service the spend was "
    "traced to — reinforce it. NEVER fabricate amounts. If "
    "status is blind_spot, ask one pointed question about where the cash "
    "likely went. Also write one short overall_summary. "
    "Return STRICT JSON: "
    "{\"overall_summary\": \"...\", \"group_insights\": [{\"idx\": 0, \"insight\": \"...\"}]}"
)

_LLM_TIMEOUT = 30.0


def _llm_payload(groups: list[ReconciliationGroup], kpis: ReconciliationKpis) -> str:
    rows = []
    for i, g in enumerate(groups):
        rows.append({
            "idx": i,
            "kind": g.kind,
            "txn_date": g.txn_date,
            "bank": g.bank,
            "time": g.time,
            "debit_amount": g.debit_amount,
            "status": g.status,
            "attribution_note": g.attribution_note,
            "candidates": [
                {"source": c.source, "date": c.date, "vendor": c.vendor, "amount": c.amount}
                for c in g.candidates[:5]
            ],
        })
    return json.dumps({
        "kpis": kpis.model_dump(),
        "groups": rows,
    }, ensure_ascii=False)


def _parse_llm_json(text: str) -> Optional[dict]:
    """Tolerate markdown fences and trailing text around the JSON envelope."""
    if not text:
        return None
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence_match:
        text = fence_match.group(1)
    else:
        # Greedy slice between first { and last } — handles preambles.
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    try:
        return json.loads(text)
    except Exception:
        return None


def _try_gemini(payload: str) -> Optional[str]:
    if not settings.gemini_api_key:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)
        # gemini-2.0-flash free-tier quota was reset to 0 in June 2026.
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(f"{_LLM_SYSTEM}\n\nDATA:\n{payload}")
        return (getattr(response, "text", "") or "").strip() or None
    except Exception as exc:
        log.warning("Gemini reconcile call failed (%s)", exc.__class__.__name__)
        return None


def _try_openrouter(payload: str) -> Optional[str]:
    if not settings.openrouter_api_key:
        return None
    import httpx
    # The old chain (minimax-m2, gemma-2-9b) was retired by OpenRouter in
    # 2026. Use the same currently-live slugs the assistant router uses.
    from app.routers.assistant import FALLBACK_MODELS
    models = [settings.openrouter_model, *FALLBACK_MODELS]
    seen: set[str] = set()
    for m in models:
        if not m or m in seen:
            continue
        seen.add(m)
        try:
            resp = httpx.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://pesalens.app",
                    "X-Title": "PesaLens",
                },
                json={
                    "model": m,
                    "messages": [
                        {"role": "system", "content": _LLM_SYSTEM},
                        {"role": "user", "content": payload},
                    ],
                    "max_tokens": 900,
                    "temperature": 0.3,
                },
                timeout=_LLM_TIMEOUT,
            )
            if resp.status_code in (400, 404, 429):
                continue
            resp.raise_for_status()
            data = resp.json()
            reply = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                or ""
            ).strip()
            if reply:
                return reply
        except Exception as exc:
            log.warning("OpenRouter reconcile model %s failed: %s", m, exc.__class__.__name__)
            continue
    return None


def llm_narrative(
    groups: list[ReconciliationGroup], kpis: ReconciliationKpis
) -> tuple[Optional[str], dict[int, str], str]:
    """Annotate groups with insights. Returns (overall_summary, per_idx_insight, status)."""
    if not groups:
        return None, {}, "skipped"
    payload = _llm_payload(groups, kpis)
    raw = _try_gemini(payload) or _try_openrouter(payload)
    if not raw:
        return None, {}, "unavailable"
    parsed = _parse_llm_json(raw)
    if not parsed:
        log.warning("LLM reconcile reply was not parseable JSON")
        return None, {}, "unavailable"
    overall = parsed.get("overall_summary")
    insights: dict[int, str] = {}
    for item in parsed.get("group_insights") or []:
        try:
            idx = int(item.get("idx"))
            insight = (item.get("insight") or "").strip()
            if insight:
                insights[idx] = insight
        except (TypeError, ValueError):
            continue
    return overall, insights, "ok"


# ---------------------------------------------------------------------------
# Top-level builder
# ---------------------------------------------------------------------------

def build_reconciliation(
    db: Session,
    user_id: int,
    start: date,
    end: date,
    scope: Scope,
    *,
    job_id: Optional[str] = None,
    mode: str = "general",
) -> ReconciliationResponse:
    """Cross-source reconciliation for a date range.

    `mode="general"` (default) is the historical behaviour — pool everything in
    [start, end]. `mode="statement"` with a `job_id` scopes the view to a single
    uploaded statement: its own transactions and only the receipts/entries
    associated with it (a NULL association resolves to the user's newest
    statement), over the statement's OWN period.
    """
    statement_mode = mode == "statement" and bool(job_id)

    # In statement mode the statement's own period is authoritative — derive it
    # so the range always covers exactly this statement (and the caller can skip
    # the range cap). Falls back to the passed range if the period is unknown.
    # Reads the ONE statement's JSON (not the whole archive) to keep this cheap.
    if statement_mode:
        result = load_result(user_id, job_id)
        if result:
            period = _infer_period(
                result.get("transactions") or [], result.get("metadata") or {}
            )
            p_start = _parse_date(period.get("start"))
            p_end = _parse_date(period.get("end"))
            if p_start and p_end:
                start, end = p_start, p_end

    # In statement mode, restrict the txn scan to the one statement UP FRONT so
    # the cross-upload dedupe can't steal an overlapping row from it (see
    # load_statement_txns_in_range). The receipt/entry pool is scoped by
    # association below.
    txns, _, result_count = load_statement_txns_in_range(
        user_id, start, end, job_id=job_id if statement_mode else None
    )
    receipts = load_receipts_in_range(user_id, start, end)
    entries = load_manual_entries_in_range(db, user_id, start, end, scope)

    if statement_mode:
        newest = newest_job_id(user_id, db=db)
        receipts = [r for r in receipts if effective_stmt(r.get("_stmt"), newest) == job_id]
        entries = [e for e in entries if effective_stmt(e.get("_stmt"), newest) == job_id]

    # Only SUCCESSFUL uploads have a result JSON to compare against. Rows are now
    # created at queue time, so counting every row here would make failed / in-
    # flight uploads permanently inflate the "skipped" note below.
    done_upload_count = (
        db.query(Upload)
        .filter(Upload.user_id == user_id, Upload.status == "done")
        .count()
    )

    notes: list[str] = []
    # Statement mode intentionally scans a single result, so `result_count` is 1
    # and this "missing results" note would be misleading — only emit it for the
    # general (all-statements) view.
    if not statement_mode and done_upload_count > result_count:
        notes.append(
            f"{done_upload_count - result_count} upload(s) had no extraction result on disk and were skipped."
        )
    if not txns and not receipts and not entries:
        notes.append("No data found for this date range. Upload a statement, scan receipts, or add manual entries.")

    # Single shared candidate pool (receipts ∪ expense entries) — receipts
    # and entries compete for the same statement debits, and we want the
    # `_consumed` flag to prevent a receipt being claimed by both a
    # withdrawal and a POS row.
    pool: list[dict] = []
    pool.extend(receipts)
    pool.extend(entries)

    withdrawals_t, pos_t, transfers_t = classify_debits(txns)

    groups: list[ReconciliationGroup] = []
    groups.extend(_match_withdrawals(withdrawals_t, pool, end))
    groups.extend(_match_pos_direct(pos_t, pool))
    groups.extend(_match_transfers(transfers_t, scope))
    groups.sort(key=lambda g: g.txn_date)

    # Everything in the pool the matcher didn't consume — receipts/entries with
    # no statement debit to pair against (common when the user has scanned
    # receipts but not yet uploaded the matching statement). These still belong
    # in the ledger so the user can SEE their recorded spend in reconciliation.
    #
    # Scope guard: business entries are still MATCHED against personal cash
    # withdrawals in personal scope (a sole-trader's SME spend consumes the cash
    # they pull out), so they legitimately appear inside groups. But an
    # UNMATCHED business entry is noise in a personal ledger — keep the personal
    # view personal by dropping it here.
    unmatched = [
        _make_candidate(c)
        for c in pool
        if not c.get("_consumed")
        and not (scope == "personal" and c.get("_source") == "business")
    ]
    unmatched.sort(key=lambda c: c.date, reverse=True)

    total_out = sum(g.debit_amount for g in groups)
    total_explained = sum(g.explained_amount for g in groups)
    kpis = ReconciliationKpis(
        total_money_out=round(total_out, 2),
        total_explained=round(total_explained, 2),
        blind_spot_ratio=round(1 - (total_explained / total_out) if total_out > 0 else 0.0, 4),
        group_count=len(groups),
        fully_explained=sum(1 for g in groups if g.status == "fully_explained"),
        partial=sum(1 for g in groups if g.status == "partial"),
        blind_spot=sum(1 for g in groups if g.status == "blind_spot"),
    )

    patterns: Optional[HistoricalPatterns] = None
    if (end - start).days >= 30:
        patterns = historical_patterns(txns, receipts, entries, groups)

    # Bank charges & interest — computed per-statement (correct balance chain)
    # then filtered to this date range. Independent of the debit↔receipt match.
    charges_summary = ChargesSummary(**charges_and_interest_in_range(user_id, start, end))

    overall, insights, llm_status = llm_narrative(groups, kpis)
    if insights:
        for i, g in enumerate(groups):
            if i in insights:
                g.insight = insights[i]

    return ReconciliationResponse(
        range=ReconciliationRange(start=start.isoformat(), end=end.isoformat()),
        scope=scope,
        kpis=kpis,
        groups=groups,
        unmatched_candidates=unmatched,
        patterns=patterns,
        charges_summary=charges_summary,
        overall_summary=overall,
        llm_status=llm_status,
        notes=notes,
    )
