"""Analytics aggregation across saved extraction results.

Reads previously-saved result JSONs from storage and computes:
  - dashboard KPIs (money in/out, net flow, optional trend KPIs once
    the user has uploaded >= 3 statements)
  - balance comparison insight (statement closing vs computed)
  - simple categorization + spending breakdown
  - monthly income/expense series
  - flagged issues (large transfers, low-confidence rows, unknowns)

This module deliberately works off the on-disk JSONs so we do not need
a database — it matches the rest of the scaffolding.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from app.config import settings
from app.utils.logger import get_logger

log = get_logger(__name__)


# ---------- categorization ----------

CATEGORY_KEYWORDS: list[tuple[str, list[str], str]] = [
    ("Salary",      ["salary", "payroll", "wage", "emolument"],                  "#10B981"),
    ("Income",      ["deposit", "credit transfer", "incoming", "received from",
                     "received money", "client invoice", "freelance", "upwork",
                     "fiverr", "payment received", "cash deposit",
                     "interest earned", "dividend", "refund"],                    "#10B981"),
    ("Housing",     ["rent", "landlord", "mortgage", "lease", "accommodation"],  "#4C6EF5"),
    ("Utilities",   ["tanesco", "luku", "dawasco", "water", "electric",
                     "umeme", "luku token", "ewura", "power", "electricity"],    "#F59E0B"),
    ("Telecom",     ["airtime", "vodacom", "airtel", "tigo", "halotel", "yas",
                     "mixx by yas", "bundle", "data bundle", "internet",
                     "safaricom", "m-pesa", "mpesa"],                             "#06B6D4"),
    ("Groceries",   ["shoprite", "supermarket", "groceries", "food",
                     "tanga chips", "shop", "market", "vegetables",
                     "provisions"],                                               "#10B981"),
    ("Transport",   ["fuel", "petrol", "diesel", "total", "puma", "oryx",
                     "bolt", "uber", "transport", "bajaj", "daladala",
                     "bus", "taxi", "fare", "parking"],                           "#06B6D4"),
    ("Dining",      ["restaurant", "cafe", "coffee", "kfc", "pizza", "hotel",
                     "food court", "lunch", "dinner", "eat"],                     "#EC4899"),
    ("Health",      ["pharmacy", "hospital", "clinic", "medicare",
                     "medicine", "doctor", "medical", "lab", "health"],           "#8B5CF6"),
    ("Business",    ["aws", "amazon web services", "google cloud", "azure",
                     "stripe", "paypal", "office", "supplier", "invoice",
                     "stock", "inventory"],                                       "#7C3AED"),
    ("Debt",        ["loan", "repayment", "instalment", "installment",
                     "debt", "credit card", "overdraft"],                         "#EF4444"),
    ("Transfers",   ["transfer", "lipa", "send to", "sent to", "tips",
                     "wallet", "paid to", "sent money", "pay to",
                     "cash out", "send money"],                                   "#94A3B8"),
    ("Fees & Charges", ["fee", "vat", "excise duty", "charge", "commission",
                     "transaction charge", "service charge", "stamp duty",
                     "ledger fee", "sms alert", "maintenance fee"],              "#64748B"),
    ("Withdrawal",  ["withdraw", "withdrawn", "atm", "cash withdrawal",
                     "agent withdrawal", "cashout"],                              "#F97316"),
    ("Education",   ["school", "tuition", "university", "college",
                     "education", "training", "course", "student"],              "#0EA5E9"),
    ("Insurance",   ["insurance", "nhif", "nssf", "pension", "premium"],         "#6366F1"),
    ("Entertainment", ["cinema", "movie", "dstv", "gotv", "netflix",
                     "subscription", "spotify", "gaming"],                        "#A855F7"),
]

# Broader fallback patterns. Catches "PAID TO ...", "SENT TO ..." style M-Pesa
# descriptions that don't include a specific keyword from the table above.
FALLBACK_PATTERNS: list[tuple[str, list[str], str]] = [
    ("Transfers",   ["paid to", "sent to", "pay ", "send ", "received from",
                     " to "],                                                     "#94A3B8"),
    ("Withdrawal",  ["withdraw", "cash"],                                         "#F97316"),
]


def categorize(description: Optional[str]) -> tuple[str, str]:
    """Best-effort category + colour for a transaction description.

    Never returns "Unknown". Falls back to broader verb/preposition patterns,
    then to "Other Expenses" so every transaction has a meaningful label.
    """
    if not description:
        return ("Uncategorized", "#6B7280")
    text = description.lower()

    for name, keywords, colour in CATEGORY_KEYWORDS:
        if any(kw in text for kw in keywords):
            return name, colour

    for name, patterns, colour in FALLBACK_PATTERNS:
        if any(p in text for p in patterns):
            return name, colour

    return ("Other Expenses", "#78716C")


# ---------- result loading ----------

def _safe_load(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Failed to read %s: %s", path, exc)
        return None


def load_all_results(user_id: Optional[int] = None) -> list[dict]:
    """Return saved result JSONs sorted by created_at ascending.

    When user_id is provided, only that user's directory is scanned.
    """
    if user_id is not None:
        results_dir = settings.results_path / str(user_id)
    else:
        results_dir = settings.results_path
    if not results_dir.exists():
        return []

    items: list[tuple[float, dict]] = []
    for path in results_dir.glob("*.json"):
        data = _safe_load(path)
        if not data:
            continue
        created = data.get("created_at") or ""
        try:
            ts = datetime.fromisoformat(created.replace("Z", "")).timestamp()
        except Exception:
            ts = path.stat().st_mtime
        items.append((ts, data))

    items.sort(key=lambda x: x[0])
    return [d for _, d in items]


def load_latest_result(user_id: Optional[int] = None) -> Optional[dict]:
    """Return the most recently saved result for a user (or globally) or None."""
    results = load_all_results(user_id)
    return results[-1] if results else None


def load_result(user_id: Optional[int], job_id: str) -> Optional[dict]:
    """Load a SINGLE saved result JSON by job_id — no full-archive scan.

    Used by statement-scoped hot paths that only need one statement's data, so
    they don't pay O(all statements) of disk I/O to read one file.
    """
    if user_id is not None:
        path = settings.results_path / str(user_id) / f"{job_id}.json"
    else:
        path = settings.results_path / f"{job_id}.json"
    return _safe_load(path)


# ---------- per-result computation ----------

def _sum_amounts(transactions: list[dict]) -> tuple[float, float]:
    debits = sum((t.get("debit") or 0) for t in transactions)
    credits = sum((t.get("credit") or 0) for t in transactions)
    return float(credits), float(debits)


def _category_breakdown(transactions: list[dict]) -> list[dict]:
    """Aggregate spending (debits) by category."""
    totals: dict[str, float] = defaultdict(float)
    colours: dict[str, str] = {}
    for t in transactions:
        debit = t.get("debit") or 0
        if not debit:
            continue
        name, colour = categorize(t.get("description"))
        totals[name] += float(debit)
        colours[name] = colour
    rows = [
        {"name": name, "value": round(value, 2), "color": colours.get(name, "#94A3B8")}
        for name, value in totals.items()
    ]
    rows.sort(key=lambda r: r["value"], reverse=True)
    return rows


def _monthly_series(transactions: list[dict]) -> list[dict]:
    """Aggregate credits/debits by YYYY-MM."""
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for t in transactions:
        d = t.get("txn_date")
        if not d:
            continue
        key = str(d)[:7]  # YYYY-MM
        buckets[key]["income"] += float(t.get("credit") or 0)
        buckets[key]["expense"] += float(t.get("debit") or 0)

    rows: list[dict] = []
    for key in sorted(buckets):
        try:
            month_label = datetime.strptime(key, "%Y-%m").strftime("%b %Y")
        except ValueError:
            month_label = key
        rows.append({
            "month": month_label,
            "label": month_label,
            "income": round(buckets[key]["income"], 2),
            "expense": round(buckets[key]["expense"], 2),
        })
    return rows


def _daily_series(transactions: list[dict]) -> list[dict]:
    """Aggregate credits/debits by YYYY-MM-DD."""
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for t in transactions:
        d = t.get("txn_date")
        if not d:
            continue
        key = str(d)[:10]
        buckets[key]["income"] += float(t.get("credit") or 0)
        buckets[key]["expense"] += float(t.get("debit") or 0)
    return [
        {"label": k, "income": round(v["income"], 2), "expense": round(v["expense"], 2)}
        for k, v in sorted(buckets.items())
    ]


def _weekly_series(transactions: list[dict]) -> list[dict]:
    """Aggregate credits/debits by ISO week (YYYY-Www)."""
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for t in transactions:
        d = t.get("txn_date")
        if not d:
            continue
        try:
            dt = datetime.strptime(str(d)[:10], "%Y-%m-%d")
        except ValueError:
            continue
        iso = dt.isocalendar()
        key = f"{iso[0]}-W{iso[1]:02d}"
        buckets[key]["income"] += float(t.get("credit") or 0)
        buckets[key]["expense"] += float(t.get("debit") or 0)
    return [
        {"label": k, "income": round(v["income"], 2), "expense": round(v["expense"], 2)}
        for k, v in sorted(buckets.items())
    ]


def _quarterly_series(transactions: list[dict]) -> list[dict]:
    """Aggregate credits/debits by calendar quarter (YYYY-Qn)."""
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for t in transactions:
        d = t.get("txn_date")
        if not d:
            continue
        try:
            dt = datetime.strptime(str(d)[:10], "%Y-%m-%d")
        except ValueError:
            continue
        q = (dt.month - 1) // 3 + 1
        key = f"{dt.year}-Q{q}"
        buckets[key]["income"] += float(t.get("credit") or 0)
        buckets[key]["expense"] += float(t.get("debit") or 0)
    return [
        {"label": k, "income": round(v["income"], 2), "expense": round(v["expense"], 2)}
        for k, v in sorted(buckets.items())
    ]


def _detect_available_views(transactions: list[dict]) -> list[str]:
    """Pick which time aggregations make sense for this statement's span."""
    dates: list[datetime] = []
    for t in transactions:
        d = t.get("txn_date")
        if not d:
            continue
        try:
            dates.append(datetime.strptime(str(d)[:10], "%Y-%m-%d"))
        except ValueError:
            continue
    if not dates:
        return ["daily"]
    span_days = (max(dates) - min(dates)).days
    views = ["daily"]
    if span_days >= 7:
        views.append("weekly")
    if span_days >= 28:
        views.append("monthly")
    if span_days >= 90:
        views.append("quarterly")
    return views


