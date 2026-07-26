"""Foreign-exchange helper: convert receipt amounts to TZS.

PesaLens is TZS-first, but receipts occasionally arrive in foreign
currencies (university application fees, IOM medical checks, online
services billed in USD/EUR/GBP). The scan pipeline stamps such receipts
with the TZS equivalent at the current market rate so every aggregate
stays a single-currency sum.

Rate sources, in order:
  1. The market scheduler's `forex_global` cache (refreshed every 6h by
     market_scheduler.refresh_forex_global — open.er-api.com + Frankfurter).
     Rates there are quoted as units-of-currency per 1 USD, so
     TZS-per-unit = rate_usd(TZS) / rate_usd(CCY).
  2. A direct sync fetch of open.er-api.com (free, no key, carries TZS),
     persisted to fx_spot.json for reuse.
  3. The stale fx_spot.json as a last resort — an old rate with a
     timestamp beats no rate.

All callers run in threadpool workers (receipt scan pipeline), so the
sync httpx call never blocks the event loop.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Optional

import httpx

from app.config import settings
from app.utils.logger import get_logger

log = get_logger(__name__)

ER_API_URL = "https://open.er-api.com/v6/latest/USD"

# Cache freshness windows (seconds).
_SCHEDULER_CACHE_MAX_AGE = 12 * 3600   # forex_global refreshes every 6h
_SPOT_CACHE_MAX_AGE = 12 * 3600

_SPOT_CACHE_PATH = settings.storage_path / "market_cache" / "fx_spot.json"
_fetch_lock = threading.Lock()

# Negative caching for the live fetch.
#
# `_fetch_lock` is held across a synchronous 10s httpx call, and a FAILED fetch
# writes nothing — so the in-lock re-check below returns None for every waiter
# and each one goes on to run its own 10s fetch, serially. Eight foreign
# receipts scanned during a provider outage became 80s of blocking inside the
# same bounded threadpool that serves /receipts/scan and the gallery. Recording
# the failure bounds an outage to one attempt per window process-wide; waiters
# fall straight through to the stale cache instead.
_FETCH_FAILURE_COOLDOWN_SECONDS = 300
_last_fetch_failure_at = 0.0

# Currency spellings the vision/text models emit for the same thing.
CURRENCY_ALIASES = {
    "TSH": "TZS", "TSHS": "TZS", "SH": "TZS", "SHILLING": "TZS",
    "SHILLINGS": "TZS", "TZSH": "TZS", "/=": "TZS",
    "TZS.": "TZS", "TANZANIAN SHILLING": "TZS", "TANZANIAN SHILLINGS": "TZS",
    "$": "USD", "US$": "USD", "USD$": "USD", "DOLLAR": "USD", "DOLLARS": "USD",
    "USD.": "USD", "US DOLLAR": "USD", "US DOLLARS": "USD", "USDOLLAR": "USD",
    "U.S. DOLLAR": "USD", "US$.": "USD",
    "€": "EUR", "EURO": "EUR", "EUROS": "EUR", "EUR.": "EUR",
    "£": "GBP", "POUND": "GBP", "POUNDS": "GBP", "STERLING": "GBP",
    "GBP.": "GBP", "POUND STERLING": "GBP",
    "KSH": "KES", "KSHS": "KES", "KENYAN SHILLING": "KES",
    "USH": "UGX", "USHS": "UGX", "UGANDAN SHILLING": "UGX",
    # South African banks appear in Tanzanian corporate flows (Absa, Standard).
    "R": "ZAR", "RAND": "ZAR", "ZAR.": "ZAR",
}


def normalize_currency(raw: Optional[str]) -> str:
    """Normalize a model-emitted currency label to an ISO code.

    Unknown junk resolves to TZS — the app's home currency and by far the
    most likely truth for a Tanzanian receipt with an unreadable label.
    """
    code = (raw or "").strip().upper()
    if not code:
        return "TZS"
    code = CURRENCY_ALIASES.get(code, code)
    if len(code) != 3 or not code.isalpha():
        return "TZS"
    return code


def _rates_from_scheduler_cache(
    max_age: Optional[float] = _SCHEDULER_CACHE_MAX_AGE,
) -> tuple[dict[str, float], Optional[str]] | None:
    """USD-quoted rates from the market scheduler's forex_global cache.

    `max_age=None` accepts the cache at any age — for read paths where a stale
    rate is strictly better than no answer (see `cached_rate_to_tzs`).
    """
    try:
        from app.services.market_scheduler import load_cache
        payload = load_cache("forex_global")
    except Exception:  # noqa: BLE001 - cache layer must never break FX
        return None
    if not payload:
        return None
    updated = payload.get("updated_at") or ""
    try:
        from datetime import datetime, timezone
        ts = datetime.fromisoformat(updated.replace("Z", "+00:00"))
        if max_age is not None and (datetime.now(timezone.utc) - ts).total_seconds() > max_age:
            return None
    except ValueError:
        # An unparseable timestamp is only disqualifying when age matters.
        if max_age is not None:
            return None
    rates = {
        row.get("currency"): float(row.get("rate_usd") or 0)
        for row in payload.get("data") or []
        if row.get("currency") and row.get("rate_usd")
    }
    return (rates, updated) if rates.get("TZS") else None


def _rates_from_spot_cache(max_age: Optional[float]) -> tuple[dict[str, float], Optional[str]] | None:
    try:
        payload = json.loads(_SPOT_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if max_age is not None and time.time() - float(payload.get("fetched_at") or 0) > max_age:
        return None
    rates = payload.get("rates") or {}
    return (rates, payload.get("as_of")) if rates.get("TZS") else None


def _fetch_spot_rates() -> tuple[dict[str, float], Optional[str]] | None:
    """Sync fetch of USD-quoted rates; persists to fx_spot.json."""
    try:
        r = httpx.get(ER_API_URL, timeout=10)
        if r.status_code != 200:
            return None
        payload = r.json()
        rates = {
            k: float(v) for k, v in (payload.get("rates") or {}).items()
            if isinstance(v, (int, float)) and v > 0
        }
        if not rates.get("TZS"):
            return None
        as_of = payload.get("time_last_update_utc")
        try:
            _SPOT_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            _SPOT_CACHE_PATH.write_text(
                json.dumps({"rates": rates, "as_of": as_of, "fetched_at": time.time()}),
                encoding="utf-8",
            )
        except OSError as exc:
            log.warning("Could not persist fx spot cache: %s", exc)
        return rates, as_of
    except Exception as exc:  # noqa: BLE001 - FX outage must never break a scan
        log.warning("FX spot fetch failed: %s", exc)
        return None


def _rate_from_sources(
    code: str, sources: tuple[dict[str, float], Optional[str]] | None
) -> tuple[Optional[float], Optional[str]]:
    if sources is None:
        return None, None
    rates, as_of = sources
    tzs_per_usd = rates.get("TZS") or 0.0
    # Rates are quoted per 1 USD, so USD's own rate is 1 by definition (the
    # scheduler cache doesn't store a USD row at all).
    ccy_per_usd = 1.0 if code == "USD" else (rates.get(code) or 0.0)
    if tzs_per_usd <= 0 or ccy_per_usd <= 0:
        return None, None
    return round(tzs_per_usd / ccy_per_usd, 4), as_of


def get_rate_to_tzs(currency: str) -> tuple[Optional[float], Optional[str]]:
    """(TZS per 1 unit of `currency`, as-of label) — or (None, None).

    `currency` should already be normalized. TZS itself returns (1.0, None).

    BLOCKING: may perform a synchronous HTTP fetch under a global lock. Never
    call this from the event loop — use `run_in_threadpool`, or
    `cached_rate_to_tzs` when a cache-only answer will do.
    """
    code = normalize_currency(currency)
    if code == "TZS":
        return 1.0, None

    sources = (
        _rates_from_scheduler_cache()
        or _rates_from_spot_cache(_SPOT_CACHE_MAX_AGE)
    )
    if sources is None:
        global _last_fetch_failure_at
        with _fetch_lock:
            # Re-check under the lock — a concurrent scan may just have fetched.
            sources = _rates_from_spot_cache(_SPOT_CACHE_MAX_AGE)
            if sources is None:
                # Skip the network entirely while a recent attempt is still
                # cooling off, so a provider outage costs one 10s fetch per
                # window rather than one per waiting receipt.
                cooling = (time.time() - _last_fetch_failure_at) < _FETCH_FAILURE_COOLDOWN_SECONDS
                if not cooling:
                    sources = _fetch_spot_rates()
                    _last_fetch_failure_at = 0.0 if sources else time.time()
            if sources is None:
                sources = _rates_from_spot_cache(None)  # stale beats nothing
    return _rate_from_sources(code, sources)


def warm_spot_cache() -> None:
    """Populate fx_spot.json once at boot. BLOCKING — call in a threadpool.

    Without this, the file is written only by the receipt-scan path, so a fresh
    deploy has no spot cache at all until somebody happens to scan a foreign
    receipt. `cached_rate_to_tzs` is cache-only by contract and every receipt
    aggregate depends on it, so "no cache yet" is not a neutral state — it
    values foreign receipts at zero. One fetch at startup removes that window.

    Mirrors what start_scheduler() already does for forex_global; this is the
    one FX cache that had no boot warm-up.
    """
    if _rates_from_spot_cache(_SPOT_CACHE_MAX_AGE):
        return  # already fresh — no need to spend a request
    if _fetch_spot_rates():
        log.info("FX spot cache warmed at boot")
    else:
        log.warning("FX spot cache could not be warmed at boot")


def cached_rate_to_tzs(currency: str) -> Optional[float]:
    """TZS per 1 unit of `currency` from CACHE ONLY — never any network I/O.

    For read paths that must stay fast and non-blocking (aggregates, report
    roll-ups). Returns None when no cached rate covers the currency; the
    caller must then decline to value the amount rather than guess.

    BOTH caches are read at any age here. The alternative — rejecting a
    forex_global cache more than 12h old, as the scan path does — meant that a
    deploy whose scheduler had been down since yesterday, and where nobody had
    yet scanned a foreign receipt (the only thing that writes fx_spot.json),
    valued every USD receipt at 0 in the business P&L and the TRA compliance
    roll-up. Yesterday's rate is off by a fraction of a percent; a zero is off
    by everything.
    """
    code = normalize_currency(currency)
    if code == "TZS":
        return 1.0
    sources = (
        _rates_from_scheduler_cache(None)
        or _rates_from_spot_cache(None)
    )
    rate, _ = _rate_from_sources(code, sources)
    return rate


def receipt_printed_amount(r: dict) -> float:
    """The figure printed on the receipt, in whatever currency it is in."""
    try:
        original = float(r.get("original_amount") or 0)
    except (TypeError, ValueError):
        original = 0.0
    if original > 0:
        return original
    for key in ("total", "amount", "subtotal"):
        try:
            value = float(r.get(key) or 0)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    items_sum = 0.0
    for item in r.get("items") or []:
        try:
            # Schema-guided Gemini returns `line_total` (already row-total).
            # Prompt-only path (OpenRouter free models, OCR-text fallback)
            # returns `price` which still needs * quantity. Try the row-total
            # field first to avoid double-multiplying.
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


def receipt_amount_tzs(r: dict) -> float:
    """What a receipt is worth in TZS. The ONE definition — use it everywhere.

    Every aggregate over receipts (spend totals, the TRA compliance roll-up,
    vendor analytics, bookkeeping) must agree on this, because the alternative
    is each caller writing `amount_tzs or total`, which reads a foreign
    receipt's printed figure as TZS and books a 140 USD slip as TZS 140
    instead of ~373,000.

    A stamped `amount_tzs` wins. Otherwise a foreign receipt is converted at a
    CACHED rate (no network — this runs inside request handlers), and only if
    no cached rate exists at all is the receipt valued at 0 rather than counted
    at a 2,600x error.

    That last branch is a genuine last resort, not a routine outcome: the spot
    cache is warmed at boot (main.lifespan) and the scheduler refreshes
    forex_global every 6h, and `cached_rate_to_tzs` accepts both at any age. It
    takes a cold deploy whose very first FX fetch also failed to reach here.
    """
    try:
        stamped = float(r.get("amount_tzs") or 0)
        if stamped > 0:
            return stamped
    except (TypeError, ValueError):
        pass

    printed = receipt_printed_amount(r)
    code = normalize_currency(r.get("currency"))
    if code == "TZS" or printed <= 0:
        return printed

    rate = cached_rate_to_tzs(code)
    if rate:
        return round(printed * rate, 2)
    log.warning(
        "Receipt %s is %s with no amount_tzs and no cached rate — excluded "
        "from totals rather than counted as TZS.",
        r.get("id"), code,
    )
    return 0.0
