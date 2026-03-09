from django import forms
from django.contrib.auth.forms import UserCreationForm
from users.models import User


class TraderRegisterForm(UserCreationForm):
    email = forms.EmailField(required=True)

    class Meta:
        model = User
        fields = ('username', 'email', 'password1', 'password2')

    def save(self, commit=True):
        user = super().save(commit=False)
        user.role = 'trader'
        user.balance = 10000
        if commit:
            user.save()
        return user
