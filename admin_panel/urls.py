from django.urls import path
from admin_panel.views import AdminLeaderboardAPI, AdminTradesAPI, AdminUsersAPI

urlpatterns = [
    path('users/', AdminUsersAPI.as_view(), name='api_admin_users'),
    path('trades/', AdminTradesAPI.as_view(), name='api_admin_trades'),
    path('leaderboard/', AdminLeaderboardAPI.as_view(), name='api_admin_leaderboard'),
]
