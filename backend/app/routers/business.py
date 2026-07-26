"""Business Ledger CRUD + monthly P&L / Balance Sheet PDF.

Mirrors the personal-entries surface but adds an `account_class` field
so each row can be classified into the right financial statement at
report time. Receipts captured via OCR are merged in as additional
expense lines, so a business owner can rely on a single monthly report
that combines both data streams.
"""

from __future__ import annotations

import calendar
import io
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app.config import settings
from app.db import BusinessEntry, User, get_db
from app.deps import get_current_user, require_active_plan
from app.schemas.response import APIResponse
from app.services.activity import record_activity
from app.services.analytics import load_latest_result
from app.services.fx import receipt_amount_tzs
from app.services.ds_intel import (
    cash_flow_forecast,
    detect_anomalies,
    treasury_recommendation,
    vendor_analytics,
)
from app.services.tax_codes import annotate as annotate_tax, compliance_summary
from app.utils.logger import get_logger

log = get_logger(__name__)

router = APIRouter(tags=["business"], prefix="/business")


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

ACCOUNT_CLASSES = {"revenue", "expense", "asset", "liability", "equity"}


class EntryIn(BaseModel):
    entry_date: str = Field(min_length=10, max_length=10)
    vendor: Optional[str] = Field(default=None, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    amount: float = Field(gt=0)
    account_class: Literal["revenue", "expense", "asset", "liability", "equity"] = "expense"
    # Multi-currency: a foreign currency converts `amount` to TZS server-side
    # (the stored amount is always TZS) — see personal.resolve_entry_amount.
    currency: Optional[str] = Field(default=None, max_length=8)


def _validate_date(date_str: str) -> None:
    if not _DATE_RE.match(date_str):
        raise HTTPException(status_code=400, detail="entry_date must be YYYY-MM-DD")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="entry_date is not a valid date")


