from django.conf import settings
from django.db import models


class Watchlist(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='watchlists')
    name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'name')
        ordering = ['name']

    def __str__(self):
        return f'{self.user.username} - {self.name}'


class WatchlistItem(models.Model):
    watchlist = models.ForeignKey(Watchlist, on_delete=models.CASCADE, related_name='items')
    symbol = models.CharField(max_length=24)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('watchlist', 'symbol')
        ordering = ['-added_at']

    def __str__(self):
        return f'{self.watchlist.user.username} - {self.watchlist.name} - {self.symbol}'
