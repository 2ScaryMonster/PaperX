from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    ROLE_CHOICES = (
        ('trader', 'Trader'),
        ('admin', 'Admin'),
    )

    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='trader')
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=10000.00)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.username
