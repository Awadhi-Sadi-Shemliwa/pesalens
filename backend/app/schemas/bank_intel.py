"""Per-bank spending intelligence — the "money map" (Epic-2, Slice 3).

Rolls up spend, inflow, transaction count and — the point of the feature —
bank charges per service, so a user running 7+ providers can see which one
is quietly the most expensive and where to move their money. Deterministic
facts stand alone; the optional LLM narrative only enriches them.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class BankIntelCard(BaseModel):
    """One provider's rolled-up activity across all the user's statements."""

    bank: str                       # BankFormat value, e.g. "nmb"
    label: str                      # display label, e.g. "NMB"
    spend: float = 0.0              # total money out (debits)
    inflow: float = 0.0             # total money in (credits)
    txn_count: int = 0
    charges: float = 0.0            # total detected bank charges / fees / VAT
    charge_occurrences: int = 0
    interest: float = 0.0           # total interest / uncredited amounts
    fee_rate: float = 0.0           # charges / spend, 0..1 (0 when no spend)
    avg_fee_per_txn: float = 0.0    # charges / txn_count
    statement_count: int = 0


class BankIntelSuggestion(BaseModel):
    """A deterministic, fact-based recommendation. `kind` lets the UI pick an
    icon / tone; `bank` + `amount` back the copy so the frontend can re-render
    them in the user's locale without re-deriving."""

    kind: Literal["most_expensive", "cheapest", "saving_estimate"]
    title: str
    detail: str
    bank: Optional[str] = None
    amount: Optional[float] = None


class BankIntelTotals(BaseModel):
    total_spend: float = 0.0
    total_inflow: float = 0.0
    total_charges: float = 0.0
    total_txns: int = 0
    bank_count: int = 0


class BankIntelResponse(BaseModel):
    banks: list[BankIntelCard] = Field(default_factory=list)
    suggestions: list[BankIntelSuggestion] = Field(default_factory=list)
    totals: BankIntelTotals = Field(default_factory=BankIntelTotals)
    overall_summary: Optional[str] = None
    llm_status: Literal["ok", "unavailable", "skipped"] = "skipped"
    notes: list[str] = Field(default_factory=list)
