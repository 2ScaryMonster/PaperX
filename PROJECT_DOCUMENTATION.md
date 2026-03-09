# PaperX Project Documentation (Current State)

## 1. Project Overview
PaperX is a Django + DRF paper trading platform for Indian markets with:
- User auth and role separation (trader/admin).
- Portfolio and order simulation.
- Kite-style dashboard/watchlist UX.
- Analysis workspace with charting, indicators, fundamentals, sentiment, prediction, drawing tools.
- Intraday screener with dynamic universe and query builder.
- Bot engine with manual strategies and AI-driven custom strategy mode.
- Advanced news sentiment page.

This document reflects the codebase state on **2026-03-09**.


## 2. Tech Stack
- Backend: Django 5, Django REST Framework.
- DB: SQLite (development).
- Data: yfinance + NSE index API (for screener universe).
- AI/NLP: FinBERT (transformers), Ollama for local LLM assistant + AI custom bot decisions.
- Frontend: Django templates + vanilla JS + Bootstrap + Plotly + Chart.js.

Core dependencies from `requirements.txt`:
- Django, djangorestframework
- yfinance, pandas, numpy, requests
- transformers, torch
- feedparser, beautifulsoup4


## 3. Folder Map
- `papertrading/`: project settings, global views, URL router, screener core.
- `users/`: custom user model, auth pages/APIs.
- `trades/`: trade execution APIs, symbol search, bot APIs, bot logic, AI assistant integration.
- `portfolio/`: positions and summary APIs.
- `watchlist/`: multi-watchlist CRUD APIs.
- `analysis/`: chart/sentiment/prediction/fundamentals APIs.
- `admin_panel/`: admin APIs for users/trades/leaderboard.
- `templates/`: all pages.
- `static/js/`: page scripts.
- `static/css/`: global styles.


## 4. Data Model

### 4.1 User (`users.User`)
- Extends `AbstractUser`.
- Fields:
- `role`: `trader | admin`
- `balance`: decimal (starts with 10000 for trader signup)
- `created_at`

### 4.2 Trades (`trades.Trade`)
- Fields:
- `user`, `symbol`, `exchange`, `order_type`, `action`
- `quantity`, `price`, `limit_price`, `stop_loss`
- `status` (`executed`, `pending`, `cancelled`, `triggered`)
- `pnl`, `timestamp`

### 4.3 Portfolio (`portfolio.PortfolioPosition`)
- Fields:
- `user`, `symbol`
- `quantity`, `avg_buy_price`, `current_value`
- Unique: `(user, symbol)`

### 4.4 Watchlist (`watchlist.Watchlist`, `watchlist.WatchlistItem`)
- `Watchlist`: `user`, `name`, timestamps
- `WatchlistItem`: `watchlist`, `symbol`, `added_at`
- Unique:
- `(user, name)` on watchlist
- `(watchlist, symbol)` on item

### 4.5 Analysis Persistence (`analysis.NewsSentiment`, `analysis.Prediction`)
- `NewsSentiment`: symbol/headline/label/score/fetched time
- `Prediction`: symbol/predicted_price/date/model_used

### 4.6 Bot (`trades.TradingBotConfig`, `trades.TradingBotLog`)
- Bot config:
- `is_enabled`
- `strategy`: `ema_cross | trend_pullback | ai_custom`
- `strategy_prompt` (text prompt for `ai_custom`)
- `symbols`, `order_quantity`, `poll_seconds`
- `max_daily_loss`, `max_open_positions`
- `last_run_at`, `last_status`
- Bot log:
- `level`, `message`, `symbol`, `action`, `timestamp`


## 5. URL and Page Routing

Main router: [`papertrading/urls.py`](/e:/P/D3/PaperX/papertrading/urls.py)

Pages:
- `/` landing
- `/dashboard/`
- `/analysis/`
- `/news-analysis/`
- `/screener/`
- `/bot/`
- `/orders/`
- `/watchlist/`
- `/history/`
- `/admin-panel/users/`
- `/admin-panel/trades/`
- `/admin-panel/leaderboard/`

