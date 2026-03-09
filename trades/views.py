from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
import requests
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from trades.assistant import ai_normalize_command, ollama_health
from trades.bot import get_or_create_bot_config, parse_symbols, run_bot_cycle
from trades.models import Trade
from trades.serializers import ExecuteTradeSerializer, TradeSerializer
from trades.services import execute_trade, get_live_price, get_price_series, resolve_symbol
from trades.models import TradingBotLog


class ExecuteTradeAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ExecuteTradeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            trade, live_price = execute_trade(request.user, serializer.validated_data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                'trade': TradeSerializer(trade).data,
                'live_price': float(live_price),
                'message': f'Trade {trade.status}.',
            }
        )


class TradeHistoryAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        trades = Trade.objects.filter(user=request.user)
        action = request.query_params.get('action')
        symbol = request.query_params.get('symbol')
        if action:
            trades = trades.filter(action=action)
        if symbol:
            trades = trades.filter(symbol__icontains=symbol.upper())
        return Response(TradeSerializer(trades, many=True).data)


class PendingOrderDeleteAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, trade_id):
        trade = Trade.objects.filter(id=trade_id, user=request.user).first()
        if not trade:
            return Response({'error': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)
        if trade.status != 'pending':
            return Response({'error': 'Only pending orders can be deleted.'}, status=status.HTTP_400_BAD_REQUEST)
        trade.delete()
        return Response({'message': 'Pending order deleted.'})


class LivePriceAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        try:
            resolved = resolve_symbol(symbol.upper())
            price = get_live_price(resolved)
            return Response({'symbol': resolved, 'price': float(price)})
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class SymbolSearchAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response({'results': []})

        try:
            resp = requests.get(
                'https://query2.finance.yahoo.com/v1/finance/search',
                params={'q': query, 'quotesCount': 12, 'newsCount': 0},
                timeout=8,
                headers={'User-Agent': 'Mozilla/5.0'},
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            return Response({'error': f'Search unavailable: {exc}'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        results = []
        for row in payload.get('quotes', []):
            symbol = row.get('symbol')
            if not symbol:
                continue
            symbol_upper = symbol.upper()
            # Restrict suggestions strictly to Indian cash market symbols.
            if not (symbol_upper.endswith('.NS') or symbol_upper.endswith('.BO')):
                continue
            quote_type = (row.get('quoteType') or '').upper()
            if quote_type and quote_type not in {'EQUITY', 'ETF'}:
                continue
            results.append(
                {
                    'symbol': symbol_upper,
                    'name': row.get('shortname') or row.get('longname') or symbol_upper,
                    'exchange': 'NSE' if symbol_upper.endswith('.NS') else 'BSE' if symbol_upper.endswith('.BO') else (row.get('exchange') or row.get('exchDisp') or ''),
                    'type': quote_type or '',
                }
            )

        return Response({'results': results[:12]})


class TradeChartAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        range_key = request.query_params.get('range', '5d')
        try:
            payload = get_price_series(symbol.upper(), range_key)
            return Response(payload)
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class BotConfigAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        cfg = get_or_create_bot_config(request.user)
        return Response(
            {
                'is_enabled': cfg.is_enabled,
                'strategy': cfg.strategy,
                'strategy_prompt': cfg.strategy_prompt,
                'symbols': cfg.symbols,
                'parsed_symbols': parse_symbols(cfg.symbols),
                'order_quantity': cfg.order_quantity,
                'poll_seconds': cfg.poll_seconds,
                'max_daily_loss': float(cfg.max_daily_loss),
                'max_open_positions': cfg.max_open_positions,
                'last_run_at': cfg.last_run_at,
                'last_status': cfg.last_status,
            }
        )

    def post(self, request):
        cfg = get_or_create_bot_config(request.user)
        cfg.strategy = (request.data.get('strategy') or cfg.strategy).strip() or cfg.strategy
        cfg.symbols = (request.data.get('symbols') or cfg.symbols).strip() or cfg.symbols
        cfg.strategy_prompt = (request.data.get('strategy_prompt') or cfg.strategy_prompt).strip()
        if cfg.strategy == 'ai_custom' and not cfg.strategy_prompt:
            return Response({'error': 'AI custom strategy requires a strategy prompt.'}, status=status.HTTP_400_BAD_REQUEST)
        cfg.order_quantity = max(1, int(request.data.get('order_quantity', cfg.order_quantity)))
        cfg.poll_seconds = max(20, min(300, int(request.data.get('poll_seconds', cfg.poll_seconds))))
        cfg.max_open_positions = max(1, int(request.data.get('max_open_positions', cfg.max_open_positions)))
        cfg.max_daily_loss = request.data.get('max_daily_loss', cfg.max_daily_loss)
        cfg.save()
        return Response({'message': 'Bot config saved.'})

    def delete(self, request):
        cfg = get_or_create_bot_config(request.user)
        cfg.is_enabled = False
        cfg.strategy = 'ema_cross'
        cfg.strategy_prompt = ''
        cfg.symbols = ''
        cfg.order_quantity = 1
        cfg.poll_seconds = 60
        cfg.max_daily_loss = 500
        cfg.max_open_positions = 5
        cfg.last_status = 'Bot deleted/reset by user.'
        cfg.save()
        return Response({'message': 'Bot strategy/config deleted and bot stopped.'})


class BotStartStopAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        action = (request.data.get('action') or '').strip().lower()
        if action not in {'start', 'stop', 'pause', 'resume'}:
            return Response({'error': 'action must be start, pause, resume, or stop'}, status=status.HTTP_400_BAD_REQUEST)
        cfg = get_or_create_bot_config(request.user)
        if action in {'start', 'resume'}:
            cfg.is_enabled = True
            cfg.last_status = 'Bot resumed.' if action == 'resume' else 'Bot started.'
        elif action == 'pause':
            cfg.is_enabled = False
            cfg.last_status = 'Bot paused.'
        else:
            cfg.is_enabled = False
            cfg.last_status = 'Bot stopped.'
        cfg.save(update_fields=['is_enabled', 'last_status', 'updated_at'])
        return Response({'message': cfg.last_status, 'is_enabled': cfg.is_enabled})


class BotTickAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        result = run_bot_cycle(request.user)
        return Response(
            {
                'ran': result.ran,
                'message': result.message,
                'executed': result.executed,
                'skipped': result.skipped,
            }
        )


class BotLogsAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = TradingBotLog.objects.filter(user=request.user)[:120]
        rows = [
            {
                'id': x.id,
                'timestamp': x.timestamp,
                'level': x.level,
                'symbol': x.symbol,
                'action': x.action,
                'message': x.message,
            }
            for x in qs
        ]
        return Response({'rows': rows})


class BotAssistantAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        message = (request.data.get('message') or '').strip()
        if not message:
            return Response({'error': 'message is required'}, status=status.HTTP_400_BAD_REQUEST)
        history = request.data.get('history') or []
        if not isinstance(history, list):
            history = []
        out = ai_normalize_command(message, history=history[:20])
        return Response(out)


class BotAssistantHealthAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(ollama_health())


@login_required
def execute_trade_form(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST is allowed.'}, status=405)
    payload = {
        'symbol': request.POST.get('symbol', '').strip().upper(),
        'exchange': request.POST.get('exchange', 'NSE').strip(),
        'order_type': request.POST.get('order_type', 'market').strip(),
        'action': request.POST.get('action', 'buy').strip(),
        'quantity': request.POST.get('quantity', 0),
    }
    if request.POST.get('limit_price'):
        payload['limit_price'] = request.POST.get('limit_price')
    if request.POST.get('stop_loss'):
        payload['stop_loss'] = request.POST.get('stop_loss')

    serializer = ExecuteTradeSerializer(data=payload)
    if not serializer.is_valid():
        return JsonResponse({'error': serializer.errors}, status=400)

    try:
        trade, _ = execute_trade(request.user, serializer.validated_data)
    except ValueError as exc:
        messages.error(request, str(exc))
        return JsonResponse({'error': str(exc)}, status=400)

    if trade.status == 'executed':
        messages.success(request, f'{trade.action.title()} order executed for {trade.symbol}.')
    else:
        messages.info(request, f'Order placed as pending: {trade.symbol}.')
    return JsonResponse({'ok': True})
