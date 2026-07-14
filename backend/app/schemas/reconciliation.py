"""Pydantic models for the cross-source reconciliation endpoint.

The reconciliation engine in `app/services/reconciliation.py` joins three
disconnected data sources for a given date range:

  * statement transactions (extracted from uploaded PDFs)
  * scanned receipts
  * manual personal / business ledger entries

…and produces a per-statement-debit grouping where each row carries the
receipts and entries that plausibly explain it, plus a rolled-up "blind
spot" KPI (% of money out with no receipt/entry backing) and optional
LLM coaching notes.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# A single explanation candidate (a receipt or a manual ledger entry) that
# may explain part of a statement debit.
class ReconciliationCandidate(BaseModel):
    source: Literal["receipt", "personal", "business"]
    date: str  # YYYY-MM-DD
    # True when the receipt OCR couldn't read a date and we fell back to
    # `scanned_at[:10]`. UI shows a "(scan date)" hint.
    date_inferred: bool = False
    vendor: Optional[str] = None
    category: Optional[str] = None
    amount: float
    ref_id: Optional[str] = None  # receipt_id / personal_entry_id / etc.


class ReconciliationGroup(BaseModel):
    """One statement debit + the receipts/entries that plausibly explain it."""

    kind: Literal["withdrawal", "pos", "transfer"]
    txn_date: str
    description: str
    debit_amount: float
    explained_amount: float
    status: Literal["fully_explained", "partial", "blind_spot"]
    candidates: list[ReconciliationCandidate] = Field(default_factory=list)
    # The provider (BankFormat value, e.g. "nmb") and time-of-day of the
    # statement debit this group represents, so the UI can show "NMB · 13:40".
    bank: Optional[str] = None
    time: Optional[str] = None
    # Set when this debit was chosen over a competing one from another service
    # by amount sufficiency and/or recency — explains the attribution to the user
    # ("Attributed to NMB 13:40 — Selcom's 18k withdrawal was too small to cover
    # the 25k receipt").
    attribution_note: Optional[str] = None
    # LLM coaching note. Nullable — empty when the LLM is unavailable.
    insight: Optional[str] = None


class ReconciliationKpis(BaseModel):
    total_money_out: float
    total_explained: float
    blind_spot_ratio: float  # 0.0–1.0
    group_count: int
    fully_explained: int
    partial: int
    blind_spot: int


class RecurringWithdrawal(BaseModel):
    weekday: str
    band_label: str  # e.g. "TZS 50K–100K"
    occurrences: int
    avg_amount: float
    total: float


class TopVendor(BaseModel):
    vendor: str
    total: float
    occurrences: int
    sources: list[str]  # ["receipt", "personal", ...]


class MonthlyBlindSpot(BaseModel):
    month: str  # YYYY-MM
    total_money_out: float
    total_explained: float
    blind_spot_ratio: float


class HistoricalPatterns(BaseModel):
    recurring_withdrawals: list[RecurringWithdrawal] = Field(default_factory=list)
    top_vendors: list[TopVendor] = Field(default_factory=list)
    blind_spot_by_month: list[MonthlyBlindSpot] = Field(default_factory=list)


class ChargeItem(BaseModel):
    """A single detected bank charge or interest row."""

    date: Optional[str] = None
    description: str = ""
    amount: float


class ChargesSummary(BaseModel):
    """Bank charges + interest identified from running-balance gaps, restricted
    to the reconciliation date range. Charges = balance dropped more than the
    listed debit (fees/VAT/excise); interest = balance rose more than listed."""

    total_charges: float = 0.0
    charge_occurrences: int = 0
    total_interest: float = 0.0
    interest_occurrences: int = 0
    charges: list[ChargeItem] = Field(default_factory=list)
    interest: list[ChargeItem] = Field(default_factory=list)


class ReconciliationRange(BaseModel):
    start: str
    end: str


class ReconciliationResponse(BaseModel):
    range: ReconciliationRange
    scope: Literal["personal", "business"]
    kpis: ReconciliationKpis
    groups: list[ReconciliationGroup] = Field(default_factory=list)
    # Receipts / entries that fell inside the date range but weren't consumed
    # by any statement debit (either nothing matched them, or no statement
    # covers their date). Surfaced so the ledger shows EVERY backing item the
    # user recorded — a scanned receipt must be visible in reconciliation even
    # before it's paired with an outflow.
    unmatched_candidates: list[ReconciliationCandidate] = Field(default_factory=list)
    patterns: Optional[HistoricalPatterns] = None
    charges_summary: Optional[ChargesSummary] = None
    overall_summary: Optional[str] = None
    llm_status: Literal["ok", "unavailable", "skipped"] = "skipped"
    notes: list[str] = Field(default_factory=list)
