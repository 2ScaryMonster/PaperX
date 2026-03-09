from django.urls import path
from analysis.views import ChartDataAPI, FundamentalsAPI, PredictionAPI, SentimentAPI, SentimentAdvancedAPI

urlpatterns = [
    path('chart/<str:symbol>/', ChartDataAPI.as_view(), name='api_analysis_chart'),
    path('fundamentals/<str:symbol>/', FundamentalsAPI.as_view(), name='api_analysis_fundamentals'),
    path('sentiment/<str:symbol>/', SentimentAPI.as_view(), name='api_analysis_sentiment'),
    path('sentiment-advanced/<str:symbol>/', SentimentAdvancedAPI.as_view(), name='api_analysis_sentiment_advanced'),
    path('prediction/<str:symbol>/', PredictionAPI.as_view(), name='api_analysis_prediction'),
]
