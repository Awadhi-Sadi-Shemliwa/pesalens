"""PesaLens Market Bot — collects live financial data from Tanzanian and
international sources for the Markets page.

Sources:
- DSE: https://dse.co.tz/api/get/live/market/prices (JSON)
- Bank of Tanzania: https://www.bot.go.tz/ (HTML scrape, indicative rates)
- EWURA: https://www.ewura.go.tz/ (PDF cap prices, monthly)
- CoinGecko: free crypto prices
- Frankfurter / ExchangeRate-API: international FX
- Yahoo Finance / Alpha Vantage: S&P 500 + global indices
- Polymarket gamma API: prediction markets

Each fetcher is defensive — failures are logged but never raise. The
scheduler caches the last successful payload to disk, so users always
see *some* data even when an upstream source is down.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import settings
from app.utils.logger import get_logger

log = get_logger(__name__)

# A real-browser UA + Referer is required for DSE; many TZ government sites
# block "naked" Python clients with an empty UA.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_float(value: Any) -> float:
    """Parse strings like '2,540.50' or '+1.25%' into a float; never raises."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", "").replace("%", "").replace("+", "")
    if not s or s in {"-", "—", "N/A"}:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Tanzania: DSE live stock prices
# ---------------------------------------------------------------------------

DSE_URL = "https://dse.co.tz/api/get/live/market/prices"
DSE_DAILY_SUMMARY_URL = "https://dse.co.tz/api/get/trade/daily/summary"
DSE_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Referer": "https://dse.co.tz/",
    "Accept": "application/json, text/plain, */*",
}


async def fetch_dse_daily_summary(max_lookback_days: int = 7) -> dict:
    """Fetch the most recent populated DSE daily-summary payload.

    DSE publishes per-stock volume + turnover only after market close on
    trading days. Weekends and TZ public holidays return an empty payload,
    so we walk back up to `max_lookback_days` calendar days until we find
    a day with data.

    Returns ``{"as_of": "YYYY-MM-DD", "rows": [...]}`` or
    ``{"as_of": None, "rows": []}`` when no recent day had data.
    """
    from datetime import date, timedelta

    today = date.today()
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # First try without a date param — when the market has closed
        # for the day, this returns the latest summary directly.
        try:
            resp = await client.get(DSE_DAILY_SUMMARY_URL, headers=DSE_HEADERS)
            if resp.status_code == 200:
                payload = resp.json()
                if payload.get("success") and payload.get("data"):
                    return {"as_of": today.isoformat(), "rows": payload["data"]}
        except Exception as exc:  # noqa: BLE001
            log.debug("DSE daily summary (no-date) failed: %s", exc)

        for offset in range(1, max_lookback_days + 1):
            day = today - timedelta(days=offset)
            try:
                resp = await client.get(
                    DSE_DAILY_SUMMARY_URL,
                    params={"date": day.isoformat()},
                    headers=DSE_HEADERS,
                )
                if resp.status_code != 200:
                    continue
                payload = resp.json()
                if payload.get("success") and payload.get("data"):
                    return {"as_of": day.isoformat(), "rows": payload["data"]}
            except Exception as exc:  # noqa: BLE001
                log.debug("DSE daily summary for %s failed: %s", day, exc)
    return {"as_of": None, "rows": []}


def _extract_volume_row(item: dict) -> tuple[str, int, float]:
    """Normalise one daily-summary row → (symbol, volume, turnover)."""
    sym = (
        item.get("symbol")
        or item.get("ticker")
        or item.get("code")
        or item.get("security")
        or item.get("company")
        or ""
    )
    volume = int(_parse_float(
        item.get("volume")
        or item.get("totalVolume")
        or item.get("total_volume")
        or item.get("traded_volume")
        or item.get("tradedVolume")
        or item.get("shares")
        or 0
    ))
    turnover = _parse_float(
        item.get("turnover")
        or item.get("totalTurnover")
        or item.get("total_turnover")
        or item.get("value")
        or 0
    )
    return str(sym).upper().strip(), volume, round(turnover, 2)


