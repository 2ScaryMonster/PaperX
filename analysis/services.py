import datetime as dt
import hashlib
import re
from decimal import Decimal
from functools import lru_cache
from typing import Callable, Dict, List, Tuple
from urllib.parse import quote

import numpy as np
import requests
import yfinance as yf
from bs4 import BeautifulSoup
from analysis.models import NewsSentiment, Prediction
from email.utils import parsedate_to_datetime
from trades.services import resolve_symbol

import feedparser


def fetch_ohlc(symbol: str, period='6mo', interval='1d'):
    df = yf.Ticker(symbol).history(period=period, interval=interval)
    if df.empty:
        raise ValueError('No chart data available.')
    df = df.reset_index()
    return df


def compute_indicators(df):
    close = df['Close']
    delta = close.diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    df['RSI'] = 100 - (100 / (1 + rs))
    df['SMA20'] = close.rolling(20).mean()
    df['EMA20'] = close.ewm(span=20, adjust=False).mean()
    std = close.rolling(20).std()
    df['BB_UPPER'] = df['SMA20'] + (2 * std)
    df['BB_LOWER'] = df['SMA20'] - (2 * std)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df['MACD'] = ema12 - ema26
    df['SIGNAL'] = df['MACD'].ewm(span=9, adjust=False).mean()
    return df


@lru_cache(maxsize=1)
def _load_finbert_pipeline():
    try:
        from transformers import pipeline

        return pipeline('sentiment-analysis', model='ProsusAI/finbert', tokenizer='ProsusAI/finbert')
    except Exception:
        return None


def _heuristic_sentiment(text: str) -> Tuple[str, float]:
    positive_words = ['surge', 'beats', 'growth', 'strong', 'gain', 'upgrade', 'profit', 'bullish']
    negative_words = ['falls', 'drop', 'misses', 'weak', 'downgrade', 'loss', 'bearish']
    lowered = text.lower()
    pos = sum(1 for w in positive_words if w in lowered)
    neg = sum(1 for w in negative_words if w in lowered)
    score = pos - neg
    if score > 0:
        return 'Positive', min(1.0, 0.55 + 0.1 * score)
    if score < 0:
        return 'Negative', max(-1.0, -0.55 + 0.1 * score)
    return 'Neutral', 0.0


def classify_financial_sentiment(headline: str) -> Tuple[str, float, str]:
    model = _load_finbert_pipeline()
    if model is None:
        label, score = _heuristic_sentiment(headline)
        return label, score, 'heuristic-fallback'

    result = model(headline[:512])[0]
    label_map = {
        'positive': 'Positive',
        'neutral': 'Neutral',
        'negative': 'Negative',
        'Positive': 'Positive',
        'Neutral': 'Neutral',
        'Negative': 'Negative',
    }
    label = label_map.get(result.get('label', 'Neutral'), 'Neutral')
    raw_score = float(result.get('score', 0.0))

    if label == 'Negative':
        score = -raw_score
    elif label == 'Neutral':
        score = 0.0
    else:
        score = raw_score

    return label, round(score, 4), 'ProsusAI/finbert'


def _extract_news_titles_from_yfinance(symbol: str, limit: int) -> List[str]:
    ticker = yf.Ticker(symbol)
    titles = []
    for item in (ticker.news or [])[: limit * 2]:
        title = item.get('title')
        if title and title not in titles:
            titles.append(title)
        if len(titles) >= limit:
            break
    return titles


NEWS_LOOKBACK_DAYS = 30
HTTP_HEADERS = {"User-Agent": "Mozilla/5.0"}
RSS_SOURCES: Dict[str, Callable[[str], List[dict]]] = {}


def _article_id(title: str, link: str) -> str:
    return hashlib.md5(f"{title}|{link}".encode("utf-8")).hexdigest()


def _clean_title(title: str) -> str:
    return re.sub(r"\s*[-|].*$", "", title).strip()


def _is_recent(published: str, days: int = NEWS_LOOKBACK_DAYS) -> bool:
    if not published:
        return True
    try:
        published_dt = parsedate_to_datetime(published)
        now = dt.datetime.now(published_dt.tzinfo)
        return published_dt >= now - dt.timedelta(days=days)
    except Exception:
        return True


