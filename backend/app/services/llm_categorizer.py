"""LLM batch categorization for transactions the keyword matcher can't place.

The keyword categorizer in analytics.py covers the overwhelming majority of
Tanzanian statement descriptions; whatever still lands in "Other Expenses"
gets one shot at an LLM here, AT EXTRACTION TIME (in the worker thread,
never on a dashboard read path). Results are cached in the CategoryCache
table keyed on a normalized description, so a description is ever paid for
once — re-extractions and repeated vendors are free.

Degradation is graceful at every layer: no API keys, quota exhaustion,
timeouts, or malformed responses simply leave rows as "Other Expenses".
"""

from __future__ import annotations

import json
import re

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.services.analytics import CATEGORY_COLOURS, UNCATEGORIZED, categorize
from app.utils.logger import get_logger

log = get_logger(__name__)

# Categories the LLM may answer with. There is deliberately NO "Other"
# option: the whole point of this pass is to name what the keyword matcher
# could not, so the model is forced to commit to a real category ("MSHIKO
# FASTA DISBURSEMENT" -> Debt, not "Other"). The prompt tells it to pick the
# closest fit rather than to hedge.
CATEGORY_NAMES: list[str] = [n for n in CATEGORY_COLOURS if n != UNCATEGORIZED]

_BATCH_SIZE = 40
_HTTP_TIMEOUT = 30.0
_GEMINI_MODEL = "gemini-2.5-flash-lite"

_DIGIT_RUN_RX = re.compile(r"\d{4,}")
_WS_RX = re.compile(r"\s+")


def normalize_desc_key(description: str) -> str:
    """Cache key for a description: lowercase, digit-runs stripped, squashed.

    Reference numbers, phone numbers, and timestamps vary per transaction
    while the merchant/narrative part repeats — stripping runs of 4+ digits
    makes "Paid to DUKA X ref 99841120" and "... ref 99841121" share one
    cache row.
    """
    key = _DIGIT_RUN_RX.sub("#", (description or "").lower())
    key = _WS_RX.sub(" ", key).strip()
    return key[:200]


_PROMPT = (
    "You are categorizing bank/mobile-money transaction descriptions from "
    "Tanzania into personal-finance categories. Descriptions may be in "
    "English or Swahili, are often abbreviated, and frequently contain OCR "
    "errors from scanned statements (e.g. 'Governmeint 1.vy' = government "
    "levy, 'Funds Transter' = funds transfer, 'MSHIKO FASTA DGBURSEMENT' = "
    "a Mshiko Fasta micro-loan disbursement).\n"
    "Read through the noise and ALWAYS choose the closest-fitting category — "
    "there is no 'other' option. Loan disbursements and repayments are Debt. "
    "Government levies and TRA/GEPG payments are Government & Tax. Bank "
    "commissions, VAT on charges and ledger fees are Fees & Charges.\n"
    "Tanzanian bank branches are named after buildings and suburbs — 'House', "
    "'Clock Tower House', 'Tower', 'Mbezi', 'Madaraka', 'Kariakoo'. A "
    "description that is only such a name, or only a person's name or a "
    "reference number, with no activity word, is a fragment of a bank record "
    "and must be answered Bank Services — never Housing (it is a branch, not "
    "rent).\n"
    "Allowed categories: {categories}\n"
    "Return STRICT JSON: an array of category strings, one per input, in "
    "the same order.\nDescriptions:\n{items}"
)


def _build_prompt(descriptions: list[str]) -> str:
    items = "\n".join(f"{i + 1}. {d[:160]}" for i, d in enumerate(descriptions))
    return _PROMPT.format(categories=", ".join(CATEGORY_NAMES), items=items)


