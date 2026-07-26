"""Receipt scanning + spending pattern endpoints.

The scan endpoint sends the image to a vision-capable model on OpenRouter,
asks it to first decide whether the image is actually a receipt, and then
either records the parsed JSON in storage/receipts/ or returns a friendly
message asking the user to add a real receipt.

The patterns endpoint loads every stored receipt and surfaces simple
aggregate insights (fuel cadence, frequent groceries, etc.).
"""

import base64
import json
import os
import re
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool

from sqlalchemy.orm import Session

from app.config import settings
from app.db import User, get_db
from app.deps import get_current_user, require_active_plan
from app.services.activity import record_activity, record_error
from app.rate_limit import limiter
from app.schemas.response import APIResponse
from app.services.fx import (
    get_rate_to_tzs,
    normalize_currency,
    receipt_amount_tzs,
    receipt_printed_amount,
)
from app.utils.storage import delete_receipt_files
from app.services.tax_codes import annotate as annotate_tax, compliance_summary
from app.utils.logger import get_logger
from app.utils.sanitize import sanitize_user_text
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["receipts"])


# Magic-byte signatures for the image formats vision models accept.
# Trusting Content-Type alone lets a caller send executables / scripts
# pretending to be JPEG; we sniff the first bytes instead.
def _detect_image_mime(blob: bytes) -> str | None:
    if len(blob) < 12:
        return None
    if blob.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    if blob[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if blob[4:8] in (b"ftyp",) and blob[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"heis"):
        return "image/heic"
    return None


# Receipt photos straight off a phone carry GPS coordinates, device serial,
# and capture timestamps in EXIF. None of that is needed for OCR, and we
# don't want to send it to the vision LLM or persist it on disk. Re-encode
# the image through Pillow without metadata; for formats Pillow can't round-
# trip cleanly (e.g. HEIC without pillow-heif) we fall through and return
# the original bytes so the existing pipeline still runs.
_PIL_FORMAT_BY_MIME = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
    "image/gif": "GIF",
}


def _strip_image_metadata(blob: bytes, mime: str | None) -> bytes:
    fmt = _PIL_FORMAT_BY_MIME.get(mime or "")
    if not fmt:
        return blob  # HEIC and friends — Pillow can't always re-emit, leave alone.
    try:
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(blob))
        # Preserve mode for PNG transparency etc; JPEG can't store RGBA.
        if fmt == "JPEG" and img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        buf = BytesIO()
        save_kwargs: dict = {"format": fmt}
        if fmt == "JPEG":
            save_kwargs["quality"] = 90
            save_kwargs["optimize"] = True
        img.save(buf, **save_kwargs)
        return buf.getvalue()
    except Exception as exc:
        log.warning("EXIF strip failed (%s) — using original bytes", exc.__class__.__name__)
        return blob


# Built-in fallbacks. OpenRouter retires free vision tiers often (the
# previous Qwen2.5-VL / Llama-4-Scout / Gemini-2.0-flash-exp / Nemotron
# Nano 12B 2 VL slots all returned 400/404 after the vendors pulled their
# free endpoints — the last one died in June 2026 with "not a valid model
# ID"). The real source of truth is the OPENROUTER_VISION_MODELS env var
# (comma-separated) — set that to whatever a live `/v1/models` query shows
# for your account. Gemma-4 stays off this list (field reports of weak
# OCR); Nemotron-3 Nano Omni is NVIDIA's current multimodal model and was
# the strongest free vision option live on OpenRouter as of 2026-06.
DEFAULT_VISION_MODELS = [
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
]


def _vision_model_chain() -> list[str]:
    """OpenRouter vision-capable models, in try-order, deduped.

    `openrouter_model` is intentionally excluded — that slot is the chat /
    text-only model (MiniMax M2.5 by default), which rejects image input.
    To override the vision list, set OPENROUTER_VISION_MODELS in .env.
    """
    chain: list[str] = []
    if settings.openrouter_vision_models:
        for m in settings.openrouter_vision_models.split(","):
            m = m.strip()
            if m and m not in chain:
                chain.append(m)
    for m in DEFAULT_VISION_MODELS:
        if m not in chain:
            chain.append(m)
    return chain


def _text_model() -> str:
    """Text-only model for OCR-string parsing (defaults to openrouter_model)."""
    return settings.openrouter_text_model or settings.openrouter_model


PROMPT = (
    "You are a vision system that decides whether an image is a financial "
    "receipt and, if so, extracts its data. Return STRICT JSON only — no "
    "markdown fences, no commentary.\n\n"
    "First decide:\n"
    "  is_receipt = true  → the image clearly shows a printed receipt, "
    "till slip, invoice, hand-written sales note, BANK PAYMENT SLIP (NBC / "
    "CRDB / NMB / Stanbic GePG slip, deposit receipt), MOBILE-MONEY "
    "CONFIRMATION (M-Pesa, Tigo Pesa, Airtel Money, HaloPesa, Mixx by Yas), "
    "or TRA / EFD tax receipt — i.e. anything documenting a money "
    "transaction with an amount.\n"
    "  is_receipt = false → anything else (people, scenery, screenshots of "
    "apps that are NOT payment confirmations, ID cards, blank pages, "
    "illegible blur, random objects, etc.).\n\n"
    "If is_receipt is false, return EXACTLY this shape:\n"
    "{\n"
    '  "is_receipt": false,\n'
    '  "image_description": "short plain description of what the image shows"\n'
    "}\n\n"
    "If is_receipt is true, return EXACTLY this shape:\n"
    "{\n"
    '  "is_receipt": true,\n'
    '  "vendor": "merchant / bank / operator name (NOT the full slip text)",\n'
    '  "date": "YYYY-MM-DD or null",\n'
    '  "items": [{"name": "item or description", "quantity": 1, "unit": "kg/litres/pcs/null", "unit_price": 0, "line_total": 0}],\n'
    '  "subtotal": 0,\n'
    '  "tax": 0,\n'
    '  "total": 0,\n'
    '  "currency": "TZS",\n'
    '  "category": "fuel|groceries|restaurant|utilities|stock|transport|tax|bank_transfer|mobile_money|other"\n'
    "}\n"
    "CRITICAL RULES:\n"
    "- ALWAYS extract EVERY visible line item into `items` (with its "
    "`unit_price` and `line_total`) AND the grand total into `total`. "
    "A receipt that shows printed amounts MUST come back with `total` > 0 "
    "and its line items — NEVER return just the vendor.\n"
    "- `total` MUST be the headline transaction amount as a plain number "
    "(no commas, no currency symbol). For a bank slip labelled "
    "'AMOUNT TZS 101,250.00', total = 101250. For an M-Pesa confirmation "
    "'Umelipa TZS 5,000', total = 5000. For a till receipt with a "
    "'Receipt Total $204.75' line, total = 204.75.\n"
    "- Receipts may be in TZS, USD, KES, or other currencies. Read the "
    "printed currency symbol/code and set `currency` accordingly "
    "(e.g. '$' -> USD, 'TSh' -> TZS). Still extract all amounts as plain "
    "numbers.\n"
    "- NEVER dump the full OCR text into `vendor` — extract only the "
    "merchant / bank / operator NAME (e.g. 'NBC', 'Vodacom M-Pesa', "
    "'Shoprite Mlimani City').\n"
    "- For bank slips and mobile-money confirmations with no line items, "
    "return `items: []` and put the amount in `total`.\n"
    "- Use 0 instead of null for numbers when unknown."
)


def _receipts_dir(user_id=None) -> Path:
    base = settings.storage_path / "receipts"
    target = base / str(user_id) if user_id else base
    target.mkdir(parents=True, exist_ok=True)
    return target


