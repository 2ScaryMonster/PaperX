from django.urls import path
from portfolio.views import DashboardSummaryAPI, PortfolioAPI

urlpatterns = [
    path('', PortfolioAPI.as_view(), name='api_portfolio'),
    path('summary/', DashboardSummaryAPI.as_view(), name='api_dashboard_summary'),
]
