from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import redirect, render
from papertrading.screener import get_available_sectors, run_screener


def landing(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    return render(request, 'landing.html')


@login_required
def dashboard(request):
    return render(request, 'dashboard.html')


@login_required
def trade_page(request):
    return redirect('analysis_page')


@login_required
def analysis_page(request):
    return render(request, 'analysis.html')


@login_required
def news_analysis_page(request):
    return render(request, 'news_analysis.html')


@login_required
def watchlist_page(request):
    return render(request, 'watchlist.html')


@login_required
def history_page(request):
    return render(request, 'history.html')


@login_required
def orders_page(request):
    return render(request, 'orders.html')


@login_required
def screener_page(request):
    return render(request, 'screener.html')


@login_required
def bot_page(request):
    return render(request, 'bot.html')


@login_required
def screener_run_api(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST allowed.'}, status=405)
    query = request.POST.get('query', '')
    try:
        result = run_screener(query)
    except Exception as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    return JsonResponse(result)


@login_required
def screener_sectors_api(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Only GET allowed.'}, status=405)
    try:
        sectors = get_available_sectors()
    except Exception as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    return JsonResponse({'sectors': sectors})


def _require_admin(request):
    if not request.user.is_authenticated:
        return redirect('login')
    if not (request.user.role == 'admin' or request.user.is_staff):
        messages.error(request, 'Admin access required.')
        return redirect('dashboard')
    return None


def admin_users_page(request):
    denied = _require_admin(request)
    if denied:
        return denied
    return render(request, 'admin/users.html')


def admin_trades_page(request):
    denied = _require_admin(request)
    if denied:
        return denied
    return render(request, 'admin/trades.html')


def admin_leaderboard_page(request):
    denied = _require_admin(request)
    if denied:
        return denied
    return render(request, 'admin/leaderboard.html')
