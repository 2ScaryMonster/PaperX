import re
from dataclasses import dataclass
from functools import lru_cache
import time
from typing import Callable

import requests
import yfinance as yf


FALLBACK_UNIVERSE = [
    "RELIANCE.NS",
    "TCS.NS",
    "INFY.NS",
    "ITC.NS",
    "HDFCBANK.NS",
    "ICICIBANK.NS",
    "SBIN.NS",
    "BHARTIARTL.NS",
    "LT.NS",
    "AXISBANK.NS",
    "KOTAKBANK.NS",
    "MARUTI.NS",
    "HINDUNILVR.NS",
    "BAJFINANCE.NS",
    "SUNPHARMA.NS",
    "DRREDDY.NS",
]

NSE_INDEXES = [
    "NIFTY 50",
    "NIFTY NEXT 50",
    "NIFTY MIDCAP 100",
    "NIFTY SMALLCAP 100",
    "NIFTY BANK",
    "NIFTY FINANCIAL SERVICES",
    "NIFTY IT",
    "NIFTY PHARMA",
    "NIFTY AUTO",
    "NIFTY FMCG",
    "NIFTY METAL",
]
MAX_DYNAMIC_UNIVERSE = 260
UNIVERSE_CACHE_TTL_SEC = 6 * 60 * 60
_UNIVERSE_CACHE = {"symbols": None, "ts": 0.0}

FIELD_ALIASES = {
    "market capitalization": "market_cap",
    "market cap": "market_cap",
    "current price": "current_price",
    "price to earning": "pe",
    "price to earnings": "pe",
    "p/e": "pe",
    "volume": "volume",
    "from 52w high": "from_52w_high",
    "from 52 week high": "from_52w_high",
    "dma 50": "dma50",
    "sector": "sector",
    "current price > dma 50": "current_gt_dma50",
}


@dataclass
class Row:
    symbol: str
    company: str
    sector: str | None
    current_price: float | None
    pe: float | None
    market_cap: float | None
    volume: float | None
    from_52w_high: float | None
    dma50: float | None

    def as_dict(self):
        return {
            "symbol": self.symbol,
            "company": self.company,
            "sector": self.sector,
            "current_price": self.current_price,
            "pe": self.pe,
            "market_cap": self.market_cap,
            "volume": self.volume,
            "from_52w_high": self.from_52w_high,
            "dma50": self.dma50,
        }


def _to_float(v):
    try:
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def _nse_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://www.nseindia.com/",
        }
    )
    return s


def _fetch_nse_index_symbols(index_name: str) -> list[str]:
    s = _nse_session()
    # Prime cookies
    try:
        s.get("https://www.nseindia.com/", timeout=8)
    except Exception:
        pass
    resp = s.get(
        "https://www.nseindia.com/api/equity-stockIndices",
        params={"index": index_name},
        timeout=12,
    )
    resp.raise_for_status()
    payload = resp.json() or {}
    out = []
    for row in payload.get("data", []):
        sym = (row.get("symbol") or "").strip().upper()
        if not sym:
            continue
        if sym.endswith(".NS"):
            out.append(sym)
        elif "." not in sym and "-" not in sym:
            out.append(f"{sym}.NS")
    return out


def get_dynamic_universe() -> list[str]:
    now = time.time()
    cached = _UNIVERSE_CACHE.get("symbols")
    ts = float(_UNIVERSE_CACHE.get("ts") or 0.0)
    if cached and (now - ts) < UNIVERSE_CACHE_TTL_SEC:
        return list(cached)

    symbols = []
    seen = set()
    try:
        for idx_name in NSE_INDEXES:
            for sym in _fetch_nse_index_symbols(idx_name):
                if sym in seen:
                    continue
                seen.add(sym)
                symbols.append(sym)
                if len(symbols) >= MAX_DYNAMIC_UNIVERSE:
                    break
            if len(symbols) >= MAX_DYNAMIC_UNIVERSE:
                break
    except Exception:
        symbols = []

    if not symbols:
        symbols = list(FALLBACK_UNIVERSE)

    _UNIVERSE_CACHE["symbols"] = list(symbols)
    _UNIVERSE_CACHE["ts"] = now
    return symbols


