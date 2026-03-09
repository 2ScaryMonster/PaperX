from django.conf import settings
from django.db import models


class PortfolioPosition(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='positions')
    symbol = models.CharField(max_length=24)
    quantity = models.PositiveIntegerField(default=0)
    avg_buy_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    current_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        unique_together = ('user', 'symbol')

    def __str__(self):
        return f'{self.user.username} - {self.symbol}'
