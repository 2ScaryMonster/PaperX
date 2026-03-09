from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
import re

import pandas as pd
import yfinance as yf
from django.db.models import Sum
from django.utils import timezone

from papertrading.screener import get_dynamic_universe
from portfolio.models import PortfolioPosition
from trades.assistant import ai_decide_from_strategy
from trades.models import Trade, TradingBotConfig, TradingBotLog
from trades.services import execute_trade, resolve_symbol


MAX_BOT_SYMBOLS = 20
AUTO_PICK_SCAN_LIMIT = 140


def _bot_log(user, level: str, message: str, symbol: str = '', action: str = ''):
    TradingBotLog.objects.create(
        user=user,
        level=level,
        message=message[:1000],
        symbol=(symbol or '')[:24],
        action=(action or '')[:8],
    )


def get_or_create_bot_config(user):
    cfg, _ = TradingBotConfig.objects.get_or_create(user=user)
    return cfg


def parse_symbols(text: str):
    raw = text or ''
    parts = [p.strip().upper() for p in raw.replace('\n', ',').split(',')]
    out = []
    seen = set()
    for p in parts:
        if not p:
            continue
        try:
            resolved = resolve_symbol(p)
        except Exception:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        out.append(resolved)
        if len(out) >= MAX_BOT_SYMBOLS:
            break
    return out


def _extract_prompt_symbols(prompt_text: str):
    raw = prompt_text or ''
    found = re.findall(r"\b([A-Za-z0-9][A-Za-z0-9\-]{0,18}\.(?:NS|BO))\b", raw, flags=re.IGNORECASE)
    out = []
    seen = set()
    for sym in found:
        up = sym.upper()
        if up in seen:
            continue
        seen.add(up)
        out.append(up)
    return out


def _exchange_of(symbol: str):
    s = (symbol or '').upper()
    if s.endswith('.BO'):
        return 'BSE'
    if s.endswith('-USD'):
        return 'CRYPTO'
    return 'NSE'


def _ema_signal(symbol: str):
    ticker = yf.Ticker(symbol)
    df = ticker.history(period='7d', interval='15m')
    if df.empty or len(df.index) < 25:
        raise ValueError('Not enough candles for EMA strategy.')
    close = df['Close'].dropna()
    if len(close.index) < 25:
        raise ValueError('Not enough close points.')
    ema20 = close.ewm(span=20, adjust=False).mean().iloc[-1]
    latest = float(close.iloc[-1])
    if latest > float(ema20):
        return 'buy', latest, float(ema20)
    if latest < float(ema20):
        return 'sell', latest, float(ema20)
    return 'hold', latest, float(ema20)


def _compute_rsi(close: pd.Series, period: int = 14):
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


