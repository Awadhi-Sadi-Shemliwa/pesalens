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
from datetime import date, datetime
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


def _balance_comparison(result: dict) -> dict:
    metadata = result.get("metadata") or {}
    transactions = result.get("transactions") or []
    credits, debits = _sum_amounts(transactions)

    opening = metadata.get("opening_balance")
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


def _transaction_costs(result: dict) -> dict:
    """Estimate hidden bank fees from balance mismatches after debits.

    Many banks deduct fees, VAT, and excise duty silently — the running
    balance drops by more than the listed debit. We sum every such
    positive gap (expected_balance - actual_balance, after a debit) so
    the user can see what their bank is quietly charging them.
    """
    transactions = result.get("transactions") or []
    metadata = result.get("metadata") or {}
    opening = metadata.get("opening_balance")

    if opening is None and transactions:
        first = transactions[0]
        if first.get("balance") is not None:
            debit = first.get("debit") or 0
            credit = first.get("credit") or 0
            opening = first["balance"] - credit + debit

    total_hidden_fees = 0.0
    fee_count = 0
    prev_balance = opening

    for t in transactions:
        balance = t.get("balance")
        debit = t.get("debit") or 0
        credit = t.get("credit") or 0
        if balance is not None and prev_balance is not None:
            expected = prev_balance - debit + credit
            diff = expected - balance
            if diff > 1.0 and debit > 0:
                total_hidden_fees += diff
                fee_count += 1
        if balance is not None:
            prev_balance = balance

    if fee_count > 0:
        insight = (
            f"Estimated TZS {total_hidden_fees:,.0f} in hidden transaction costs "
            f"across {fee_count} transaction(s). These are typically bank fees, "
            "VAT, and excise duty deducted silently."
        )
    else:
        insight = "No hidden transaction costs detected in this statement."

    return {
        "estimated_total": round(total_hidden_fees, 2),
        "fee_occurrences": fee_count,
        "insight": insight,
    }


def _kpis(results: list[dict]) -> dict:
    """Compute KPI block. Trend KPIs are only filled once we have >= 3 uploads."""
    if not results:
        empty = {k: None for k in
                 ("money_in", "money_out", "net_flow", "savings_rate",
                  "savings", "expense_growth", "income_growth")}
        return empty

    latest = results[-1]
    latest_credits, latest_debits = _sum_amounts(latest.get("transactions") or [])
    base = {
        "money_in": round(latest_credits, 2),
        "money_out": round(latest_debits, 2),
        "net_flow": round(latest_credits - latest_debits, 2),
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

def build_dashboard_summary(user_id: Optional[int] = None) -> dict:
    """Top-level aggregation feeding /api/dashboard/summary."""
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

    latest = results[-1]
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
        "latest_upload": {
            "job_id": latest.get("job_id"),
            "bank": metadata.get("bank"),
            "filename": latest.get("filename"),
            "uploaded_at": latest.get("created_at"),
            "total_transactions": latest.get("total_transactions"),
        },
        "kpis": _kpis(results),
        "balance_comparison": _balance_comparison(latest),
        "transaction_costs": _transaction_costs(latest),
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

    return {
        "job_id": job_id,
        "metadata": data.get("metadata"),
        "transactions": enriched,
        "kpis": {
            "total_transactions": len(transactions),
            "largest_expense": float(largest_expense.get("debit") or 0) if largest_expense else 0,
            "largest_income": float(largest_income.get("credit") or 0) if largest_income else 0,
            "avg_daily_spend": avg_daily_spend,
        },
        "categories": _category_breakdown(transactions),
        "balance_comparison": _balance_comparison(data),
        "transaction_costs": _transaction_costs(data),
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