def _detect_issues(result: dict) -> list[dict]:
    """Surface actionable financial insights the user should see.

    Internal OCR/pipeline noise (flagged rows, validation errors,
    uncategorized totals) is intentionally excluded — Important Issues
    should read like advice from a financial advisor, not a developer log.
    """
    issues: list[dict] = []
    transactions = result.get("transactions") or []
    if not transactions:
        return issues

    credits, debits = _sum_amounts(transactions)

    # 1. Large outgoing transaction worth verifying
    largest_debit = max(transactions, key=lambda t: t.get("debit") or 0, default=None)
    if largest_debit and (largest_debit.get("debit") or 0) > 0:
        amount = largest_debit.get("debit") or 0
        if debits and amount >= max(debits * 0.25, 250_000):
            issues.append({
                "severity": "warning",
                "title": "Large outgoing transaction",
                "description": (
                    f"TZS {amount:,.0f} on {largest_debit.get('txn_date') or 'unknown date'} — "
                    f"{(largest_debit.get('description') or '').strip()[:80]}. "
                    "Verify this was intentional."
                ),
            })

    # 2. Spending exceeds income for the period
    if credits > 0 and debits > credits:
        overspend = debits - credits
        issues.append({
            "severity": "warning",
            "title": "Spending exceeds income",
            "description": (
                f"You spent TZS {overspend:,.0f} more than you earned this period. "
                "Review non-essential expenses to bring spending under control."
            ),
        })

    # 3. One category dominates the spend mix
    categories = _category_breakdown(transactions)
    if categories and debits > 0:
        top = categories[0]
        pct = (top["value"] / debits) * 100
        if pct > 50:
            issues.append({
                "severity": "info",
                "title": f"{top['name']} dominates spending ({pct:.0f}%)",
                "description": (
                    f"TZS {top['value']:,.0f} went to {top['name']}. "
                    "Consider whether this proportion is sustainable."
                ),
            })

    # 4. Death-by-a-thousand-cuts: many tiny outflows
    small_txns = [
        t for t in transactions
        if (t.get("debit") or 0) > 0 and (t.get("debit") or 0) < 5_000
    ]
    if len(small_txns) > 10:
        small_total = sum((t.get("debit") or 0) for t in small_txns)
        issues.append({
            "severity": "info",
            "title": f"{len(small_txns)} small expenses under TZS 5,000",
            "description": (
                f"These add up to TZS {small_total:,.0f}. Small daily expenses "
                "are often overlooked but can represent significant savings."
            ),
        })

    return issues


