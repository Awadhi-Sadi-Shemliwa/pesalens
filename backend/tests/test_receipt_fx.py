"""Currency handling for receipts — the one place a 2,600x error can hide.

    backend/venv/Scripts/python.exe backend/tests/test_receipt_fx.py

A Tanzanian user's receipts are mostly TZS, but a USD hotel or airline slip
turns up often enough that reading its printed "140" as TZS 140 (rather than
~TZS 373,000) quietly corrupts every total that receipt touches. Covered here:

1. **One definition of a receipt's value.** `fx.receipt_amount_tzs` is what
   every aggregate must use — bookkeeping, the TRA roll-up, vendor analytics,
   the spend gallery. A caller writing `amount_tzs or total` reintroduces the
   bug, so the shared helper has to be correct on its own.
2. **No re-conversion.** The helper runs on receipts that were already
   stamped; converting a second time would multiply by the rate again.
3. **Termination.** `_needs_fx` and `_apply_fx` are a loop: the heal calls
   apply and re-checks needs. A receipt that apply cannot improve must stop
   asking, or every listing rewrites it to disk forever.

These run offline: the rate cache is stubbed, so nothing here touches the
network or depends on a live rate.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import fx  # noqa: E402

_failures: list[str] = []


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


# A fixed rate so the assertions are exact and offline.
_RATE = 2600.0


def _stub_rates(monkeypatched: dict) -> None:
    """Force both cache readers to a known rate table; no network either way."""
    monkeypatched["scheduler"] = fx._rates_from_scheduler_cache
    monkeypatched["spot"] = fx._rates_from_spot_cache
    monkeypatched["fetch"] = fx._fetch_spot_rates
    fx._rates_from_scheduler_cache = lambda max_age=None: ({"TZS": _RATE}, "stub")
    fx._rates_from_spot_cache = lambda max_age=None: ({"TZS": _RATE}, "stub")

    def _no_network():
        raise AssertionError("FX fetch must not run in these tests")

    fx._fetch_spot_rates = _no_network


def _restore(monkeypatched: dict) -> None:
    fx._rates_from_scheduler_cache = monkeypatched["scheduler"]
    fx._rates_from_spot_cache = monkeypatched["spot"]
    fx._fetch_spot_rates = monkeypatched["fetch"]


def _no_rates(monkeypatched: dict) -> None:
    """Simulate an empty cache — every lookup misses."""
    fx._rates_from_scheduler_cache = lambda max_age=None: None
    fx._rates_from_spot_cache = lambda max_age=None: None


# ------------------------------------------------------------------ valuation

def test_receipt_amount_tzs() -> None:
    print("receipt_amount_tzs")
    saved = {}
    _stub_rates(saved)
    try:
        _assert_amounts()
    finally:
        _restore(saved)


def _assert_amounts() -> None:
    # TZS receipt: the printed total, untouched.
    check("TZS receipt", fx.receipt_amount_tzs({"currency": "TZS", "total": 1000}), 1000.0)

    # Foreign receipt with no stamp: converted, NOT read as TZS. This is the
    # whole point — 140 must never land in a total as 140.
    check("USD converted",
          fx.receipt_amount_tzs({"id": "a", "currency": "USD", "total": 140}),
          round(140 * _RATE, 2))

    # Already stamped: use the stamp, never convert again.
    check("stamped wins",
          fx.receipt_amount_tzs({"currency": "USD", "total": 140,
                                 "amount_tzs": 373000}), 373000.0)

    # `original_amount` is the printed figure once conversion has run; the
    # helper must not treat the converted amount as if it were printed.
    check("no double conversion",
          fx.receipt_amount_tzs({"currency": "USD", "original_amount": 140,
                                 "amount_tzs": 364000}), 364000.0)

    # And re-running the whole stamp on an already-stamped receipt must be a
    # no-op, not another multiplication — the heal path re-visits receipts.
    from app.routers.receipts import _apply_fx
    twice = {"id": "b", "currency": "USD", "total": 140}
    _apply_fx(twice)
    once = dict(twice)
    _apply_fx(twice)
    check("apply is idempotent", twice["amount_tzs"], once["amount_tzs"])

    # Nothing readable: zero, not a crash.
    check("unreadable total", fx.receipt_amount_tzs({"currency": "USD", "total": 0}), 0.0)

    # Falls back through the amount chain for TZS receipts.
    check("items fallback",
          fx.receipt_amount_tzs({"currency": "TZS", "items": [
              {"unit_price": 250, "quantity": 2}, {"line_total": 500}]}), 1000.0)

    # A LITERAL zero total (no total line on the page) must not stop the walk:
    # the first POSITIVE candidate wins, so subtotal / summed items still
    # value the receipt. This pins the contract the JS receiptAmountTZS
    # mirrors — a `total ?? amount` there only falls through on null, so it
    # read this receipt as worth nothing, and a legacy TZS receipt never gets
    # a stamped amount_tzs to rescue it (_needs_fx is False for TZS).
    check("zero total falls through to subtotal",
          fx.receipt_amount_tzs({"currency": "TZS", "total": 0, "subtotal": 8400}),
          8400.0)
    check("zero total falls through to items",
          fx.receipt_amount_tzs({"currency": "TZS", "total": 0, "items": [
              {"line_total": 300}]}), 300.0)


def test_no_cached_rate_excludes_rather_than_guesses() -> None:
    """With no rate available, a foreign receipt is worth 0 — never its digits.

    Under-counting a receipt we cannot value is recoverable and visible in the
    logs; booking 140 USD as TZS 140 is a silent 2,600x error in the user's
    totals.
    """
    print("no cached rate")
    saved = {}
    _stub_rates(saved)
    try:
        _no_rates(saved)
        check("foreign excluded",
              fx.receipt_amount_tzs({"id": "a", "currency": "USD", "total": 140}), 0.0)
        # A TZS receipt needs no rate at all and must be unaffected.
        check("TZS unaffected",
              fx.receipt_amount_tzs({"currency": "TZS", "total": 1000}), 1000.0)
        check("cached_rate_to_tzs misses", fx.cached_rate_to_tzs("USD"), None)
        check("TZS rate is identity", fx.cached_rate_to_tzs("TZS"), 1.0)
    finally:
        _restore(saved)


# ----------------------------------------------------------------- the loop

def test_fx_heal_terminates() -> None:
    """`_needs_fx` must stop asking for work `_apply_fx` cannot do.

    The heal is a loop: list_receipts asks _needs_fx, calls _apply_fx, and
    persists. A receipt whose total is unreadable (0) gets amount_tzs=0 and no
    fx_pending — so if _needs_fx still says True, every single listing rewrites
    that file to disk, forever.
    """
    print("heal loop terminates")
    from app.routers.receipts import _apply_fx, _needs_fx

    saved = {}
    _stub_rates(saved)
    try:
        stuck = {"id": "abc", "currency": "USD", "total": 0}
        _apply_fx(stuck)
        check("apply leaves nothing pending", stuck.get("fx_pending"), None)
        check("zero-total stops asking", _needs_fx(stuck), False)

        # The cases that genuinely do need work still say so.
        check("real USD asks", _needs_fx({"id": "x", "currency": "USD", "total": 140}), True)
        check("pending asks",
              _needs_fx({"id": "x", "currency": "USD", "total": 140,
                         "fx_pending": True}), True)
        check("converted stops",
              _needs_fx({"id": "x", "currency": "USD", "total": 140,
                         "amount_tzs": 364000}), False)
        check("TZS never asks", _needs_fx({"id": "x", "currency": "TZS", "total": 1000}), False)

        # And one full pass through apply settles a real receipt for good.
        real = {"id": "d", "currency": "USD", "total": 140}
        _apply_fx(real)
        check("apply converts", real["amount_tzs"], round(140 * _RATE, 2))
        check("apply keeps the printed figure", real["original_amount"], 140.0)
        check("settled receipt stops asking", _needs_fx(real), False)
    finally:
        _restore(saved)


# --------------------------------------------------------------- the caches

def test_stale_scheduler_cache_still_values() -> None:
    """A read path takes yesterday's rate over no rate at all.

    `cached_rate_to_tzs` is cache-only by contract, and every receipt aggregate
    depends on it. When it rejected a forex_global cache older than 12h, a
    deploy whose scheduler had been down since yesterday — and where nobody had
    yet scanned a foreign receipt, the only thing that writes fx_spot.json —
    valued every USD receipt at 0 in the business P&L and the TRA roll-up.
    Yesterday's rate is off by a fraction of a percent; a zero is off by
    everything.
    """
    print("stale scheduler cache")
    from datetime import datetime, timedelta, timezone

    from app.services import market_scheduler

    saved_load = market_scheduler.load_cache
    saved_spot = fx._rates_from_spot_cache
    old = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
    market_scheduler.load_cache = lambda name: {
        "updated_at": old,
        "data": [{"currency": "TZS", "rate_usd": _RATE}],
    }
    fx._rates_from_spot_cache = lambda max_age=None: None  # no spot file at all
    try:
        check("scan path still rejects a stale cache",
              fx._rates_from_scheduler_cache(), None)
        check("read path accepts it", fx.cached_rate_to_tzs("USD"), _RATE)
        check("receipt is valued, not zeroed",
              fx.receipt_amount_tzs({"id": "a", "currency": "USD", "total": 140}),
              round(140 * _RATE, 2))
    finally:
        market_scheduler.load_cache = saved_load
        fx._rates_from_spot_cache = saved_spot


def test_failed_fetch_is_not_retried_immediately() -> None:
    """One failed fetch per cooldown window, not one per waiting receipt.

    `_fetch_lock` is held across a synchronous 10s httpx call and a FAILED
    fetch writes nothing, so without a recorded failure every thread queued
    behind the lock ran its own 10s fetch in turn. Scanning eight USD receipts
    during a provider outage became 80s of serialized blocking inside the same
    threadpool that serves the scan endpoint and the gallery.
    """
    print("failed fetch cools off")
    saved_sched = fx._rates_from_scheduler_cache
    saved_spot = fx._rates_from_spot_cache
    saved_fetch = fx._fetch_spot_rates
    saved_failure_at = fx._last_fetch_failure_at
    calls = {"n": 0}

    def _failing_fetch():
        calls["n"] += 1
        return None

    fx._rates_from_scheduler_cache = lambda max_age=None: None
    fx._rates_from_spot_cache = lambda max_age=None: None
    fx._fetch_spot_rates = _failing_fetch
    fx._last_fetch_failure_at = 0.0
    try:
        for _ in range(8):
            fx.get_rate_to_tzs("USD")
        check("outage costs one fetch, not eight", calls["n"], 1)
        check("failure was recorded", fx._last_fetch_failure_at > 0, True)

        # And the cooldown must expire rather than latch off forever.
        fx._last_fetch_failure_at = 0.0
        fx.get_rate_to_tzs("USD")
        check("retries once the window elapses", calls["n"], 2)
    finally:
        fx._rates_from_scheduler_cache = saved_sched
        fx._rates_from_spot_cache = saved_spot
        fx._fetch_spot_rates = saved_fetch
        fx._last_fetch_failure_at = saved_failure_at


def test_receipt_write_is_atomic() -> None:
    """A torn receipt JSON is permanent data loss, so writes must be atomic.

    `_heal_fx` runs off a GET, so two clients refreshing the gallery together
    can rewrite the same file at the same time. `_load_receipts` skips
    unparseable JSON with a log line, which means a half-written file does not
    surface as an error — the receipt simply disappears from the gallery and
    every aggregate, for good.
    """
    print("receipt writes are atomic")
    import json
    import tempfile

    from app.routers.receipts import _write_receipt_json

    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "abc123.json"
        _write_receipt_json(target, {"id": "abc123", "total": 140})
        check("target parses", json.loads(target.read_text(encoding="utf-8"))["total"], 140)

        # Overwriting must not leave the reader a truncated file, and must not
        # leave a temp behind for the `*.json` glob to trip over.
        _write_receipt_json(target, {"id": "abc123", "total": 900})
        check("overwrite lands", json.loads(target.read_text(encoding="utf-8"))["total"], 900)
        check("no temp files left", sorted(p.name for p in Path(tmp).iterdir()), ["abc123.json"])

        # A serialization failure must leave the PREVIOUS content intact rather
        # than a zero-byte file where the receipt used to be.
        class _Unserializable:
            def __repr__(self):
                raise ValueError("boom")

        try:
            _write_receipt_json(target, {"id": "abc123", "bad": _Unserializable()})
        except Exception:  # noqa: BLE001 — the raise is the contract
            pass
        check("previous content survives a failed write",
              json.loads(target.read_text(encoding="utf-8"))["total"], 900)
        check("still no temp files", sorted(p.name for p in Path(tmp).iterdir()), ["abc123.json"])


def main() -> int:
    for fn in (
        test_receipt_amount_tzs,
        test_no_cached_rate_excludes_rather_than_guesses,
        test_fx_heal_terminates,
        test_stale_scheduler_cache_still_values,
        test_failed_fetch_is_not_retried_immediately,
        test_receipt_write_is_atomic,
    ):
        fn()
    print()
    if _failures:
        print(f"{len(_failures)} FAILURE(S):")
        for f in _failures:
            print("  -", f)
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
