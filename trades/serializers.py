from rest_framework import serializers
from trades.models import Trade


class TradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trade
        fields = '__all__'
        read_only_fields = ('user', 'price', 'status', 'pnl', 'timestamp')


class ExecuteTradeSerializer(serializers.Serializer):
    symbol = serializers.CharField(max_length=24)
    exchange = serializers.ChoiceField(choices=['NSE', 'BSE', 'CRYPTO'])
    order_type = serializers.ChoiceField(choices=['market', 'limit'])
    action = serializers.ChoiceField(choices=['buy', 'sell'])
    quantity = serializers.IntegerField(min_value=1)
    limit_price = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    stop_loss = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
