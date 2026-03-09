from django.db.models import Count, F, Sum
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from trades.models import Trade
from users.models import User


class IsRoleAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and (request.user.role == 'admin' or request.user.is_staff))


class AdminUsersAPI(APIView):
    permission_classes = [IsRoleAdmin]

    def get(self, request):
        users = User.objects.filter(role='trader').values('id', 'username', 'email', 'balance', 'is_active', 'created_at')
        return Response(list(users))


class AdminTradesAPI(APIView):
    permission_classes = [IsRoleAdmin]

    def get(self, request):
        trades = Trade.objects.select_related('user').all()
        payload = [
            {
                'id': t.id,
                'username': t.user.username,
                'symbol': t.symbol,
                'exchange': t.exchange,
                'action': t.action,
                'order_type': t.order_type,
                'quantity': t.quantity,
                'price': float(t.price),
                'pnl': float(t.pnl),
                'status': t.status,
                'timestamp': t.timestamp,
            }
            for t in trades
        ]
        return Response(payload)


class AdminLeaderboardAPI(APIView):
    permission_classes = [IsRoleAdmin]

    def get(self, request):
        sort_by = request.query_params.get('sort', 'total_profit')
        base = User.objects.filter(role='trader').annotate(
            total_profit=Sum('trades__pnl'),
            trade_count=Count('trades'),
            invested=Sum(F('positions__quantity') * F('positions__avg_buy_price')),
            current_value=Sum('positions__current_value'),
        )

        rows = []
        for u in base:
            total_profit = float(u.total_profit or 0)
            invested = float(u.invested or 0)
            return_pct = (total_profit / invested * 100.0) if invested else 0.0
            rows.append(
                {
                    'username': u.username,
                    'current_balance': float(u.balance),
                    'current_value': float(u.current_value or 0),
                    'total_profit': round(total_profit, 2),
                    'return_pct': round(return_pct, 2),
                    'trade_count': u.trade_count,
                }
            )

        key_map = {
            'total_profit': lambda x: x['total_profit'],
            'return_pct': lambda x: x['return_pct'],
            'trade_count': lambda x: x['trade_count'],
            'current_balance': lambda x: x['current_balance'],
        }
        rows.sort(key=key_map.get(sort_by, key_map['total_profit']), reverse=True)
        return Response(rows)
