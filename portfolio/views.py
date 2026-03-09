from decimal import Decimal

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from portfolio.models import PortfolioPosition
from portfolio.serializers import PortfolioPositionSerializer
from trades.models import Trade
from trades.services import get_live_price


class PortfolioAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        positions = PortfolioPosition.objects.filter(user=request.user)
        total_market_value = Decimal('0')
        total_cost = Decimal('0')

        for pos in positions:
            try:
                price = get_live_price(pos.symbol)
            except Exception:
                price = pos.avg_buy_price
            pos.current_value = Decimal(pos.quantity) * price
            pos.save(update_fields=['current_value'])
            total_market_value += pos.current_value
            total_cost += Decimal(pos.quantity) * pos.avg_buy_price

        pnl = total_market_value - total_cost
        return Response(
            {
                'balance': float(request.user.balance),
                'portfolio_value': float(total_market_value),
                'pnl': float(pnl),
                'positions': PortfolioPositionSerializer(positions, many=True).data,
            }
        )


class DashboardSummaryAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        recent_trades = Trade.objects.filter(user=request.user)[:5]
        return Response(
            {
                'balance': float(request.user.balance),
                'open_positions': PortfolioPosition.objects.filter(user=request.user, quantity__gt=0).count(),
                'recent_trades': [
                    {
                        'symbol': t.symbol,
                        'action': t.action,
                        'quantity': t.quantity,
                        'price': float(t.price),
                        'status': t.status,
                        'timestamp': t.timestamp,
                    }
                    for t in recent_trades
                ],
            }
        )
