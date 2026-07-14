"""Per-bank spending intelligence — the "money map" (Epic-2, Slice 3).

For a user running several services (NMB, CRDB, Selcom, Airtel Money, M-Pesa,
Tigo Pesa, Yas…) this rolls every statement up BY PROVIDER and surfaces the
one number that's otherwise invisible: how much each service charges in fees.
From that it ranks the providers and produces deterministic "move your money
here" suggestions. An LLM adds a coaching sentence when available, mirroring
`reconciliation.llm_narrative` — but the facts and suggestions stand alone if
both providers are down.

Reuses the running-balance charge detector (`_charges_and_interest`) and the
cross-upload transaction de-dupe (`_txn_dedupe_key`) so the money map never
drifts from the rest of analytics or double-counts overlapping statements.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections import OrderedDict, defaultdict
from typing import Optional

from app.config import settings
from app.schemas.bank_intel import (
    BankIntelCard,
    BankIntelResponse,
    BankIntelSuggestion,
    BankIntelTotals,
)
from app.services.analytics import _charges_and_interest, load_all_results
from app.services.reconciliation import _bank_label, _fmt_amt, _txn_dedupe_key
from app.utils.logger import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def _blank_agg() -> dict:
    return {
        "spend": 0.0, "inflow": 0.0, "txn_count": 0,
        "charges": 0.0, "charge_occ": 0, "interest": 0.0,
        "statements": 0,
        "seen_txn": set(), "seen_charge": set(), "seen_interest": set(),
    }


def _aggregate(user_id: Optional[int]) -> dict[str, dict]:
    """Fold every saved statement into a per-bank accumulator.

    Charges are computed per-statement (the balance chain is only valid within
    one statement) then de-duplicated by (date, description, amount) so two
    uploads overlapping the same period don't double-count a fee. Transactions
    de-dupe with `_txn_dedupe_key` for the same reason.
    """
    by_bank: dict[str, dict] = defaultdict(_blank_agg)

    for result in load_all_results(user_id):
        bank = (result.get("metadata") or {}).get("bank") or "unknown"
        agg = by_bank[bank]
        agg["statements"] += 1

        for t in result.get("transactions") or []:
            key = _txn_dedupe_key(t)
            if key in agg["seen_txn"]:
                continue
            agg["seen_txn"].add(key)
            agg["spend"] += float(t.get("debit") or 0)
            agg["inflow"] += float(t.get("credit") or 0)
            agg["txn_count"] += 1

        ci = _charges_and_interest(result)
        for item in ci.get("charges") or []:
            ck = (item.get("date"), item.get("description"), item.get("amount"))
            if ck in agg["seen_charge"]:
                continue
            agg["seen_charge"].add(ck)
            agg["charges"] += float(item.get("amount") or 0)
            agg["charge_occ"] += 1
        for item in ci.get("interest") or []:
            ik = (item.get("date"), item.get("description"), item.get("amount"))
            if ik in agg["seen_interest"]:
                continue
            agg["seen_interest"].add(ik)
            agg["interest"] += float(item.get("amount") or 0)

    return by_bank


def _to_cards(by_bank: dict[str, dict]) -> list[BankIntelCard]:
    cards: list[BankIntelCard] = []
    for bank, a in by_bank.items():
        spend = round(a["spend"], 2)
        charges = round(a["charges"], 2)
        txns = a["txn_count"]
        cards.append(BankIntelCard(
            bank=bank,
            label=_bank_label(bank),
            spend=spend,
            inflow=round(a["inflow"], 2),
            txn_count=txns,
            charges=charges,
            charge_occurrences=a["charge_occ"],
            interest=round(a["interest"], 2),
            fee_rate=round(charges / spend, 4) if spend > 0 else 0.0,
            avg_fee_per_txn=round(charges / txns, 2) if txns > 0 else 0.0,
            statement_count=a["statements"],
        ))
    # Most expensive first (by absolute charges, then fee rate) — the card the
    # user should look at is the one costing them the most.
    cards.sort(key=lambda c: (c.charges, c.fee_rate), reverse=True)
    return cards


# ---------------------------------------------------------------------------
# Deterministic suggestions
# ---------------------------------------------------------------------------

def _suggestions(cards: list[BankIntelCard]) -> list[BankIntelSuggestion]:
    """Fact-based recommendations ranked off the aggregated cards.

    All copy is derived from real numbers — no fabrication. Needs at least one
    provider that actually charged a fee before it says anything.
    """
    out: list[BankIntelSuggestion] = []
    charging = [c for c in cards if c.txn_count > 0]
    if not charging:
        return out

    # Most expensive by fee-per-transaction (normalises across providers with
    # very different volumes — a service that charges more PER move is the leak).
    priciest = max(charging, key=lambda c: c.avg_fee_per_txn)
    if priciest.charges > 0:
        out.append(BankIntelSuggestion(
            kind="most_expensive",
            title=f"{priciest.label} costs you the most",
            detail=(
                f"{priciest.label} charged {_fmt_amt(priciest.charges)} across "
                f"{priciest.charge_occurrences} fee(s) — about "
                f"{_fmt_amt(priciest.avg_fee_per_txn)} per transaction "
                f"({priciest.fee_rate * 100:.1f}% of what you spent through it)."
            ),
            bank=priciest.bank,
            amount=priciest.charges,
        ))

    # Cheapest to transact — the lowest fee-per-transaction (fee can be 0).
    cheapest = min(charging, key=lambda c: c.avg_fee_per_txn)
    if cheapest.bank != priciest.bank:
        out.append(BankIntelSuggestion(
            kind="cheapest",
            title=f"{cheapest.label} is your cheapest service",
            detail=(
                f"{cheapest.label} averages "
                f"{_fmt_amt(cheapest.avg_fee_per_txn)} per transaction"
                + (" — no fees detected at all." if cheapest.charges <= 0
                   else ". Route more of your transfers through it.")
            ),
            bank=cheapest.bank,
            amount=cheapest.avg_fee_per_txn,
        ))

        # Saving estimate: move the priciest service's volume onto the cheapest.
        per_txn_gap = priciest.avg_fee_per_txn - cheapest.avg_fee_per_txn
        saving = round(per_txn_gap * priciest.txn_count, 2)
        if saving > 0:
            out.append(BankIntelSuggestion(
                kind="saving_estimate",
                title=f"Save ~{_fmt_amt(saving)}",
                detail=(
                    f"Moving your {priciest.txn_count} {priciest.label} "
                    f"transaction(s) to {cheapest.label} would have saved about "
                    f"{_fmt_amt(saving)} in fees over this period."
                ),
                bank=cheapest.bank,
                amount=saving,
            ))
    return out


# ---------------------------------------------------------------------------
# LLM narrative — Gemini → OpenRouter, graceful fallback (mirrors reconciliation)
# ---------------------------------------------------------------------------

_LLM_SYSTEM = (
    "You are PesaLens AI's money-map coach for a Tanzanian user who runs "
    "several bank / mobile-money services. You receive a per-service roll-up "
    "of spend, transaction count, and the FEES each service charged, plus "
    "deterministic suggestions already computed for you. Write ONE short "
    "overall_summary (2-3 sentences, TZS terms) that tells the user which "
    "service is costing them most in fees and what to do about it. Be specific "
    "with amounts and service names. NEVER invent numbers — use only what is in "
    "the data. Return STRICT JSON: {\"overall_summary\": \"...\"}"
)

_LLM_TIMEOUT = 30.0


def _payload(cards: list[BankIntelCard], suggestions: list[BankIntelSuggestion]) -> str:
    return json.dumps({
        "banks": [
            {
                "service": c.label, "spend": c.spend, "txn_count": c.txn_count,
                "charges": c.charges, "fee_rate": c.fee_rate,
                "avg_fee_per_txn": c.avg_fee_per_txn,
            }
            for c in cards
        ],
        "suggestions": [
            {"kind": s.kind, "title": s.title, "detail": s.detail} for s in suggestions
        ],
    }, ensure_ascii=False)


def _parse_llm_json(text: str) -> Optional[dict]:
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    else:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
    try:
        return json.loads(text)
    except Exception:
        return None


def _try_gemini(payload: str) -> Optional[str]:
    if not settings.gemini_api_key:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(f"{_LLM_SYSTEM}\n\nDATA:\n{payload}")
        return (getattr(response, "text", "") or "").strip() or None
    except Exception as exc:
        log.warning("Gemini bank-intel call failed (%s)", exc.__class__.__name__)
        return None


def _try_openrouter(payload: str) -> Optional[str]:
    if not settings.openrouter_api_key:
        return None
    import httpx
    from app.routers.assistant import FALLBACK_MODELS
    models = [settings.openrouter_model, *FALLBACK_MODELS]
    seen: set[str] = set()
    for m in models:
        if not m or m in seen:
            continue
        seen.add(m)
        try:
            resp = httpx.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://pesalens.app",
                    "X-Title": "PesaLens",
                },
                json={
                    "model": m,
                    "messages": [
                        {"role": "system", "content": _LLM_SYSTEM},
                        {"role": "user", "content": payload},
                    ],
                    "max_tokens": 400,
                    "temperature": 0.3,
                },
                timeout=_LLM_TIMEOUT,
            )
            if resp.status_code in (400, 404, 429):
                continue
            resp.raise_for_status()
            data = resp.json()
            reply = (
                data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
            ).strip()
            if reply:
                return reply
        except Exception as exc:
            log.warning("OpenRouter bank-intel model %s failed: %s", m, exc.__class__.__name__)
            continue
    return None


def _llm_narrative(
    cards: list[BankIntelCard], suggestions: list[BankIntelSuggestion]
) -> tuple[Optional[str], str]:
    """(overall_summary, status). Status mirrors reconciliation: ok / unavailable / skipped."""
    if not cards:
        return None, "skipped"
    payload = _payload(cards, suggestions)
    raw = _try_gemini(payload) or _try_openrouter(payload)
    if not raw:
        return None, "unavailable"
    parsed = _parse_llm_json(raw)
    if not parsed:
        log.warning("LLM bank-intel reply was not parseable JSON")
        return None, "unavailable"
    summary = (parsed.get("overall_summary") or "").strip() or None
    return summary, "ok" if summary else "unavailable"


# ---------------------------------------------------------------------------
# Per-user cache — the money map is expensive (full-archive scan + an uncached
# LLM call with a provider fallback chain), yet the Dashboard mounts it on every
# visit for data that only changes when a statement is added/removed. We key the
# cache on a cheap fingerprint of the result-file set (auto-invalidates on a new
# upload or deletion — no explicit hook) plus a TTL safety valve so a transient
# LLM outage or a newly-added API key is eventually retried.
# ---------------------------------------------------------------------------

_CACHE_LOCK = threading.Lock()
# LRU-bounded so a long-lived worker can't accumulate one retained response per
# user forever. OrderedDict + move_to_end/popitem gives cheap LRU eviction.
_CACHE: "OrderedDict[Optional[int], tuple[str, float, BankIntelResponse]]" = OrderedDict()
_CACHE_TTL_SEC = 900   # 15 min
_CACHE_MAX_ENTRIES = 512


def _statement_signature(user_id: Optional[int]) -> str:
    """Fingerprint of the user's statement set — changes when any result JSON is
    added, removed, or rewritten. Stat-only (no parsing), so it's cheap enough
    to compute on every request."""
    base = settings.results_path / str(user_id) if user_id is not None else settings.results_path
    if not base.exists():
        return "none"
    parts: list[str] = []
    for p in sorted(base.glob("*.json")):
        try:
            st = p.stat()
            parts.append(f"{p.name}:{st.st_mtime_ns}:{st.st_size}")
        except OSError:
            continue
    return "|".join(parts) or "none"


def invalidate_bank_intel(user_id: Optional[int]) -> None:
    """Drop a user's cached money map (e.g. after a new upload)."""
    with _CACHE_LOCK:
        _CACHE.pop(user_id, None)