# Client-generated idempotency key for a scan attempt. The client may abort
# (timeout, network drop) AFTER the server has already saved the receipt —
# the marker file lets a retried upload or a reconciliation poll find the
# receipt that the "failed" attempt actually produced, instead of saving a
# duplicate or reporting a false failure.
_SCAN_ID_RX = re.compile(r"^[A-Fa-f0-9-]{8,40}$")


def _clean_scan_id(raw: str | None) -> str | None:
    raw = (raw or "").strip()
    return raw if raw and _SCAN_ID_RX.match(raw) else None


def _scan_marker_path(user_id: int, scan_id: str) -> Path:
    return _receipts_dir(user_id) / f".scan-{scan_id}"


def _receipt_for_scan(user_id: int, scan_id: str) -> dict | None:
    """Load the receipt a previous attempt with this scan_id saved, if any."""
    marker = _scan_marker_path(user_id, scan_id)
    try:
        receipt_id = marker.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not receipt_id:
        return None
    json_path = _receipts_dir(user_id) / f"{receipt_id}.json"
    try:
        return json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - marker without JSON = treat as absent
        return None


def _user_image_bytes(user_id: int) -> int:
    """Total stored image size for this user, in bytes (excludes JSON)."""
    total = 0
    target = _receipts_dir(user_id)
    for p in target.iterdir():
        if p.is_file() and p.suffix.lower() != ".json":
            try:
                total += p.stat().st_size
            except OSError:
                continue
    return total


def _enforce_receipt_quota(user_id: int, incoming_bytes: int) -> None:
    """Raise 413 if the new image would exceed the per-user image quota."""
    cap = max(0, int(settings.receipt_quota_mb)) * 1024 * 1024
    if cap <= 0:
        return
    used = _user_image_bytes(user_id)
    if used + incoming_bytes > cap:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Receipt storage limit reached "
                f"({settings.receipt_quota_mb} MB). Delete older receipts "
                f"or upgrade your plan to scan more."
            ),
        )


def _cleanup_old_receipt_images(user_id: int) -> int:
    """Delete receipt images older than the retention window. Keeps the
    JSON metadata so analytics still see the spend. Best-effort —
    failures are logged and skipped."""
    days = max(0, int(settings.receipt_image_retention_days))
    if days <= 0:
        return 0
    cutoff = time.time() - days * 86400
    removed = 0
    target = _receipts_dir(user_id)
    for p in target.iterdir():
        if not p.is_file() or p.suffix.lower() == ".json":
            continue
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                removed += 1
        except OSError as exc:
            log.warning("receipt cleanup skip %s: %s", p, exc)
    return removed


def _strip_json(text: str) -> str:
    """Strip ```json fences and surrounding noise from model output."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*", "", cleaned).strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[: -3].strip()
    return cleaned


def _extract_json_object(text: str) -> str | None:
    """Best-effort scrape of the first JSON object out of free-form text."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    return text[start : end + 1]


# Tried in order. 2.5-flash is plenty for receipts; 2.5-flash-lite is the
# fallback when 2.5-flash is rate-limited. gemini-2.0-flash was removed —
# Google zeroed its free tier in June 2026, so every call returned 429
# "exceeded your quota" and it only burned a 12s retry before falling
# through. gemini-1.5-flash was retired in 2025 (404 on v1beta).
GEMINI_VISION_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]

# Per-minute Gemini free-tier windows are 60s wide, not "a couple of
# seconds". The previous 1.5s retry slammed straight back into the same
# minute window and burned the only retry we had. 12s gives the window a
# chance to actually clear before we waste the second attempt.
_RETRY_DELAY_SEC = 12.0

# Hard wall-clock budget for the WHOLE vision cascade (Gemini models +
# OpenRouter fallbacks + inter-service cool-down). Without this the cascade
# could stack 90s + 12s retry + 90s + 60s timeouts and run for minutes —
# long past the client's AbortController — so the browser showed "request
# failed" while the backend quietly finished and SAVED the receipt (the
# exact bug users hit). Capping the server side below the client abort
# guarantees the request always returns a decisive answer the UI can show.
# The client abort (api.js) is set comfortably ABOVE this so the backend
# always wins the race.
SCAN_BUDGET_SEC = 75.0

# Per-call HTTP timeouts. Each individual call is also clamped to whatever
# remains of SCAN_BUDGET_SEC, so a single slow model can never blow the
# overall budget. Gemini gets the larger slice: the common success path is ONE
# Gemini call, and schema-guided decoding of a long, many-line receipt
# (maxOutputTokens=32768) can legitimately stream for ~50s — a 45s cap was
# clipping those into false failures. 60s still leaves headroom under the 75s
# budget (a second Gemini attempt just gets the remainder), and Gemini 5xx/429
# failures return fast so the OpenRouter fallback keeps most of the budget.
_GEMINI_HTTP_TIMEOUT = 60.0
_OPENROUTER_HTTP_TIMEOUT = 45.0

# Minimum remaining budget to START a fresh upstream vision call. A vision
# request needs real time to complete (upload the image, run inference, stream
# JSON back), so firing one with only a few seconds left is guaranteed-wasted
# work: it ReadTimeouts, burns a request, and eats the seconds that a decisive
# failure message could have used. 18s is the floor below which we stop trying
# and return the classified failure instead. Kept well under _GEMINI_HTTP_TIMEOUT
# so a first call still gets its full slice on a fresh budget.
_MIN_START_BUDGET_SEC = 18.0


# Structured-output schema for Gemini vision calls. Passed verbatim as
# `generationConfig.responseSchema` so the model is contractually bound
# to a complete, parseable receipt object instead of free-form JSON that
# could truncate mid-string under output-token pressure (the actual
# cause of the recurring "Bad JSON (after scrape)" warnings, not a
# rate-limit). Keep `required` minimal so a "this is not a receipt"
# image still validates and the is_receipt=false branch in
# scan_receipt can route the friendly explanation.
RECEIPT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "is_receipt": {"type": "boolean"},
        "image_description": {"type": "string"},
        "vendor": {"type": "string"},
        "date": {"type": "string"},
        "currency": {"type": "string"},
        "subtotal": {"type": "number"},
        "tax": {"type": "number"},
        "total": {"type": "number"},
        "category": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "quantity": {"type": "number"},
                    "unit": {"type": "string"},
                    "unit_price": {"type": "number"},
                    "line_total": {"type": "number"},
                },
                "required": ["name"],
            },
        },
    },
    # Gemini structured output honours `propertyOrdering` — decoding the
    # line items BEFORE the grand total measurably improves the arithmetic
    # and stops the model short-circuiting to a vendor-only object.
    "propertyOrdering": [
        "is_receipt", "image_description", "vendor", "date", "items",
        "subtotal", "tax", "total", "currency", "category",
    ],
    # Expanding `required` beyond `is_receipt` is the real fix: with only
    # is_receipt required, schema-guided decoding treated {is_receipt,
    # vendor} as a *complete* answer, so 2.5-flash legally dropped the
    # amount and every line item (the "receipt scanned but recorded as 0"
    # bug). Forcing the money fields makes the model emit them on every
    # receipt. On a non-receipt image the model fills 0 / "" here, which
    # the is_receipt=false branch in scan_receipt ignores.
    "required": [
        "is_receipt", "vendor", "items",
        "subtotal", "tax", "total", "currency", "category",
    ],
}


def _classify_http_error(status_code: int, body: str) -> str:
    """Map an upstream HTTP failure to a short, user-actionable tag."""
    if status_code == 429:
        return "rate_limited"
    if status_code in (401, 403):
        return "auth_failed"
    if 500 <= status_code < 600:
        return "upstream_5xx"
    return f"http_{status_code}"


