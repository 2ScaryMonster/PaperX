from decimal import Decimal

import yfinance as yf
from django.db import transaction
from portfolio.models import PortfolioPosition
from trades.models import Trade


_RANGE_MAP = {
    '1d': ('1d', '5m'),
    '5d': ('5d', '15m'),
    '1mo': ('1mo', '60m'),
    '6mo': ('6mo', '1d'),
    'ytd': ('ytd', '1d'),
    '1y': ('1y', '1d'),
    '5y': ('5y', '1wk'),
    'max': ('max', '1mo'),
}

_CRYPTO_BASES = {
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'DOT', 'MATIC', 'LTC', 'AVAX', 'SHIB', 'TRX'
}


def _candidate_symbols(symbol: str):
    raw = symbol.strip().upper()
    if not raw:
        return []
    if '.' in raw or '-' in raw:
        return [raw]

    candidates = []
    if raw in _CRYPTO_BASES:
        candidates.extend([f'{raw}-USD', raw])
    else:
        candidates.extend([f'{raw}.NS', f'{raw}.BO', raw, f'{raw}-USD'])
    # Preserve order while removing duplicates.
    seen = set()
    out = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _price_from_yfinance(symbol: str):
    ticker = yf.Ticker(symbol)
    history = ticker.history(period='1d', interval='1m')
    if not history.empty:
        latest = history['Close'].iloc[-1]
        return Decimal(str(round(float(latest), 2)))

    fast = getattr(ticker, 'fast_info', None)
    if fast and fast.get('lastPrice'):
        return Decimal(str(round(float(fast['lastPrice']), 2)))
    raise ValueError(f'No price data for {symbol}')


def resolve_symbol(symbol: str):
    for candidate in _candidate_symbols(symbol):
        try:
            _price_from_yfinance(candidate)
            return candidate
        except Exception:
            continue
    raise ValueError(f'No valid quote symbol found for {symbol}')


def get_live_price(symbol: str) -> Decimal:
    resolved = resolve_symbol(symbol)
    return _price_from_yfinance(resolved)


def get_quote_snapshot(symbol: str):
    resolved = resolve_symbol(symbol)
    ticker = yf.Ticker(resolved)
    ltp = float(_price_from_yfinance(resolved))

    prev_close = None
    try:
        fast = getattr(ticker, 'fast_info', None) or {}
        if fast.get('previousClose') is not None:
            prev_close = float(fast.get('previousClose'))
    except Exception:
        prev_close = None

    if prev_close is None:
        try:
            info = ticker.info or {}
            if info.get('previousClose') is not None:
                prev_close = float(info.get('previousClose'))
        except Exception:
            prev_close = None

    if prev_close is None:
        try:
            hist = ticker.history(period='2d', interval='1d')
            if len(hist.index) >= 2:
                prev_close = float(hist['Close'].iloc[-2])
            elif len(hist.index) == 1:
                prev_close = float(hist['Close'].iloc[-1])
        except Exception:
            prev_close = None

    change = None
    change_pct = None
    if prev_close not in (None, 0):
        change = round(ltp - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2)

    return {
        'symbol': resolved,
        'ltp': round(ltp, 2),
        'previous_close': None if prev_close is None else round(prev_close, 2),
        'change': change,
        'change_pct': change_pct,
    }


def get_price_series(symbol: str, range_key: str = '5d'):
    symbol = resolve_symbol(symbol)
    period, interval = _RANGE_MAP.get(range_key, _RANGE_MAP['5d'])
    ticker = yf.Ticker(symbol)
    df = ticker.history(period=period, interval=interval)
    if df.empty:
        raise ValueError(f'No chart data for {symbol}')

    df = df.reset_index()
    dt_col = 'Datetime' if 'Datetime' in df.columns else 'Date'
    labels = []
    prices = []

    for _, row in df.iterrows():
        ts = row[dt_col]
        close = row['Close']
        if close is None:
            continue
        labels.append(str(ts))
        prices.append(round(float(close), 2))

    if not prices:
        raise ValueError(f'No close series for {symbol}')

    first = prices[0]
    last = prices[-1]
    delta = round(last - first, 2)
    delta_pct = round((delta / first) * 100, 2) if first else 0.0

    return {
        'symbol': symbol,
        'range': range_key,
        'labels': labels,
        'prices': prices,
        'latest': last,
        'change': delta,
        'change_pct': delta_pct,
    }


@transaction.atomic
def execute_trade(user, payload):
    symbol = payload['symbol'].upper()
    exchange = payload['exchange']
    order_type = payload['order_type']
    action = payload['action']
    quantity = int(payload['quantity'])
    limit_price = payload.get('limit_price')
    stop_loss = payload.get('stop_loss')

    if '.' not in symbol and '-' not in symbol:
        if exchange == 'NSE':
            symbol = f'{symbol}.NS'
        elif exchange == 'BSE':
            symbol = f'{symbol}.BO'
        elif exchange == 'CRYPTO':
            symbol = f'{symbol}-USD'

    symbol = resolve_symbol(symbol)
    live_price = get_live_price(symbol)
    exec_price = live_price
    status = 'executed'

    if order_type == 'limit':
        if limit_price is None:
            raise ValueError('limit_price is required for limit orders.')
        limit_price = Decimal(str(limit_price))
        should_execute = (action == 'buy' and live_price <= limit_price) or (action == 'sell' and live_price >= limit_price)
        if not should_execute:
            status = 'pending'
            exec_price = limit_price

    position, _ = PortfolioPosition.objects.get_or_create(user=user, symbol=symbol)
    pnl = Decimal('0')

    if status == 'executed':
        total_value = Decimal(quantity) * exec_price
        if action == 'buy':
            if user.balance < total_value:
                raise ValueError('Insufficient virtual balance.')
            old_qty = position.quantity
            new_qty = old_qty + quantity
            weighted_cost = Decimal(old_qty) * position.avg_buy_price + total_value
            position.quantity = new_qty
            position.avg_buy_price = (weighted_cost / Decimal(new_qty)).quantize(Decimal('0.01'))
            user.balance -= total_value
        else:
            if position.quantity < quantity:
                raise ValueError('Not enough quantity in portfolio to sell.')
            pnl = (exec_price - position.avg_buy_price) * Decimal(quantity)
            position.quantity -= quantity
            user.balance += total_value
            if position.quantity == 0:
                position.avg_buy_price = Decimal('0')

        position.current_value = Decimal(position.quantity) * exec_price
        position.save()
        user.save(update_fields=['balance'])

    trade = Trade.objects.create(
        user=user,
        symbol=symbol,
        exchange=exchange,
        order_type=order_type,
        action=action,
        quantity=quantity,
        price=exec_price,
        limit_price=limit_price,
        stop_loss=stop_loss,
        status=status,
        pnl=pnl,
    )
    return trade, live_price
