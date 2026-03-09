from rest_framework import serializers
from portfolio.models import PortfolioPosition


class PortfolioPositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PortfolioPosition
        fields = ('id', 'symbol', 'quantity', 'avg_buy_price', 'current_value')