def _call_gemini_vision(
    image_bytes: bytes, mime: str, deadline: float
) -> tuple[dict | None, list[str]]:
    """Try Google AI Studio Gemini vision models directly.

    Free tier has its own per-key quota (not the shared global pool that
    makes OpenRouter free models unreliable), so this is the preferred path.

    `deadline` is a `time.monotonic()` timestamp: no upstream call is started
    (and no 429 retry sleep is taken) once the budget is spent, so the whole
    cascade returns before the client's abort fires.

    Returns (parsed_or_None, errors). `errors` is a list of "model: tag"
    strings the caller uses to build a useful diagnostic for the user.
    """
    errors: list[str] = []
    if not settings.gemini_api_key:
        errors.append("gemini: no_api_key")
        return None, errors

    b64 = base64.b64encode(image_bytes).decode("ascii")
    body = {
        "contents": [{
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": mime, "data": b64}},
            ],
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            # Structured-output: forces the model into schema-guided
            # decoding so it cannot emit a half-finished string. Pairs
            # with the maxOutputTokens raise below — together they
            # eliminate the mid-string truncation that was being
            # mis-reported as a rate-limit cascade.
            "responseSchema": RECEIPT_RESPONSE_SCHEMA,
            "temperature": 0.1,
            # Schema-guided JSON burns tokens on keys + structure as well
            # as values, so 8192 was marginal — long supermarket receipts
            # hit MAX_TOKENS and the cascade fell through to the generic
            # catch-all. 32768 covers ~300 items while staying well under
            # Gemini 2.5 Flash's 65,536-output ceiling.
            "maxOutputTokens": 32768,
        },
    }

    # API key goes in the `x-goog-api-key` header — never in the URL —
    # so it cannot leak into server logs, proxy logs, or APM traces.
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.gemini_api_key,
    }

    for model_id in GEMINI_VISION_MODELS:
        remaining = deadline - time.monotonic()
        if remaining < _MIN_START_BUDGET_SEC:
            log.info("Gemini budget exhausted before %s — skipping", model_id)
            errors.append(f"gemini/{model_id}: budget_exhausted")
            break
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_id}:generateContent"
        )
        # One short retry on 429 — per-minute free-tier windows clear fast,
        # but only if the budget can absorb the 12s wait AND a real attempt.
        resp = None
        for attempt in range(2):
            call_timeout = min(_GEMINI_HTTP_TIMEOUT, deadline - time.monotonic())
            if call_timeout < _MIN_START_BUDGET_SEC:
                errors.append(f"gemini/{model_id}: budget_exhausted")
                break
            try:
                resp = httpx.post(url, json=body, headers=headers, timeout=call_timeout)
            except Exception as exc:
                log.warning("Gemini %s transport error: %s", model_id, exc)
                errors.append(f"gemini/{model_id}: transport_error")
                resp = None
                break
            if resp.status_code != 429 or attempt == 1:
                break
            if deadline - time.monotonic() < _RETRY_DELAY_SEC + _MIN_START_BUDGET_SEC:
                log.info("Gemini %s 429 — no budget for a retry, moving on", model_id)
                break
            log.info("Gemini %s 429 — retrying in %.1fs", model_id, _RETRY_DELAY_SEC)
            time.sleep(_RETRY_DELAY_SEC)
        if resp is None:
            continue

        if resp.status_code >= 400:
            tag = _classify_http_error(resp.status_code, resp.text)
            log.warning("Gemini %s -> %s: %s",
                        model_id, resp.status_code, resp.text[:200])
            errors.append(f"gemini/{model_id}: {tag}")
            continue

        try:
            data = resp.json()
        except Exception:
            errors.append(f"gemini/{model_id}: bad_json_envelope")
            continue

        candidates = data.get("candidates") or []
        if not candidates:
            log.warning("Gemini %s returned no candidates: %s",
                        model_id, str(data)[:200])
            errors.append(f"gemini/{model_id}: no_candidates")
            continue

        # With responseSchema enforced, a MAX_TOKENS finish is the real
        # signal — schema-guided decoding can't legally emit a partial
        # object, so cutoff means we need more output budget rather
        # than a JSON repair pass. Surface it distinctly so the cascade
        # diagnostic is honest.
        finish_reason = candidates[0].get("finishReason")
        if finish_reason == "MAX_TOKENS":
            log.warning("Gemini %s hit MAX_TOKENS — bump maxOutputTokens",
                        model_id)
            errors.append(f"gemini/{model_id}: max_tokens")
            continue

        parts = (candidates[0].get("content") or {}).get("parts") or []
        raw = "".join(p.get("text", "") for p in parts).strip()
        if not raw:
            errors.append(f"gemini/{model_id}: empty_response")
            continue

        try:
            parsed = json.loads(_strip_json(raw))
        except json.JSONDecodeError:
            snippet = _extract_json_object(raw)
            if not snippet:
                log.warning("Bad JSON from Gemini %s: %s", model_id, raw[:200])
                errors.append(f"gemini/{model_id}: bad_json_body")
                continue
            try:
                parsed = json.loads(snippet)
            except json.JSONDecodeError:
                log.warning("Bad JSON (after scrape) from Gemini %s: %s",
                            model_id, raw[:200])
                errors.append(f"gemini/{model_id}: bad_json_body")
                continue

        log.info("Vision parse from Gemini %s", model_id)
        parsed["_model"] = f"google/{model_id}"
        return parsed, errors

    return None, errors


def _call_openrouter(
    image_bytes: bytes, mime: str, deadline: float
) -> tuple[dict | None, list[str]]:
    """Try vision models on OpenRouter in order; return (parsed, errors).

    `deadline` is a `time.monotonic()` timestamp — each model call is clamped
    to the remaining budget and the loop stops once it's spent.
    """
    errors: list[str] = []
    if not settings.openrouter_api_key:
        errors.append("openrouter: no_api_key")
        return None, errors

    b64 = base64.b64encode(image_bytes).decode("ascii")
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url",
             "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ],
    }]

    candidates = _vision_model_chain()

    for model_id in candidates:
        call_timeout = min(_OPENROUTER_HTTP_TIMEOUT, deadline - time.monotonic())
        if call_timeout < _MIN_START_BUDGET_SEC:
            log.info("OpenRouter budget exhausted before %s — skipping", model_id)
            errors.append(f"openrouter/{model_id}: budget_exhausted")
            break
        try:
            resp = httpx.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_id,
                    "messages": messages,
                    "max_tokens": 1200,
                    "temperature": 0.1,
                },
                timeout=call_timeout,
            )
        except Exception as exc:
            log.warning("Vision model %s transport error: %s", model_id, exc)
            errors.append(f"openrouter/{model_id}: transport_error")
            continue

        if resp.status_code >= 400:
            tag = _classify_http_error(resp.status_code, resp.text)
            log.warning("Vision model %s -> %s: %s",
                        model_id, resp.status_code, resp.text[:200])
            errors.append(f"openrouter/{model_id}: {tag}")
            continue

        try:
            data = resp.json()
        except Exception:
            errors.append(f"openrouter/{model_id}: bad_json_envelope")
            continue
        raw = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            or ""
        ).strip()
        if not raw:
            errors.append(f"openrouter/{model_id}: empty_response")
            continue

        try:
            parsed = json.loads(_strip_json(raw))
        except json.JSONDecodeError:
            snippet = _extract_json_object(raw)
            if not snippet:
                log.warning("Bad JSON from %s: %s", model_id, raw[:200])
                errors.append(f"openrouter/{model_id}: bad_json_body")
                continue
            try:
                parsed = json.loads(snippet)
            except json.JSONDecodeError:
                log.warning("Bad JSON (after scrape) from %s: %s",
                            model_id, raw[:200])
                errors.append(f"openrouter/{model_id}: bad_json_body")
                continue

        log.info("Vision parse from %s", model_id)
        parsed["_model"] = model_id
        return parsed, errors

    return None, errors