def _resolve_opening_balance(
    transactions: list[dict], metadata: dict | None
) -> Optional[float]:
    """Opening balance from metadata, else back-derived from the first row.

    The statement header/footer scrape (pipeline._extract_header_balances)
    and the validator both try to establish this earlier; this is the final
    fallback used at analytics time: opening = row1.balance - row1.credit +
    row1.debit. Shared by every caller so the derivation never drifts.
    """
    metadata = metadata or {}
    opening = metadata.get("opening_balance")
    if opening is not None:
        return float(opening)
    if transactions:
        first = transactions[0]
        if first.get("balance") is not None:
            debit = first.get("debit") or 0
            credit = first.get("credit") or 0
            return round(float(first["balance"]) - float(credit) + float(debit), 2)
    return None


def _period_balances(result: dict) -> dict:
    """Opening + period-end (closing) balance for the statement.

    closing precedence:
      1. metadata.closing_balance (scraped from header/footer)
      2. the LAST transaction's running balance
      3. opening + credits - debits (computed)
    so the user always sees the exact account balance at the period end.
    """
    metadata = result.get("metadata") or {}
    transactions = result.get("transactions") or []
    credits, debits = _sum_amounts(transactions)

    opening = _resolve_opening_balance(transactions, metadata)

    closing = metadata.get("closing_balance")
    closing_source = "statement"
    if closing is None:
        last_with_balance = next(
            (t for t in reversed(transactions) if t.get("balance") is not None),
            None,
        )
        if last_with_balance is not None:
            closing = float(last_with_balance["balance"])
            closing_source = "last_row"
        elif opening is not None:
            closing = round(opening + credits - debits, 2)
            closing_source = "computed"

    return {
        "opening_balance": round(opening, 2) if opening is not None else None,
        "closing_balance": round(float(closing), 2) if closing is not None else None,
        "closing_source": closing_source if closing is not None else None,
    }


