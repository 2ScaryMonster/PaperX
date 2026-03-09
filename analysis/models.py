from django.db import models


class Prediction(models.Model):
    symbol = models.CharField(max_length=24)
    predicted_price = models.DecimalField(max_digits=14, decimal_places=2)
    prediction_date = models.DateField()
    model_used = models.CharField(max_length=50, default='prophet')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-prediction_date']


class NewsSentiment(models.Model):
    LABEL_CHOICES = (
        ('Positive', 'Positive'),
        ('Neutral', 'Neutral'),
        ('Negative', 'Negative'),
    )

    symbol = models.CharField(max_length=24)
    headline = models.CharField(max_length=400)
    sentiment_label = models.CharField(max_length=10, choices=LABEL_CHOICES)
    sentiment_score = models.FloatField()
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fetched_at']