def _fetch_row(symbol: str):
    t = yf.Ticker(symbol)
    info = t.info or {}
    fast = getattr(t, "fast_info", None) or {}
    px = _to_float(fast.get("lastPrice")) or _to_float(info.get("currentPrice"))
    if px is None:
        hist = t.history(period="5d", interval="1d")
        if not hist.empty:
            px = _to_float(hist["Close"].iloc[-1])

    h52 = _to_float(info.get("fiftyTwoWeekHigh"))
    from_52 = None if (px is None or not h52) else round(px / h52, 4)

    dma50 = None
    hist_6m = t.history(period="6mo", interval="1d")
    if len(hist_6m.index) >= 50:
        dma50 = _to_float(hist_6m["Close"].tail(50).mean())

    return Row(
        symbol=symbol,
        company=info.get("shortName") or info.get("longName") or symbol,
        sector=info.get("sector"),
        current_price=px,
        pe=_to_float(info.get("trailingPE")),
        market_cap=_to_float(info.get("marketCap")),
        volume=_to_float(info.get("volume")) or _to_float(fast.get("lastVolume")),
        from_52w_high=from_52,
        dma50=dma50,
    )


@lru_cache(maxsize=1024)
def _fetch_row_cached(symbol: str):
    return _fetch_row(symbol)


def _compare(a: float | None, op: str, b: float):
    if a is None:
        return False
    if op == ">":
        return a > b
    if op == "<":
        return a < b
    if op == ">=":
        return a >= b
    if op == "<=":
        return a <= b
    if op == "=":
        return abs(a - b) < 1e-9
    return False


def _compare_text(a: str | None, op: str, b: str):
    if a is None:
        return False
    av = str(a).strip().lower()
    bv = str(b).strip().lower()
    if not bv:
        return False
    if op == "=":
        return av == bv
    if op == "contains":
        return bv in av
    return False


def _condition_from_line(line: str) -> Callable[[Row], bool] | None:
    normalized = " ".join(line.lower().strip().split())
    if not normalized:
        return None
    if normalized in {"and", "or"}:
        return None

    # Special case: current price > dma 50
    if "current price" in normalized and "dma 50" in normalized:
        m = re.search(r"current price\s*(>=|<=|>|<|=)\s*dma 50", normalized)
        if m:
            op = m.group(1)

            def f(row: Row):
                if row.current_price is None or row.dma50 is None:
                    return False
                return _compare(row.current_price, op, row.dma50)

            return f

    m = re.search(r"(.+?)\s*(>=|<=|>|<|=)\s*([0-9.]+)$", normalized)
    if m:
        lhs = m.group(1).strip()
        op = m.group(2)
        rhs = float(m.group(3))
        field = FIELD_ALIASES.get(lhs)
        if not field:
            return None

        def fn(row: Row):
            return _compare(getattr(row, field, None), op, rhs)

        return fn

    # Text conditions: Sector = Banking, Sector contains bank
    m_txt = re.search(r"(.+?)\s*(=|contains)\s*['\"]?(.+?)['\"]?$", normalized)
    if not m_txt:
        return None
    lhs = m_txt.group(1).strip()
    op = m_txt.group(2).strip()
    rhs_text = m_txt.group(3).strip()
    field = FIELD_ALIASES.get(lhs)
    if field != "sector":
        return None

    def fn_text(row: Row):
        return _compare_text(getattr(row, field, None), op, rhs_text)

    return fn_text


def run_screener(query_text: str):
    universe = get_dynamic_universe()
    parts = re.split(r"\n|AND|and", query_text or "")
    conditions = [c for c in (_condition_from_line(p) for p in parts) if c is not None]

    rows = []
    scanned = 0
    failures = 0
    for sym in universe:
        scanned += 1
        try:
            row = _fetch_row_cached(sym)
        except Exception:
            failures += 1
            continue
        if all(cond(row) for cond in conditions):
            rows.append(row.as_dict())
    return {
        "rows": rows,
        "meta": {
            "scanned": scanned,
            "total": len(universe),
            "failures": failures,
        },
    }


@lru_cache(maxsize=1)
def get_available_sectors():
    sectors = set()
    for sym in get_dynamic_universe():
        try:
            row = _fetch_row_cached(sym)
        except Exception:
            continue
        if row.sector:
            sectors.add(str(row.sector).strip())
    return sorted(sectors)