def _fetch_google_news(query: str, max_items: int = 6) -> List[dict]:
    url = f"https://news.google.com/rss/search?q={quote(query)}+india&hl=en-IN&gl=IN&ceid=IN:en"
    feed = feedparser.parse(url)
    rows = []
    for item in feed.entries[: max_items * 2]:
        title = _clean_title(getattr(item, "title", ""))
        link = getattr(item, "link", "")
        published = getattr(item, "published", "")
        if not title or not _is_recent(published):
            continue
        rows.append({"title": title, "link": link, "published": published, "source": "Google News"})
        if len(rows) >= max_items:
            break
    return rows


def _query_tokens(query: str) -> List[str]:
    return [t for t in re.findall(r"[a-zA-Z]{3,}", (query or "").lower()) if t not in {"and", "the", "for", "with"}]


def _loosely_matches_query(text: str, query: str) -> bool:
    t = (text or "").lower()
    if not t:
        return False
    q = (query or "").lower().strip()
    if q and q in t:
        return True
    tokens = _query_tokens(query)
    if not tokens:
        return True
    hits = sum(1 for tok in tokens if tok in t)
    return hits >= 1


def _fetch_filtered_rss(url: str, source: str, query: str, max_items: int = 4) -> List[dict]:
    feed = feedparser.parse(url)
    rows = []
    for item in feed.entries:
        title = _clean_title(getattr(item, "title", ""))
        summary = getattr(item, "summary", "")
        text = f"{title} {summary}"
        if not _loosely_matches_query(text, query):
            continue
        published = getattr(item, "published", "")
        if not _is_recent(published):
            continue
        rows.append(
            {
                "title": title,
                "link": getattr(item, "link", ""),
                "published": published,
                "source": source,
            }
        )
        if len(rows) >= max_items:
            break
    return rows


def _fetch_recent_rss(url: str, source: str, max_items: int = 3) -> List[dict]:
    feed = feedparser.parse(url)
    rows = []
    for item in feed.entries:
        title = _clean_title(getattr(item, "title", ""))
        if not title:
            continue
        published = getattr(item, "published", "")
        if not _is_recent(published):
            continue
        rows.append(
            {
                "title": title,
                "link": getattr(item, "link", ""),
                "published": published,
                "source": source,
            }
        )
        if len(rows) >= max_items:
            break
    return rows


def _fetch_moneycontrol(query: str, max_items: int = 5) -> List[dict]:
    rows = []
    try:
        url = f"https://www.moneycontrol.com/news/news-all.php?search_q={quote(query)}"
        response = requests.get(url, headers=HTTP_HEADERS, timeout=12)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for node in soup.select("h2 a, h3 a"):
            title = _clean_title(node.get_text(" ", strip=True))
            link = node.get("href", "")
            if not title or len(title) < 8:
                continue
            if link and not link.startswith("http"):
                link = f"https://www.moneycontrol.com{link}"
            rows.append({"title": title, "link": link, "published": "", "source": "Moneycontrol"})
            if len(rows) >= max_items:
                break
    except Exception:
        return []
    return rows


RSS_SOURCES = {
    "Google News": lambda q: _fetch_google_news(q),
    "Economic Times": lambda q: _fetch_filtered_rss(
        "https://economictimes.indiatimes.com/rssfeedstopstories.cms",
        "Economic Times",
        q,
    ),
    "LiveMint": lambda q: _fetch_filtered_rss("https://www.livemint.com/rss/news", "LiveMint", q),
    "Reuters India": lambda q: _fetch_filtered_rss(
        "https://feeds.reuters.com/reuters/INbusinessNews",
        "Reuters India",
        q,
    ),
    "Moneycontrol": lambda q: _fetch_moneycontrol(q),
}


MAX_SENTIMENT_ARTICLES = 20


