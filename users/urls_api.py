from django.urls import path
from users.views import LoginAPI, RegisterAPI

urlpatterns = [
    path('register/', RegisterAPI.as_view(), name='api_register'),
    path('login/', LoginAPI.as_view(), name='api_login'),
]
