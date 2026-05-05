"""Core data models for bank statement extraction."""

from __future__ import annotations

import datetime as dt
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class DocumentType(str, Enum):
    DIGITAL = "digital"
    SCANNED = "scanned"
    MIXED = "mixed"


class BankFormat(str, Enum):
    CRDB = "crdb"
    NMB = "nmb"
    NBC = "nbc"
    KCB = "kcb"
    ABSA = "absa"
    AMANA = "amana"
    MPESA = "mpesa"
    AIRTEL_MONEY = "airtel_money"
    TIGO_PESA = "tigo_pesa"
    HALO_PESA = "halo_pesa"
    SELCOM = "selcom"
    YAS = "yas"
    UNKNOWN = "unknown"


class Transaction(BaseModel):
    """A single transaction row extracted from a bank statement."""

    row_index: int = Field(..., description="Sequential row number in the statement")
    txn_date: Optional[dt.date] = Field(None, description="Transaction date")
    description: str = Field("", description="Transaction description/narration")
    reference: Optional[str] = Field(None, description="Transaction reference number")
    debit: Optional[float] = Field(None, description="Amount debited (money out)")
    credit: Optional[float] = Field(None, description="Amount credited (money in)")
    balance: Optional[float] = Field(None, description="Running balance after transaction")
    currency: str = Field("TZS", description="Currency code")
    confidence: float = Field(
        1.0, ge=0.0, le=1.0, description="Extraction confidence score"
    )
    raw_text: str = Field("", description="Original raw text for this row")
    needs_review: bool = Field(False, description="Flagged for manual review")
    review_reason: Optional[str] = Field(None, description="Why this row needs review")
    page_number: int = Field(0, description="PDF page this row was found on")


class PageResult(BaseModel):
    """Extraction result for a single PDF page."""

    page_number: int
    is_scanned: bool = False
    raw_text: str = ""
    transactions: list[Transaction] = []
    skipped_lines: list[str] = Field(
        default_factory=list,
        description="Lines skipped (headers, footers, summaries)",
    )
    errors: list[str] = Field(default_factory=list)
    confidence: float = Field(1.0, ge=0.0, le=1.0)


class StatementMetadata(BaseModel):
    """Metadata extracted from the statement header or footer.

    Some banks (Amana, Airtel) print summary lines at the top of page 1;
    others (NMB) print them on the LAST page. The pipeline now scans the
    entire document text so either layout works.
    """

    bank: BankFormat = BankFormat.UNKNOWN
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    period_start: Optional[dt.date] = None
    period_end: Optional[dt.date] = None
    opening_balance: Optional[float] = None
    closing_balance: Optional[float] = None
    # Totals as printed by the bank itself (when present). Used for
    # cross-checking against the sum of extracted transaction rows.
    reported_total_debits: Optional[float] = None
    reported_total_credits: Optional[float] = None
    currency: str = "TZS"


class ExtractionResult(BaseModel):
    """Complete extraction result for the entire document."""

    job_id: str
    filename: str
    document_type: DocumentType = DocumentType.DIGITAL
    metadata: StatementMetadata = Field(default_factory=StatementMetadata)
    pages: list[PageResult] = []
    transactions: list[Transaction] = []
    total_pages: int = 0
    total_transactions: int = 0
    validation_passed: bool = False
    validation_errors: list[str] = Field(default_factory=list)
    processing_time_seconds: float = 0.0
    created_at: dt.datetime = Field(
        default_factory=lambda: dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    )


class ClassificationResult(BaseModel):
    """Result of document classification."""

    document_type: DocumentType
    bank_format: BankFormat
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    page_types: list[DocumentType] = Field(
        default_factory=list,
        description="Per-page classification (digital or scanned)",
    )
    total_pages: int = 0
    sample_text: str = Field("", description="First extracted text for debugging")