def _extract_news_titles_multi_source(symbol: str, limit: int) -> List[str]:
    base_term = symbol.split(".")[0].split("-")[0].strip()
    queries = [
        base_term,
        f"{base_term} earnings",
        f"{base_term} quarterly results",
        f"{base_term} dividend",
        f"{base_term} upgrade",
        f"{base_term} downgrade",
        f"{base_term} sector comparison",
    ]
    seen = set()
    items = []
    for query in queries:
        for fetch_fn in RSS_SOURCES.values():
            try:
                articles = fetch_fn(query)
            except Exception:
                continue
            for article in articles:
                uid = _article_id(article["title"], article.get("link", ""))
                if uid in seen:
                    continue
                seen.add(uid)
                items.append(article)
                if len(items) >= limit:
                    return [f"[{it['source']}] {it['title']}" for it in items]
    return [f"[{it['source']}] {it['title']}" for it in items]


def _extract_news_items_multi_source(symbol: str, limit: int, source: str = "all") -> List[dict]:
    base_term = symbol.split(".")[0].split("-")[0].strip()
    company_term = base_term
    try:
        info = yf.Ticker(symbol).info or {}
        cname = (info.get("shortName") or info.get("longName") or "").strip()
        if cname:
            company_term = cname
    except Exception:
        pass
    queries = [
        base_term,
        company_term,
        f"{base_term} earnings",
        f"{base_term} quarterly results",
        f"{base_term} dividend",
        f"{base_term} upgrade",
        f"{base_term} downgrade",
        f"{base_term} sector comparison",
    ]
    source_norm = (source or "all").strip().lower()
    selected_fetchers = []
    if source_norm in {"all", ""}:
        selected_fetchers = list(RSS_SOURCES.items())
    else:
        for name, fn in RSS_SOURCES.items():
            if name.lower() == source_norm:
                selected_fetchers = [(name, fn)]
                break

    seen = set()
    items: List[dict] = []

    for query in queries:
        for source_name, fetch_fn in selected_fetchers:
            try:
                articles = fetch_fn(query)
            except Exception:
                continue
            for article in articles:
                title = article.get("title", "").strip()
                if not title:
                    continue
                link = article.get("link", "")
                uid = _article_id(title, link)
                if uid in seen:
                    continue
                seen.add(uid)
                items.append(
                    {
                        "title": title,
                        "link": link,
                        "published": article.get("published", ""),
                        "source": article.get("source") or source_name,
                    }
                )
                if len(items) >= limit:
                    return items

    # If still low, pull recent headlines from broad RSS feeds (no strict symbol filter).
    if len(items) < limit and source_norm in {"all", ""}:
        broad_feeds = [
            ("Economic Times", "https://economictimes.indiatimes.com/rssfeedstopstories.cms"),
            ("LiveMint", "https://www.livemint.com/rss/news"),
            ("Reuters India", "https://feeds.reuters.com/reuters/INbusinessNews"),
        ]
        for feed_name, feed_url in broad_feeds:
            for article in _fetch_recent_rss(feed_url, feed_name, max_items=4):
                uid = _article_id(article["title"], article.get("link", ""))
                if uid in seen:
                    continue
                seen.add(uid)
                items.append(article)
                if len(items) >= limit:
                    return items

    # If user asked for "all" (or Yahoo only), include Yahoo Finance feed fallback.
    if source_norm in {"all", "yahoo finance", "yahoo", "yfinance"} and len(items) < limit:
        for title in _extract_news_titles_from_yfinance(symbol, limit=limit * 2):
            uid = _article_id(title, "")
            if uid in seen:
                continue
            seen.add(uid)
            items.append({"title": title, "link": "", "published": "", "source": "Yahoo Finance"})
            if len(items) >= limit:
                break

    return items[:limit]


def fetch_news_sentiment(symbol: str, limit=8):
    headlines = _extract_news_titles_multi_source(symbol, limit=limit)
    if not headlines:
        headlines = _extract_news_titles_from_yfinance(symbol, limit=limit)

    if not headlines:
        headlines = [f'No recent major headline available for {symbol}.']

    records = []
    model_used = 'heuristic-fallback'
    for title in headlines:
        label, score, model_name = classify_financial_sentiment(title)
        model_used = model_name
        rec = NewsSentiment.objects.create(
            symbol=symbol,
            headline=title[:400],
            sentiment_label=label,
            sentiment_score=score,
        )
        records.append(rec)

    avg_score = sum(r.sentiment_score for r in records) / len(records)
    overall = 'Positive' if avg_score > 0.1 else 'Negative' if avg_score < -0.1 else 'Neutral'
    return records, overall, avg_score, model_used