def _trend_pullback_decision(symbol: str):
    ticker = yf.Ticker(symbol)
    df = ticker.history(period='2y', interval='1d')
    if df.empty or len(df.index) < 240:
        return {'decision': 'REJECT', 'reason': 'Not enough daily candles.'}

    df = df.dropna(subset=['Open', 'High', 'Low', 'Close', 'Volume']).copy()
    close = df['Close']
    open_ = df['Open']
    high = df['High']
    low = df['Low']
    volume = df['Volume']

    dma20 = close.rolling(20).mean().iloc[-1]
    dma50 = close.rolling(50).mean().iloc[-1]
    dma200 = close.rolling(200).mean().iloc[-1]
    last_close = float(close.iloc[-1])
    prev_close = float(close.iloc[-2])
    rsi = float(_compute_rsi(close, 14).iloc[-1])

    # 1) Market filter
    try:
        idx_df = yf.Ticker('^NSEI').history(period='2y', interval='1d').dropna(subset=['Close'])
        idx_close = float(idx_df['Close'].iloc[-1])
        idx_dma200 = float(idx_df['Close'].rolling(200).mean().iloc[-1])
    except Exception:
        idx_close, idx_dma200 = None, None

    if idx_close is None or idx_dma200 is None or idx_close <= idx_dma200:
        return {
            'decision': 'REJECT',
            'reason': 'Index filter failed: NIFTY below 200 DMA.',
            'metrics': {'index_close': idx_close, 'index_dma200': idx_dma200},
        }
    if last_close <= float(dma200):
        return {
            'decision': 'REJECT',
            'reason': 'Stock filter failed: price below 200 DMA.',
            'metrics': {'close': last_close, 'dma200': float(dma200)},
        }

    # 2) Trend confirmation
    if not (float(dma20) > float(dma50) > float(dma200)):
        return {
            'decision': 'REJECT',
            'reason': 'Trend failed: 20 DMA > 50 DMA > 200 DMA not satisfied.',
            'metrics': {'dma20': float(dma20), 'dma50': float(dma50), 'dma200': float(dma200)},
        }

    # 3) Pullback condition
    support = float(low.iloc[-15:-1].min()) if len(low.iloc[-15:-1]) else float(low.iloc[-2])
    near_dma20 = abs(last_close - float(dma20)) / max(float(dma20), 1e-9) <= 0.025
    near_support = abs(last_close - support) / max(support, 1e-9) <= 0.02
    body_pct = ((open_ - close).abs() / close.replace(0, pd.NA)).fillna(0)
    controlled = float(body_pct.iloc[-5:].mean()) <= 0.018

    if not ((near_dma20 or near_support) and controlled):
        return {
            'decision': 'WAIT',
            'reason': 'Pullback not near support/20DMA or candles not controlled.',
            'metrics': {'close': last_close, 'dma20': float(dma20), 'support': support},
        }

    # 4) RSI condition
    if not (40 <= rsi <= 55):
        return {
            'decision': 'WAIT',
            'reason': 'RSI outside 40-55 range.',
            'metrics': {'rsi': rsi},
        }

    # 5) Entry trigger
    o1, c1, h1 = float(open_.iloc[-1]), float(close.iloc[-1]), float(high.iloc[-1])
    o0, c0, h0 = float(open_.iloc[-2]), float(close.iloc[-2]), float(high.iloc[-2])
    avg_body = float((open_ - close).abs().iloc[-8:-1].mean() or 0)
    curr_body = abs(c1 - o1)
    bullish_engulfing = (c1 > o1) and (c0 < o0) and (c1 >= o0) and (o1 <= c0)
    strong_green = (c1 > o1) and (curr_body >= max(avg_body * 1.2, 0.0001))
    break_prev_high = c1 > h0
    if not (bullish_engulfing or strong_green or break_prev_high):
        return {
            'decision': 'WAIT',
            'reason': 'No bullish confirmation candle trigger.',
            'metrics': {'close': c1, 'prev_high': h0},
        }

    # 6) Stop loss and risk
    pullback_low = float(low.iloc[-5:-1].min()) if len(low.iloc[-5:-1]) else float(low.iloc[-2])
    stop = min(pullback_low, float(dma20))
    stop = float(stop) * 0.998
    entry = max(h1, c1)
    if stop >= entry:
        return {'decision': 'REJECT', 'reason': 'Invalid stop placement.'}
    risk_pct = ((entry - stop) / entry) * 100.0
    if risk_pct > 3.0:
        return {
            'decision': 'REJECT',
            'reason': 'Risk exceeds 3% rule.',
            'metrics': {'entry': entry, 'stop': stop, 'risk_pct': risk_pct},
        }

    # 7) Target (minimum 1:2 RR)
    target = entry + (2 * (entry - stop))
    rr = (target - entry) / (entry - stop) if entry > stop else 0
    if rr < 2:
        return {'decision': 'REJECT', 'reason': 'Could not satisfy minimum 1:2 risk-reward.'}

    return {
        'decision': 'BUY',
        'reason': 'Trend Pullback conditions satisfied.',
        'entry': entry,
        'stop': stop,
        'target': target,
        'risk_pct': risk_pct,
        'metrics': {
            'close': last_close,
            'dma20': float(dma20),
            'dma50': float(dma50),
            'dma200': float(dma200),
            'rsi': rsi,
            'support': support,
        },
    }