TEXT_PROMPT = (
    "You are a Tanzanian financial assistant for the Pesalens app. The user "
    "captured a receipt and ran it through OCR. The text below may be messy, "
    "may mix Swahili and English, and may include EFD/TRA fields. Decide if it "
    "looks like a receipt at all. Return STRICT JSON only — no commentary, no "
    "markdown fences.\n\n"
    "If it does NOT look like a receipt, return:\n"
    "{\n"
    '  "is_receipt": false,\n'
    '  "image_description": "short plain description of what the text contains"\n'
    "}\n\n"
    "If it DOES look like a receipt, return:\n"
    "{\n"
    '  "is_receipt": true,\n'
    '  "vendor": "store name or null",\n'
    '  "date": "YYYY-MM-DD or null",\n'
    '  "items": [{"name": "item", "quantity": 1, "unit": "kg/litres/pcs/null", "price": 0}],\n'
    '  "subtotal": 0,\n'
    '  "tax": 0,\n'
    '  "total": 0,\n'
    '  "currency": "TZS",\n'
    '  "category": "fuel|groceries|restaurant|utilities|stock|transport|tax|other",\n'
    '  "tra_z_number": "Z-number if found, else null"\n'
    "}\n"
    "Use 0 instead of null for numbers when unknown. The total should be the "
    "grand total in TZS as a plain number (no commas, no currency)."
)


def _call_openrouter_text(text: str) -> dict | None:
    """Send raw OCR text to the text-only model (MiniMax by default)."""
    if not settings.openrouter_api_key:
        return None
    model_id = _text_model()
    if not model_id:
        return None

    messages = [
        {"role": "system", "content": TEXT_PROMPT},
        {"role": "user", "content": f"OCR text:\n\"\"\"\n{text}\n\"\"\""},
    ]

    try:
        resp = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": messages,
                "max_tokens": 1200,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            },
            timeout=60.0,
        )
    except Exception as exc:
        log.warning("Text model %s transport error: %s", model_id, exc)
        return None

    if resp.status_code >= 400:
        log.warning("Text model %s -> %s: %s",
                    model_id, resp.status_code, resp.text[:200])
        return None

    try:
        data = resp.json()
    except Exception:
        return None

    raw = (
        data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
    ).strip()
    if not raw:
        return None

    try:
        parsed = json.loads(_strip_json(raw))
    except json.JSONDecodeError:
        snippet = _extract_json_object(raw)
        if not snippet:
            log.warning("Bad JSON from text model %s: %s", model_id, raw[:200])
            return None
        try:
            parsed = json.loads(snippet)
        except json.JSONDecodeError:
            log.warning("Bad JSON (after scrape) from text model %s: %s",
                        model_id, raw[:200])
            return None

    parsed["_model"] = model_id
    return parsed


def _resolve_statement_job(raw: str | None) -> str | None:
    """The statement a new receipt belongs to — the caller's word, or nothing.

    There is a real contradiction here worth naming: `list_receipts` DISPLAYS a
    receipt with no `statement_job_id` under the user's newest statement, while
    `delete_statement`'s cascade matches an explicit id only. So the gallery
    files a receipt under a statement that deleting that statement won't remove.

    It is tempting to close that gap by stamping the newest statement onto every
    unscoped scan. Don't: it resolves the contradiction in the destructive
    direction. A receipt scanned outside any statement context would become a
    child of whatever was uploaded last, and deleting that statement would take
    the user's image files with it. It also permanently pins
    `_start_over_state` to reason='attached', disabling the one escape hatch
    that can clear unattached data.

    NULL therefore keeps its meaning — "general, belongs to no statement" — and
    the client sends an explicit id when the user is actually working inside a
    statement. Displaying an unowned receipt in a convenient place costs nothing
    when it is wrong; deleting one does.
    """
    return (raw or "").strip()[:40] or None


def _bank_for_job(user_id: int, statement_job_id: str | None) -> str | None:
    """Best-effort provider label for the statement a receipt is scoped to.

    Reads the saved result index and returns the `metadata.bank` of the
    matching job_id so the receipt carries its service (e.g. "nmb") for the
    per-statement money map. Any failure resolves to None — the receipt is
    still saved, just without a bank tag.
    """
    if not statement_job_id:
        return None
    try:
        from app.services.analytics import load_result
        result = load_result(user_id, statement_job_id)
        if result:
            return (result.get("metadata") or {}).get("bank")
    except Exception:
        return None
    return None


def _write_receipt_json(path: Path, data: dict) -> None:
    """Write a receipt JSON so a concurrent writer can never leave it torn.

    Two requests CAN target the same file: `_heal_fx` runs off a GET, so a web
    tab and the phone app refreshing the gallery together — or one double-fired
    pull-to-refresh — both see the same receipt as due and both rewrite it. A
    plain `write_text` truncates first, so an interleaved or half-finished write
    leaves invalid JSON, and `_load_receipts` then silently skips it: the
    receipt vanishes from the gallery and every aggregate, permanently.

    Serialize into a per-writer temp file, then `os.replace` it into place —
    atomic on POSIX and on Windows, both of which this project runs on. The
    temp name carries pid + a random suffix so two writers do not collide on
    the temp file either, and ends in `.tmp` so `_load_receipts`' `*.json` glob
    cannot pick up a partial one.
    """
    payload = json.dumps(data, indent=2, default=str)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        # Never leave a temp behind on failure — this directory is globbed.
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _save_receipt(
    parsed: dict,
    image_bytes: bytes,
    filename: str,
    user_id: int,
    statement_job_id: str | None = None,
    scan_id: str | None = None,
) -> str:
    # Idempotency: a retry of a scan that already saved (client aborted after
    # the server finished) must return the existing receipt, not save twice.
    if scan_id:
        existing = _receipt_for_scan(user_id, scan_id)
        if existing and existing.get("id"):
            log.info("Scan %s already saved receipt %s — skipping duplicate save",
                     scan_id, existing["id"])
            return existing["id"]

    receipt_id = uuid.uuid4().hex[:12]
    target_dir = _receipts_dir(user_id)
    suffix = Path(filename).suffix or ".bin"
    image_path = target_dir / f"{receipt_id}{suffix}"
    if image_bytes:
        image_path.write_bytes(image_bytes)
    parsed = {
        **parsed,
        "id": receipt_id,
        "scanned_at": utcnow().isoformat() + "Z",
        "image_filename": image_path.name if image_bytes else None,
        "source_filename": filename,
    }
    if scan_id:
        parsed["client_scan_id"] = scan_id
    # Per-statement scoping (Epic-2): stamp the association only when present so
    # existing receipt JSONs are byte-for-byte unaffected. `bank` mirrors the
    # statement's provider for the money map.
    if statement_job_id:
        parsed["statement_job_id"] = statement_job_id
        bank = _bank_for_job(user_id, statement_job_id)
        if bank:
            parsed["bank"] = bank
    # Stamp TRA tax code + EFD compliance fields at save time so they are
    # cheap to read later (no recompute on every dashboard render).
    annotate_tax(parsed)
    _write_receipt_json(target_dir / f"{receipt_id}.json", parsed)
    if scan_id:
        try:
            _scan_marker_path(user_id, scan_id).write_text(
                receipt_id, encoding="utf-8"
            )
        except OSError as exc:
            # Marker is an optimization — the receipt itself is saved.
            log.warning("Could not write scan marker %s: %s", scan_id, exc)
    return receipt_id


