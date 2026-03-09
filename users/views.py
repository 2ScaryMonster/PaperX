from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from users.forms import TraderRegisterForm
from users.serializers import LoginSerializer, RegisterSerializer


class RegisterAPI(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response({'id': user.id, 'username': user.username}, status=status.HTTP_201_CREATED)


class LoginAPI(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        login(request, serializer.validated_data['user'])
        return Response({'message': 'Logged in successfully.'})


def register_page(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    if request.method == 'POST':
        form = TraderRegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, 'Registration complete. Virtual balance credited: ₹10,000.')
            return redirect('dashboard')
    else:
        form = TraderRegisterForm()
    return render(request, 'registration/register.html', {'form': form})


def login_page(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '').strip()
        serializer = LoginSerializer(data={'username': username, 'password': password})
        if serializer.is_valid():
            login(request, serializer.validated_data['user'])
            messages.success(request, 'Welcome back.')
            return redirect('dashboard')
        messages.error(request, 'Invalid username or password.')
    return render(request, 'registration/login.html')


@login_required
def logout_page(request):
    logout(request)
    messages.info(request, 'You have been logged out.')
    return redirect('landing')
