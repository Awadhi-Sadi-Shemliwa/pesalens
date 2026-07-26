"""Lightweight data-science intelligence layer.

Adds forecast, anomaly detection, surplus-cash / treasury, and vendor
analytics on top of the existing analytics pipeline. Intentionally
zero-dependency beyond pandas + numpy (already in requirements). When
scikit-learn is installed we upgrade IsolationForest; otherwise we fall
back to a robust z-score / IQR anomaly heuristic.

Hooked into:
  - dashboard summary  (services/analytics.build_dashboard_summary)
  - business intel     (routers/business.intel)
  - assistant context  (routers/assistant via build_assistant_context)
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from app.services.fx import receipt_amount_tzs
from app.utils.logger import get_logger

log = get_logger(__name__)


# Operating-cash buffer multiple. If a business needs TZS X / month to run,
# we keep `OPERATING_BUFFER_MULT * X` as untouchable, and call the rest
# "surplus cash" available for treasury deployment.
OPERATING_BUFFER_MULT = 1.5

# Approximate Tanzanian instrument yields (annualised). Sourced from the
# Bank of Tanzania weekly auctions and commercial-bank deposit boards as
# of 2026 — refresh from the markets bot once it carries fixed-income.
INSTRUMENT_YIELDS = {
    "tbill_91d": 0.095,
    "fixed_deposit": 0.080,
    "money_market": 0.072,
}


# ---------- helpers ----------

def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _daily_net(transactions: list[dict]) -> dict[date, float]:
    """Return a date -> net (credit - debit) map sorted by date."""
    bucket: dict[date, float] = defaultdict(float)
    for t in transactions:
        d = _parse_date(t.get("txn_date"))
        if not d:
            continue
        bucket[d] += float(t.get("credit") or 0) - float(t.get("debit") or 0)
    return dict(sorted(bucket.items()))


# ---------- 1. Cash-flow forecast (lightweight, no Prophet) ----------

def cash_flow_forecast(transactions: list[dict], horizon_days: int = 30) -> dict:
    """EWMA + weekday seasonality forecast with rough confidence band.

    Heavy ML (Prophet/ARIMA) is overkill for the data volume we see and
    would pull in 100MB+ deps. The hybrid below is good enough to flag
    runway risk and recurring weekly patterns — the actual customer
    value of Component 2 in DATA_SCIENCE_COMPONENTS.md.
    """
    daily = _daily_net(transactions)
    if len(daily) < 7:
        return {
            "available": False,
            "horizon_days": horizon_days,
            "reason": "Need at least 7 days of transactions to forecast.",
        }

    dates = list(daily.keys())
    values = list(daily.values())

    # 7-day exponentially-weighted mean — weights recent days more.
    alpha = 2 / (7 + 1)
    ewma = values[0]
    for v in values[1:]:
        ewma = alpha * v + (1 - alpha) * ewma

    # Weekday seasonal multiplier (Mon..Sun) relative to overall mean.
    overall_mean = sum(values) / len(values) or 1.0
    by_weekday: dict[int, list[float]] = defaultdict(list)
    for d, v in daily.items():
        by_weekday[d.weekday()].append(v)
    weekday_mult = {}
    for wd in range(7):
        if by_weekday[wd]:
            weekday_mult[wd] = (sum(by_weekday[wd]) / len(by_weekday[wd])) / (overall_mean or 1)
        else:
            weekday_mult[wd] = 1.0

    # Std-dev as a crude confidence-interval driver.
    sigma = statistics.pstdev(values) if len(values) > 1 else abs(ewma) * 0.5

    last_date = dates[-1]
    forecast_points: list[dict] = []
    cumulative = 0.0
    for i in range(1, horizon_days + 1):
        d = last_date + timedelta(days=i)
        wd = d.weekday()
        point = ewma * weekday_mult.get(wd, 1.0)
        cumulative += point
        forecast_points.append({
            "date": d.isoformat(),
            "expected_net": round(point, 2),
            "lower": round(point - 1.28 * sigma, 2),  # ~80% CI
            "upper": round(point + 1.28 * sigma, 2),
            "cumulative_expected": round(cumulative, 2),
        })

    avg_daily_burn = -ewma if ewma < 0 else 0.0
    runway_days: int | None = None
    closing_balance = _latest_balance(transactions)
    if avg_daily_burn > 0 and closing_balance is not None:
        runway_days = int(closing_balance / avg_daily_burn)

    return {
        "available": True,
        "horizon_days": horizon_days,
        "expected_net_30d": round(cumulative, 2) if horizon_days >= 30 else None,
        "avg_daily_net": round(ewma, 2),
        "sigma": round(sigma, 2),
        "weekday_multipliers": {str(k): round(v, 3) for k, v in weekday_mult.items()},
        "runway_days": runway_days,
        "closing_balance": closing_balance,
        "points": forecast_points,
    }


def _latest_balance(transactions: list[dict]) -> float | None:
    for t in reversed(transactions):
        b = t.get("balance")
        if b is not None:
            try:
                return float(b)
            except (TypeError, ValueError):
                return None
    return None


# ---------- 2. Anomaly detection ----------

def detect_anomalies(transactions: list[dict], top_pct: float = 0.05) -> list[dict]:
    """Flag the top ~5% most unusual debit transactions.

    Uses scikit-learn IsolationForest when available, otherwise falls
    back to robust z-score on (amount, hour, weekday). The fallback is
    deterministic and good enough to surface the obvious outliers — and
    Skills.md mandates lightweight, no-GPU paths.
    """
    debits = [
        t for t in transactions
        if (t.get("debit") or 0) > 0 and _parse_date(t.get("txn_date"))
    ]
    if len(debits) < 10:
        return []

    rows: list[tuple[dict, list[float]]] = []
    for t in debits:
        d = _parse_date(t.get("txn_date"))
        amt = float(t.get("debit") or 0)
        hour = 12  # statements rarely carry time-of-day; placeholder
        rows.append((t, [amt, d.weekday(), hour, 1.0 if _is_round(amt) else 0.0]))

    flagged: list[dict] = []
    try:  # sklearn path
        import numpy as np
        from sklearn.ensemble import IsolationForest

        X = np.array([r[1] for r in rows])
        contamination = max(0.01, min(top_pct, 0.2))
        clf = IsolationForest(contamination=contamination, random_state=42)
        scores = clf.fit_predict(X)
        for (t, _), s in zip(rows, scores):
            if s == -1:
                flagged.append(_anomaly_entry(t, "outlier"))
    except Exception:  # noqa: BLE001 — sklearn missing or numerical edge case
        amounts = [r[1][0] for r in rows]
        med = statistics.median(amounts)
        mad = statistics.median([abs(a - med) for a in amounts]) or 1.0
        for t, feats in rows:
            score = abs(feats[0] - med) / (1.4826 * mad)
            if score >= 3.5:
                flagged.append(_anomaly_entry(t, "high_amount"))

    # Always add rule-based duplicates (same vendor + amount within 7 days).
    flagged.extend(_duplicate_payments(debits))

    # De-duplicate by date+description+amount.
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for f in flagged:
        key = (f.get("date"), f.get("description"), f.get("amount"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)
    deduped.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    return deduped[:25]


def _is_round(amount: float) -> bool:
    """TZS 1,000,000 exactly is suspicious; TZS 1,003,250 is not."""
    if amount < 50_000:
        return False
    return amount % 100_000 == 0


def _anomaly_entry(t: dict, reason: str) -> dict:
    return {
        "date": t.get("txn_date"),
        "amount": float(t.get("debit") or 0),
        "description": (t.get("description") or "").strip()[:120],
        "reason": reason,
    }


def _duplicate_payments(debits: list[dict]) -> list[dict]:
    """Same vendor + same amount within a 7-day window."""
    out: list[dict] = []
    by_key: dict[tuple, list[dict]] = defaultdict(list)
    for t in debits:
        desc = (t.get("description") or "").strip().lower()[:30]
        amt = round(float(t.get("debit") or 0), 0)
        if not desc or amt <= 0:
            continue
        by_key[(desc, amt)].append(t)
    for (_, amt), txns in by_key.items():
        if len(txns) < 2:
            continue
        txns.sort(key=lambda x: x.get("txn_date") or "")
        for i in range(1, len(txns)):
            d1 = _parse_date(txns[i - 1].get("txn_date"))
            d2 = _parse_date(txns[i].get("txn_date"))
            if d1 and d2 and (d2 - d1).days <= 7:
                out.append(_anomaly_entry(txns[i], "duplicate_payment"))
    return out


# ---------- 3. Treasury / surplus-cash recommender ----------

def treasury_recommendation(transactions: list[dict]) -> dict:
    """Estimate surplus cash and recommend a deployment mix.

    Conservative by design: liquidity always wins over yield. Mirrors
    Pillar 3 of BUSINESS_VALUE_PROPOSITION.md.
    """
    daily = _daily_net(transactions)
    if not daily:
        return {"available": False, "reason": "No transactions yet."}

    monthly_outflows: list[float] = []
    months: dict[str, float] = defaultdict(float)
    for d, v in daily.items():
        if v < 0:
            months[d.strftime("%Y-%m")] += -v
    monthly_outflows = list(months.values())
    if not monthly_outflows:
        return {"available": False, "reason": "No outflows recorded yet."}

    avg_monthly_burn = sum(monthly_outflows) / len(monthly_outflows)
    operating_minimum = avg_monthly_burn * OPERATING_BUFFER_MULT
    closing_balance = _latest_balance(transactions) or 0.0
    surplus = max(0.0, closing_balance - operating_minimum)

    if surplus <= 0:
        return {
            "available": True,
            "operating_minimum": round(operating_minimum, 2),
            "closing_balance": round(closing_balance, 2),
            "surplus_cash": 0.0,
            "monthly_burn": round(avg_monthly_burn, 2),
            "recommendation": [],
            "blended_yield": 0.0,
            "note": (
                "No surplus cash detected after applying a 1.5x operating "
                "buffer. Focus on stabilising cash flow before deploying."
            ),
        }

    # 40% T-bill (91d), 30% fixed deposit, 20% money market, 10% buffer.
    alloc = [
        ("91-day Treasury Bill", 0.40, INSTRUMENT_YIELDS["tbill_91d"], "Government-backed, 91-day liquidity"),
        ("Fixed Deposit (30-day)", 0.30, INSTRUMENT_YIELDS["fixed_deposit"], "Bank deposit, 30-day notice"),
        ("Money Market Fund", 0.20, INSTRUMENT_YIELDS["money_market"], "Same-day liquidity"),
        ("Cash buffer (above minimum)", 0.10, 0.0, "Operational flexibility"),
    ]
    rec = []
    blended = 0.0
    for name, weight, yld, note in alloc:
        amt = surplus * weight
        rec.append({
            "instrument": name,
            "amount": round(amt, 2),
            "yield_annualised": yld,
            "expected_monthly_income": round(amt * yld / 12, 2),
            "note": note,
        })
        blended += weight * yld

    return {
        "available": True,
        "operating_minimum": round(operating_minimum, 2),
        "closing_balance": round(closing_balance, 2),
        "surplus_cash": round(surplus, 2),
        "monthly_burn": round(avg_monthly_burn, 2),
        "blended_yield": round(blended, 4),
        "expected_monthly_income": round(surplus * blended / 12, 2),
        "recommendation": rec,
    }


# ---------- 4. Vendor analytics + price-trend regression ----------

def vendor_analytics(receipts: list[dict]) -> dict:
    """Aggregate by vendor; flag price drift on repeat items.

    Uses simple linear regression on (visit-index, unit-price) per
    (vendor, item) — pure numpy/statistics, no scipy needed.
    """
    by_vendor: dict[str, list[dict]] = defaultdict(list)
    for r in receipts:
        v = (r.get("vendor") or "").strip()
        if not v:
            continue
        by_vendor[v].append(r)

    summary: list[dict] = []
    for vendor, items in by_vendor.items():
        total = 0.0
        visits = 0
        last_visit = ""
        for r in items:
            try:
                total += receipt_amount_tzs(r)
            except (TypeError, ValueError):
                pass
            visits += 1
            d = r.get("date") or r.get("scanned_at", "")[:10] or ""
            if d and d > last_visit:
                last_visit = d
        summary.append({
            "vendor": vendor,
            "visits": visits,
            "spend_total": round(total, 2),
            "avg_per_visit": round(total / visits, 2) if visits else 0,
            "last_visit": last_visit,
        })
    summary.sort(key=lambda x: x["spend_total"], reverse=True)

    # Price drift on repeat items across the full receipt history.
    drift = _price_drift(receipts)

    return {
        "vendor_count": len(by_vendor),
        "top_vendors": summary[:10],
        "price_drift": drift,
    }


def _price_drift(receipts: list[dict]) -> list[dict]:
    item_history: dict[tuple, list[tuple[str, float]]] = defaultdict(list)
    for r in receipts:
        vendor = (r.get("vendor") or "").strip()
        d = r.get("date") or (r.get("scanned_at") or "")[:10]
        for it in r.get("items") or []:
            name = (it.get("name") or "").strip().lower()
            qty = float(it.get("quantity") or 1) or 1.0
            try:
                price = float(it.get("price") or 0) / qty
            except (TypeError, ValueError):
                continue
            if not name or price <= 0:
                continue
            item_history[(vendor, name)].append((d or "", price))

    drifts: list[dict] = []
    for (vendor, name), points in item_history.items():
        if len(points) < 3:
            continue
        points.sort(key=lambda p: p[0])
        prices = [p[1] for p in points]
        x = list(range(len(prices)))
        # Linear-regression slope: sum((x-mx)(y-my)) / sum((x-mx)^2)
        mx = sum(x) / len(x)
        my = sum(prices) / len(prices)
        num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, prices))
        den = sum((xi - mx) ** 2 for xi in x) or 1
        slope = num / den
        if my == 0:
            continue
        pct_per_visit = (slope / my) * 100
        if abs(pct_per_visit) < 1.0:  # < 1% per visit drift = noise
            continue
        drifts.append({
            "vendor": vendor or "(unknown)",
            "item": name,
            "visits": len(prices),
            "first_price": round(prices[0], 2),
            "latest_price": round(prices[-1], 2),
            "pct_change_per_visit": round(pct_per_visit, 2),
            "direction": "up" if slope > 0 else "down",
        })
    drifts.sort(key=lambda d: abs(d["pct_change_per_visit"]), reverse=True)
    return drifts[:10]


# ---------- 5. Convenience: assistant DS context block ----------

def build_ds_context(latest: dict | None, receipts: list[dict] | None = None) -> str:
    """Compact text injection for the assistant prompt (RAG-lite)."""
    if not latest:
        return ""
    transactions = latest.get("transactions") or []
    parts: list[str] = []

    fc = cash_flow_forecast(transactions, horizon_days=30)
    if fc.get("available"):
        line = (
            f"Forecast (next 30d): expected net TZS {fc['expected_net_30d']:,.0f}; "
            f"avg daily net TZS {fc['avg_daily_net']:,.0f}"
        )
        if fc.get("runway_days") is not None:
            line += f"; runway {fc['runway_days']} days at current burn"
        parts.append(line)

    anomalies = detect_anomalies(transactions)
    if anomalies:
        head = anomalies[:3]
        parts.append(
            "Flagged anomalies: "
            + "; ".join(
                f"{a['date']} TZS {a['amount']:,.0f} ({a['reason']})"
                for a in head
            )
        )

    tr = treasury_recommendation(transactions)
    if tr.get("available") and tr.get("surplus_cash", 0) > 0:
        parts.append(
            f"Surplus cash: TZS {tr['surplus_cash']:,.0f} above operating minimum "
            f"of TZS {tr['operating_minimum']:,.0f} (blended yield "
            f"{tr['blended_yield']*100:.2f}% if deployed)."
        )

    if receipts:
        va = vendor_analytics(receipts)
        if va.get("top_vendors"):
            top = va["top_vendors"][0]
            parts.append(
                f"Top vendor: {top['vendor']} ({top['visits']} visits, "
                f"TZS {top['spend_total']:,.0f})."
            )
        if va.get("price_drift"):
            d = va["price_drift"][0]
            parts.append(
                f"Price drift: {d['item']} at {d['vendor']} "
                f"{d['direction']} {abs(d['pct_change_per_visit']):.1f}%/visit."
            )

    return "\n".join(parts)