def _balance_comparison(result: dict) -> dict:
    metadata = result.get("metadata") or {}
    transactions = result.get("transactions") or []
    credits, debits = _sum_amounts(transactions)

    opening = _resolve_opening_balance(transactions, metadata)
    closing = metadata.get("closing_balance")

    if closing is None:
        return {
            "closing_balance_from_statement": None,
            "computed_remaining": None,
            "discrepancy": None,
            "insight": (
                "Balance comparison unavailable — opening/closing balance not "
                "detected in the statement header."
            ),
        }

    computed = float(opening or 0) + credits - debits
    discrepancy = abs(float(closing) - computed)

    if discrepancy < 1_000:
        insight = (
            f"Your books are clean. The closing balance (TZS {closing:,.0f}) "
            f"matches within TZS {discrepancy:,.0f} of the computed balance."
        )
    elif discrepancy < 50_000:
        insight = (
            f"Small discrepancy of TZS {discrepancy:,.0f} detected. This is "
            "likely bank fees or charges not listed in transactions. Consider "
            "reviewing with your bank."
        )
    else:
        insight = (
            f"Significant discrepancy of TZS {discrepancy:,.0f}. Missing "
            "transactions may exist. Verify all pages were included in the "
            "uploaded statement."
        )

    return {
        "closing_balance_from_statement": float(closing),
        "computed_remaining": round(computed, 2),
        "discrepancy": round(discrepancy, 2),
        "insight": insight,
    }


_BALANCE_GAP_TOLERANCE = 1.0  # TZS; mirrors validator.BALANCE_TOLERANCE


def _charges_and_interest(result: dict) -> dict:
    """Identify bank charges AND interest from running-balance gaps.

    For each row: expected = prev_balance - debit + credit; diff = expected - balance.
      * diff > tol  → balance dropped MORE than listed ⇒ a silent bank
        charge / VAT / excise (guarded by debit > 0, i.e. attributed to a
        real outgoing transaction).
      * diff < -tol → balance rose MORE than listed ⇒ interest credited /
        an amount the bank added that wasn't itemised (guarded by debit == 0
        so we don't mistake an under-listed debit for interest).

    Caveat: validator.py repairs rows where BOTH debit & credit were missing
    by setting them to the full balance delta, which zeroes the gap for
    *standalone* fee/interest rows. Those are invisible here; charges/interest
    on rows that already carry a listed debit/credit are still detected.

    Returns a superset of the legacy `transaction_costs` shape
    (`estimated_total`, `fee_occurrences`, `insight`) so existing consumers
    (Dashboard fees card, InvestmentSimulator) keep working unchanged.
    """
    transactions = result.get("transactions") or []
    metadata = result.get("metadata") or {}
    prev_balance = _resolve_opening_balance(transactions, metadata)

    total_charges = 0.0
    total_interest = 0.0
    charges: list[dict] = []
    interest: list[dict] = []

    for t in transactions:
        balance = t.get("balance")
        debit = t.get("debit") or 0
        credit = t.get("credit") or 0
        if balance is not None and prev_balance is not None:
            expected = prev_balance - debit + credit
            diff = expected - balance
            if diff > _BALANCE_GAP_TOLERANCE and debit > 0:
                amount = round(diff, 2)
                total_charges += amount
                charges.append({
                    "date": t.get("txn_date"),
                    "description": (t.get("description") or "").strip()[:100],
                    "amount": amount,
                })
            elif diff < -_BALANCE_GAP_TOLERANCE and debit == 0:
                amount = round(-diff, 2)
                total_interest += amount
                interest.append({
                    "date": t.get("txn_date"),
                    "description": (t.get("description") or "").strip()[:100],
                    "amount": amount,
                })
        if balance is not None:
            prev_balance = balance

    charge_count = len(charges)
    interest_count = len(interest)

    parts: list[str] = []
    if charge_count > 0:
        parts.append(
            f"TZS {total_charges:,.0f} in bank charges across "
            f"{charge_count} transaction(s) — typically fees, VAT, and excise "
            "duty deducted silently."
        )
    if interest_count > 0:
        parts.append(
            f"TZS {total_interest:,.0f} in interest / uncredited amounts across "
            f"{interest_count} transaction(s)."
        )
    insight = " ".join(parts) if parts else (
        "No bank charges or interest detected in this statement."
    )

    return {
        # legacy keys (backward-compatible)
        "estimated_total": round(total_charges, 2),
        "fee_occurrences": charge_count,
        "insight": insight,
        # new charge/interest breakdown
        "total_charges": round(total_charges, 2),
        "charge_occurrences": charge_count,
        "total_interest": round(total_interest, 2),
        "interest_occurrences": interest_count,
        "charges": charges,
        "interest": interest,
    }


