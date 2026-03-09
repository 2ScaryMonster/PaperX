from decimal import Decimal

from django.core.management.base import BaseCommand
from portfolio.models import PortfolioPosition
from trades.models import Trade
from trades.services import get_live_price


class Command(BaseCommand):
    help = 'Check stop-loss conditions and auto-trigger sell orders.'

    def handle(self, *args, **options):
        open_trades = Trade.objects.filter(action='buy', status='executed').exclude(stop_loss__isnull=True)
        triggered = 0
        for trade in open_trades:
            try:
                price = get_live_price(trade.symbol)
            except Exception:
                continue
            if price > trade.stop_loss:
                continue
            position = PortfolioPosition.objects.filter(user=trade.user, symbol=trade.symbol).first()
            if not position or position.quantity == 0:
                continue
            qty = position.quantity
            proceeds = Decimal(qty) * price
            pnl = (price - position.avg_buy_price) * Decimal(qty)

            trade.user.balance += proceeds
            trade.user.save(update_fields=['balance'])

            position.quantity = 0
            position.avg_buy_price = Decimal('0')
            position.current_value = Decimal('0')
            position.save()

            Trade.objects.create(
                user=trade.user,
                symbol=trade.symbol,
                exchange=trade.exchange,
                order_type='market',
                action='sell',
                quantity=qty,
                price=price,
                stop_loss=trade.stop_loss,
                status='triggered',
                pnl=pnl,
            )
            triggered += 1

        self.stdout.write(self.style.SUCCESS(f'Stop-loss check complete. Triggered: {triggered}'))