def _serialize(entry: BusinessEntry) -> dict:
    return {
        "id": entry.id,
        "entry_date": entry.entry_date,
        "vendor": entry.vendor,
        "category": entry.category,
        "description": entry.description,
        "amount": entry.amount,
        "account_class": entry.account_class,
        "currency": entry.currency or "TZS",
        "original_amount": entry.original_amount,
        "fx_rate": entry.fx_rate,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


@router.get("/entries", response_model=APIResponse)
def list_entries(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(BusinessEntry)
        .filter(BusinessEntry.user_id == user.id)
        .order_by(BusinessEntry.entry_date.desc(), BusinessEntry.id.desc())
        .all()
    )
    return APIResponse(
        success=True, message="ok",
        data={"entries": [_serialize(r) for r in rows]},
    )


@router.post("/entries", response_model=APIResponse)
def create_entry(
    payload: EntryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_date(payload.entry_date)
    from app.routers.personal import resolve_entry_amount
    entry = BusinessEntry(
        user_id=user.id,
        entry_date=payload.entry_date,
        vendor=(payload.vendor or "").strip()[:120] or None,
        category=payload.category.strip(),
        description=(payload.description or "").strip() or None,
        account_class=payload.account_class,
        **resolve_entry_amount(payload.amount, payload.currency),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return APIResponse(success=True, message="Entry saved", data=_serialize(entry))


@router.delete("/entries/{entry_id}", response_model=APIResponse)
def delete_entry(
    request: Request,
    entry_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = (
        db.query(BusinessEntry)
        .filter(BusinessEntry.id == entry_id, BusinessEntry.user_id == user.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    # Snapshot before the delete — see the identical note in personal.py.
    snapshot = {
        "id": entry.id,
        "entry_date": entry.entry_date,
        "vendor": entry.vendor,
        "category": entry.category,
        "amount": entry.amount,
        "account_class": entry.account_class,
    }
    db.delete(entry)
    db.commit()
    record_activity(db, "business_entry_deleted", user_id=user.id,
                    request=request, details=snapshot)
    return APIResponse(success=True, message="Entry deleted", data={"id": entry_id})


# --------------------------- monthly report --------------------------

def _resolve_month(month: str | None) -> tuple[int, int]:
    """Return (year, month). Defaults to the current calendar month."""
    if not month:
        today = date.today()
        return today.year, today.month
    if not _MONTH_RE.match(month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    y, m = month.split("-")
    return int(y), int(m)


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    last_day = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


def _load_receipts_for_user(user_id: int) -> list[dict]:
    base = settings.storage_path / "receipts" / str(user_id)
    if not base.exists():
        return []
    out: list[dict] = []
    for path in base.glob("*.json"):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:  # noqa: BLE001
            log.warning("Bad receipt json %s: %s", path, exc)
    return out


def _filter_receipts(receipts: list[dict], start_iso: str, end_iso: str) -> list[dict]:
    """Receipts are kept if their parsed date falls in [start, end].

    If a receipt has no date we fall back to its `scanned_at` timestamp.
    """
    kept: list[dict] = []
    for r in receipts:
        d = r.get("date") or ""
        if not _DATE_RE.match(d):
            scanned = (r.get("scanned_at") or "")[:10]
            d = scanned if _DATE_RE.match(scanned) else ""
        if d and start_iso <= d <= end_iso:
            kept.append({**r, "date": d})
    return kept


def _aggregate(entries: list[BusinessEntry], receipts: list[dict]) -> dict:
    """Bucket entries + receipts by account class and category.

    Receipts always count as expense lines (their `category` becomes the
    expense bucket, defaulting to "Other").
    """
    by_class: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for e in entries:
        if e.account_class not in ACCOUNT_CLASSES:
            continue
        by_class[e.account_class][e.category or "Other"] += float(e.amount or 0)

    for r in receipts:
        cat = (r.get("category") or "other").strip().capitalize() or "Other"
        # One shared definition of a receipt's TZS value: falling back to
        # `total` here would book a 140 USD slip as TZS 140.
        amt = receipt_amount_tzs(r)
        if amt > 0:
            by_class["expense"][cat] += amt

    revenue_total = sum(by_class["revenue"].values())
    expense_total = sum(by_class["expense"].values())
    net_income = revenue_total - expense_total

    asset_total = sum(by_class["asset"].values())
    liability_total = sum(by_class["liability"].values())
    equity_total = sum(by_class["equity"].values())

    return {
        "by_class": {k: dict(v) for k, v in by_class.items()},
        "revenue_total": revenue_total,
        "expense_total": expense_total,
        "net_income": net_income,
        "asset_total": asset_total,
        "liability_total": liability_total,
        "equity_total": equity_total,
    }


def _money(v: float) -> str:
    return f"TZS {v:,.0f}"


def _build_pdf(
    *,
    user: User,
    year: int,
    month: int,
    monthly: dict,
    cumulative: dict,
) -> bytes:
    """Render a two-section PDF: P&L for the month, Balance Sheet at month-end."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"PesaLens Monthly Report {year}-{month:02d}",
        author="PesaLens",
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18, spaceAfter=4)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, spaceBefore=12, spaceAfter=6)
    sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#555"))
    body = styles["BodyText"]

    month_name = calendar.month_name[month]
    owner = (user.full_name or user.email or "").strip() or "Account holder"

    story: list = []
    story.append(Paragraph("PesaLens Monthly Financial Report", h1))
    story.append(Paragraph(f"{owner} &middot; {month_name} {year}", sub))
    story.append(Spacer(1, 8))

    # ---- Income Statement (P&L) ----
    story.append(Paragraph("Income Statement (Profit &amp; Loss)", h2))
    story.append(Paragraph(f"Period: {month_name} {year}", sub))
    story.append(Spacer(1, 6))

    rev_rows = sorted(monthly["by_class"].get("revenue", {}).items(), key=lambda kv: -kv[1])
    exp_rows = sorted(monthly["by_class"].get("expense", {}).items(), key=lambda kv: -kv[1])

    pl_data: list[list] = [["Account", "Amount (TZS)"]]
    pl_data.append(["Revenue", ""])
    if rev_rows:
        for cat, val in rev_rows:
            pl_data.append([f"  {cat}", _money(val)])
    else:
        pl_data.append(["  (no revenue recorded)", _money(0)])
    pl_data.append(["Total Revenue", _money(monthly["revenue_total"])])

    pl_data.append(["Expenses", ""])
    if exp_rows:
        for cat, val in exp_rows:
            pl_data.append([f"  {cat}", _money(val)])
    else:
        pl_data.append(["  (no expenses recorded)", _money(0)])
    pl_data.append(["Total Expenses", _money(monthly["expense_total"])])
    pl_data.append(["Net Income", _money(monthly["net_income"])])

    pl_table = Table(pl_data, colWidths=[110 * mm, 50 * mm])
    pl_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B5FFF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7FB")]),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.black),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(pl_table)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Net Income = Total Revenue &minus; Total Expenses for the period above. "
        "Receipts captured via OCR are included as expense lines.",
        sub,
    ))

    story.append(PageBreak())

    # ---- Balance Sheet (cumulative through end of month) ----
    story.append(Paragraph("Balance Sheet", h2))
    story.append(Paragraph(f"As of {month_name} {calendar.monthrange(year, month)[1]}, {year}", sub))
    story.append(Spacer(1, 6))

    asset_rows = sorted(cumulative["by_class"].get("asset", {}).items(), key=lambda kv: -kv[1])
    liab_rows = sorted(cumulative["by_class"].get("liability", {}).items(), key=lambda kv: -kv[1])
    eq_rows = sorted(cumulative["by_class"].get("equity", {}).items(), key=lambda kv: -kv[1])
    retained = cumulative["net_income"]
    equity_with_retained = cumulative["equity_total"] + retained

    bs_data: list[list] = [["Account", "Amount (TZS)"]]
    bs_data.append(["Assets", ""])
    if asset_rows:
        for cat, val in asset_rows:
            bs_data.append([f"  {cat}", _money(val)])
    else:
        bs_data.append(["  (no assets recorded)", _money(0)])
    bs_data.append(["Total Assets", _money(cumulative["asset_total"])])

    bs_data.append(["Liabilities", ""])
    if liab_rows:
        for cat, val in liab_rows:
            bs_data.append([f"  {cat}", _money(val)])
    else:
        bs_data.append(["  (no liabilities recorded)", _money(0)])
    bs_data.append(["Total Liabilities", _money(cumulative["liability_total"])])

    bs_data.append(["Equity", ""])
    if eq_rows:
        for cat, val in eq_rows:
            bs_data.append([f"  {cat}", _money(val)])
    bs_data.append(["  Retained Earnings (cumulative net income)", _money(retained)])
    bs_data.append(["Total Equity", _money(equity_with_retained)])
    bs_data.append([
        "Total Liabilities + Equity",
        _money(cumulative["liability_total"] + equity_with_retained),
    ])

    bs_table = Table(bs_data, colWidths=[110 * mm, 50 * mm])
    bs_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B5FFF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7FB")]),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.black),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(bs_table)
    story.append(Spacer(1, 8))

    diff = cumulative["asset_total"] - (cumulative["liability_total"] + equity_with_retained)
    note = (
        "Assets = Liabilities + Equity "
        f"(reconciliation: {_money(diff)})."
        if abs(diff) < 1
        else (
            "Reconciliation difference: "
            f"{_money(diff)}. Add the missing asset, liability, or equity entry to balance."
        )
    )
    story.append(Paragraph(note, sub))
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "Generated by PesaLens. This report is not a substitute for audited "
        "financial statements.",
        sub,
    ))

    doc.build(story)
    return buf.getvalue()


@router.get("/reports/monthly")
def monthly_report(
    month: str | None = Query(default=None, description="YYYY-MM (defaults to current month)"),
    user: User = Depends(require_active_plan),
    db: Session = Depends(get_db),
):
    """Stream a PDF combining P&L for the month + Balance Sheet at month end."""
    year, m = _resolve_month(month)
    start_iso, end_iso = _month_bounds(year, m)

    monthly_entries = (
        db.query(BusinessEntry)
        .filter(
            BusinessEntry.user_id == user.id,
            BusinessEntry.entry_date >= start_iso,
            BusinessEntry.entry_date <= end_iso,
        )
        .all()
    )
    cumulative_entries = (
        db.query(BusinessEntry)
        .filter(
            BusinessEntry.user_id == user.id,
            BusinessEntry.entry_date <= end_iso,
        )
        .all()
    )

    receipts_all = _load_receipts_for_user(user.id)
    monthly_receipts = _filter_receipts(receipts_all, start_iso, end_iso)
    cumulative_receipts = _filter_receipts(receipts_all, "0000-01-01", end_iso)

    monthly = _aggregate(monthly_entries, monthly_receipts)
    cumulative = _aggregate(cumulative_entries, cumulative_receipts)

    pdf_bytes = _build_pdf(
        user=user, year=year, month=m, monthly=monthly, cumulative=cumulative,
    )

    filename = f"pesalens-{year:04d}-{m:02d}-financials.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/reports/summary", response_model=APIResponse)
def monthly_summary(
    month: str | None = Query(default=None, description="YYYY-MM (defaults to current month)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """JSON sibling of /reports/monthly — used by the mobile app to preview totals."""
    year, m = _resolve_month(month)
    start_iso, end_iso = _month_bounds(year, m)

    monthly_entries = (
        db.query(BusinessEntry)
        .filter(
            BusinessEntry.user_id == user.id,
            BusinessEntry.entry_date >= start_iso,
            BusinessEntry.entry_date <= end_iso,
        )
        .all()
    )
    cumulative_entries = (
        db.query(BusinessEntry)
        .filter(
            BusinessEntry.user_id == user.id,
            BusinessEntry.entry_date <= end_iso,
        )
        .all()
    )

    receipts_all = _load_receipts_for_user(user.id)
    monthly_receipts = _filter_receipts(receipts_all, start_iso, end_iso)
    cumulative_receipts = _filter_receipts(receipts_all, "0000-01-01", end_iso)

    monthly = _aggregate(monthly_entries, monthly_receipts)
    cumulative = _aggregate(cumulative_entries, cumulative_receipts)

    return APIResponse(
        success=True, message="ok",
        data={
            "month": f"{year:04d}-{m:02d}",
            "monthly": {
                "revenue_total": monthly["revenue_total"],
                "expense_total": monthly["expense_total"],
                "net_income": monthly["net_income"],
                "by_class": monthly["by_class"],
                "receipt_count": len(monthly_receipts),
            },
            "balance_sheet": {
                "asset_total": cumulative["asset_total"],
                "liability_total": cumulative["liability_total"],
                "equity_total": cumulative["equity_total"],
                "retained_earnings": cumulative["net_income"],
                "by_class": cumulative["by_class"],
            },
        },
    )


# --------------------------- business intel --------------------------

@router.get("/intel", response_model=APIResponse)
def business_intel(user: User = Depends(get_current_user)):
    """One-shot intelligence payload for the Business dashboard.

    Combines the four DS pillars (forecast, anomalies, treasury,
    vendor analytics) plus TRA/EFD compliance into a single call — the
    mobile / web client can render a CFO-style overview without
    fanning out to four endpoints.
    """
    latest = load_latest_result(user.id) or {}
    transactions = latest.get("transactions") or []
    receipts = _load_receipts_for_user(user.id)

    return APIResponse(
        success=True, message="ok",
        data={
            "has_statement": bool(transactions),
            "forecast": cash_flow_forecast(transactions, horizon_days=30),
            "anomalies": detect_anomalies(transactions),
            "treasury": treasury_recommendation(transactions),
            "vendor_analytics": vendor_analytics(receipts),
            "compliance": compliance_summary(receipts),
        },
    )