Legacy trade page:
- `/trade/` now redirects to `/analysis/`.


## 6. API Surface

### 6.1 Auth
- `POST /api/auth/register/`
- `POST /api/auth/login/`

### 6.2 Trade + Market Data
- `POST /api/trade/execute/`
- `POST /api/trade/execute-form/`
- `GET /api/trade/history/`
- `DELETE /api/trade/pending/<trade_id>/` (cancel pending order)
- `GET /api/trade/live-price/<symbol>/`
- `GET /api/trade/symbol-search/?q=...`
- `GET /api/trade/chart/<symbol>/?range=...`

### 6.3 Portfolio
- `GET /api/portfolio/`
- `GET /api/portfolio/summary/`

### 6.4 Watchlist
- `GET /api/watchlist/`
- `POST /api/watchlist/create/`
- `PATCH /api/watchlist/rename/<watchlist_id>/`
- `DELETE /api/watchlist/delete/<watchlist_id>/`
- `POST /api/watchlist/add/`
- `DELETE /api/watchlist/remove/<item_id>/`

### 6.5 Analysis
- `GET /api/analysis/chart/<symbol>/?range=...`
- `GET /api/analysis/fundamentals/<symbol>/`
- `GET /api/analysis/sentiment/<symbol>/`
- `GET /api/analysis/sentiment-advanced/<symbol>/?source=...&count=...`
- `GET /api/analysis/prediction/<symbol>/?days=7..30`

### 6.6 Bot
- `GET /api/trade/bot/config/`
- `POST /api/trade/bot/config/`
- `DELETE /api/trade/bot/config/` (reset/delete bot strategy+config)
- `POST /api/trade/bot/toggle/` action in `{start,pause,resume,stop}`
- `POST /api/trade/bot/tick/`
- `GET /api/trade/bot/logs/`
- `POST /api/trade/bot/assistant/`
- `GET /api/trade/bot/assistant-health/`

### 6.7 Screener
- `POST /api/screener/run/`
- `GET /api/screener/sectors/`

### 6.8 Admin APIs
- `GET /api/admin/users/`
- `GET /api/admin/trades/`
- `GET /api/admin/leaderboard/?sort=total_profit|return_pct|trade_count|current_balance`


## 7. Major Module Behavior

## 7.1 Trade Execution Rules
Implemented in [`trades/services.py`](/e:/P/D3/PaperX/trades/services.py)
- Symbol resolve:
- bare symbol tries `.NS`, `.BO`, raw, and crypto forms.
- Order types:
- market: immediate at live price
- limit:
- buy executes only if `live <= limit`
- sell executes only if `live >= limit`
- otherwise stored as `pending`
- Buy validation:
- must have enough virtual balance.
- Sell validation:
- must have enough quantity.

## 7.2 Watchlist
Implemented in [`watchlist/views.py`](/e:/P/D3/PaperX/watchlist/views.py)
- Multiple watchlists per user.
- Rename/delete watchlist.
- Add/remove items.
- API returns LTP, previous close, day change, day % change for each row.

## 7.3 Dashboard
Template: [`templates/dashboard.html`](/e:/P/D3/PaperX/templates/dashboard.html)  
Script: `static/js/dashboard.js`
- Kite-like split layout.
- Left: watchlist/search/actions/market-depth/order ticket.
- Right: equity summary, holdings, recent trades.
- Holdings symbols and order symbols route to analysis.
- Hover actions and order modal logic are in dashboard JS.

## 7.4 Analysis Page
Template: [`templates/analysis.html`](/e:/P/D3/PaperX/templates/analysis.html)  
Script: `static/js/analysis.js`
- Symbol search suggestions.
- Multi-range OHLC/candlestick/line/area chart.
- Indicators: RSI/MACD/SMA/EMA/Bollinger.
- Draw toolkit:
- line/free/rect/circle/hline/vline/text
- undo/redo/clear
- drawings stored in localStorage per `(symbol + range)`.
- Buy/Sell quick actions from analysis page.
- Fundamentals table + top cards.
- Prediction chart.
- Basic sentiment + advanced analysis link/panel.

