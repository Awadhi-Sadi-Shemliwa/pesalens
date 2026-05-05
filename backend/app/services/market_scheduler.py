"""Background scheduler that refreshes the market cache on a schedule.

The cache is plain JSON files under storage/market_cache/. Each fetcher
writes its own file so that a failure in one source (e.g. EWURA PDF
parsing) does not invalidate the others. The /api/markets/* endpoints
serve directly from these cache files — no live scraping per request.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.services.market_bot import (
    fetch_bot_rates,
    fetch_crypto,
    fetch_dse_prices,
    fetch_ewura_fuel_prices,
    fetch_forex_global,
    fetch_global_indices,
    fetch_polymarket,
)
from app.utils.logger import get_logger

log = get_logger(__name__)

CACHE_DIR: Path = settings.storage_path / "market_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _save(name: str, data: Any) -> None:
    payload = {"data": data, "updated_at": _now_iso()}
    path = CACHE_DIR / f"{name}.json"
    path.write_text(json.dumps(payload, default=str, indent=2), encoding="utf-8")


def load_cache(name: str) -> dict | None:
    path = CACHE_DIR / f"{name}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        log.warning("Failed to read cache %s: %s", path.name, exc)
        return None


async def _safe_run(name: str, fn: Callable[[], Awaitable[Any]]) -> None:
    """Run a fetcher and persist its output; never raise."""
    try:
        data = await fn()
        _save(name, data)
        size = len(data) if hasattr(data, "__len__") else 1
        log.info("market: %s refreshed (%s items)", name, size)
    except Exception as exc:  # noqa: BLE001
        log.warning("market: %s refresh failed: %s", name, exc)


# Job wrappers — apscheduler needs a callable per id
async def refresh_dse() -> None:
    await _safe_run("dse", fetch_dse_prices)


async def refresh_bot() -> None:
    await _safe_run("forex_bot", fetch_bot_rates)


async def refresh_ewura() -> None:
    await _safe_run("fuel", fetch_ewura_fuel_prices)


async def refresh_crypto() -> None:
    await _safe_run("crypto", fetch_crypto)


async def refresh_forex_global() -> None:
    await _safe_run("forex_global", fetch_forex_global)


async def refresh_indices() -> None:
    await _safe_run("indices", fetch_global_indices)


async def refresh_polymarket() -> None:
    await _safe_run("polymarket", fetch_polymarket)


_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> AsyncIOScheduler:
    """Start the market scheduler. Idempotent — safe to call from lifespan."""
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        return _scheduler

    sched = AsyncIOScheduler(timezone="Africa/Dar_es_Salaam")

    # Cadence picked per the build guide: DSE intraday, BOT daily,
    # EWURA monthly, crypto fast, equity indices and predictions in between.
    sched.add_job(refresh_dse, "interval", minutes=10, id="dse", replace_existing=True)
    sched.add_job(refresh_bot, "interval", hours=12, id="bot", replace_existing=True)
    sched.add_job(refresh_ewura, "interval", hours=24, id="ewura", replace_existing=True)
    sched.add_job(refresh_crypto, "interval", minutes=5, id="crypto", replace_existing=True)
    sched.add_job(refresh_forex_global, "interval", hours=6, id="forex_global", replace_existing=True)
    sched.add_job(refresh_indices, "interval", minutes=30, id="indices", replace_existing=True)
    sched.add_job(refresh_polymarket, "interval", minutes=15, id="polymarket", replace_existing=True)

    sched.start()
    _scheduler = sched
    log.info("Market scheduler started (jobs=%d)", len(sched.get_jobs()))

    # Kick off a one-shot initial fetch so users don't see an empty page
    # on first boot. We fire-and-forget; failures are logged inside _safe_run.
    loop = asyncio.get_event_loop()
    for fn in (
        refresh_dse, refresh_bot, refresh_crypto,
        refresh_forex_global, refresh_indices, refresh_polymarket,
        # EWURA is heavy — skip on cold start to keep boot snappy
    ):
        loop.create_task(fn())

    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            pass
        _scheduler = None