def _build_failure_message(errors: list[str]) -> str:
    """Turn the per-model error tags into one actionable sentence.

    Most users hit either rate limits (free-tier shared pool) or auth
    failures (wrong / expired key). Bubbling that up beats the previous
    generic "try again in a minute" which left them with no next step.
    """
    if not errors:
        return (
            "Could not read the image right now. The vision service is "
            "temporarily unavailable — please try again in a minute."
        )

    tags = [e.split(":", 1)[1].strip() if ":" in e else e for e in errors]
    has_gemini = any(e.startswith("gemini") for e in errors)
    has_openrouter = any(e.startswith("openrouter") for e in errors)

    if all(t == "no_api_key" for t in tags):
        return (
            "Receipt scanning is offline. Set GEMINI_API_KEY (preferred, "
            "free tier on Google AI Studio) or OPENROUTER_API_KEY in the "
            "backend .env to enable real OCR."
        )

    # Most actionable failure: the primary vision model overflowed its
    # output window on a long receipt. The fallbacks are usually all
    # rate-limited at the same time, which is why this case otherwise
    # falls through to the generic catch-all.
    if any(t == "max_tokens" for t in tags):
        return (
            "This receipt has more line items than the vision model could "
            "extract in one pass. Crop the photo to the totals + the lines "
            "you care about, or scan it in two halves and add them as "
            "separate entries."
        )

    if all(t == "rate_limited" for t in tags):
        which = "Gemini and OpenRouter" if has_gemini and has_openrouter else (
            "Gemini" if has_gemini else "OpenRouter"
        )
        return (
            f"All vision models on {which} are rate-limited right now. "
            "Free-tier quotas reset on the minute — please try again shortly."
        )

    if all(t == "auth_failed" for t in tags):
        return (
            "The configured vision API keys were rejected. Check that "
            "GEMINI_API_KEY and OPENROUTER_API_KEY in the backend .env are "
            "current and have vision access enabled."
        )

    if all(t.startswith("bad_json") or t == "empty_response" for t in tags):
        return (
            "The vision model returned an unreadable response. Try a clearer, "
            "well-lit photo of the receipt and re-scan."
        )

    if any(t == "transport_error" for t in tags):
        return (
            "Could not reach the vision service. Check the backend's internet "
            "connection and try again in a moment."
        )

    if all(t in ("budget_exhausted", "rate_limited", "upstream_5xx") for t in tags):
        return (
            "The vision service is busy right now and took too long to "
            "respond. Free-tier capacity usually frees up within a minute — "
            "please try again shortly."
        )

    return (
        "Could not read the image right now. The vision service returned "
        "errors on every fallback — please try again shortly."
    )


def _needs_fx(r: dict) -> bool:
    """Does this receipt still need a currency conversion stamped?

    True for a receipt saved during an FX outage (`fx_pending`), and for a
    LEGACY receipt saved before _apply_fx existed — foreign currency read off
    the page, but no `amount_tzs` ever written. The second case has no flag of
    its own, so it must be recognised by its shape: not TZS, no TZS amount.

    A receipt with nothing to convert (an unreadable total, so 0) must answer
    False even though it is foreign and has no TZS amount. `_apply_fx` short-
    circuits on a non-positive total and leaves `amount_tzs` at 0, so claiming
    it still needs work makes the pair loop forever: every GET /receipts would
    re-enter the threadpool and rewrite that receipt's JSON to disk, for good.
    """
    if r.get("fx_pending"):
        return True
    if normalize_currency(r.get("currency")) == "TZS":
        return False
    try:
        if float(r.get("amount_tzs") or 0) > 0:
            return False
    except (TypeError, ValueError):
        return True
    # No TZS amount recorded — worth converting only if something was read.
    return receipt_printed_amount(r) > 0


def _apply_fx(parsed: dict) -> None:
    """Stamp currency + TZS-equivalent fields on a parsed receipt.

    TZS receipts (the default) get `amount_tzs = total` and nothing else.
    Foreign-currency receipts keep the printed amount as `original_amount`
    and record the conversion (`fx_rate`, `fx_as_of`, `amount_tzs`) at the
    current market rate — a 140 USD receipt counts as ~TZS 373,000 in every
    aggregate instead of a bogus TZS 140. When no rate is reachable the
    receipt is saved with `fx_pending: true` and back-filled on the next
    list_receipts (see the lazy backfill there).

    Idempotent: this now also runs on receipts it did not create (the legacy
    heal path), so it must never convert an already-converted amount. It reads
    `receipt_printed_amount` — the figure ON the page — and never
    `_receipt_amount`, which returns the TZS VALUE and would hand this
    function an already-converted number to multiply by the rate a second
    time (140 USD -> 364,000 -> 946,400,000).
    """
    cur = normalize_currency(parsed.get("currency"))
    parsed["currency"] = cur
    total = receipt_printed_amount(parsed)
    if cur == "TZS" or total <= 0:
        parsed["amount_tzs"] = total
        parsed.pop("fx_pending", None)
        return
    parsed["original_amount"] = total
    rate, as_of = get_rate_to_tzs(cur)
    if rate:
        parsed["fx_rate"] = rate
        parsed["fx_as_of"] = as_of
        parsed["amount_tzs"] = round(total * rate, 2)
        parsed.pop("fx_pending", None)
    else:
        parsed["fx_pending"] = True