def _parse_answer(raw: str, expected: int) -> list[str] | None:
    """Parse the model's JSON array; None when unusable."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*", "", raw).strip().rstrip("`").strip()
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        return None
    try:
        arr = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(arr, list) or len(arr) != expected:
        return None
    return [str(a) for a in arr]


def _call_gemini(descriptions: list[str]) -> list[str] | None:
    if not settings.gemini_api_key:
        return None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{_GEMINI_MODEL}:generateContent"
    )
    body = {
        "contents": [{"parts": [{"text": _build_prompt(descriptions)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "ARRAY",
                "items": {"type": "STRING", "enum": CATEGORY_NAMES},
            },
            "temperature": 0.0,
            "maxOutputTokens": 4096,
        },
    }
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.gemini_api_key,
    }
    try:
        resp = httpx.post(url, json=body, headers=headers, timeout=_HTTP_TIMEOUT)
        if resp.status_code >= 400:
            log.warning("Gemini categorizer -> %s: %s",
                        resp.status_code, resp.text[:200])
            return None
        candidates = resp.json().get("candidates") or []
        parts = (candidates[0].get("content") or {}).get("parts") or [] if candidates else []
        raw = "".join(p.get("text", "") for p in parts)
        return _parse_answer(raw, len(descriptions))
    except Exception as exc:  # noqa: BLE001 - categorization is best-effort
        log.warning("Gemini categorizer failed: %s", exc)
        return None


def _call_openrouter(descriptions: list[str]) -> list[str] | None:
    if not settings.openrouter_api_key:
        return None
    model = settings.openrouter_text_model or settings.openrouter_model
    try:
        resp = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": _build_prompt(descriptions)}],
                "temperature": 0.0,
            },
            timeout=_HTTP_TIMEOUT,
        )
        if resp.status_code >= 400:
            log.warning("OpenRouter categorizer -> %s: %s",
                        resp.status_code, resp.text[:200])
            return None
        choices = resp.json().get("choices") or []
        raw = ((choices[0].get("message") or {}).get("content") or "") if choices else ""
        return _parse_answer(raw, len(descriptions))
    except Exception as exc:  # noqa: BLE001
        log.warning("OpenRouter categorizer failed: %s", exc)
        return None


def categorize_descriptions(descriptions: list[str]) -> dict[str, str]:
    """Map description -> category for the given descriptions.

    Cache-first; uncached keys go to Gemini (OpenRouter fallback) in batches.
    Only valid category names are accepted and cached. Failures yield {} for
    the failed batch — callers keep the keyword fallback.

    Runs on its OWN short-lived session, deliberately. This is called from
    inside the extraction worker, whose session also carries the in-flight
    `Upload` progress and heartbeat writes. Committing on that session would
    flush those unrelated pending changes at an arbitrary point, and the
    `rollback()` on a `desc_key` unique-race would DISCARD them — losing job
    progress because a cache insert lost a race. The cache is an independent
    concern and gets an independent transaction.
    """
    from app.db import CategoryCache, SessionLocal

    result: dict[str, str] = {}
    key_by_desc = {d: normalize_desc_key(d) for d in descriptions if d}
    keys = {k for k in key_by_desc.values() if k}
    if not keys:
        return result

    db = SessionLocal()
    try:
        return _categorize_with_cache(db, CategoryCache, result, key_by_desc, keys)
    finally:
        db.close()


def _categorize_with_cache(
    db: Session,
    CategoryCache,
    result: dict[str, str],
    key_by_desc: dict[str, str],
    keys: set,
) -> dict[str, str]:
    """Cache lookup + LLM fill. `db` is this function's own session to commit."""

    # Validate on read: the allowed category set changes as the keyword table
    # evolves (e.g. "Other Expenses" was retired), and a cache written under
    # the old set must not resurrect a category we no longer show. Stale rows
    # are deleted so the description is re-asked once and cached correctly.
    cached: dict[str, str] = {}
    stale: list = []
    for row in db.query(CategoryCache).filter(CategoryCache.desc_key.in_(keys)).all():
        if row.category in CATEGORY_NAMES:
            cached[row.desc_key] = row.category
        else:
            stale.append(row)
    if stale:
        for row in stale:
            db.delete(row)
        try:
            db.commit()
            log.info("Purged %d stale category-cache row(s)", len(stale))
        except Exception:  # noqa: BLE001
            db.rollback()
    for desc, key in key_by_desc.items():
        if key in cached:
            result[desc] = cached[key]

    pending = [d for d, k in key_by_desc.items() if k not in cached]
    # One representative description per cache key (duplicates ride along free).
    by_key: dict[str, list[str]] = {}
    for d in pending:
        by_key.setdefault(key_by_desc[d], []).append(d)
    unique_descs = [descs[0] for descs in by_key.values()]

    for i in range(0, len(unique_descs), _BATCH_SIZE):
        batch = unique_descs[i:i + _BATCH_SIZE]
        answers = _call_gemini(batch) or _call_openrouter(batch)
        if not answers:
            continue
        for desc, cat in zip(batch, answers):
            cat = (cat or "").strip()
            if cat not in CATEGORY_COLOURS:
                continue
            key = key_by_desc[desc]
            for twin in by_key.get(key, [desc]):
                result[twin] = cat
            try:
                db.add(CategoryCache(desc_key=key, category=cat))
                db.commit()
            except Exception:  # noqa: BLE001 - unique race / db hiccup
                db.rollback()
    return result


def apply_llm_categories(transactions: list) -> int:
    """Stamp `category` on transactions the keyword matcher couldn't place.

    Mutates the Transaction models in place; returns how many rows got an
    LLM category. No-op when disabled or no rows need it.

    Takes no session on purpose: the only persistence here is the category
    cache, which owns its own transaction (see `categorize_descriptions`).
    Borrowing the caller's session would let a cache write commit or roll back
    the extraction job's in-flight state.
    """
    if not settings.enable_llm_categorization:
        return 0
    if not (settings.gemini_api_key or settings.openrouter_api_key):
        return 0

    needs: list = []
    for t in transactions:
        name, _colour = categorize(t.description)
        if name == UNCATEGORIZED and (t.description or "").strip():
            needs.append(t)
        else:
            t.category = name
            t.category_source = "keywords"
    if not needs:
        return 0

    mapping = categorize_descriptions([t.description for t in needs])
    stamped = 0
    for t in needs:
        cat = mapping.get(t.description)
        if cat:
            t.category = cat
            t.category_source = "llm"
            stamped += 1
        else:
            t.category = UNCATEGORIZED
            t.category_source = "unmatched"
    log.info(
        "LLM categorizer: %d/%d unmatched rows given a real category",
        stamped, len(needs),
    )
    return stamped
