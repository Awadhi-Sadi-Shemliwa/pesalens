"""
OCR extractor for scanned PDF pages.

Uses RapidOCR (PP-OCR models exported to ONNX — same accuracy as PaddleOCR,
~50MB install, no paddle/torch dependencies). Output is converted to the same
shape as pdfplumber's extract_words() so the existing row_builder Tier 2 engine
can consume it with zero changes.

Optional: if rapid-table is installed, scanned pages also get structured-table
recognition (the PP-Structure equivalent of what MinerU does). When it fires,
row_builder Tier 1 kicks in — same code path as digital tables.

Lazy-loaded: the OCR engine costs ~1GB RAM when initialized. We only boot it
when a scanned page actually needs extraction, and we reuse the instance across
pages. If RapidOCR is not installed, we gracefully return empty results so the
pipeline doesn't crash (matching prior stub behavior).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

import pdfplumber

from app.config import settings
from app.schemas.transaction import DocumentType
from app.services.digital_extractor import PageExtraction
from app.services.image_preprocess import preprocess_for_ocr, render_pdf_page
from app.schemas.transaction import PageResult
from app.utils.logger import get_logger

log = get_logger(__name__)

# Lazy singletons — loaded on first use
_ocr_engine: Any = None
_table_engine: Any = None
_ocr_unavailable: bool = False
_table_unavailable: bool = False


class OcrPageLimitExceeded(Exception):
    """Raised when a document has more scanned pages than ocr_max_pages allows."""

    def __init__(self, scanned_pages: int, limit: int):
        self.scanned_pages = scanned_pages
        self.limit = limit
        super().__init__(
            f"{scanned_pages} scanned pages exceeds the OCR limit of {limit}"
        )


def is_ocr_available() -> bool:
    """Whether the OCR engine can be used (loads it on first call)."""
    return _get_ocr_engine() is not None


def _get_ocr_engine():
    """Lazy-load RapidOCR. Returns None if package isn't installed."""
    global _ocr_engine, _ocr_unavailable
    if _ocr_engine is not None:
        return _ocr_engine
    if _ocr_unavailable:
        return None
    try:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
        log.info("RapidOCR engine initialized")
        return _ocr_engine
    except ImportError:
        log.warning(
            "rapidocr_onnxruntime not installed — scanned pages will be skipped. "
            "Install with: pip install rapidocr-onnxruntime"
        )
        _ocr_unavailable = True
        return None
    except Exception as e:
        log.error("Failed to initialize RapidOCR: %s", e)
        _ocr_unavailable = True
        return None


def _get_table_engine():
    """Lazy-load rapid-table (optional). Returns None if not installed."""
    global _table_engine, _table_unavailable
    if _table_engine is not None:
        return _table_engine
    if _table_unavailable:
        return None
    try:
        from rapid_table import RapidTable
        _table_engine = RapidTable()
        log.info("RapidTable (PP-Structure equivalent) initialized")
        return _table_engine
    except ImportError:
        log.info("rapid_table not installed — falling back to word-position mode for scanned pages")
        _table_unavailable = True
        return None
    except Exception as e:
        log.warning("Failed to initialize RapidTable: %s", e)
        _table_unavailable = True
        return None


def _ocr_boxes_to_pdfplumber_words(
    ocr_result: list, img_width: int, img_height: int, page_width: float, page_height: float,
) -> list[dict]:
    """
    Convert RapidOCR's [[bbox_pts], text, conf] rows into pdfplumber's word dict format.

    RapidOCR returns pixel coordinates. pdfplumber works in PDF points (1/72 inch).
    We scale pixel -> point so bboxes line up with the logical page size, letting
    row_builder's column-detection heuristics work the same as for digital PDFs.
    """
    if not ocr_result:
        return []

    sx = page_width / img_width if img_width else 1.0
    sy = page_height / img_height if img_height else 1.0
    words: list[dict] = []

    for row in ocr_result:
        # RapidOCR format variants: [bbox, text, conf] or [bbox, (text, conf)]
        if len(row) == 3:
            bbox_pts, text, conf = row
        elif len(row) == 2:
            bbox_pts, inner = row
            if isinstance(inner, (list, tuple)) and len(inner) == 2:
                text, conf = inner
            else:
                text, conf = inner, 0.0
        else:
            continue

        if not text or not str(text).strip():
            continue

        xs = [p[0] for p in bbox_pts]
        ys = [p[1] for p in bbox_pts]
        x0, x1 = min(xs) * sx, max(xs) * sx
        top, bottom = min(ys) * sy, max(ys) * sy

        # A detected text box may contain multiple whitespace-separated tokens;
        # split so row_builder can assign each to a column individually. Space
        # them proportionally across the bbox so x-positions remain meaningful.
        tokens = str(text).split()
        if not tokens:
            continue
        box_w = x1 - x0
        per = box_w / max(len(tokens), 1)
        for i, tok in enumerate(tokens):
            words.append({
                "text": tok,
                "x0": x0 + i * per,
                "x1": x0 + (i + 1) * per,
                "top": top,
                "bottom": bottom,
                "confidence": float(conf) if conf is not None else 0.0,
            })

    # Sort reading-order (top-to-bottom, then left-to-right)
    words.sort(key=lambda w: (round(w["top"], 1), w["x0"]))
    return words