## 7.5 Advanced News Analysis
Template: [`templates/news_analysis.html`](/e:/P/D3/PaperX/templates/news_analysis.html)  
Script: `static/js/news_analysis.js`
- Source selector, headline count with max limit 20.
- Symbol search suggestions.
- Progress bar with adaptive timing.
- Backend source aggregation in [`analysis/services.py`](/e:/P/D3/PaperX/analysis/services.py):
- Google News, Economic Times, LiveMint, Reuters India, Moneycontrol, Yahoo fallback.

## 7.6 Screener
Template: [`templates/screener.html`](/e:/P/D3/PaperX/templates/screener.html)  
Script: `static/js/screener.js`  
Engine: [`papertrading/screener.py`](/e:/P/D3/PaperX/papertrading/screener.py)
- Query builder with typed conditions.
- Sorting/pagination in UI.
- Dynamic universe:
- pulls NSE index constituents via NSE API.
- cached with TTL.
- fallback universe if external fetch fails.
- Sector dropdown fetched from `/api/screener/sectors/` with fallback list in JS.

## 7.7 Bot Engine
UI: [`templates/bot.html`](/e:/P/D3/PaperX/templates/bot.html)  
Script: `static/js/bot.js`  
Backend: [`trades/bot.py`](/e:/P/D3/PaperX/trades/bot.py), [`trades/views.py`](/e:/P/D3/PaperX/trades/views.py)

Supported bot strategies:
- `ema_cross`
- `trend_pullback`
- `ai_custom` (prompt-driven at runtime)

Runtime safeguards:
- Daily loss cutoff -> auto stop.
- Max open positions.
- Balance checks.
- Per-cycle logs.

Pause/Resume behavior:
- `pause` sets `is_enabled=False`, state badge should show Paused.
- `resume/start` sets `is_enabled=True`.

Delete Strategy/Bot button:
- Calls `DELETE /api/trade/bot/config/`.
- Stops bot and resets strategy/config fields.

## 7.8 AI Assistant + Ollama
Module: [`trades/assistant.py`](/e:/P/D3/PaperX/trades/assistant.py)
- Assistant endpoint tries Ollama first.
- If parsing fails, attempts repair pass.
- If still unavailable, fallback parser is used.

Important:
- `Ollama: Connected` only means service + endpoint reachable.
- `AI provider: fallback` means assistant reply was not parseable/usable for that turn.

Environment variables:
- `BOT_ASSISTANT_URL` (default `http://localhost:11434/api/generate`)
- `BOT_ASSISTANT_MODEL` (default `qwen2.5:3b`)


## 8. AI Custom Strategy Symbol Selection Logic
In bot cycle for `ai_custom`:
- If manual symbols exist in config -> uses them.
- Else if prompt text contains explicit symbols (like `TCS.NS`) -> uses those only.
- Else -> auto-picks candidates from dynamic NSE/BSE universe.

This enforces your rule:
- Auto-pick only when prompt does not specify symbols.


## 9. Running the Project

## 9.1 Local setup
1. `python -m venv .venv`
2. activate venv
3. `pip install -r requirements.txt`
4. `python manage.py migrate`
5. `python manage.py runserver`

## 9.2 Ollama setup
1. Install Ollama.
2. Start service.
3. Pull model, example:
- `ollama pull qwen2.5:3b`
- or `ollama pull llama3`
4. Set env var if using non-default model:
- PowerShell: `$env:BOT_ASSISTANT_MODEL="llama3"`
5. Reload Django server.


## 10. Development Workflows

## 10.1 Add new strategy
1. Add choice in `TradingBotConfig.STRATEGY_CHOICES`.
2. Implement strategy function in `trades/bot.py`.
3. Add branch in `run_bot_cycle`.
4. Add UI option in `templates/bot.html` + `static/js/bot.js`.
5. Create and run migration if model changed.