def fetch_news_sentiment_advanced(symbol: str, source: str = "all", limit: int = 8):
    safe_limit = min(max(int(limit or 1), 1), MAX_SENTIMENT_ARTICLES)
    source_label = (source or "all").strip() or "all"
    items = _extract_news_items_multi_source(symbol, limit=safe_limit, source=source_label)

    if not items:
        items = [{"title": f"No recent major headline available for {symbol}.", "source": "System", "link": "", "published": ""}]

    records = []
    model_used = 'heuristic-fallback'
    for item in items:
        headline = f"[{item.get('source', 'News')}] {item.get('title', '')}".strip()
        label, score, model_name = classify_financial_sentiment(headline)
        model_used = model_name
        rec = NewsSentiment.objects.create(
            symbol=symbol,
            headline=headline[:400],
            sentiment_label=label,
            sentiment_score=score,
        )
        records.append(rec)

    avg_score = sum(r.sentiment_score for r in records) / len(records)
    overall = 'Positive' if avg_score > 0.1 else 'Negative' if avg_score < -0.1 else 'Neutral'
    return records, overall, avg_score, model_used, safe_limit


def naive_predict(symbol: str, days=14):
    df = fetch_ohlc(symbol, period='3mo', interval='1d')
    closes = df['Close'].tail(10).to_numpy(dtype=float)
    trend = (closes[-1] - closes[0]) / max(1, len(closes) - 1)
    base = closes[-1]
    output = []

    for day in range(1, days + 1):
        pred = max(0.01, base + trend * day)
        pdate = dt.date.today() + dt.timedelta(days=day)
        obj = Prediction.objects.create(
            symbol=symbol,
            predicted_price=Decimal(str(round(pred, 2))),
            prediction_date=pdate,
            model_used='lstm-lite',
        )
        output.append(obj)
    return output


def fetch_fundamentals(symbol: str):
    resolved = resolve_symbol(symbol)
    ticker = yf.Ticker(resolved)
    info = ticker.info or {}

    hist_1d = ticker.history(period='1d', interval='1m')
    hist_1y = ticker.history(period='1y', interval='1d')

    price = None
    if not hist_1d.empty:
        price = round(float(hist_1d['Close'].iloc[-1]), 2)
    elif info.get('currentPrice') is not None:
        price = round(float(info.get('currentPrice')), 2)

    week52_high = info.get('fiftyTwoWeekHigh')
    week52_low = info.get('fiftyTwoWeekLow')
    if (week52_high is None or week52_low is None) and not hist_1y.empty:
        week52_high = float(hist_1y['High'].max())
        week52_low = float(hist_1y['Low'].min())

    dividend_yield = info.get('dividendYield')
    if dividend_yield is not None:
        dividend_yield = round(float(dividend_yield) * 100, 2)

    payload = {
        'symbol': resolved,
        'name': info.get('shortName') or info.get('longName') or resolved,
        'exchange': info.get('exchange') or info.get('fullExchangeName') or '',
        'currency': info.get('currency') or 'INR',
        'price': price,
        'open': info.get('open'),
        'previous_close': info.get('previousClose'),
        'day_high': info.get('dayHigh'),
        'day_low': info.get('dayLow'),
        'volume': info.get('volume'),
        'avg_volume': info.get('averageVolume'),
        'market_cap': info.get('marketCap'),
        'pe_ratio': info.get('trailingPE'),
        'eps': info.get('trailingEps'),
        'beta': info.get('beta'),
        'dividend_yield': dividend_yield,
        'week52_high': week52_high,
        'week52_low': week52_low,
        'sector': info.get('sector'),
        'industry': info.get('industry'),
    }
    # Ensure key display fields are never empty.
    if payload['price'] is None and payload.get('previous_close') is not None:
        payload['price'] = payload.get('previous_close')
    if not payload.get('exchange'):
        if resolved.endswith('.NS'):
            payload['exchange'] = 'NSE'
        elif resolved.endswith('.BO'):
            payload['exchange'] = 'BSE'
        elif resolved.endswith('-USD'):
            payload['exchange'] = 'CRYPTO'
    return payload