def _html_table_to_rows(html: str) -> list[list[str]]:
    """Parse a simple <table>...</table> HTML string into a list[list[str]] grid."""
    import re
    rows: list[list[str]] = []
    row_matches = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL | re.IGNORECASE)
    for row_html in row_matches:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.DOTALL | re.IGNORECASE)
        cleaned = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
        if any(cleaned):
            rows.append(cleaned)
    return rows


def _ocr_page(
    page_img,
    page_number: int,
    page_width: float,
    page_height: float,
) -> tuple[PageResult, list[list[str]], list[dict]]:
    """
    Run OCR on a single preprocessed page image.

    Returns (page_result, tables, words) — same shape as digital_extractor
    so pipeline.py can treat scanned and digital pages uniformly.
    """
    ocr = _get_ocr_engine()
    if ocr is None:
        return (
            PageResult(
                page_number=page_number,
                is_scanned=True,
                errors=["OCR engine unavailable — install rapidocr-onnxruntime"],
                confidence=0.0,
            ),
            [],
            [],
        )

    img_h, img_w = page_img.shape[:2]

    # --- Word-level OCR ---
    try:
        result, _ = ocr(page_img)
    except Exception as e:
        log.error("OCR failed on page %d: %s", page_number, e)
        return (
            PageResult(
                page_number=page_number,
                is_scanned=True,
                errors=[f"OCR failed: {e}"],
                confidence=0.0,
            ),
            [],
            [],
        )

    words = _ocr_boxes_to_pdfplumber_words(
        result or [], img_w, img_h, page_width, page_height,
    )
    raw_text = " ".join(w["text"] for w in words)

    # --- Optional table structure recognition (MinerU's killer feature, lite) ---
    tables: list[list[str]] = []
    table_engine = _get_table_engine()
    if table_engine is not None:
        try:
            table_html, _elapse = table_engine(page_img, result)
            if table_html:
                parsed = _html_table_to_rows(table_html)
                if parsed:
                    tables = [parsed]
                    log.info("Page %d: table engine recovered %d rows", page_number, len(parsed))
        except Exception as e:
            log.warning("Table recognition failed on page %d: %s", page_number, e)

    # Confidence: average per-word confidence, penalized if very few words found
    if words:
        avg_conf = sum(w.get("confidence", 0.0) for w in words) / len(words)
        if len(words) < 20:
            avg_conf *= 0.6
    else:
        avg_conf = 0.0

    return (
        PageResult(
            page_number=page_number,
            is_scanned=True,
            raw_text=raw_text,
            confidence=round(avg_conf, 2),
        ),
        tables,
        words,
    )


def extract_scanned_pdf(
    file_path: Path,
    page_types: list[DocumentType],
    progress_cb: Optional[Callable[[str, int], None]] = None,
) -> list[PageExtraction]:
    """
    OCR-extract the scanned pages of a PDF. Digital pages are left for
    digital_extractor. Emits the same PageExtraction shape so pipeline.py
    can merge scanned and digital results seamlessly.

    `progress_cb(stage, pct)` fires before each page: OCR runs ~40s/page, so
    per-page pings both keep the job's heartbeat fresh (orphan recovery would
    otherwise kill a long scan at 600s of silence) and let the client render
    "Reading scanned pages (12/100)". Percent maps into the pipeline's
    20→55 extraction band.

    Raises OcrPageLimitExceeded when the scanned-page count is over
    settings.ocr_max_pages — bounding worst-case worker occupancy.
    """
    extractions: list[PageExtraction] = []
    scanned_total = sum(1 for t in page_types if t == DocumentType.SCANNED)
    if scanned_total > settings.ocr_max_pages:
        raise OcrPageLimitExceeded(scanned_total, settings.ocr_max_pages)
    done = 0

    try:
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                page_num = i + 1
                if i >= len(page_types) or page_types[i] != DocumentType.SCANNED:
                    continue

                if progress_cb:
                    try:
                        progress_cb(
                            f"Reading scanned pages ({done + 1}/{scanned_total})",
                            20 + int(34 * done / max(scanned_total, 1)),
                        )
                    except Exception:  # noqa: BLE001 - progress must never break OCR
                        log.debug("progress_cb raised (ignored)", exc_info=True)
                done += 1

                log.info("OCR: processing scanned page %d", page_num)
                try:
                    raw_img = render_pdf_page(page)
                    clean_img = preprocess_for_ocr(raw_img)
                    page_result, tables, words = _ocr_page(
                        clean_img, page_num,
                        page_width=float(page.width),
                        page_height=float(page.height),
                    )
                    extractions.append(PageExtraction(
                        page_result=page_result, tables=tables, words=words,
                    ))
                    log.info(
                        "Page %d OCR: %d words, %d tables, confidence=%.2f",
                        page_num, len(words), len(tables), page_result.confidence,
                    )
                except Exception as e:
                    log.exception("Scanned page %d extraction failed", page_num)
                    extractions.append(PageExtraction(
                        page_result=PageResult(
                            page_number=page_num,
                            is_scanned=True,
                            errors=[f"OCR pipeline failed: {e}"],
                            confidence=0.0,
                        ),
                    ))
    except Exception as e:
        log.error("Failed to open PDF for OCR: %s", e)

    return extractions