def charges_and_interest_in_range(
    user_id: Optional[int], start: date, end: date
) -> dict:
    """Aggregate bank charges + interest across a user's statements, keeping
    only itemised rows whose transaction date falls in [start, end].

    The running-balance gap method is per-statement — chaining balances across
    different statements/accounts would be wrong — so we run
    `_charges_and_interest` on each saved result (correct balance chain) and
    then filter its itemised rows by date. Rows are de-duplicated by
    (date, description, amount) so two uploads overlapping the same period do
    not double-count. Used by the Reconciliation page.
    """
    def _in_range(item: dict) -> bool:
        raw = item.get("date")
        if not raw:
            return True  # keep undated items rather than silently drop them
        try:
            d = datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
        except ValueError:
            return True
        return start <= d <= end

    seen: set[tuple] = set()
    charges: list[dict] = []
    interest: list[dict] = []
    total_charges = 0.0
    total_interest = 0.0

    for result in load_all_results(user_id):
        ci = _charges_and_interest(result)
        for kind, bucket in (("c", ci["charges"]), ("i", ci["interest"])):
            for item in bucket:
                if not _in_range(item):
                    continue
                key = (kind, item.get("date"), item.get("description"), item.get("amount"))
                if key in seen:
                    continue
                seen.add(key)
                if kind == "c":
                    charges.append(item)
                    total_charges += item["amount"]
                else:
                    interest.append(item)
                    total_interest += item["amount"]

    charges.sort(key=lambda x: str(x.get("date") or ""))
    interest.sort(key=lambda x: str(x.get("date") or ""))

    return {
        "total_charges": round(total_charges, 2),
        "charge_occurrences": len(charges),
        "total_interest": round(total_interest, 2),
        "interest_occurrences": len(interest),
        "charges": charges,
        "interest": interest,
    }


def _kpis(results: list[dict]) -> dict:
    """Compute KPI block. Trend KPIs are only filled once we have >= 3 uploads."""
    if not results:
        empty = {k: None for k in
                 ("money_in", "money_out", "net_flow", "opening_balance",
                  "closing_balance", "savings_rate", "savings",
                  "expense_growth", "income_growth")}
        return empty

    latest = results[-1]
    latest_credits, latest_debits = _sum_amounts(latest.get("transactions") or [])
    balances = _period_balances(latest)
    base = {
        "money_in": round(latest_credits, 2),
        "money_out": round(latest_debits, 2),
        "net_flow": round(latest_credits - latest_debits, 2),
        # Account balance at the start / end of the statement period. net_flow
        # stays as pure credits - debits; these give the exact standing balance.
        "opening_balance": balances["opening_balance"],
        "closing_balance": balances["closing_balance"],
        "savings_rate": None,
        "savings": None,
        "expense_growth": None,
        "income_growth": None,
    }

    if len(results) < 3:
        return base

    previous = results[-2]
    prev_credits, prev_debits = _sum_amounts(previous.get("transactions") or [])

    if latest_credits > 0:
        base["savings_rate"] = round(((latest_credits - latest_debits) / latest_credits) * 100, 2)
    base["savings"] = round(latest_credits - latest_debits, 2)
    if prev_debits > 0:
        base["expense_growth"] = round(((latest_debits - prev_debits) / prev_debits) * 100, 2)
    if prev_credits > 0:
        base["income_growth"] = round(((latest_credits - prev_credits) / prev_credits) * 100, 2)

    return base


# ---------- public entry points ----------

def _same_day_siblings(results: list[dict], selected: dict) -> list[dict]:
    """Other statements uploaded the SAME calendar day as `selected`.

    Powers the "you also uploaded NMB today — look into it too" hint: when a
    user uploads two services on one day, selecting one surfaces the sibling(s).
    """
    sel_day = str(selected.get("created_at") or "")[:10]
    sel_job = selected.get("job_id")
    if not sel_day:
        return []
    out: list[dict] = []
    for r in results:
        if r.get("job_id") == sel_job:
            continue
        if str(r.get("created_at") or "")[:10] != sel_day:
            continue
        md = r.get("metadata") or {}
        out.append({
            "job_id": r.get("job_id"),
            "bank": md.get("bank"),
            "filename": r.get("filename"),
            "created_at": r.get("created_at"),
        })
    return out


