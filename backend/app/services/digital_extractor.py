"""
Digital PDF extraction using pdfplumber.

Extracts three data sources per page:
  1. Raw text (layout-preserved) — for debugging
  2. Structured tables — for Tier 1 table-mode extraction
  3. Words with bounding boxes — for Tier 2 word-position extraction

The row_builder decides which source to use based on quality.
"""

from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

from app.schemas.transaction import DocumentType, PageResult
from app.utils.logger import get_logger

log = get_logger(__name__)


@dataclass
class PageExtraction:
    """All extraction data for a single page."""
    page_result: PageResult
    tables: list[list[list[str | None]]] = field(default_factory=list)
    words: list[dict] = field(default_factory=list)


def extract_digital_pdf(
    file_path: Path, page_types: list[DocumentType]
) -> list[PageExtraction]:
    """
    Extract text, tables, and words from all digital pages of a PDF.
    """
    extractions: list[PageExtraction] = []

    try:
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                page_num = i + 1
                is_scanned = (
                    page_types[i] == DocumentType.SCANNED
                    if i < len(page_types) else False
                )

                if is_scanned:
                    extractions.append(PageExtraction(
                        page_result=PageResult(
                            page_number=page_num,
                            is_scanned=True,
                            errors=["Page is scanned — requires OCR"],
                        ),
                    ))
                    continue

                try:
                    # 1. Raw text with layout
                    raw_text = ""
                    try:
                        raw_text = page.extract_text(layout=True) or ""
                    except Exception:
                        raw_text = page.extract_text() or ""

                    # 2. Tables
                    tables = []
                    try:
                        found = page.extract_tables() or []
                        tables = [t for t in found if t and len(t) >= 1]
                    except Exception as e:
                        log.warning("Page %d table extraction failed: %s", page_num, e)

                    # 3. Words with bounding boxes
                    words = []
                    try:
                        words = page.extract_words() or []
                    except Exception as e:
                        log.warning("Page %d word extraction failed: %s", page_num, e)

                    extractions.append(PageExtraction(
                        page_result=PageResult(
                            page_number=page_num,
                            is_scanned=False,
                            raw_text=raw_text,
                            confidence=1.0,
                        ),
                        tables=tables,
                        words=words,
                    ))

                    log.info(
                        "Page %d: %d chars, %d tables, %d words",
                        page_num, len(raw_text), len(tables), len(words),
                    )

                except Exception as e:
                    log.error("Page %d extraction failed: %s", page_num, e)
                    extractions.append(PageExtraction(
                        page_result=PageResult(
                            page_number=page_num,
                            errors=[f"Extraction failed: {str(e)}"],
                            confidence=0.0,
                        ),
                    ))

    except Exception as e:
        log.error("Failed to open PDF: %s", e)

    return extractions