def _run_scan_pipeline(
    image_bytes: bytes,
    filename: str,
    user_id: int,
    statement_job_id: str | None = None,
    scan_id: str | None = None,
) -> dict:
    """Blocking receipt-scan work: quota, mime sniff, vision cascade, save.

    Runs in a worker thread (via run_in_threadpool) so the synchronous httpx
    calls and time.sleep never freeze the event loop — that freeze was what
    stalled the health probe (Render 503s) and other requests while a scan
    was in flight. Returns the `data` dict for the APIResponse; raises
    HTTPException for the fast 4xx client-input cases.
    """
    # A retried upload whose first attempt already saved (client gave up but
    # the server finished) short-circuits here — instant answer, zero LLM cost.
    if scan_id:
        existing = _receipt_for_scan(user_id, scan_id)
        if existing and existing.get("id"):
            log.info("Scan %s: returning already-saved receipt %s",
                     scan_id, existing["id"])
            return {**existing, "duplicate": True}

    # Cheap garbage-collect of expired images, then enforce per-user quota.
    _cleanup_old_receipt_images(user_id)
    _enforce_receipt_quota(user_id, len(image_bytes))

    # Magic-byte check — trust the bytes, not the Content-Type header.
    mime = _detect_image_mime(image_bytes)
    if not mime:
        return {
            "is_receipt": False,
            "message": "That file is not a supported image (JPEG/PNG/WebP/HEIC). Please pick a photo of a receipt.",
        }

    # Strip EXIF (GPS coords, device fingerprint, timestamps) before the
    # image touches disk or the vision LLM. Best-effort: a malformed image
    # falls through unchanged so the existing 400 path still surfaces it.
    image_bytes = _strip_image_metadata(image_bytes, mime)

    if not (settings.gemini_api_key or settings.openrouter_api_key):
        return {
            "is_receipt": False,
            "message": (
                "Receipt scanning is offline. Set GEMINI_API_KEY (preferred, "
                "free tier on Google AI Studio) or OPENROUTER_API_KEY in the "
                "backend .env to enable real OCR."
            ),
        }

    # One shared wall-clock budget across BOTH providers so the whole
    # cascade returns before the client's abort — the backend always wins
    # the race and hands back a decisive answer instead of finishing after
    # the browser already gave up.
    deadline = time.monotonic() + SCAN_BUDGET_SEC

    # Gemini direct first (per-key free quota), OpenRouter free vision models
    # only as a fallback (shared global pool, frequently throttled).
    parsed, gem_errors = _call_gemini_vision(image_bytes, mime, deadline)
    or_errors: list[str] = []
    if not parsed:
        # Cool-down before bouncing to OpenRouter — but only if there's
        # budget left, and never longer than what remains.
        remaining = deadline - time.monotonic()
        if remaining > _MIN_START_BUDGET_SEC:
            time.sleep(min(_RETRY_DELAY_SEC / 4, max(0.0, remaining - _MIN_START_BUDGET_SEC)))
            parsed, or_errors = _call_openrouter(image_bytes, mime, deadline)
        else:
            or_errors.append("openrouter: budget_exhausted")

    if not parsed:
        all_errors = gem_errors + or_errors
        # Log the per-model diagnostic server-side only — never bubble
        # vendor / model identifiers up to the browser.
        log.warning("Receipt scan failed for user %s: %s", user_id, all_errors)
        # ...and persist it. This path returns HTTP 200 with a friendly
        # message, so nothing here ever raised and the owner console used to
        # show no trace of it at all: every vision-model outage looked like
        # silence. The per-model diagnostic is exactly what tells quota
        # exhaustion apart from a throttle apart from a genuinely unreadable
        # photo, so it is the message worth keeping — operator-only, still
        # never returned to the client.
        record_error(
            "receipt_scan_failed",
            "; ".join(all_errors) or "no vision provider returned a result",
            user_id=user_id, path="/receipts/scan", method="POST",
            stage="vision", source="handled",
        )
        record_activity(None, "receipt_scan_failed", user_id=user_id,
                        details={"providers": all_errors[:6]})
        return {
            "is_receipt": False,
            "message": _build_failure_message(all_errors),
        }

    if parsed.get("is_receipt") is False:
        desc = (parsed.get("image_description") or "").strip() or "something else"
        return {
            "is_receipt": False,
            "image_description": desc,
            "message": (
                f"This looks like {desc}, not a receipt. "
                "Please add a photo of a receipt to record the spending."
            ),
        }

    parsed.setdefault("category", "other")
    parsed.setdefault("currency", "TZS")
    parsed["is_receipt"] = True

    # The schema only marks `is_receipt` as required, so the model is free
    # to omit `total`. On bank-payment slips it usually does — and dumps
    # the whole OCR text into `vendor`. Backfill: items-sum first, then a
    # currency-anchored regex over the textual fields. The mobile UI reads
    # `data.total`, so populating this field is what makes the spend show
    # up as more than TZS 0.
    try:
        current_total = float(parsed.get("total") or 0)
    except (TypeError, ValueError):
        current_total = 0.0
    if current_total <= 0:
        inferred = _receipt_amount(parsed)
        if inferred <= 0:
            inferred = _extract_amount_from_text(
                str(parsed.get("vendor") or ""),
                str(parsed.get("image_description") or ""),
            )
        if inferred > 0:
            parsed["total"] = inferred

    # Currency normalization + TZS equivalent (after the total backfill so
    # the conversion sees the final amount).
    _apply_fx(parsed)

    receipt_id = _save_receipt(
        parsed, image_bytes, filename, user_id=user_id,
        statement_job_id=statement_job_id, scan_id=scan_id,
    )
    record_activity(None, "receipt_scanned", user_id=user_id, details={
        "receipt_id": receipt_id,
        "vendor": parsed.get("vendor"),
        "total": parsed.get("total"),
        "currency": parsed.get("currency"),
        "statement_job_id": statement_job_id,
    })
    return {**parsed, "id": receipt_id}


