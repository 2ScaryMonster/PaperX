from django.urls import path
from trades.views import (
    BotConfigAPI,
    BotLogsAPI,
    BotAssistantAPI,
    BotAssistantHealthAPI,
    BotStartStopAPI,
    BotTickAPI,
    ExecuteTradeAPI,
    LivePriceAPI,
    PendingOrderDeleteAPI,
    SymbolSearchAPI,
    TradeChartAPI,
    TradeHistoryAPI,
    execute_trade_form,
)

urlpatterns = [
    path('execute/', ExecuteTradeAPI.as_view(), name='api_trade_execute'),
    path('execute-form/', execute_trade_form, name='trade_form_execute'),
    path('history/', TradeHistoryAPI.as_view(), name='api_trade_history'),
    path('pending/<int:trade_id>/', PendingOrderDeleteAPI.as_view(), name='api_pending_order_delete'),
    path('live-price/<str:symbol>/', LivePriceAPI.as_view(), name='api_live_price'),
    path('symbol-search/', SymbolSearchAPI.as_view(), name='api_symbol_search'),
    path('chart/<str:symbol>/', TradeChartAPI.as_view(), name='api_trade_chart'),
    path('bot/config/', BotConfigAPI.as_view(), name='api_bot_config'),
    path('bot/toggle/', BotStartStopAPI.as_view(), name='api_bot_toggle'),
    path('bot/tick/', BotTickAPI.as_view(), name='api_bot_tick'),
    path('bot/logs/', BotLogsAPI.as_view(), name='api_bot_logs'),
    path('bot/assistant/', BotAssistantAPI.as_view(), name='api_bot_assistant'),
    path('bot/assistant-health/', BotAssistantHealthAPI.as_view(), name='api_bot_assistant_health'),
]
