from rest_framework import serializers
from analysis.models import NewsSentiment, Prediction


class SentimentSerializer(serializers.ModelSerializer):
    class Meta:
        model = NewsSentiment
        fields = ('headline', 'sentiment_label', 'sentiment_score', 'fetched_at')


class PredictionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Prediction
        fields = ('prediction_date', 'predicted_price', 'model_used')