@router.post("/receipts/scan", response_model=APIResponse)
@limiter.limit(settings.rate_limit_receipts)
async def scan_receipt(
    request: Request,
    file: UploadFile = File(...),
    statement_job_id: str | None = Form(default=None),
    scan_id: str | None = Form(default=None),
    # No `db` dependency on purpose: nothing here touches the ORM (the work is
    # file- and JSON-backed), and require_active_plan already resolves its own
    # session. Declaring one would hold a connection open for the whole
    # multi-second vision call — the slowest request in the app.
    user: User = Depends(require_active_plan),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename missing")

    statement_job_id = _resolve_statement_job(statement_job_id)
    scan_id = _clean_scan_id(scan_id)

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image exceeds 10MB limit")

    # Everything below blocks (sync httpx + time.sleep + disk I/O). Run it in
    # a worker thread so the event loop stays free to serve health probes and
    # other requests while the vision models grind — freezing the loop here is
    # what produced the Render 503s and "backend didn't respond" symptom.
    data = await run_in_threadpool(
        _run_scan_pipeline, image_bytes, file.filename, user.id,
        statement_job_id, scan_id,
    )
    return APIResponse(success=True, message="ok", data=data)


@router.get("/receipts/by-scan/{scan_id}", response_model=APIResponse)
async def receipt_by_scan(
    scan_id: str,
    user: User = Depends(get_current_user),
):
    """Look up the receipt a scan attempt saved, by its client scan_id.

    Used by the client to reconcile a timed-out/aborted scan: the server may
    have finished and saved after the browser gave up. O(1) marker-file read.
    Returns {found: false} (HTTP 200) when absent so the client can poll
    quietly without error noise.
    """
    cleaned = _clean_scan_id(scan_id)
    if not cleaned:
        return APIResponse(success=True, message="ok", data={"found": False})
    receipt = _receipt_for_scan(user.id, cleaned)
    if not receipt:
        return APIResponse(success=True, message="ok", data={"found": False})
    receipt.setdefault("amount", _receipt_amount(receipt))
    return APIResponse(success=True, message="ok",
                       data={"found": True, "receipt": receipt})


@router.post("/receipts/parse-text", response_model=APIResponse)
@limiter.limit(settings.rate_limit_receipts)
async def parse_receipt_text(
    request: Request,
    payload: dict = Body(...),
    # No `db` dependency — see scan_receipt.
    user: User = Depends(require_active_plan),
):
    """Parse already-OCR'd text into the standard receipt JSON via the text model.

    Body: { "text": "...", "save": true|false, "statement_job_id": "..." }
    Returns the same shape as /receipts/scan. If save=true, persists the
    extracted receipt (no source image) — scoped to the same statement the
    image path would use, so a locally-OCR'd capture is not orphaned.
    """
    text = (payload.get("text") or "").strip()
    save = bool(payload.get("save", False))
    scan_id = _clean_scan_id(payload.get("scan_id"))
    statement_job_id = _resolve_statement_job(payload.get("statement_job_id"))

    if not text:
        raise HTTPException(status_code=400, detail="text missing")

    # Same idempotency short-circuit as the image path: if another pipeline
    # (e.g. the vision scan of the same camera frame) already saved under
    # this scan_id, return that receipt instead of saving a duplicate.
    if save and scan_id:
        existing = _receipt_for_scan(user.id, scan_id)
        if existing and existing.get("id"):
            return APIResponse(success=True, message="ok",
                               data={**existing, "duplicate": True})

    # Body text is concatenated into the LLM prompt below — neutralise the
    # standard "ignore prior instructions" / "show me your prompt" patterns
    # before send. Mirrors the assistant chat hardening at assistant.py:297.
    text = sanitize_user_text(text)

    if not settings.openrouter_api_key:
        return APIResponse(
            success=True, message="ok",
            data={
                "is_receipt": False,
                "message": (
                    "Text parsing is offline. Set OPENROUTER_API_KEY in the "
                    "backend .env to enable receipt parsing."
                ),
            },
        )

    parsed = _call_openrouter_text(text)
    if not parsed:
        return APIResponse(
            success=True, message="ok",
            data={
                "is_receipt": False,
                "message": (
                    "The text model could not parse this snippet right now. "
                    "Try again in a moment, or capture a clearer frame."
                ),
            },
        )

    if parsed.get("is_receipt") is False:
        desc = (parsed.get("image_description") or "").strip() or "something else"
        return APIResponse(
            success=True, message="ok",
            data={
                "is_receipt": False,
                "image_description": desc,
                "message": (
                    f"This looks like {desc}, not a receipt. "
                    "Capture a real receipt to record the spending."
                ),
            },
        )

    parsed.setdefault("category", "other")
    parsed.setdefault("currency", "TZS")
    parsed["is_receipt"] = True

    # Same total-backfill as the image scan path. The text-parse flow runs
    # on already-OCR'd strings, so the regex scrape has even better signal
    # than on vision-model output.
    try:
        current_total = float(parsed.get("total") or 0)
    except (TypeError, ValueError):
        current_total = 0.0
    if current_total <= 0:
        inferred = _receipt_amount(parsed)
        if inferred <= 0:
            inferred = _extract_amount_from_text(
                str(parsed.get("vendor") or ""),
                str(parsed.get("image_description") or ""),
                text,
            )
        if inferred > 0:
            parsed["total"] = inferred

    # Same currency handling as the image path — also for unsaved parses so
    # the preview already shows the TZS equivalent.
    #
    # In a threadpool: `_apply_fx` can reach `get_rate_to_tzs`, which on a cold
    # or stale cache takes a global lock and blocks on a 10s synchronous
    # httpx.get. Called straight from this async handler that stalls the whole
    # event loop — every other request, health probes included, waits behind
    # one user's USD receipt. That is the Render-503 failure mode the image
    # path already avoids the same way.
    await run_in_threadpool(_apply_fx, parsed)

    if save:
        receipt_id = _save_receipt(
            parsed, b"", f"text-{uuid.uuid4().hex[:8]}.txt", user_id=user.id,
            statement_job_id=statement_job_id, scan_id=scan_id,
        )
        return APIResponse(
            success=True, message="ok",
            data={**parsed, "id": receipt_id},
        )

    return APIResponse(success=True, message="ok", data=parsed)


def _load_receipts(user_id: int) -> list[dict]:
    target_dir = _receipts_dir(user_id)
    receipts: list[dict] = []
    for path in target_dir.glob("*.json"):
        try:
            receipts.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:
            log.warning("Bad receipt json %s: %s", path, exc)
    receipts.sort(key=lambda r: r.get("scanned_at") or "", reverse=True)
    return receipts


# Tanzanian receipts use a handful of total-line formats:
#   "AMOUNT TZS 101,250.00"   (bank slips)
#   "Umelipa TZS 5,000"        (M-Pesa / Tigo Pesa confirmations)
#   "Total: Tsh 12,500/="      (till receipts)
#   "JUMLA 7,500"              (Swahili-labelled till receipts)
# Anchor on a currency / total word so we don't grab reference IDs or
# phone numbers that happen to be 5+ digits. Capture group 1 is the
# numeric portion (still comma-formatted; strip before float-cast).
_AMOUNT_RE = re.compile(
    r"(?:TZS|TSh|Tsh|Jumla|JUMLA|Total|TOTAL|Amount|AMOUNT|Paid|PAID|Umelipa|UMELIPA)"
    r"[\s:\-]+"
    r"(?:TZS|TSh|Tsh|Sh)?"
    r"\s*"
    r"([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?"   # comma-grouped
    r"|[0-9]+\.[0-9]{2}"                              # plain decimal
    r"|[0-9]{4,})",                                   # 4+ digit integer
    re.IGNORECASE,
)


def _extract_amount_from_text(*chunks: str) -> float:
    """Scrape a TZS amount out of free-form OCR text.

    Last-resort fallback for when the vision model flagged the image as a
    receipt but left `total` at 0 — common on bank payment slips and
    mobile-money confirmations where the layout isn't a classic till
    receipt and the model stuffs the whole text into `vendor`.
    """
    best = 0.0
    for chunk in chunks:
        if not chunk:
            continue
        for m in _AMOUNT_RE.finditer(chunk):
            try:
                v = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            # Cap at 100M TZS to filter out reference IDs that snuck past
            # the anchor word (e.g. "Total reference 9984112047436").
            if 100 <= v <= 100_000_000 and v > best:
                best = v
    return best


def _receipt_amount(r: dict) -> float:
    """Best-effort TZS amount for a receipt.

    A stamped `amount_tzs` (written at save time by _apply_fx — the TZS
    equivalent for foreign-currency receipts, the plain total for TZS ones)
    wins outright. Legacy receipts without it fall back to the original
    chain (total → amount → subtotal → summed items), which is implicitly
    TZS.

    A foreign receipt with no stamped amount is converted at a CACHED rate, and
    excluded from the total when no rate is cached — never counted as TZS. See
    `fx.receipt_amount_tzs`, which is the single definition every aggregate
    shares so they cannot drift apart.
    """
    return receipt_amount_tzs(r)


# How long to wait before re-attempting FX conversion for a receipt whose last
# attempt did not resolve. Without this, a receipt whose rate is permanently
# unreachable (`fx_pending` never clears) makes EVERY GET /receipts re-run a
# blocking ~10s httpx fetch under a global lock with no progress — unbounded
# cost on each gallery load. The cooldown bounds that to one attempt per window.
_FX_HEAL_COOLDOWN_SECONDS = 6 * 3600


def _fx_retry_due(r: dict, now: float | None = None) -> bool:
    """Should we (re)attempt FX conversion for this receipt right now?

    True only when the receipt still needs conversion (`_needs_fx`) AND we have
    not tried within `_FX_HEAL_COOLDOWN_SECONDS`. The last failed attempt is
    remembered on the receipt as an epoch-seconds `fx_last_attempt`, so a rate
    that stays unreachable is retried at most once per window instead of on
    every request.
    """
    if not _needs_fx(r):
        return False
    last = r.get("fx_last_attempt")
    if last is None:
        return True
    try:
        last_ts = float(last)
    except (TypeError, ValueError):
        return True
    return ((now if now is not None else time.time()) - last_ts) >= _FX_HEAL_COOLDOWN_SECONDS


def _heal_fx(user_id: int, receipts: list[dict]) -> None:
    """Convert + persist any receipt due for an FX (re)attempt.

    Blocking (sync httpx inside get_rate_to_tzs) — callers must run this in a
    threadpool, never on the event loop. Mutates `receipts` in place. Honours
    the per-receipt cooldown so an unreachable rate is not re-fetched on every
    request; when an attempt fails to resolve, the attempt time is stamped and
    persisted so subsequent requests skip it until the window elapses.
    """
    for r in receipts:
        if not _fx_retry_due(r):
            continue
        _apply_fx(r)
        if not r.get("id"):
            continue
        if r.get("fx_pending"):
            # Still unresolved: record when we tried so the cooldown holds off
            # the next blocking fetch. (Persisted below like the success case.)
            r["fx_last_attempt"] = time.time()
        else:
            # Resolved — the attempt marker is now irrelevant; drop it.
            r.pop("fx_last_attempt", None)
        try:
            _write_receipt_json(_receipts_dir(user_id) / f"{r['id']}.json", r)
        except OSError as exc:
            log.warning("FX backfill persist failed for %s: %s", r.get("id"), exc)


def _receipt_effective_date(r: dict) -> str | None:
    """A receipt's date for windowing: OCR `date`, else `scanned_at` — YYYY-MM-DD."""
    for key in ("date", "scanned_at"):
        v = r.get(key)
        if v:
            s = str(v)[:10]
            if len(s) == 10 and s[4] == "-" and s[7] == "-":
                return s
    return None


@router.get("/receipts", response_model=APIResponse)
async def list_receipts(
    scope: str | None = Query(default=None),
    job_id: str | None = Query(default=None),
    day: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List this user's receipts, optionally scoped.

    No scope params → the full gallery (unchanged default behaviour).
    `scope=statement&job_id=X` → only receipts belonging to statement X (a
    receipt with no `statement_job_id` resolves to the newest statement).
    `scope=general` with `day` or `start`/`end` → receipts whose effective date
    falls in that window.
    """
    receipts = _load_receipts(user.id)

    if scope == "statement" and job_id:
        from app.services.analytics import effective_stmt, newest_job_id
        newest = newest_job_id(user.id, db=db)
        receipts = [
            r for r in receipts
            if effective_stmt(r.get("statement_job_id"), newest) == job_id
        ]
    elif scope == "general":
        lo = (day or start) or None
        hi = (day or end) or None
        if lo or hi:
            def _in_window(r: dict) -> bool:
                d = _receipt_effective_date(r)
                if not d:
                    return False
                if lo and d < lo:
                    return False
                if hi and d > hi:
                    return False
                return True
            receipts = [r for r in receipts if _in_window(r)]

    # Lazy FX backfill — heals TWO populations, not one:
    #
    #  * `fx_pending`: saved by current code while no rate was reachable.
    #  * LEGACY: saved BEFORE _apply_fx existed. The vision model read the
    #    currency off the receipt ("USD") but nothing ever converted it, so
    #    there is no amount_tzs AND no fx_pending flag to notice it by.
    #    _receipt_amount then falls through to the PRINTED total, and a
    #    140 USD bank slip counts as TZS 140 in every aggregate — the spend
    #    totals, the category mix, reconciliation. Checking only fx_pending
    #    skipped these forever, which is exactly the bug a user hit with four
    #    Absa Bank USD slips.
    #
    # OFF THE EVENT LOOP. `get_rate_to_tzs` can fall through to a synchronous
    # `httpx.get(timeout=10)` under a lock. Running that inline in an `async def`
    # would stall the whole ASGI loop for every other user — the same failure
    # mode `scan_receipt` avoids with run_in_threadpool.
    #
    # Gate on `_fx_retry_due`, not `_needs_fx`: a receipt whose rate is
    # permanently unreachable stays `fx_pending` forever, so a bare `_needs_fx`
    # gate would dispatch this blocking heal on EVERY gallery load with no
    # progress. The cooldown limits each stuck receipt to one attempt per window.
    if any(_fx_retry_due(r) for r in receipts):
        await run_in_threadpool(_heal_fx, user.id, receipts)

    # Surface a single `amount` field so the gallery doesn't have to know
    # whether OCR populated `total` vs `subtotal` vs item-line prices.
    # Older receipts saved before tax-code annotation get stamped on read
    # — keeps the response uniform without a backfill migration.
    for r in receipts:
        r["amount"] = _receipt_amount(r)
        if "tax_code" not in r or "efd_compliant" not in r:
            annotate_tax(r)
    return APIResponse(
        success=True, message="ok",
        data={"receipts": receipts},
    )


# A receipt id is always a 12-char hex string minted by _save_receipt. Pinning
# the shape means a caller can never steer the filesystem lookup below with
# path segments ("..", "/") — the id is used to build a real path.
_RECEIPT_ID_RX = re.compile(r"^[a-f0-9]{6,32}$")


@router.delete("/receipts/{receipt_id}", response_model=APIResponse)
async def delete_receipt(
    request: Request,
    receipt_id: str,
    user: User = Depends(get_current_user),
):
    """Delete one scanned receipt and every file behind it.

    Until now receipts could be created but never removed — not individually,
    not in bulk — so a bad scan was permanent. Ownership is inherent in the
    layout: receipts live under `storage/receipts/<user_id>/`, so resolving
    inside the caller's own directory cannot reach another user's data.
    """
    if not _RECEIPT_ID_RX.match((receipt_id or "").strip().lower()):
        raise HTTPException(status_code=404, detail="Receipt not found")
    receipt_id = receipt_id.strip().lower()

    path = _receipts_dir(user.id) / f"{receipt_id}.json"
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="Receipt not found")

    # Deletes the JSON, the captured image AND the `.scan-<id>` idempotency
    # marker — an orphaned marker would make a later scan reusing that id
    # resolve to a receipt that no longer exists.
    failures = delete_receipt_files(user.id, receipt)
    if failures:
        # A partial delete leaves the user's data in a state neither of us can
        # see from the outside — which files survived is precisely what the
        # operator needs to unstick it by hand.
        record_error(
            "receipt_delete_failed", "; ".join(str(f) for f in failures)[:2000],
            user_id=user.id, path="/receipts/{id}", method="DELETE",
            source="handled",
        )
        raise HTTPException(
            status_code=500,
            detail="Could not fully remove that receipt. Please try again.",
        )
    log.info("User %s deleted receipt %s", user.id, receipt_id)
    record_activity(None, "receipt_deleted", user_id=user.id, request=request,
                    details={
                        "receipt_id": receipt_id,
                        "vendor": receipt.get("vendor"),
                        "total": receipt.get("total"),
                        "currency": receipt.get("currency"),
                        "date": receipt.get("date"),
                        "statement_job_id": receipt.get("statement_job_id"),
                    })
    return APIResponse(
        success=True, message="Receipt deleted", data={"id": receipt_id},
    )


@router.get("/receipts/compliance", response_model=APIResponse)
async def receipts_compliance(user: User = Depends(get_current_user)):
    """TRA / EFD compliance roll-up across all this user's receipts."""
    receipts = _load_receipts(user.id)
    return APIResponse(
        success=True, message="ok",
        data=compliance_summary(receipts),
    )


@router.get("/receipts/patterns", response_model=APIResponse)
async def receipt_patterns(user: User = Depends(get_current_user)):
    receipts = _load_receipts(user.id)
    by_category: dict[str, list[dict]] = defaultdict(list)
    for r in receipts:
        by_category[(r.get("category") or "other").lower()].append(r)

    insights: list[dict] = []

    fuel = by_category.get("fuel", [])
    if len(fuel) >= 3:
        litres: list[float] = []
        totals: list[float] = []
        for r in fuel:
            for item in r.get("items") or []:
                if (item.get("unit") or "").lower() in {"l", "litre", "litres", "liters"}:
                    qty = float(item.get("quantity") or 0)
                    if qty:
                        litres.append(qty)
            t = _receipt_amount(r)
            if t:
                totals.append(t)
        if totals:
            avg_total = sum(totals) / len(totals)
            avg_litre_text = ""
            if litres:
                avg_litres = sum(litres) / len(litres)
                avg_litre_text = f" (~{avg_litres:.1f} L per visit)"
            insights.append({
                "category": "fuel",
                "title": "Fuel spending pattern",
                "insight": (
                    f"You average TZS {avg_total:,.0f} per fuel stop"
                    f"{avg_litre_text} across {len(totals)} receipts. "
                    "Carpooling or route optimisation could shave 20–30% off this."
                ),
            })

    groceries = by_category.get("groceries", [])
    if len(groceries) >= 3:
        item_counter: Counter[str] = Counter()
        total = 0.0
        for r in groceries:
            for item in r.get("items") or []:
                name = (item.get("name") or "").strip().lower()
                if name:
                    item_counter[name] += 1
            total += _receipt_amount(r)
        frequent = [name for name, _ in item_counter.most_common(5)]
        avg = total / len(groceries) if groceries else 0
        insights.append({
            "category": "groceries",
            "title": "Grocery basket pattern",
            "insight": (
                f"Average grocery receipt: TZS {avg:,.0f} across "
                f"{len(groceries)} visits. "
                + (f"Frequent items: {', '.join(frequent)}." if frequent else "")
            ),
        })

    # Spend mix: sum of receipt totals per category (TZS), not the
    # receipt count. The Bookkeeping UI renders these values as money.
    spend_by_category: dict[str, float] = {}
    count_by_category: dict[str, int] = {}
    for cat, items in by_category.items():
        spend_by_category[cat] = sum(_receipt_amount(r) for r in items)
        count_by_category[cat] = len(items)

    return APIResponse(
        success=True,
        message="ok",
        data={
            "receipt_count": len(receipts),
            "by_category": spend_by_category,
            "count_by_category": count_by_category,
            "insights": insights,
        },
    )
