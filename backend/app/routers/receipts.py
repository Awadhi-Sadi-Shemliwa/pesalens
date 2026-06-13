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
import re
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile

from app.config import settings
from app.db import User
from app.deps import get_current_user, require_active_plan
from app.rate_limit import limiter
from app.schemas.response import APIResponse
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
# previous Qwen2.5-VL / Llama-4-Scout / Gemini-2.0-flash-exp slots all
# returned 404 by mid-2026 after the vendors pulled their free endpoints).
# The real source of truth is the OPENROUTER_VISION_MODELS env var
# (comma-separated) — set that to whatever's currently live on OpenRouter
# for your account. Gemma-4 was dropped from this list after field reports
# of weak OCR; Nemotron Nano 12B 2 VL is NVIDIA's small dedicated
# vision-language model and handles receipt OCR more reliably on the
# shared free pool.
DEFAULT_VISION_MODELS = [
    "nvidia/nemotron-nano-12b-2-vl:free",
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
    '  "items": [{"name": "item or description", "quantity": 1, "unit": "kg/litres/pcs/null", "price": 0}],\n'
    '  "subtotal": 0,\n'
    '  "tax": 0,\n'
    '  "total": 0,\n'
    '  "currency": "TZS",\n'
    '  "category": "fuel|groceries|restaurant|utilities|stock|transport|tax|bank_transfer|mobile_money|other"\n'
    "}\n"
    "CRITICAL RULES:\n"
    "- `total` MUST be the headline transaction amount as a plain number "
    "(no commas, no currency symbol). For a bank slip labelled "
    "'AMOUNT TZS 101,250.00', total = 101250. For an M-Pesa confirmation "
    "'Umelipa TZS 5,000', total = 5000.\n"
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


# Tried in order. 2.5-flash is plenty for receipts; 2.0-flash is the
# fallback when 2.5 is rate-limited. gemini-1.5-flash was retired by
# Google in 2025 (404 on v1beta), so it's no longer in the chain.
GEMINI_VISION_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]

# Per-minute Gemini free-tier windows are 60s wide, not "a couple of
# seconds". The previous 1.5s retry slammed straight back into the same
# minute window and burned the only retry we had. 12s gives the window a
# chance to actually clear before we waste the second attempt.
_RETRY_DELAY_SEC = 12.0


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
    "required": ["is_receipt"],
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