async def fetch_dse_prices() -> list[dict]:
    """Fetch the DSE live ticker and merge volume from the daily summary."""
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(DSE_URL, headers=DSE_HEADERS)
        resp.raise_for_status()
        raw = resp.json()

    # The API returns either a list or an object with a "data" key — handle both.
    items = raw if isinstance(raw, list) else raw.get("data", []) or raw.get("prices", [])
    stocks = []
    for item in items:
        if not isinstance(item, dict):
            continue
        # DSE's live ticker returns {id, company, price, change} where
        # `company` is actually the ticker code (MBP, CRDB, NMB, ...).
        # We support a few alternative field names in case the schema shifts.
        symbol = (
            item.get("symbol")
            or item.get("ticker")
            or item.get("code")
            or item.get("company")
            or ""
        )
        name = (
            item.get("companyName")
            or item.get("name")
            or item.get("company_name")
            or DSE_FULL_NAMES.get(str(symbol).upper().strip(), str(symbol))
        )
        price = _parse_float(
            item.get("close")
            or item.get("price")
            or item.get("last")
            or item.get("currentPrice")
        )
        prev = _parse_float(item.get("previous") or item.get("prevClose"))
        change = _parse_float(item.get("change") or item.get("priceChange"))
        if not change and prev and price:
            change = price - prev
        change_pct = _parse_float(
            item.get("changePercent")
            or item.get("change_pct")
            or item.get("percentChange")
        )
        # DSE doesn't return % change — derive it from price/change.
        if not change_pct and price and change:
            previous = price - change
            change_pct = (change / previous) * 100 if previous else 0.0
        stocks.append({
            "symbol": str(symbol).upper().strip(),
            "name": str(name).strip() or str(symbol),
            "price": round(price, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "volume": int(_parse_float(item.get("volume") or 0)),
            "turnover": 0.0,
            "volume_as_of": None,
            "currency": "TZS",
            "source": "dse",
        })

    # Merge in volume + turnover from the latest populated daily summary.
    # The live ticker doesn't carry volume, so without this every stock
    # would render as "—" in the Most Active filter.
    try:
        summary = await fetch_dse_daily_summary()
    except Exception as exc:  # noqa: BLE001
        log.warning("DSE daily summary fetch failed: %s", exc)
        summary = {"as_of": None, "rows": []}

    if summary.get("rows"):
        as_of = summary.get("as_of")
        vol_by_sym: dict[str, int] = {}
        turn_by_sym: dict[str, float] = {}
        for row in summary["rows"]:
            if not isinstance(row, dict):
                continue
            sym, vol, turn = _extract_volume_row(row)
            if not sym:
                continue
            if vol:
                vol_by_sym[sym] = vol
            if turn:
                turn_by_sym[sym] = turn
        for s in stocks:
            sym = s["symbol"]
            if sym in vol_by_sym:
                s["volume"] = vol_by_sym[sym]
                s["turnover"] = turn_by_sym.get(sym, 0.0)
                s["volume_as_of"] = as_of

    return stocks


# Hand-curated DSE ticker -> friendly company name. Used only when the
# API doesn't include a long name (current /live endpoint returns only
# the ticker code in the `company` field).
DSE_FULL_NAMES = {
    "CRDB": "CRDB Bank",
    "NMB": "NMB Bank",
    "DSE": "Dar es Salaam Stock Exchange",
    "TBL": "Tanzania Breweries",
    "TCC": "Tanzania Cigarette Company",
    "TPCC": "Tanzania Portland Cement",
    "TOL": "TOL Gases",
    "MBP": "Mwalimu Commercial Bank",
    "DCB": "DCB Commercial Bank",
    "MKCB": "Mkombozi Commercial Bank",
    "MUCOBA": "Mufindi Community Bank",
    "MCB": "Maendeleo Bank",
    "NICO": "National Investments Company",
    "PAL": "Precision Air",
    "SWALA": "Swala Oil & Gas",
    "TICL": "Tanzania Insurance",
    "TTP": "Tanga Cement",
    "USL": "Uchumi Supermarkets",
    "VODA": "Vodacom Tanzania",
    "AIRTEL": "Airtel Tanzania",
    "JATU": "JATU PLC",
    "JHL": "Jubilee Holdings",
    "KA": "Kenya Airways",
    "EABL": "East African Breweries",
    "KCB": "KCB Group",
    "ACA": "Acacia Mining",
    "NMG": "Nation Media Group",
    "SCB": "Standard Chartered Bank",
    "CRJL": "Cross Rejuvenate Limited",
}


# ---------------------------------------------------------------------------
# Tanzania: Bank of Tanzania indicative exchange rates (HTML scrape)
# ---------------------------------------------------------------------------

BOT_URLS = [
    "https://www.bot.go.tz/",
    "https://www.bot.go.tz/ExchangeRate",
]
BOT_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


async def fetch_bot_rates() -> list[dict]:
    """Scrape BOT indicative exchange rates from the homepage table."""
    from bs4 import BeautifulSoup  # local import keeps optional dep optional

    html = ""
    for url in BOT_URLS:
        try:
            async with httpx.AsyncClient(timeout=30, verify=False, follow_redirects=True) as client:
                resp = await client.get(url, headers=BOT_HEADERS)
                if resp.status_code == 200 and resp.text:
                    html = resp.text
                    break
        except Exception as exc:  # noqa: BLE001
            log.warning("BOT fetch failed for %s: %s", url, exc)

    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")

    # The accordion id observed on bot.go.tz is "exRates"; fall back to
    # any table that has both "USD" and "buying" if the structure shifts.
    container = soup.find("div", id="exRates") or soup.find("div", id="collapseOne")
    table = None
    if container:
        table = container.find("table")
    if table is None:
        for t in soup.find_all("table"):
            text = t.get_text(" ", strip=True).lower()
            if "usd" in text and ("buying" in text or "selling" in text):
                table = t
                break
    if table is None:
        return []

    rates: list[dict] = []
    rows = table.find_all("tr")
    for row in rows[1:]:  # skip header
        cols = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
        if len(cols) < 3:
            continue
        currency = cols[0].upper()
        if not re.match(r"^[A-Z]{2,5}$", currency):
            # Sometimes the first column has both code and name; pull a 3-letter code.
            m = re.search(r"\b([A-Z]{3})\b", cols[0])
            if not m:
                continue
            currency = m.group(1)
        buying = _parse_float(cols[1])
        selling = _parse_float(cols[2])
        mean = round((buying + selling) / 2, 2) if buying and selling else (buying or selling)
        rates.append({
            "currency": currency,
            "buying": round(buying, 2),
            "selling": round(selling, 2),
            "mean": mean,
            "source": "bot",
        })
    return rates


# ---------------------------------------------------------------------------
# Tanzania: EWURA fuel cap prices (PDF scrape, monthly)
# ---------------------------------------------------------------------------

EWURA_LANDING_URLS = [
    "https://www.ewura.go.tz/petroleum-publications/",
    "https://www.ewura.go.tz/petroleum/",
    "https://www.ewura.go.tz/",
]


async def fetch_ewura_fuel_prices() -> dict:
    """Scrape EWURA's latest published cap-price PDF and extract Dar prices."""
    from bs4 import BeautifulSoup
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not installed", "source": "ewura"}

    pdf_link: str | None = None
    async with httpx.AsyncClient(timeout=45, verify=False, follow_redirects=True) as client:
        for url in EWURA_LANDING_URLS:
            try:
                resp = await client.get(url, headers=BOT_HEADERS)
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.text, "html.parser")
                # Look for any link that looks like a cap-price PDF.
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    label = a.get_text(" ", strip=True).lower()
                    if href.lower().endswith(".pdf") and (
                        "cap" in label or "indicative" in label or "petroleum" in label
                    ):
                        pdf_link = href
                        break
                if pdf_link:
                    break
            except Exception as exc:  # noqa: BLE001
                log.warning("EWURA landing fetch failed for %s: %s", url, exc)

        if not pdf_link:
            return {"error": "no_pdf_found", "source": "ewura"}

        if pdf_link.startswith("//"):
            pdf_link = "https:" + pdf_link
        elif pdf_link.startswith("/"):
            pdf_link = "https://www.ewura.go.tz" + pdf_link

        # Download into the storage directory so we can re-extract on demand.
        pdf_path = settings.storage_path / "market_cache" / "ewura_latest.pdf"
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            pdf_resp = await client.get(pdf_link, headers=BOT_HEADERS)
            pdf_resp.raise_for_status()
            pdf_path.write_bytes(pdf_resp.content)
        except Exception as exc:  # noqa: BLE001
            log.warning("EWURA pdf download failed: %s", exc)
            return {"error": f"download_failed: {exc}", "source": "ewura"}

    return _parse_ewura_pdf(pdf_path, pdf_link)


