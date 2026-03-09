from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from analysis.serializers import PredictionSerializer, SentimentSerializer
from analysis.services import (
    MAX_SENTIMENT_ARTICLES,
    compute_indicators,
    fetch_fundamentals,
    fetch_news_sentiment,
    fetch_news_sentiment_advanced,
    fetch_ohlc,
    naive_predict,
)
from trades.services import resolve_symbol


class ChartDataAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        range_key = request.query_params.get('range', '6mo').lower()
        range_map = {
            '1d': ('1d', '5m'),
            '5d': ('5d', '15m'),
            '1mo': ('1mo', '60m'),
            '3mo': ('3mo', '1d'),
            '6mo': ('6mo', '1d'),
            '1y': ('1y', '1d'),
            '5y': ('5y', '1wk'),
        }
        period, interval = range_map.get(range_key, range_map['6mo'])

        try:
            resolved = resolve_symbol(symbol.upper())
            df = compute_indicators(fetch_ohlc(resolved, period=period, interval=interval))
        except Exception as exc:
            return Response({'error': str(exc)}, status=400)

        ts_col = 'Date' if 'Date' in df.columns else 'Datetime'

        data = {
            'symbol': resolved,
            'range': range_key,
            'labels': [str(x) for x in df[ts_col]],
            'open': [round(float(x), 2) for x in df['Open']],
            'high': [round(float(x), 2) for x in df['High']],
            'low': [round(float(x), 2) for x in df['Low']],
            'close': [round(float(x), 2) for x in df['Close']],
            'rsi': [None if str(x) == 'nan' else round(float(x), 2) for x in df['RSI']],
            'sma20': [None if str(x) == 'nan' else round(float(x), 2) for x in df['SMA20']],
            'ema20': [None if str(x) == 'nan' else round(float(x), 2) for x in df['EMA20']],
            'bb_upper': [None if str(x) == 'nan' else round(float(x), 2) for x in df['BB_UPPER']],
            'bb_lower': [None if str(x) == 'nan' else round(float(x), 2) for x in df['BB_LOWER']],
            'macd': [None if str(x) == 'nan' else round(float(x), 2) for x in df['MACD']],
            'signal': [None if str(x) == 'nan' else round(float(x), 2) for x in df['SIGNAL']],
        }
        return Response(data)


class SentimentAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        records, overall, avg_score, model_used = fetch_news_sentiment(symbol.upper())
        return Response(
            {
                'symbol': symbol.upper(),
                'overall': overall,
                'score': round(avg_score, 3),
                'model_used': model_used,
                'articles': SentimentSerializer(records, many=True).data,
            }
        )


class SentimentAdvancedAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        source = request.query_params.get('source', 'all')
        count = request.query_params.get('count', '8')
        try:
            count_num = int(count)
        except Exception:
            count_num = 8

        records, overall, avg_score, model_used, safe_limit = fetch_news_sentiment_advanced(
            symbol.upper(),
            source=source,
            limit=count_num,
        )
        return Response(
            {
                'symbol': symbol.upper(),
                'overall': overall,
                'score': round(avg_score, 3),
                'model_used': model_used,
                'source': source,
                'count': safe_limit,
                'max_limit': MAX_SENTIMENT_ARTICLES,
                'articles': SentimentSerializer(records, many=True).data,
            }
        )


class PredictionAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        days = int(request.query_params.get('days', 14))
        days = min(max(days, 7), 30)
        preds = naive_predict(symbol.upper(), days=days)
        return Response({'symbol': symbol.upper(), 'forecast': PredictionSerializer(preds, many=True).data})


class FundamentalsAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, symbol):
        try:
            data = fetch_fundamentals(symbol.upper())
            return Response(data)
        except Exception as exc:
            return Response({'error': str(exc)}, status=400)