def _call_gemini_vision(image_bytes: bytes, mime: str) -> tuple[dict | None, list[str]]:
    """Try Google AI Studio Gemini vision models directly.

    Free tier has its own per-key quota (not the shared global pool that
    makes OpenRouter free models unreliable), so this is the preferred path.

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
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_id}:generateContent"
        )
        # One short retry on 429 — per-minute free-tier windows clear fast.
        resp = None
        for attempt in range(2):
            try:
                resp = httpx.post(url, json=body, headers=headers, timeout=60.0)
            except Exception as exc:
                log.warning("Gemini %s transport error: %s", model_id, exc)
                errors.append(f"gemini/{model_id}: transport_error")
                resp = None
                break
            if resp.status_code != 429 or attempt == 1:
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


def _call_openrouter(image_bytes: bytes, mime: str) -> tuple[dict | None, list[str]]:
    """Try vision models on OpenRouter in order; return (parsed, errors)."""
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
                timeout=60.0,
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


def _save_receipt(parsed: dict, image_bytes: bytes, filename: str, user_id: int) -> str:
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
    # Stamp TRA tax code + EFD compliance fields at save time so they are
    # cheap to read later (no recompute on every dashboard render).
    annotate_tax(parsed)
    (target_dir / f"{receipt_id}.json").write_text(
        json.dumps(parsed, indent=2, default=str), encoding="utf-8"
    )
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

    return (
        "Could not read the image right now. The vision service returned "
        "errors on every fallback — please try again shortly."
    )


@router.post("/receipts/scan", response_model=APIResponse)
@limiter.limit(settings.rate_limit_receipts)
async def scan_receipt(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_active_plan),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename missing")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image exceeds 10MB limit")

    # Cheap garbage-collect of expired images, then enforce per-user quota.
    _cleanup_old_receipt_images(user.id)
    _enforce_receipt_quota(user.id, len(image_bytes))

    # Magic-byte check — trust the bytes, not the Content-Type header.
    sniffed = _detect_image_mime(image_bytes)
    if not sniffed:
        return APIResponse(
            success=True, message="ok",
            data={
                "is_receipt": False,
                "message": "That file is not a supported image (JPEG/PNG/WebP/HEIC). Please pick a photo of a receipt.",
            },
        )
    mime = sniffed

    # Strip EXIF (GPS coords, device fingerprint, timestamps) before the
    # image touches disk or the vision LLM. Best-effort: a malformed image
    # falls through unchanged so the existing 400 path still surfaces it.
    image_bytes = _strip_image_metadata(image_bytes, mime)

    if not (settings.gemini_api_key or settings.openrouter_api_key):
        return APIResponse(
            success=True, message="ok",
            data={
                "is_receipt": False,
                "message": (
                    "Receipt scanning is offline. Set GEMINI_API_KEY (preferred, "
                    "free tier on Google AI Studio) or OPENROUTER_API_KEY in the "
                    "backend .env to enable real OCR."
                ),
            },
        )

    # Gemini direct first (per-key free quota), OpenRouter free vision models
    # only as a fallback (shared global pool, frequently throttled).
    parsed, gem_errors = _call_gemini_vision(image_bytes, mime)
    or_errors: list[str] = []
    if not parsed:
        # Cool-down before bouncing to OpenRouter. The free vision tier
        # there is a shared upstream pool that 429s under sub-second
        # cascades from the same server IP; a small wait (quarter of
        # the per-minute Gemini window) lets the bursts smooth out.
        time.sleep(_RETRY_DELAY_SEC / 4)
        parsed, or_errors = _call_openrouter(image_bytes, mime)

    if not parsed:
        all_errors = gem_errors + or_errors
        # Log the per-model diagnostic server-side only — never bubble
        # vendor / model identifiers up to the browser.
        log.warning("Receipt scan failed for user %s: %s", user.id, all_errors)
        return APIResponse(
            success=True, message="ok",
            data={
                "is_receipt": False,
                "message": _build_failure_message(all_errors),
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
                    "Please add a photo of a receipt to record the spending."
                ),
            },
        )

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

    receipt_id = _save_receipt(parsed, image_bytes, file.filename, user_id=user.id)
    return APIResponse(
        success=True, message="ok",
        data={**parsed, "id": receipt_id},
    )


@router.post("/receipts/parse-text", response_model=APIResponse)
@limiter.limit(settings.rate_limit_receipts)
async def parse_receipt_text(
    request: Request,
    payload: dict = Body(...),
    user: User = Depends(require_active_plan),
):
    """Parse already-OCR'd text into the standard receipt JSON via the text model.

    Body: { "text": "...", "save": true|false }
    Returns the same shape as /receipts/scan. If save=true, persists the
    extracted receipt (no source image).
    """
    text = (payload.get("text") or "").strip()
    save = bool(payload.get("save", False))

    if not text:
        raise HTTPException(status_code=400, detail="text missing")

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

    if save:
        receipt_id = _save_receipt(
            parsed, b"", f"text-{uuid.uuid4().hex[:8]}.txt", user_id=user.id
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
    """Best-effort amount for a receipt: total, else subtotal, else summed items."""
    for key in ("total", "amount", "subtotal"):
        v = r.get(key)
        try:
            f = float(v or 0)
        except (TypeError, ValueError):
            f = 0.0
        if f > 0:
            return f
    items_sum = 0.0
    for item in r.get("items") or []:
        try:
            # Schema-guided Gemini returns `line_total` (already row-total).
            # Prompt-only path (OpenRouter free models, OCR-text fallback)
            # returns `price` which still needs * quantity. Try the
            # row-total field first to avoid double-multiplying.
            line_total = float(item.get("line_total") or 0)
            if line_total > 0:
                items_sum += line_total
                continue
            unit_price = float(item.get("unit_price") or item.get("price") or 0)
            qty = float(item.get("quantity") or 1)
            items_sum += unit_price * qty
        except (TypeError, ValueError):
            continue
    return items_sum


@router.get("/receipts", response_model=APIResponse)
async def list_receipts(user: User = Depends(get_current_user)):
    receipts = _load_receipts(user.id)
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
            t = float(r.get("total") or 0)
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
            total += float(r.get("total") or 0)
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
