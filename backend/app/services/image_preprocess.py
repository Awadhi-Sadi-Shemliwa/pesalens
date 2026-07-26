"""
Image preprocessing for OCR quality.

Rendered PDF pages go through:
  1. Grayscale
  2. Deskew (detect angle, rotate to horizontal)
  3. Denoise (remove salt-and-pepper noise from scans)
  4. Adaptive binarize (handles uneven lighting on photos of statements)

This is the single biggest OCR-accuracy lever after choice of engine. Photos
of paper statements are typically off-angle by 1-3 degrees and binarizing
them with a flat threshold destroys light text.
"""

from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image

from app.utils.logger import get_logger

log = get_logger(__name__)

# Target DPI when rendering PDFs to images. 300 is the OCR sweet spot.
# Lower than 200 = unreliable text recognition. Higher than 400 = slow with no
# accuracy gain on printed statements.
RENDER_DPI = 300

# Cap the rendered long edge. A4 at 300 DPI is ~3508px, so normal statement
# pages are untouched; oversized page geometries (posters, raw phone-photo
# PDFs) would otherwise render 6000px+ images that multiply OCR time for no
# accuracy gain.
MAX_RENDER_EDGE_PX = 3500
MIN_RENDER_DPI = 150


def render_pdf_page(page, dpi: int = RENDER_DPI) -> np.ndarray:
    """
    Render a pdfplumber page to a BGR numpy image.

    Uses pdfplumber's built-in pdfium-based rasterizer so we don't need
    poppler/Ghostscript on Windows.
    """
    long_edge_pts = max(float(page.width or 0), float(page.height or 0))
    if long_edge_pts > 0 and long_edge_pts * dpi / 72 > MAX_RENDER_EDGE_PX:
        capped = max(MIN_RENDER_DPI, int(MAX_RENDER_EDGE_PX * 72 / long_edge_pts))
        log.info("Capping render DPI %d -> %d for oversized page", dpi, capped)
        dpi = capped
    pil_img = page.to_image(resolution=dpi).original
    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")
    arr = np.array(pil_img)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _estimate_skew(gray: np.ndarray) -> float:
    """Return skew angle in degrees. Positive = clockwise rotation needed to fix."""
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=200,
        minLineLength=gray.shape[1] // 3, maxLineGap=20,
    )
    if lines is None or len(lines) == 0:
        return 0.0

    angles: list[float] = []
    for line in lines[:200]:
        x1, y1, x2, y2 = line[0]
        if x2 == x1:
            continue
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        # Only consider near-horizontal lines (table rows, text baselines)
        if -15 < angle < 15:
            angles.append(angle)

    if not angles:
        return 0.0
    return float(np.median(angles))


def _deskew(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    angle = _estimate_skew(gray)
    if abs(angle) < 0.2:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(
        img, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _binarize(gray: np.ndarray) -> np.ndarray:
    """Adaptive threshold — handles uneven lighting in phone photos of statements."""
    return cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31, C=15,
    )


def preprocess_for_ocr(img: np.ndarray) -> np.ndarray:
    """
    Full preprocessing chain. Returns a single-channel binary image ready for OCR.

    Returns BGR three-channel copy because some OCR engines (rapidocr) expect
    3-channel input even when the content is binary.
    """
    try:
        # Deskew on the color image first — rotation preserves color info
        deskewed = _deskew(img)
        gray = cv2.cvtColor(deskewed, cv2.COLOR_BGR2GRAY)

        # Light denoise — too aggressive hurts thin strokes on small fonts
        denoised = cv2.fastNlMeansDenoising(gray, h=7, templateWindowSize=7, searchWindowSize=21)

        binary = _binarize(denoised)
        # Expand back to 3 channels for OCR input
        return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    except Exception as e:
        log.warning("Preprocessing failed, returning raw image: %s", e)
        return img


def image_to_png_bytes(img: np.ndarray) -> bytes:
    """Encode an image as PNG bytes (for debug dumps)."""
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    return buf.getvalue()