def build_dashboard_summary(
    user_id: Optional[int] = None, job_id: Optional[str] = None
) -> dict:
    """Top-level aggregation feeding /api/dashboard/summary.

    When `job_id` is given, the view is built for THAT statement (its KPIs,
    categories, series, issues) with trend KPIs computed against the statements
    uploaded before it; otherwise it reflects the latest upload (unchanged).
    """
    # Local import to avoid any circular-import surprises at module load.
    from app.services.ds_intel import (
        cash_flow_forecast,
        detect_anomalies,
        treasury_recommendation,
    )

    results = load_all_results(user_id)
    upload_count = len(results)

    if not results:
        return {
            "upload_count": 0,
            "selected_job_id": None,
            "requested_job_id": job_id,
            "fallback": False,
            "same_day_siblings": [],
            "latest_upload": None,
            "kpis": _kpis([]),
            "balance_comparison": None,
            "transaction_costs": None,
            "issues": [],
            "categories": [],
            "monthly_data": [],
            "time_series": {"daily": [], "weekly": [], "monthly": [], "quarterly": []},
            "available_views": ["monthly"],
            "forecast": {"available": False},
            "anomalies": [],
            "treasury": {"available": False},
        }

    # Pick the statement to view. `sel_results` is the history up to AND
    # including it, so trend KPIs compare against the prior statement. If the
    # requested job_id has no result on disk (e.g. its JSON was removed) we fall
    # back to the latest but FLAG it, so the client can tell the user the numbers
    # aren't for the statement they asked for rather than showing them silently.
    sel_results = results
    fallback = False
    if job_id:
        idx = next((i for i, r in enumerate(results) if r.get("job_id") == job_id), None)
        if idx is not None:
            sel_results = results[: idx + 1]
        else:
            fallback = True

    latest = sel_results[-1]
    metadata = latest.get("metadata") or {}
    transactions = latest.get("transactions") or []
    monthly = _monthly_series(transactions)
    base_issues = _detect_issues(latest)

    # Promote the highest-severity anomalies into the Issues feed so the
    # existing UI surfaces them without a frontend change.
    anomalies = detect_anomalies(transactions)
    promoted = list(base_issues)
    for a in anomalies[:3]:
        promoted.append({
            "severity": "warning",
            "title": f"Unusual transaction ({a['reason']})",
            "description": (
                f"TZS {a['amount']:,.0f} on {a['date']} — "
                f"{a['description'][:80]}. Verify this is legitimate."
            ),
        })

    return {
        "upload_count": upload_count,
        "selected_job_id": latest.get("job_id"),
        "requested_job_id": job_id,
        "fallback": fallback,
        "same_day_siblings": _same_day_siblings(results, latest),
        "latest_upload": {
            "job_id": latest.get("job_id"),
            "bank": metadata.get("bank"),
            "filename": latest.get("filename"),
            "uploaded_at": latest.get("created_at"),
            "total_transactions": latest.get("total_transactions"),
        },
        "kpis": _kpis(sel_results),
        "balance_comparison": _balance_comparison(latest),
        "transaction_costs": _charges_and_interest(latest),
        "issues": promoted,
        "categories": _category_breakdown(transactions),
        "monthly_data": monthly,  # kept for backwards compatibility
        "time_series": {
            "daily": _daily_series(transactions),
            "weekly": _weekly_series(transactions),
            "monthly": monthly,
            "quarterly": _quarterly_series(transactions),
        },
        "available_views": _detect_available_views(transactions),
        "forecast": cash_flow_forecast(transactions, horizon_days=30),
        "anomalies": anomalies,
        "treasury": treasury_recommendation(transactions),
    }


def build_analysis_payload(job_id: str, user_id: Optional[int] = None) -> Optional[dict]:
    """Return analysis-page payload for a single job (scoped to user when given)."""
    if user_id is not None:
        path = settings.results_path / str(user_id) / f"{job_id}.json"
    else:
        path = settings.results_path / f"{job_id}.json"
    data = _safe_load(path)
    if not data:
        return None

    transactions = data.get("transactions") or []
    enriched = []
    for t in transactions:
        cat, _colour = categorize(t.get("description"))
        enriched.append({**t, "category": cat})

    credits, debits = _sum_amounts(transactions)
    largest_expense = max((t for t in transactions if (t.get("debit") or 0) > 0),
                          key=lambda t: t.get("debit") or 0, default=None)
    largest_income = max((t for t in transactions if (t.get("credit") or 0) > 0),
                         key=lambda t: t.get("credit") or 0, default=None)
    days = {str(t.get("txn_date")) for t in transactions if t.get("txn_date")}
    avg_daily_spend = round(debits / len(days), 2) if days else 0.0
    balances = _period_balances(data)

    return {
        "job_id": job_id,
        "metadata": data.get("metadata"),
        "transactions": enriched,
        "kpis": {
            "total_transactions": len(transactions),
            "largest_expense": float(largest_expense.get("debit") or 0) if largest_expense else 0,
            "largest_income": float(largest_income.get("credit") or 0) if largest_income else 0,
            "avg_daily_spend": avg_daily_spend,
            "opening_balance": balances["opening_balance"],
            "closing_balance": balances["closing_balance"],
        },
        "categories": _category_breakdown(transactions),
        "balance_comparison": _balance_comparison(data),
        "transaction_costs": _charges_and_interest(data),
        "time_series": {
            "daily": _daily_series(transactions),
            "weekly": _weekly_series(transactions),
            "monthly": _monthly_series(transactions),
            "quarterly": _quarterly_series(transactions),
        },
        "available_views": _detect_available_views(transactions),
    }