def _market_snapshot(symbol: str):
    ticker = yf.Ticker(symbol)
    df = ticker.history(period='2y', interval='1d')
    if df.empty or len(df.index) < 220:
        raise ValueError('Not enough candles for snapshot.')
    df = df.dropna(subset=['Open', 'High', 'Low', 'Close', 'Volume']).copy()
    close = df['Close']
    high = df['High']
    low = df['Low']
    vol = df['Volume']
    dma20 = float(close.rolling(20).mean().iloc[-1])
    dma50 = float(close.rolling(50).mean().iloc[-1])
    dma200 = float(close.rolling(200).mean().iloc[-1])
    rsi = float(_compute_rsi(close, 14).iloc[-1])
    avg_vol_20 = float(vol.rolling(20).mean().iloc[-1])
    prev_10_high = float(high.iloc[-11:-1].max())
    prev_10_low = float(low.iloc[-11:-1].min())
    out = {
        'close': float(close.iloc[-1]),
        'prev_close': float(close.iloc[-2]),
        'open': float(df['Open'].iloc[-1]),
        'high': float(high.iloc[-1]),
        'low': float(low.iloc[-1]),
        'volume': float(vol.iloc[-1]),
        'avg_volume_20': avg_vol_20,
        'dma20': dma20,
        'dma50': dma50,
        'dma200': dma200,
        'rsi14': rsi,
        'recent_10d_high': prev_10_high,
        'recent_10d_low': prev_10_low,
    }
    try:
        idx = yf.Ticker('^NSEI').history(period='2y', interval='1d').dropna(subset=['Close'])
        out['index_close'] = float(idx['Close'].iloc[-1])
        out['index_dma50'] = float(idx['Close'].rolling(50).mean().iloc[-1])
        out['index_dma200'] = float(idx['Close'].rolling(200).mean().iloc[-1])
    except Exception:
        out['index_close'] = None
        out['index_dma50'] = None
        out['index_dma200'] = None
    return out


def _auto_pick_ai_symbols(prompt_text: str):
    universe = get_dynamic_universe() or []
    scored = []
    scanned = 0
    for sym in universe:
        if scanned >= AUTO_PICK_SCAN_LIMIT:
            break
        scanned += 1
        try:
            snap = _market_snapshot(sym)
        except Exception:
            continue
        close = float(snap.get('close') or 0)
        dma50 = float(snap.get('dma50') or 0)
        avg_vol = float(snap.get('avg_volume_20') or 0)
        if close <= 0 or dma50 <= 0:
            continue
        # Lightweight ranking before expensive LLM decision.
        trend_score = (close - dma50) / dma50
        liquidity_score = min(avg_vol / 1_000_000.0, 5.0)
        score = trend_score * 100 + liquidity_score
        scored.append((score, sym))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [sym for _, sym in scored[:MAX_BOT_SYMBOLS]]


def _today_realized_pnl(user):
    now = timezone.localtime()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    agg = Trade.objects.filter(
        user=user,
        status='executed',
        timestamp__gte=start,
        timestamp__lt=end,
    ).aggregate(total=Sum('pnl'))
    return agg.get('total') or Decimal('0')


@dataclass
class BotCycleResult:
    ran: bool
    message: str
    executed: int = 0
    skipped: int = 0


