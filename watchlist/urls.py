from django.urls import path
from watchlist.views import (
    WatchlistAPI,
    WatchlistAddAPI,
    WatchlistCreateAPI,
    WatchlistDeleteAPI,
    WatchlistRemoveAPI,
    WatchlistRenameAPI,
)

urlpatterns = [
    path('', WatchlistAPI.as_view(), name='api_watchlist'),
    path('create/', WatchlistCreateAPI.as_view(), name='api_watchlist_create'),
    path('rename/<int:watchlist_id>/', WatchlistRenameAPI.as_view(), name='api_watchlist_rename'),
    path('delete/<int:watchlist_id>/', WatchlistDeleteAPI.as_view(), name='api_watchlist_delete'),
    path('add/', WatchlistAddAPI.as_view(), name='api_watchlist_add'),
    path('remove/<int:item_id>/', WatchlistRemoveAPI.as_view(), name='api_watchlist_remove'),
]