def _parse_ewura_pdf(pdf_path: Path, pdf_link: str) -> dict:
    """Pull the Dar es Salaam row out of an EWURA PDF table."""
    import pdfplumber  # local import

    prices = {
        "petrol": None,
        "diesel": None,
        "kerosene": None,
        "region": "Dar es Salaam",
        "source": "ewura",
        "pdf_url": pdf_link,
    }
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables() or []
                for table in tables:
                    for row in table:
                        if not row:
                            continue
                        joined = " ".join(str(c or "") for c in row)
                        if "dar" not in joined.lower() and "dsm" not in joined.lower():
                            continue
                        nums = [
                            float(n.replace(",", ""))
                            for n in re.findall(r"[\d,]+\.\d+", joined)
                        ]
                        # Prices usually look like 2,800.00 / 2,950.00 / 2,500.00
                        big = [n for n in nums if 500 < n < 10000]
                        if len(big) >= 2:
                            prices["petrol"] = big[0]
                            prices["diesel"] = big[1]
                            if len(big) >= 3:
                                prices["kerosene"] = big[2]
                            return prices
    except Exception as exc:  # noqa: BLE001
        log.warning("EWURA pdf parse failed: %s", exc)
        prices["error"] = str(exc)
    return prices


# ---------------------------------------------------------------------------
# International: CoinGecko crypto
# ---------------------------------------------------------------------------

COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
# USDT, USDC and DAI are deliberately included alongside the volatile
# coins. They are the dominant on/off ramps in Tanzanian P2P (Binance
# P2P, KuCoin, Yellow Card etc.) — leaving them out makes the simulator
# steer users away from the safest crypto rails and toward BTC/ETH
# as if those were the only options.
CRYPTO_NAME_MAP = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "tether": "USDT",
    "usd-coin": "USDC",
    "dai": "DAI",
    "solana": "SOL",
    "binancecoin": "BNB",
    "ripple": "XRP",
    "cardano": "ADA",
}


async def fetch_crypto() -> list[dict]:
    """Fetch top crypto prices in USD + TZS with 24h change.

    CoinGecko sometimes drops `vs_currencies=tzs` for free-tier requests,
    so when the TZS quote is missing we cross-multiply with the latest
    USD→TZS rate from Frankfurter (or fall back to the BOT cache).
    """
    params = {
        "ids": ",".join(CRYPTO_NAME_MAP.keys()),
        "vs_currencies": "usd,tzs",
        "include_24hr_change": "true",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(COINGECKO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    # Resolve a USD→TZS rate. Frankfurter doesn't carry TZS, so we use
    # open.er-api.com (free, no key, supports TZS).
    tzs_rate = await _usd_to_tzs()

    coins = []
    for coin_id, values in data.items():
        usd = _parse_float(values.get("usd"))
        tzs_direct = _parse_float(values.get("tzs"))
        tzs = tzs_direct if tzs_direct else round(usd * tzs_rate, 2) if tzs_rate else 0.0
        coins.append({
            "symbol": CRYPTO_NAME_MAP.get(coin_id, coin_id.upper()),
            "name": coin_id.title(),
            "price_usd": round(usd, 2),
            "price_tzs": round(tzs, 2),
            "change_pct": round(_parse_float(values.get("usd_24h_change")), 2),
            "source": "coingecko",
        })
    coins.sort(key=lambda c: c["price_usd"], reverse=True)
    return coins


# ---------------------------------------------------------------------------
# International: Forex (Frankfurter — free, no key, ECB-backed)
# ---------------------------------------------------------------------------

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
ER_API_URL = "https://open.er-api.com/v6/latest/USD"


async def _usd_to_tzs() -> float:
    """Fetch USD→TZS from open.er-api.com (Frankfurter does not carry TZS)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(ER_API_URL)
            if r.status_code == 200:
                return _parse_float(r.json().get("rates", {}).get("TZS"))
    except Exception as exc:  # noqa: BLE001
        log.debug("USD->TZS lookup failed: %s", exc)
    return 0.0


async def fetch_forex_global() -> list[dict]:
    """Pull USD-quoted rates for major currencies as a sanity check vs BOT.

    open.er-api.com is the primary because it carries TZS + KES; Frankfurter
    is the secondary for ECB-grade major-currency rates.
    """
    rates: dict[str, dict] = {}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(ER_API_URL)
            if r.status_code == 200:
                payload = r.json()
                for ccy in ["TZS", "KES", "UGX", "RWF", "ZAR", "EUR", "GBP", "JPY", "CNY", "INR"]:
                    val = payload.get("rates", {}).get(ccy)
                    if val is not None:
                        rates[ccy] = {
                            "currency": ccy,
                            "rate_usd": round(_parse_float(val), 4),
                            "source": "open.er-api",
                            "as_of": payload.get("time_last_update_utc"),
                        }
    except Exception as exc:  # noqa: BLE001
        log.warning("open.er-api fetch failed: %s", exc)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(FRANKFURTER_URL, params={"from": "USD", "to": "EUR,GBP,JPY,ZAR"})
            if resp.status_code == 200:
                data = resp.json()
                for ccy, rate in (data.get("rates") or {}).items():
                    if ccy not in rates:
                        rates[ccy] = {
                            "currency": ccy,
                            "rate_usd": round(_parse_float(rate), 4),
                            "source": "frankfurter",
                            "as_of": data.get("date"),
                        }
    except Exception as exc:  # noqa: BLE001
        log.warning("Frankfurter fetch failed: %s", exc)

    return list(rates.values())


# ---------------------------------------------------------------------------
# International: S&P 500 + headline indices via Yahoo Finance (no-key)
# ---------------------------------------------------------------------------

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
GLOBAL_TICKERS = ["^GSPC", "^DJI", "^IXIC", "^FTSE", "^N225"]
TICKER_LABELS = {
    "^GSPC": "S&P 500",
    "^DJI": "Dow Jones",
    "^IXIC": "NASDAQ",
    "^FTSE": "FTSE 100",
    "^N225": "Nikkei 225",
}


async def fetch_global_indices() -> list[dict]:
    """Fetch headline equity indices from Yahoo Finance's chart endpoint.

    /v7/quote now requires a cookie/crumb, but /v8/chart still works for
    public symbols with just a User-Agent. We hit each ticker in parallel.
    """
    headers = {"User-Agent": BROWSER_UA}
    out: list[dict] = []

    async def _one(client: httpx.AsyncClient, symbol: str) -> dict | None:
        try:
            url = YAHOO_CHART_URL.format(symbol=symbol)
            resp = await client.get(
                url, headers=headers,
                params={"range": "5d", "interval": "1d"},
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:  # noqa: BLE001
            log.warning("Yahoo chart fetch failed for %s: %s", symbol, exc)
            return None

        result = (payload.get("chart", {}).get("result") or [None])[0]
        if not result:
            return None
        meta = result.get("meta") or {}
        price = _parse_float(meta.get("regularMarketPrice"))
        prev = _parse_float(meta.get("chartPreviousClose") or meta.get("previousClose"))
        change = price - prev if (price and prev) else 0.0
        change_pct = (change / prev * 100) if prev else 0.0
        return {
            "symbol": symbol,
            "name": TICKER_LABELS.get(symbol, meta.get("symbol") or symbol),
            "price": round(price, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "currency": meta.get("currency", "USD"),
            "source": "yahoo",
        }

    import asyncio
    async with httpx.AsyncClient(timeout=15) as client:
        results = await asyncio.gather(
            *(_one(client, sym) for sym in GLOBAL_TICKERS),
            return_exceptions=False,
        )
    out = [r for r in results if r]
    return out


# ---------------------------------------------------------------------------
# Prediction markets: Polymarket gamma API
# ---------------------------------------------------------------------------

POLYMARKET_URL = "https://gamma-api.polymarket.com/markets"


async def fetch_polymarket() -> list[dict]:
    """Top active prediction markets ordered by 24h volume."""
    params = {
        "limit": 8,
        "active": "true",
        "closed": "false",
        "order": "volume24hr",
        "ascending": "false",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(POLYMARKET_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    markets = []
    iterable = data if isinstance(data, list) else data.get("data", [])
    for m in iterable:
        outcome_prices = m.get("outcomePrices") or m.get("outcome_prices") or []
        if isinstance(outcome_prices, str):
            try:
                import json
                outcome_prices = json.loads(outcome_prices)
            except Exception:  # noqa: BLE001
                outcome_prices = []
        yes_price = _parse_float(outcome_prices[0]) if outcome_prices else 0.0
        markets.append({
            "question": m.get("question") or m.get("title") or "",
            "yes_pct": round(yes_price * 100, 1) if yes_price <= 1 else round(yes_price, 1),
            "volume": round(_parse_float(m.get("volume24hr") or m.get("volume")), 0),
            "category": m.get("category") or "general",
            "ends_at": m.get("endDate") or m.get("end_date_iso"),
            "url": f"https://polymarket.com/event/{m.get('slug', '')}" if m.get("slug") else "",
            "source": "polymarket",
        })
    return markets