def run_bot_cycle(user) -> BotCycleResult:
    cfg = get_or_create_bot_config(user)
    if not cfg.is_enabled:
        return BotCycleResult(False, 'Bot is stopped.')

    symbols = parse_symbols(cfg.symbols)
    if cfg.strategy == 'ai_custom' and not symbols:
        prompt_text = (cfg.strategy_prompt or '').strip()
        prompt_symbols_raw = _extract_prompt_symbols(prompt_text)
        prompt_symbols = parse_symbols(",".join(prompt_symbols_raw))
        if prompt_symbols_raw:
            # Prompt explicitly specified symbols, so do not auto-pick if they are invalid/unresolved.
            symbols = prompt_symbols
            if symbols:
                _bot_log(user, 'info', f'AI custom using symbols from prompt: {", ".join(symbols[:6])}')
            else:
                _bot_log(user, 'warn', 'Prompt included symbols, but none resolved to valid NSE/BSE tickers.')
        else:
            symbols = _auto_pick_ai_symbols(prompt_text)
            if symbols:
                _bot_log(user, 'info', f'AI custom auto-picked symbols: {", ".join(symbols[:6])}')

    if not symbols:
        cfg.last_run_at = timezone.now()
        cfg.last_status = 'No valid symbols configured.'
        cfg.save(update_fields=['last_run_at', 'last_status', 'updated_at'])
        _bot_log(user, 'warn', cfg.last_status)
        return BotCycleResult(True, cfg.last_status, skipped=1)

    daily_pnl = _today_realized_pnl(user)
    if daily_pnl <= -abs(Decimal(cfg.max_daily_loss or 0)):
        cfg.is_enabled = False
        cfg.last_run_at = timezone.now()
        cfg.last_status = f'Daily loss limit hit ({daily_pnl}). Bot auto-stopped.'
        cfg.save(update_fields=['is_enabled', 'last_run_at', 'last_status', 'updated_at'])
        _bot_log(user, 'warn', cfg.last_status)
        return BotCycleResult(True, cfg.last_status)

    open_positions = PortfolioPosition.objects.filter(user=user, quantity__gt=0).count()
    executed = 0
    skipped = 0

    for sym in symbols:
        pos = PortfolioPosition.objects.filter(user=user, symbol=sym).first()
        held_qty = pos.quantity if pos else 0

        if cfg.strategy == 'trend_pullback':
            try:
                out = _trend_pullback_decision(sym)
            except Exception as exc:
                skipped += 1
                _bot_log(user, 'warn', f'Trend pullback skipped: {exc}', symbol=sym)
                continue
            decision = (out.get('decision') or 'REJECT').upper()
            if decision == 'BUY':
                px = float(out.get('entry') or 0)
                if held_qty > 0:
                    skipped += 1
                    _bot_log(user, 'info', 'Decision BUY, skipped: already holding.', symbol=sym)
                    continue
                if open_positions >= cfg.max_open_positions:
                    skipped += 1
                    _bot_log(user, 'warn', 'Decision BUY, skipped: max open positions reached.', symbol=sym)
                    continue
                est = Decimal(cfg.order_quantity) * Decimal(str(px))
                if user.balance < est:
                    skipped += 1
                    _bot_log(user, 'warn', 'Decision BUY, skipped: insufficient balance.', symbol=sym, action='buy')
                    continue
                payload = {
                    'symbol': sym,
                    'exchange': _exchange_of(sym),
                    'order_type': 'market',
                    'action': 'buy',
                    'quantity': int(cfg.order_quantity),
                }
                execute_trade(user, payload)
                executed += 1
                open_positions += 1
                _bot_log(
                    user,
                    'info',
                    f"BUY executed (Trend Pullback). entry={round(px, 2)} stop={round(float(out.get('stop') or 0), 2)} target={round(float(out.get('target') or 0), 2)} risk={round(float(out.get('risk_pct') or 0), 2)}%",
                    symbol=sym,
                    action='buy',
                )
            elif decision == 'WAIT':
                skipped += 1
                _bot_log(user, 'info', f"WAIT: {out.get('reason') or 'No trigger.'}", symbol=sym)
            else:
                skipped += 1
                _bot_log(user, 'warn', f"REJECT: {out.get('reason') or 'Rule rejected.'}", symbol=sym)
            continue

        if cfg.strategy == 'ai_custom':
            prompt = (cfg.strategy_prompt or '').strip()
            if not prompt:
                skipped += 1
                _bot_log(user, 'warn', 'AI custom strategy is selected but prompt is empty.', symbol=sym)
                continue
            try:
                snap = _market_snapshot(sym)
            except Exception as exc:
                skipped += 1
                _bot_log(user, 'warn', f'AI snapshot skipped: {exc}', symbol=sym)
                continue
            out = ai_decide_from_strategy(prompt, sym, snap)
            decision = (out.get('decision') or 'WAIT').upper()
            if decision == 'BUY':
                px = float(out.get('entry') or snap.get('close') or 0)
                if held_qty > 0:
                    skipped += 1
                    _bot_log(user, 'info', 'AI decision BUY, skipped: already holding.', symbol=sym)
                    continue
                if open_positions >= cfg.max_open_positions:
                    skipped += 1
                    _bot_log(user, 'warn', 'AI decision BUY, skipped: max open positions reached.', symbol=sym)
                    continue
                est = Decimal(cfg.order_quantity) * Decimal(str(px))
                if user.balance < est:
                    skipped += 1
                    _bot_log(user, 'warn', 'AI decision BUY, skipped: insufficient balance.', symbol=sym, action='buy')
                    continue
                payload = {
                    'symbol': sym,
                    'exchange': _exchange_of(sym),
                    'order_type': 'market',
                    'action': 'buy',
                    'quantity': int(cfg.order_quantity),
                }
                execute_trade(user, payload)
                executed += 1
                open_positions += 1
                _bot_log(
                    user,
                    'info',
                    f"BUY executed (AI custom). reason={out.get('reason') or '-'}",
                    symbol=sym,
                    action='buy',
                )
            elif decision == 'REJECT':
                skipped += 1
                _bot_log(user, 'warn', f"REJECT: {out.get('reason') or '-'}", symbol=sym)
            else:
                skipped += 1
                _bot_log(user, 'info', f"WAIT: {out.get('reason') or '-'}", symbol=sym)
            continue

        try:
            signal, px, ema = _ema_signal(sym)
        except Exception as exc:
            skipped += 1
            _bot_log(user, 'warn', f'Signal skipped: {exc}', symbol=sym)
            continue

        if signal == 'buy':
            if held_qty > 0:
                skipped += 1
                continue
            if open_positions >= cfg.max_open_positions:
                skipped += 1
                _bot_log(user, 'warn', 'Max open positions reached.', symbol=sym)
                continue
            est = Decimal(cfg.order_quantity) * Decimal(str(px))
            if user.balance < est:
                skipped += 1
                _bot_log(user, 'warn', 'Insufficient balance for bot buy.', symbol=sym, action='buy')
                continue
            payload = {
                'symbol': sym,
                'exchange': _exchange_of(sym),
                'order_type': 'market',
                'action': 'buy',
                'quantity': int(cfg.order_quantity),
            }
            execute_trade(user, payload)
            executed += 1
            open_positions += 1
            _bot_log(user, 'info', f'BUY executed. Price {round(px, 2)} > EMA20 {round(ema, 2)}', symbol=sym, action='buy')
        elif signal == 'sell':
            if held_qty <= 0:
                skipped += 1
                continue
            sell_qty = min(int(cfg.order_quantity), int(held_qty))
            payload = {
                'symbol': sym,
                'exchange': _exchange_of(sym),
                'order_type': 'market',
                'action': 'sell',
                'quantity': sell_qty,
            }
            execute_trade(user, payload)
            executed += 1
            _bot_log(user, 'info', f'SELL executed. Price {round(px, 2)} < EMA20 {round(ema, 2)}', symbol=sym, action='sell')
        else:
            skipped += 1

    cfg.last_run_at = timezone.now()
    cfg.last_status = f'Cycle done. Executed={executed}, Skipped={skipped}'
    cfg.save(update_fields=['last_run_at', 'last_status', 'updated_at'])
    return BotCycleResult(True, cfg.last_status, executed=executed, skipped=skipped)