def _infer_period(transactions: list[dict], metadata: dict) -> dict:
    """Derive period start, end, span and cadence label.

    Falls back to the min/max txn_date when the parser couldn't lift the
    period off the statement header. Returns a dict so the caller can
    surface period info even when `metadata['period_start']` is None
    (which is what was producing the bare "No Period Detected" string in
    the assistant's offline replies).
    """
    start_raw = metadata.get("period_start")
    end_raw = metadata.get("period_end")

    def _parse(d: Any) -> Optional[date]:
        if not d:
            return None
        try:
            return date.fromisoformat(str(d)[:10])
        except (ValueError, TypeError):
            return None

    start = _parse(start_raw)
    end = _parse(end_raw)

    # If the metadata had no usable period, scan the transaction dates.
    if not start or not end:
        dates = [_parse(t.get("txn_date")) for t in transactions]
        dates = [d for d in dates if d]
        if dates:
            start = start or min(dates)
            end = end or max(dates)

    if not start or not end:
        return {
            "start": None,
            "end": None,
            "span_days": 0,
            "label": "Unknown",
            "cadence": "unknown",
        }

    span = max(0, (end - start).days)
    if span <= 10:
        cadence = "weekly"
    elif span <= 45:
        cadence = "monthly"
    elif span <= 100:
        cadence = "quarterly"
    elif span <= 200:
        cadence = "half-year"
    else:
        cadence = "yearly"

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "span_days": span,
        "label": f"{start.isoformat()} → {end.isoformat()} ({cadence}, {span} days)",
        "cadence": cadence,
    }


def _upload_period(data: dict) -> tuple[Optional[str], Optional[str]]:
    """(period_start, period_end) for a result JSON, via the shared inferrer."""
    period = _infer_period(data.get("transactions") or [], data.get("metadata") or {})
    return period["start"], period["end"]


# Sentinel written to period_start/period_end for a `done` upload that has no
# derivable period (undated statement, or a missing result JSON). Non-NULL so the
# backfill query stops re-selecting the row, but empty so it reads back as "no
# period" (_to_iso_date("") -> None) throughout analytics and the UI.
_NO_PERIOD = ""


def backfill_upload_periods(db, user_id: Optional[int]) -> None:
    """Populate period_start/period_end on `done` Upload rows that predate period
    persistence — one-time per row, so later reads are pure indexed DB queries.

    New uploads get their period stamped at extraction time (see upload.py). This
    self-heals the rows that were extracted before that column existed, and works
    on both SQLite and Postgres (unlike the init_db SQLite-only backfill). Rows
    whose result JSON is missing on disk are left NULL (they're effectively
    orphans and never resolve to a statement).
    """
    from app.db import Upload  # local import — db.py must not depend on analytics

    rows = (
        db.query(Upload)
        .filter(
            Upload.user_id == user_id,
            Upload.status == "done",
            Upload.period_start.is_(None),
            Upload.period_end.is_(None),
        )
        .all()
    )
    if not rows:
        return
    changed = False
    for row in rows:
        data = load_result(user_id, row.job_id)
        start = end = None
        if data:
            start, end = _upload_period(data)
            if not row.total_transactions:
                row.total_transactions = data.get("total_transactions") or len(
                    data.get("transactions") or []
                )
            if not row.bank:
                row.bank = (data.get("metadata") or {}).get("bank")
        # ALWAYS stamp something (real period, or the _NO_PERIOD sentinel for an
        # undated statement / missing JSON) so this row leaves the NULL/NULL set
        # and is never re-parsed on a future read. `_NO_PERIOD` ("") reads back as
        # "no period" everywhere (_to_iso_date("") -> None) but isn't NULL, so the
        # backfill query above won't select it again.
        row.period_start = start or _NO_PERIOD
        row.period_end = end or _NO_PERIOD
        changed = True
    if changed:
        try:
            db.commit()
        except Exception:  # noqa: BLE001 — backfill is best-effort
            db.rollback()
            log.debug("Upload period backfill failed for user=%s", user_id, exc_info=True)


def newest_job_id(user_id: Optional[int] = None, db=None) -> Optional[str]:
    """job_id of the user's newest (by period_end) `done` statement, or None.

    Used to resolve receipts / entries that carry no `statement_job_id` (legacy
    rows, or items added outside a statement context) to the newest statement at
    read time — so per-statement scoping needs no data migration.

    Defined via `statement_index` (newest-first, by period_end) so this matches
    EXACTLY what the frontend treats as the default statement (`statements[0]`).
    """
    idx = statement_index(user_id, db=db)
    return idx[0]["job_id"] if idx else None


def effective_stmt(item_job_id: Optional[str], newest: Optional[str]) -> Optional[str]:
    """The statement an item belongs to: its own tag, else the newest statement."""
    return item_job_id or newest


def _to_iso_date(s: Any) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except (ValueError, TypeError):
        return None