# ---------------------------------------------------------------------------
# Top-level builder
# ---------------------------------------------------------------------------

def build_bank_intel(user_id: Optional[int], *, use_cache: bool = True) -> BankIntelResponse:
    """Per-service money map, cached per user on the statement-set fingerprint."""
    sig = _statement_signature(user_id)
    now = time.time()
    if use_cache:
        with _CACHE_LOCK:
            hit = _CACHE.get(user_id)
            if hit and hit[0] == sig and (now - hit[1]) < _CACHE_TTL_SEC:
                _CACHE.move_to_end(user_id)  # mark most-recently-used
                return hit[2]
    response = _build_bank_intel(user_id)
    with _CACHE_LOCK:
        _CACHE[user_id] = (sig, now, response)
        _CACHE.move_to_end(user_id)
        while len(_CACHE) > _CACHE_MAX_ENTRIES:
            _CACHE.popitem(last=False)  # evict least-recently-used
    return response


def _build_bank_intel(user_id: Optional[int]) -> BankIntelResponse:
    by_bank = _aggregate(user_id)
    cards = _to_cards(by_bank)

    notes: list[str] = []
    if not cards:
        notes.append("No statements uploaded yet — upload a statement to see your money map by service.")
        return BankIntelResponse(banks=[], suggestions=[], totals=BankIntelTotals(), notes=notes)
    if len(cards) == 1:
        notes.append("Only one service detected so far. Upload statements from your other banks / wallets to compare fees across them.")

    suggestions = _suggestions(cards)

    totals = BankIntelTotals(
        total_spend=round(sum(c.spend for c in cards), 2),
        total_inflow=round(sum(c.inflow for c in cards), 2),
        total_charges=round(sum(c.charges for c in cards), 2),
        total_txns=sum(c.txn_count for c in cards),
        bank_count=len(cards),
    )

    overall, llm_status = _llm_narrative(cards, suggestions)

    return BankIntelResponse(
        banks=cards,
        suggestions=suggestions,
        totals=totals,
        overall_summary=overall,
        llm_status=llm_status,
        notes=notes,
    )
