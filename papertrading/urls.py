from django.contrib import admin
from django.urls import include, path
from papertrading import views

urlpatterns = [
    path('django-admin/', admin.site.urls),
    path('', views.landing, name='landing'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('trade/', views.trade_page, name='trade_page'),
    path('analysis/', views.analysis_page, name='analysis_page'),
    path('news-analysis/', views.news_analysis_page, name='news_analysis_page'),
    path('screener/', views.screener_page, name='screener_page'),
    path('bot/', views.bot_page, name='bot_page'),
    path('orders/', views.orders_page, name='orders_page'),
    path('watchlist/', views.watchlist_page, name='watchlist_page'),
    path('history/', views.history_page, name='history_page'),
    path('admin-panel/users/', views.admin_users_page, name='admin_users_page'),
    path('admin-panel/trades/', views.admin_trades_page, name='admin_trades_page'),
    path('admin-panel/leaderboard/', views.admin_leaderboard_page, name='admin_leaderboard_page'),
    path('auth/', include('users.urls')),
    path('api/auth/', include('users.urls_api')),
    path('api/trade/', include('trades.urls')),
    path('api/portfolio/', include('portfolio.urls')),
    path('api/watchlist/', include('watchlist.urls')),
    path('api/analysis/', include('analysis.urls')),
    path('api/admin/', include('admin_panel.urls')),
    path('api/screener/run/', views.screener_run_api, name='api_screener_run'),
    path('api/screener/sectors/', views.screener_sectors_api, name='api_screener_sectors'),
]