def _apply_recency(rows: list[dict]) -> list[dict]:
    """Tag each row recent/past off the newest period_end, then sort newest first."""
    ends = [d for d in (_to_iso_date(r["period_end"]) for r in rows) if d]
    if ends:
        newest = max(ends)
        window = timedelta(days=max(0, int(settings.recent_window_days)))
        for r in rows:
            pe = _to_iso_date(r["period_end"])
            if pe is not None and pe >= newest - window:
                r["recency"] = "recent"
    rows.sort(
        key=lambda r: str(r.get("period_end") or r.get("created_at") or ""),
        reverse=True,
    )
    return rows


def statement_index(user_id: Optional[int] = None, db=None) -> list[dict]:
    """One row per saved statement for the selector / money-map grouping pipeline.

    Each row: `{job_id, bank, filename, period_start, period_end, created_at,
    txn_count, recency}`. `recency="recent"` when the statement's period end is
    within `settings.recent_window_days` of the user's MOST-recent period end,
    else `"past"`. Newest first.

    When a DB session is supplied this reads the `uploads` table directly (one
    indexed query, period columns persisted at extraction time), which is what
    every per-request caller uses. Without `db` it falls back to scanning the
    result JSONs — kept only for offline / scriptless callers.
    """
    if db is not None:
        from app.db import Upload  # local import to avoid an import cycle

        backfill_upload_periods(db, user_id)
        rows = [
            {
                "job_id": u.job_id,
                "bank": u.bank,
                "filename": u.filename,
                "period_start": u.period_start,
                "period_end": u.period_end,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "txn_count": u.total_transactions or 0,
                "recency": "past",  # refined below
            }
            for u in (
                db.query(Upload)
                .filter(Upload.user_id == user_id, Upload.status == "done")
                .all()
            )
        ]
        return _apply_recency(rows)

    rows = []
    for data in load_all_results(user_id):
        metadata = data.get("metadata") or {}
        transactions = data.get("transactions") or []
        start, end = _upload_period(data)
        rows.append({
            "job_id": data.get("job_id"),
            "bank": metadata.get("bank"),
            "filename": data.get("filename"),
            "period_start": start,
            "period_end": end,
            "created_at": data.get("created_at"),
            "txn_count": data.get("total_transactions") or len(transactions),
            "recency": "past",  # refined below
        })
    return _apply_recency(rows)


def build_assistant_context(latest: dict) -> str:
    """Compact text block describing the user's latest statement, fed to the LLM.

    Includes the full transaction list so the assistant can answer
    description-based questions like "how much was sent to Aisha?" by
    scanning rows directly, instead of telling the user to re-upload.
    Also injects the DS-intel block (forecast, anomalies, treasury) so
    the LLM can reason about runway and surplus cash without re-deriving.
    """
    # Local import — avoids a circular import (ds_intel itself imports
    # nothing from analytics, but kept lazy for symmetry / safety).
    from app.services.ds_intel import build_ds_context

    metadata = latest.get("metadata") or {}
    transactions = latest.get("transactions") or []
    credits, debits = _sum_amounts(transactions)
    categories = _category_breakdown(transactions)
    top_categories = ", ".join(
        f"{c['name']} (TZS {c['value']:,.0f})" for c in categories[:5]
    ) or "n/a"
    issues = _detect_issues(latest)
    issue_list = "; ".join(i["title"] for i in issues) or "none"
    period = _infer_period(transactions, metadata)
    ds_block = build_ds_context(latest)

    rows: list[str] = []
    for t in transactions:
        d = t.get("txn_date") or "?"
        debit = float(t.get("debit") or 0)
        credit = float(t.get("credit") or 0)
        if debit and not credit:
            amount = f"-{debit:,.0f}"
        elif credit and not debit:
            amount = f"+{credit:,.0f}"
        else:
            amount = f"{credit - debit:,.0f}"
        desc = (t.get("description") or "").replace("\n", " ").strip()
        balance = t.get("balance")
        bal_str = f" | bal {float(balance):,.0f}" if balance is not None else ""
        rows.append(f"{d} | {amount} | {desc}{bal_str}")

    txn_block = "\n".join(rows) if rows else "(no transactions parsed)"

    return (
        f"Bank: {metadata.get('bank') or 'Unknown'}\n"
        f"Period: {period['label']}\n"
        f"Cadence: {period['cadence']}\n"
        f"Transactions: {len(transactions)}\n"
        f"Total income (credits): TZS {credits:,.0f}\n"
        f"Total expenses (debits): TZS {debits:,.0f}\n"
        f"Net flow: TZS {credits - debits:,.0f}\n"
        f"Top spending categories: {top_categories}\n"
        f"Detected issues: {issue_list}\n"
        f"{('DS intel:\n' + ds_block + '\n') if ds_block else ''}"
        f"\nFull transaction list (date | amount in TZS, sign shows direction | description | balance):\n"
        f"{txn_block}\n"
    )
