from django.db import IntegrityError
from django.db.models import Count
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from trades.services import get_quote_snapshot, resolve_symbol
from watchlist.models import Watchlist, WatchlistItem
from watchlist.serializers import WatchlistSerializer, WatchlistSummarySerializer


def _default_watchlist(user):
    watchlist, _ = Watchlist.objects.get_or_create(user=user, name='My Watchlist')
    return watchlist


class WatchlistAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        selected_id = request.query_params.get('watchlist_id')
        watchlists = Watchlist.objects.filter(user=request.user).annotate(item_count=Count('items')).order_by('name')
        if not watchlists.exists():
            _default_watchlist(request.user)
            watchlists = Watchlist.objects.filter(user=request.user).annotate(item_count=Count('items')).order_by('name')

        selected = watchlists.first()
        if selected_id:
            selected = watchlists.filter(id=selected_id).first() or selected

        selected_payload = None
        if selected:
            items_payload = []
            for item in selected.items.all():
                ltp = None
                previous_close = None
                change = None
                change_pct = None
                try:
                    snap = get_quote_snapshot(item.symbol.upper())
                    ltp = snap.get('ltp')
                    previous_close = snap.get('previous_close')
                    change = snap.get('change')
                    change_pct = snap.get('change_pct')
                except Exception:
                    pass
                items_payload.append(
                    {
                        'id': item.id,
                        'symbol': item.symbol,
                        'added_at': item.added_at,
                        'ltp': ltp,
                        'previous_close': previous_close,
                        'change': change,
                        'change_pct': change_pct,
                    }
                )

            selected_payload = {
                'id': selected.id,
                'name': selected.name,
                'created_at': selected.created_at,
                'updated_at': selected.updated_at,
                'item_count': getattr(selected, 'item_count', len(items_payload)),
                'items': items_payload,
            }

        return Response(
            {
                'selected_watchlist_id': selected.id if selected else None,
                'watchlists': WatchlistSummarySerializer(watchlists, many=True).data,
                'selected_watchlist': selected_payload,
            }
        )


class WatchlistCreateAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        name = request.data.get('name', '').strip()
        if not name:
            return Response({'error': 'name is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            watchlist = Watchlist.objects.create(user=request.user, name=name)
        except IntegrityError:
            return Response({'error': 'Watchlist name already exists.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'id': watchlist.id, 'name': watchlist.name}, status=status.HTTP_201_CREATED)


class WatchlistRenameAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, watchlist_id):
        new_name = request.data.get('name', '').strip()
        if not new_name:
            return Response({'error': 'name is required'}, status=status.HTTP_400_BAD_REQUEST)
        watchlist = Watchlist.objects.filter(id=watchlist_id, user=request.user).first()
        if not watchlist:
            return Response({'error': 'Watchlist not found.'}, status=status.HTTP_404_NOT_FOUND)
        if Watchlist.objects.filter(user=request.user, name=new_name).exclude(id=watchlist.id).exists():
            return Response({'error': 'Watchlist name already exists.'}, status=status.HTTP_400_BAD_REQUEST)
        watchlist.name = new_name
        watchlist.save(update_fields=['name', 'updated_at'])
        return Response({'id': watchlist.id, 'name': watchlist.name})


class WatchlistDeleteAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, watchlist_id):
        watchlist = Watchlist.objects.filter(id=watchlist_id, user=request.user).first()
        if not watchlist:
            return Response({'error': 'Watchlist not found.'}, status=status.HTTP_404_NOT_FOUND)
        watchlist.delete()
        if not Watchlist.objects.filter(user=request.user).exists():
            _default_watchlist(request.user)
        return Response({'message': 'Watchlist deleted.'})


class WatchlistAddAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        symbol = request.data.get('symbol', '').upper().strip()
        watchlist_id = request.data.get('watchlist_id')
        if not symbol:
            return Response({'error': 'symbol is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            symbol = resolve_symbol(symbol)
        except Exception:
            return Response({'error': f'Invalid symbol: {symbol}. Try NSE/BSE suffix (e.g. RELIANCE.NS).'}, status=status.HTTP_400_BAD_REQUEST)

        watchlist = None
        if watchlist_id:
            watchlist = Watchlist.objects.filter(id=watchlist_id, user=request.user).first()
        if not watchlist:
            watchlist = _default_watchlist(request.user)

        try:
            item = WatchlistItem.objects.create(watchlist=watchlist, symbol=symbol)
        except IntegrityError:
            return Response({'error': 'Symbol already in this watchlist.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(WatchlistSerializer(item).data, status=status.HTTP_201_CREATED)


class WatchlistRemoveAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, item_id):
        deleted, _ = WatchlistItem.objects.filter(id=item_id, watchlist__user=request.user).delete()
        if not deleted:
            return Response({'error': 'Item not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'message': 'Removed from watchlist.'})
