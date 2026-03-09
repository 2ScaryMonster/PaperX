from django.conf import settings
from django.db import models


class Trade(models.Model):
    EXCHANGE_CHOICES = (
        ('NSE', 'NSE'),
        ('BSE', 'BSE'),
        ('CRYPTO', 'CRYPTO'),
    )
    ORDER_TYPE_CHOICES = (
        ('market', 'Market'),
        ('limit', 'Limit'),
    )
    ACTION_CHOICES = (
        ('buy', 'Buy'),
        ('sell', 'Sell'),
    )
    STATUS_CHOICES = (
        ('executed', 'Executed'),
        ('pending', 'Pending'),
        ('cancelled', 'Cancelled'),
        ('triggered', 'Triggered'),
    )

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='trades')
    symbol = models.CharField(max_length=24)
    exchange = models.CharField(max_length=8, choices=EXCHANGE_CHOICES)
    order_type = models.CharField(max_length=8, choices=ORDER_TYPE_CHOICES)
    action = models.CharField(max_length=4, choices=ACTION_CHOICES)
    quantity = models.PositiveIntegerField()
    price = models.DecimalField(max_digits=14, decimal_places=2)
    limit_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    stop_loss = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='executed')
    pnl = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f'{self.user.username} {self.action} {self.symbol}'


class TradingBotConfig(models.Model):
    STRATEGY_CHOICES = (
        ('ema_cross', 'EMA Cross (15m)'),
        ('trend_pullback', 'Trend Pullback (Swing)'),
        ('ai_custom', 'AI Custom Strategy'),
    )

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='bot_config')
    is_enabled = models.BooleanField(default=False)
    strategy = models.CharField(max_length=20, choices=STRATEGY_CHOICES, default='ema_cross')
    symbols = models.TextField(default='RELIANCE.NS,TCS.NS')
    order_quantity = models.PositiveIntegerField(default=1)
    poll_seconds = models.PositiveIntegerField(default=60)
    max_daily_loss = models.DecimalField(max_digits=14, decimal_places=2, default=500.00)
    max_open_positions = models.PositiveIntegerField(default=5)
    strategy_prompt = models.TextField(blank=True, default='')
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'BotConfig<{self.user.username}>'


class TradingBotLog(models.Model):
    LEVEL_CHOICES = (
        ('info', 'Info'),
        ('warn', 'Warn'),
        ('error', 'Error'),
    )

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='bot_logs')
    level = models.CharField(max_length=10, choices=LEVEL_CHOICES, default='info')
    message = models.TextField()
    symbol = models.CharField(max_length=24, blank=True, default='')
    action = models.CharField(max_length=8, blank=True, default='')
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f'BotLog<{self.user.username}:{self.level}>'