## 10.2 Add new API endpoint
1. Implement view in app `views.py`.
2. Add route in app `urls.py`.
3. Include app URLs in `papertrading/urls.py` if needed.
4. Wire frontend JS.

## 10.3 Add new page
1. Add template in `templates/`.
2. Add page view in `papertrading/views.py`.
3. Add route in `papertrading/urls.py`.
4. Add nav item in `templates/base.html`.
5. Add page JS in `static/js/`.


## 11. Known Constraints / Current Gaps
- Stop-loss auto-trigger background worker (Celery/cron) is not fully implemented as an always-on async executor.
- LLM outputs are probabilistic. JSON repair exists but can still fail if model is unstable.
- `ai_custom` runtime uses LLM-generated decision from snapshot; it is not deterministic like hard-coded rules.
- External dependencies (Yahoo/NSE/news RSS/Ollama) can rate-limit or fail.
- LocalStorage is used for bot profiles and chart drawings (browser-dependent).


## 12. Testing and Validation Checklist
- `python manage.py check`
- Bot config save/start/pause/resume/stop/delete flows.
- `ai_custom` with and without manual symbols.
- Prompt containing explicit symbols should block auto-pick.
- Pending order cancel in Orders page.
- Watchlist LTP/change population.
- Analysis page draw tools + undo/redo + clear.
- Screener sector dropdown loads from API.


## 13. Quick Troubleshooting

### 13.1 "AI provider: fallback" while Ollama shows connected
- Cause: assistant output not parseable/usable that turn.
- Actions:
- Verify model exists: `ollama list`
- Verify env model name matches pulled model.
- Keep prompts concise when sending command-style chat.

### 13.2 Symbol search empty
- Check internet connectivity.
- Yahoo search endpoint may throttle.
- Ensure query length >= 2.

### 13.3 Pending order not cancellable
- Only status `pending` can be deleted.
- Verify row has pending status in Orders table.

### 13.4 UI not reflecting latest JS
- Hard refresh (`Ctrl+F5`) to bust cached scripts.


## 14. Security and Production Notes
- `SECRET_KEY` is dev placeholder.
- `DEBUG=True` and SQLite are dev-only.
- Add production settings:
- environment-based secrets
- PostgreSQL
- static files pipeline
- proper allowed hosts
- HTTPS and secure cookies
- process manager + background task runner for always-on bot


## 15. Recommended Next Roadmap
1. Add true asynchronous stop-loss/trigger worker (Celery + Redis).
2. Add deterministic strategy DSL parser for `ai_custom` prompt auditing.
3. Add backtest page with strategy replay before live paper execution.
4. Add bot simulation report per cycle (hit rate, RR, drawdown, rejected reasons).
5. Add unit tests for trade execution, bot cycle, screener parser.
6. Add API throttling/caching for external providers.
7. Add production deployment profile.


## 16. Key Files to Start From
- Core routing: [`papertrading/urls.py`](/e:/P/D3/PaperX/papertrading/urls.py)
- Project views: [`papertrading/views.py`](/e:/P/D3/PaperX/papertrading/views.py)
- Trade execution: [`trades/services.py`](/e:/P/D3/PaperX/trades/services.py)
- Bot core: [`trades/bot.py`](/e:/P/D3/PaperX/trades/bot.py)
- Bot assistant (Ollama): [`trades/assistant.py`](/e:/P/D3/PaperX/trades/assistant.py)
- Analysis services: [`analysis/services.py`](/e:/P/D3/PaperX/analysis/services.py)
- Screener engine: [`papertrading/screener.py`](/e:/P/D3/PaperX/papertrading/screener.py)
- Bot page script: [`static/js/bot.js`](/e:/P/D3/PaperX/static/js/bot.js)
- Analysis page script: [`static/js/analysis.js`](/e:/P/D3/PaperX/static/js/analysis.js)
- Dashboard script: [`static/js/dashboard.js`](/e:/P/D3/PaperX/static/js/dashboard.js)

