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
from app.services.analytics import categorize, load_all_results
from app.utils.logger import get_logger

log = get_logger(__name__)


Scope = Literal["personal", "business"]


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


def load_statement_txns_in_range(user_id: int, start: date, end: date) -> tuple[list[dict], int, int]:
    """All statement transactions for a user where txn_date ∈ [start, end].

    Returns `(transactions, upload_count, result_count)`. `upload_count` is
    the number of uploads in the user's `Upload` table; `result_count` is the
    number that actually have a result JSON on disk. The difference (e.g.
    encrypted PDFs that failed extraction) is surfaced in the response notes.
    """
    results = load_all_results(user_id)
    seen: set[tuple] = set()
    out: list[dict] = []
    for result in results:
        job_id = result.get("job_id")
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
        category, _ = categorize(t.get("description"))

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


def _match_withdrawals(
    withdrawals: list[dict],
    pool: list[dict],
    range_end: date,
) -> list[ReconciliationGroup]:
    """Greedy window-based clustering of receipts/entries against cash withdrawals."""

    sorted_w = sorted(withdrawals, key=lambda t: _parse_date(t.get("txn_date")) or range_end)
    groups: list[ReconciliationGroup] = []

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
        # Window: from withdrawal date until the day before the next
        # withdrawal, capped at +7 days, capped at the range end.
        upper = d_w + timedelta(days=7)
        if next_w_date:
            upper = min(upper, next_w_date - timedelta(days=1))
        upper = min(upper, range_end)
        if upper < d_w:
            upper = d_w

        # Pick unconsumed candidates whose date is in the window, largest first.
        in_window = [c for c in pool if not c.get("_consumed") and d_w <= c["_date"] <= upper]
        in_window.sort(key=lambda c: c["_amount"], reverse=True)

        explained = 0.0
        picked: list[dict] = []
        for c in in_window:
            if explained >= amount:
                break
            picked.append(c)
            explained += c["_amount"]
            c["_consumed"] = True
        capped = min(explained, amount)

        groups.append(ReconciliationGroup(
            kind="withdrawal",
            txn_date=d_w.isoformat(),
            description=(w.get("description") or "").strip()[:200] or "Withdrawal",
            debit_amount=round(amount, 2),
            explained_amount=round(capped, 2),
            status=_status(capped, amount),  # type: ignore[arg-type]
            candidates=[_make_candidate(c) for c in picked],
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
    "You receive a list of cash outflows from a bank statement, plus the "
    "receipts and manual entries that may explain each one. For every "
    "group, write a 1-2 sentence coaching note in TZS terms. Be specific "
    "(mention vendor, amount, recurrence). NEVER fabricate amounts. If "
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
            "debit_amount": g.debit_amount,
            "status": g.status,
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
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(f"{_LLM_SYSTEM}\n\nDATA:\n{payload}")
        return (getattr(response, "text", "") or "").strip() or None
    except Exception as exc:
        log.warning("Gemini reconcile call failed (%s)", exc.__class__.__name__)
        return None


def _try_openrouter(payload: str) -> Optional[str]:
    if not settings.openrouter_api_key:
        return None
    import httpx
    models = [
        settings.openrouter_model,
        "minimax/minimax-m2:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemma-2-9b-it:free",
    ]
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
) -> ReconciliationResponse:
    txns, _, result_count = load_statement_txns_in_range(user_id, start, end)
    receipts = load_receipts_in_range(user_id, start, end)
    entries = load_manual_entries_in_range(db, user_id, start, end, scope)

    upload_count = (
        db.query(Upload)
        .filter(Upload.user_id == user_id)
        .count()
    )

    notes: list[str] = []
    if upload_count > result_count:
        notes.append(
            f"{upload_count - result_count} upload(s) had no extraction result on disk and were skipped."
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
        patterns=patterns,
        overall_summary=overall,
        llm_status=llm_status,
        notes=notes,
    )
