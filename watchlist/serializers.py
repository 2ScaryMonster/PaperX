from rest_framework import serializers
from watchlist.models import Watchlist, WatchlistItem


class WatchlistSerializer(serializers.ModelSerializer):
    class Meta:
        model = WatchlistItem
        fields = ('id', 'symbol', 'added_at')


class WatchlistItemDetailSerializer(serializers.ModelSerializer):
    ltp = serializers.FloatField(read_only=True)
    previous_close = serializers.FloatField(read_only=True)
    change = serializers.FloatField(read_only=True)
    change_pct = serializers.FloatField(read_only=True)

    class Meta:
        model = WatchlistItem
        fields = ('id', 'symbol', 'added_at', 'ltp', 'previous_close', 'change', 'change_pct')


class WatchlistSummarySerializer(serializers.ModelSerializer):
    item_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Watchlist
        fields = ('id', 'name', 'item_count')


class WatchlistDetailSerializer(serializers.ModelSerializer):
    items = WatchlistItemDetailSerializer(many=True, read_only=True)
    item_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Watchlist
        fields = ('id', 'name', 'created_at', 'updated_at', 'item_count', 'items')
