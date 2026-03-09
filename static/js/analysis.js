let indicatorChart;
let predictionChart;
let currentChartData = null;
let currentRange = '1d';
let autoRefreshTimer = null;
let activeDrawTool = 'pan';
let currentResolvedSymbol = '';
let drawUndoStack = [];
let drawRedoStack = [];
let isApplyingHistory = false;
let lastAnalyzedSymbol = '';
let analysisSearchDebounce = null;
let advancedNewsProgressTimer = null;
const MAX_DRAW_HISTORY = 80;
const ADVANCED_NEWS_MAX = 20;

function byId(id) {
  return document.getElementById(id);
}

function csrfToken() {
  return document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] || '';
}

function drawingKey(symbol) {
  return `analysis:drawings:${symbol}:${currentRange}`;
}

function snapshotDrawState(gd) {
  if (!gd || !gd.layout) return { shapes: [], annotations: [] };
  const shapes = Array.isArray(gd.layout.shapes) ? gd.layout.shapes : [];
  const annotations = Array.isArray(gd.layout.annotations) ? gd.layout.annotations : [];
  return JSON.parse(JSON.stringify({ shapes, annotations }));
}

function statesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

function pushUndoState(gd) {
  const next = snapshotDrawState(gd);
  const last = drawUndoStack[drawUndoStack.length - 1];
  if (last && statesEqual(last, next)) return;
  drawUndoStack.push(next);
  if (drawUndoStack.length > MAX_DRAW_HISTORY) {
    drawUndoStack = drawUndoStack.slice(drawUndoStack.length - MAX_DRAW_HISTORY);
  }
  drawRedoStack = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoBtn = byId('undo-drawings-btn');
  const redoBtn = byId('redo-drawings-btn');
  if (undoBtn) undoBtn.disabled = drawUndoStack.length <= 1;
  if (redoBtn) redoBtn.disabled = drawRedoStack.length === 0;
}

function applyDrawState(state) {
  const gd = byId('price-chart');
  if (!gd || !state) return;
  isApplyingHistory = true;
  Plotly.relayout(gd, { shapes: state.shapes || [], annotations: state.annotations || [] })
    .finally(() => {
      isApplyingHistory = false;
      saveDrawings(currentResolvedSymbol);
      updateHistoryButtons();
    });
}

function undoDrawings() {
  if (drawUndoStack.length <= 1) return;
  const current = drawUndoStack.pop();
  drawRedoStack.push(current);
  const prev = drawUndoStack[drawUndoStack.length - 1];
  applyDrawState(prev);
}

function redoDrawings() {
  if (!drawRedoStack.length) return;
  const next = drawRedoStack.pop();
  drawUndoStack.push(next);
  applyDrawState(next);
}

function loadDrawings(symbol) {
  if (!symbol) return { shapes: [], annotations: [] };
  try {
    const raw = localStorage.getItem(drawingKey(symbol));
    if (!raw) return { shapes: [], annotations: [] };
    const parsed = JSON.parse(raw);
    return {
      shapes: Array.isArray(parsed.shapes) ? parsed.shapes : [],
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    };
  } catch (_) {
    return { shapes: [], annotations: [] };
  }
}

function saveDrawings(symbol) {
  const gd = byId('price-chart');
  if (!gd || !gd.layout || !symbol) return;
  const payload = {
    shapes: Array.isArray(gd.layout.shapes) ? gd.layout.shapes : [],
    annotations: Array.isArray(gd.layout.annotations) ? gd.layout.annotations : [],
  };
  try {
    localStorage.setItem(drawingKey(symbol), JSON.stringify(payload));
  } catch (_) {}
}

function drawColor() {
  return byId('draw-color')?.value || '#2563eb';
}

function drawWidth() {
  const n = Number(byId('draw-width')?.value || 2);
  if (Number.isNaN(n)) return 2;
  return Math.min(8, Math.max(1, n));
}

function updateActiveToolButton() {
  document.querySelectorAll('.draw-tool-btn').forEach((btn) => {
    btn.classList.toggle('btn-primary', btn.dataset.drawTool === activeDrawTool);
    btn.classList.toggle('btn-outline-secondary', btn.dataset.drawTool !== activeDrawTool);
  });
}

function getDrawRelayoutPatch(tool) {
  const line = { color: drawColor(), width: drawWidth() };
  if (tool === 'pan') return { dragmode: 'pan' };
  if (tool === 'drawline') return { dragmode: 'drawline', newshape: { line } };
  if (tool === 'drawrect') return { dragmode: 'drawrect', newshape: { line, fillcolor: 'rgba(37,99,235,0.08)' } };
  if (tool === 'drawcircle') return { dragmode: 'drawcircle', newshape: { line, fillcolor: 'rgba(37,99,235,0.08)' } };
  if (tool === 'drawopenpath') return { dragmode: 'drawopenpath', newshape: { line } };
  return { dragmode: 'pan' };
}

function addSingleClickDrawing(tool, point) {
  const gd = byId('price-chart');
  if (!gd || !point) return;
  const line = { color: drawColor(), width: drawWidth() };
  const shapes = Array.isArray(gd.layout.shapes) ? [...gd.layout.shapes] : [];
  const annotations = Array.isArray(gd.layout.annotations) ? [...gd.layout.annotations] : [];

  if (tool === 'hline') {
    shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: point.y, y1: point.y, line });
    Plotly.relayout(gd, { shapes });
    return;
  }
  if (tool === 'vline') {
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: point.x, x1: point.x, y0: 0, y1: 1, line });
    Plotly.relayout(gd, { shapes });
    return;
  }
  if (tool === 'text') {
    const text = window.prompt('Annotation text');
    if (!text) return;
    annotations.push({ x: point.x, y: point.y, xref: 'x', yref: 'y', text, showarrow: true, arrowhead: 2, arrowcolor: line.color, font: { color: line.color } });
    Plotly.relayout(gd, { annotations });
  }
}

function attachDrawingHandlers(symbol) {
  const gd = byId('price-chart');
  if (!gd) return;
  gd.removeAllListeners?.('plotly_relayout');
  gd.removeAllListeners?.('plotly_click');

  gd.on('plotly_relayout', () => {
    if (!isApplyingHistory) {
      pushUndoState(gd);
    }
    saveDrawings(currentResolvedSymbol || symbol);
  });
  gd.on('plotly_click', (ev) => {
    const pt = ev?.points?.[0];
    if (!pt) return;
    if (['hline', 'vline', 'text'].includes(activeDrawTool)) {
      addSingleClickDrawing(activeDrawTool, pt);
      saveDrawings(currentResolvedSymbol || symbol);
    }
  });
}

function fmtNum(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtMoney(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function setOrderStatus(message, isError = false) {
  const el = byId('analysis-order-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = `mb-2 small ${isError ? 'text-danger' : 'text-success'}`;
}

function symbolToExchange(symbol) {
  const s = (symbol || '').toUpperCase();
  if (s.endsWith('.BO')) return 'BSE';
  return 'NSE';
}

function clearAnalysisSuggestions() {
  const box = byId('analysis-search-results');
  if (box) box.innerHTML = '';
}

function startAdvancedNewsLoading() {
  const wrap = byId('advanced-news-progress-wrap');
  const bar = byId('advanced-news-progress-bar');
  if (!wrap || !bar) return;
  wrap.classList.remove('d-none');
  bar.style.width = '6%';
  let value = 6;
  if (advancedNewsProgressTimer) clearInterval(advancedNewsProgressTimer);
  advancedNewsProgressTimer = setInterval(() => {
    value = Math.min(92, value + Math.max(2, (92 - value) * 0.12));
    bar.style.width = `${Math.round(value)}%`;
  }, 120);
}

function stopAdvancedNewsLoading() {
  const wrap = byId('advanced-news-progress-wrap');
  const bar = byId('advanced-news-progress-bar');
  if (!wrap || !bar) return;
  if (advancedNewsProgressTimer) {
    clearInterval(advancedNewsProgressTimer);
    advancedNewsProgressTimer = null;
  }
  bar.style.width = '100%';
  setTimeout(() => wrap.classList.add('d-none'), 350);
}

async function runAdvancedNewsAnalysis() {
  const statusEl = byId('advanced-news-status');
  const listEl = byId('advanced-news-list');
  if (!statusEl || !listEl) return;

  const symbol = (currentResolvedSymbol || byId('symbol-input')?.value || '').trim().toUpperCase();
  if (!symbol) {
    statusEl.textContent = 'Analyze a symbol first.';
    statusEl.className = 'small mt-2 text-danger';
    return;
  }

  const source = byId('advanced-news-source')?.value || 'all';
  const countEl = byId('advanced-news-count');
  let count = Number(countEl?.value || 8);
  if (Number.isNaN(count)) count = 8;
  count = Math.min(ADVANCED_NEWS_MAX, Math.max(1, count));
  if (countEl) countEl.value = String(count);

  listEl.innerHTML = '';
  statusEl.textContent = 'Running advanced analysis...';
  statusEl.className = 'small mt-2 text-muted';
  startAdvancedNewsLoading();

  try {
    const res = await fetch(
      `/api/analysis/sentiment-advanced/${encodeURIComponent(symbol)}/?source=${encodeURIComponent(source)}&count=${count}`
    );
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || 'Advanced analysis failed.';
      statusEl.className = 'small mt-2 text-danger';
      return;
    }

    const articles = data.articles || [];
    statusEl.textContent = `Overall: ${data.overall} (${data.score}) | Source: ${source} | Analyzed: ${articles.length}/${data.max_limit}`;
    statusEl.className = 'small mt-2 text-success';
    articles.forEach((a) => {
      listEl.innerHTML += `<li>${a.sentiment_label}: ${a.headline}</li>`;
    });
    if (!articles.length) listEl.innerHTML = '<li>No headlines found.</li>';
  } catch (_) {
    statusEl.textContent = 'Advanced analysis failed.';
    statusEl.className = 'small mt-2 text-danger';
  } finally {
    stopAdvancedNewsLoading();
  }
}

function renderAnalysisSuggestions(items) {
  const box = byId('analysis-search-results');
  if (!box) return;
  if (!items || !items.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = items
    .map((it) => `
      <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-start" data-analysis-symbol="${it.symbol}">
        <span>
          <strong>${it.symbol}</strong><br>
          <small class="text-muted">${it.name || ''}</small>
        </span>
        <small class="text-muted">${it.exchange || ''}</small>
      </button>
    `)
    .join('');
}

async function runAnalysisSymbolSearch(q) {
  if (!q || q.trim().length < 2) {
    clearAnalysisSuggestions();
    return;
  }
  try {
    const res = await fetch(`/api/trade/symbol-search/?q=${encodeURIComponent(q.trim())}`);
    const data = await res.json();
    if (!res.ok) {
      clearAnalysisSuggestions();
      return;
    }
    renderAnalysisSuggestions(data.results || []);
  } catch (_) {
    clearAnalysisSuggestions();
  }
}

async function refreshCurrentPrice(symbol, fallback = null) {
  const el = byId('analysis-current-price');
  if (!el) return;
  if (!symbol) {
    el.textContent = '-';
    return;
  }
  try {
    const res = await fetch(`/api/trade/live-price/${encodeURIComponent(symbol)}/`);
    const data = await res.json();
    if (res.ok && data.price !== null && data.price !== undefined) {
      el.textContent = fmtMoney(data.price);
      return;
    }
  } catch (_) {}
  el.textContent = fmtMoney(fallback);
}

function baseSymbolOf(symbol) {
  return (symbol || '').trim().toUpperCase().replace(/\.NS$|\.BO$|-USD$/i, '');
}

async function placeAnalysisOrder(action) {
  const qty = Number(byId('analysis-order-qty')?.value || 0);
  if (!lastAnalyzedSymbol) {
    setOrderStatus('Analyze a symbol first.', true);
    return;
  }
  if (!qty || qty < 1) {
    setOrderStatus('Enter valid quantity.', true);
    return;
  }
  setOrderStatus('Placing order...', false);
  const payload = {
    symbol: lastAnalyzedSymbol,
    exchange: symbolToExchange(lastAnalyzedSymbol),
    order_type: 'market',
    action: action === 'sell' ? 'sell' : 'buy',
    quantity: qty,
  };
  try {
    const res = await fetch('/api/trade/execute/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setOrderStatus(data.error || 'Order failed.', true);
      return;
    }
    setOrderStatus(data.message || `Order ${payload.action} placed.`);
  } catch (_) {
    setOrderStatus('Order failed.', true);
  }
}

function renderFundamentalsFallback(symbol, errorMsg) {
  const exchange = symbol.endsWith('.BO') ? 'BSE' : symbol.endsWith('-USD') ? 'CRYPTO' : 'NSE';
  const base = baseSymbolOf(symbol) || '-';
  renderFundamentals({
    name: base,
    exchange,
    price: null,
    market_cap: null,
    pe_ratio: null,
    week52_low: null,
    week52_high: null,
    open: null,
    previous_close: null,
    day_high: null,
    day_low: null,
    volume: null,
    avg_volume: null,
    eps: null,
    beta: null,
    dividend_yield: null,
    sector: null,
    industry: null,
  });
  const status = byId('fundamentals-status');
  if (status) status.textContent = errorMsg || 'Fundamentals unavailable for this symbol.';
}

function renderFundamentals(f) {
  const status = byId('fundamentals-status');
  if (status) status.textContent = '';

  byId('f-price').textContent = fmtMoney(f.price);
  byId('f-market-cap').textContent = fmtNum(f.market_cap);
  byId('f-pe').textContent = fmtNum(f.pe_ratio);
  byId('f-52w').textContent = `${fmtNum(f.week52_low)} - ${fmtNum(f.week52_high)}`;

  byId('fd-name').textContent = f.name || '-';
  byId('fd-exchange').textContent = f.exchange || '-';
  byId('fd-open').textContent = fmtMoney(f.open);
  byId('fd-prev-close').textContent = fmtMoney(f.previous_close);
  byId('fd-day-high').textContent = fmtMoney(f.day_high);
  byId('fd-day-low').textContent = fmtMoney(f.day_low);
  byId('fd-volume').textContent = fmtNum(f.volume);
  byId('fd-avg-volume').textContent = fmtNum(f.avg_volume);
  byId('fd-eps').textContent = fmtNum(f.eps);
  byId('fd-beta').textContent = fmtNum(f.beta);
  byId('fd-div-yield').textContent = f.dividend_yield === null || f.dividend_yield === undefined ? '-' : `${fmtNum(f.dividend_yield)}%`;
  byId('fd-sector').textContent = f.sector || '-';
  byId('fd-industry').textContent = f.industry || '-';
}

function setActiveRangeButton() {
  document.querySelectorAll('#range-controls [data-range]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === currentRange);
  });
}

function buildPriceTraces(symbol, chart) {
  const chartType = byId('chart-type')?.value || 'candlestick';
  const traces = [];
  const x = chart.labels;

  if (chartType === 'line' || chartType === 'area') {
    traces.push({
      x,
      y: chart.close,
      type: 'scatter',
      mode: 'lines',
      fill: chartType === 'area' ? 'tozeroy' : undefined,
      name: `${symbol} Close`,
      line: { color: '#2563eb', width: 2 },
    });
  } else if (chartType === 'ohlc') {
    traces.push({
      x,
      open: chart.open,
      high: chart.high,
      low: chart.low,
      close: chart.close,
      type: 'ohlc',
      name: symbol,
    });
  } else {
    traces.push({
      x,
      open: chart.open,
      high: chart.high,
      low: chart.low,
      close: chart.close,
      type: 'candlestick',
      name: symbol,
    });
  }

  if (byId('overlay-sma')?.checked) {
    traces.push({
      x,
      y: chart.sma20,
      type: 'scatter',
      mode: 'lines',
      name: 'SMA20',
      line: { color: '#f59e0b', width: 1.5 },
    });
  }
  if (byId('overlay-ema')?.checked) {
    traces.push({
      x,
      y: chart.ema20,
      type: 'scatter',
      mode: 'lines',
      name: 'EMA20',
      line: { color: '#16a34a', width: 1.5 },
    });
  }
  if (byId('overlay-bb')?.checked) {
    traces.push({
      x,
      y: chart.bb_upper,
      type: 'scatter',
      mode: 'lines',
      name: 'BB Upper',
      line: { color: '#a855f7', width: 1 },
    });
    traces.push({
      x,
      y: chart.bb_lower,
      type: 'scatter',
      mode: 'lines',
      name: 'BB Lower',
      line: { color: '#a855f7', width: 1 },
    });
  }

  return traces;
}

function renderPriceChart(symbol, chart) {
  const saved = loadDrawings(symbol);
  currentResolvedSymbol = symbol;
  const traces = buildPriceTraces(symbol, chart);
  Plotly.react(
    'price-chart',
    traces,
    {
      title: `${symbol} Price`,
      margin: { l: 50, r: 20, t: 45, b: 40 },
      xaxis: { rangeslider: { visible: true } },
      yaxis: { fixedrange: false },
      shapes: saved.shapes,
      annotations: saved.annotations,
      legend: { orientation: 'h' },
    },
    {
      responsive: true,
      displaylogo: false,
      editable: true,
      modeBarButtonsToAdd: ['drawline', 'drawopenpath', 'drawrect', 'drawcircle', 'eraseshape'],
    }
  );
  Plotly.relayout('price-chart', getDrawRelayoutPatch(activeDrawTool));
  attachDrawingHandlers(symbol);
  const gd = byId('price-chart');
  drawUndoStack = [snapshotDrawState(gd)];
  drawRedoStack = [];
  updateHistoryButtons();
}

function renderQuickStats(chart) {
  const close = (chart.close || []).filter((v) => v !== null && v !== undefined);
  if (!close.length) {
    byId('q-change').textContent = '-';
    byId('q-hl').textContent = '-';
    byId('q-volatility').textContent = '-';
    byId('q-points').textContent = '-';
    return;
  }

  const first = close[0];
  const last = close[close.length - 1];
  const diff = last - first;
  const diffPct = first ? (diff / first) * 100 : 0;
  const high = Math.max(...close);
  const low = Math.min(...close);

  const returns = [];
  for (let i = 1; i < close.length; i += 1) {
    if (close[i - 1]) returns.push((close[i] - close[i - 1]) / close[i - 1]);
  }
  const avg = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((a, b) => a + (b - avg) ** 2, 0) / returns.length : 0;
  const volPct = Math.sqrt(variance) * 100;

  byId('q-change').textContent = `${diff >= 0 ? '+' : ''}${fmtNum(diff)} (${diffPct >= 0 ? '+' : ''}${fmtNum(diffPct)}%)`;
  byId('q-hl').textContent = `${fmtNum(high)} / ${fmtNum(low)}`;
  byId('q-volatility').textContent = `${fmtNum(volPct)}%`;
  byId('q-points').textContent = String(close.length);
}

function renderIndicatorChart(chart) {
  const mode = byId('indicator-mode')?.value || 'all';
  const datasets = [];

  if (mode === 'all' || mode === 'rsi') {
    datasets.push({ label: 'RSI', data: chart.rsi, borderColor: '#f59e0b', pointRadius: 0, tension: 0.2, yAxisID: 'y' });
  }
  if (mode === 'all' || mode === 'macd') {
    datasets.push({ label: 'MACD', data: chart.macd, borderColor: '#2563eb', pointRadius: 0, tension: 0.2, yAxisID: 'y1' });
    datasets.push({ label: 'Signal', data: chart.signal, borderColor: '#16a34a', pointRadius: 0, tension: 0.2, yAxisID: 'y1' });
  }

  const ctx1 = byId('indicator-chart')?.getContext('2d');
  if (!ctx1) return;
  if (indicatorChart) indicatorChart.destroy();
  indicatorChart = new Chart(ctx1, {
    type: 'line',
    data: { labels: chart.labels, datasets },
    options: {
      responsive: true,
      scales: {
        x: { display: false },
        y: { position: 'left' },
        y1: { position: 'right', grid: { drawOnChartArea: false } },
      },
    },
  });
}

function renderPredictionChart(pred) {
  const ctx2 = byId('prediction-chart')?.getContext('2d');
  if (!ctx2) return;
  if (predictionChart) predictionChart.destroy();
  predictionChart = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: (pred.forecast || []).map((x) => x.prediction_date),
      datasets: [{ label: 'Predicted Price', data: (pred.forecast || []).map((x) => x.predicted_price), borderColor: '#dc2626', tension: 0.2 }],
    },
    options: { responsive: true },
  });
}

async function runAnalysis() {
  const symbolInput = byId('symbol-input');
  if (!symbolInput) return;

  const symbol = symbolInput.value.trim().toUpperCase();
  if (!symbol) return;

  try { localStorage.setItem('analysis:lastSymbol', symbol); } catch (_) {}

  const chartRes = await fetch(`/api/analysis/chart/${symbol}/?range=${encodeURIComponent(currentRange)}`)
    .then((r) => r.json())
    .catch((e) => ({ error: e.message }));

  if (chartRes.error) {
    byId('sentiment-score').textContent = `Chart error: ${chartRes.error}`;
    lastAnalyzedSymbol = '';
    refreshCurrentPrice('', null);
    return;
  }

  const resolvedSymbol = (chartRes.symbol || symbol || '').trim().toUpperCase();
  lastAnalyzedSymbol = resolvedSymbol;
  currentChartData = chartRes;
  renderPriceChart(resolvedSymbol, chartRes);
  renderIndicatorChart(chartRes);
  renderQuickStats(chartRes);
  refreshCurrentPrice(resolvedSymbol, (chartRes.close || []).slice(-1)[0]);

  const results = await Promise.allSettled([
    fetch(`/api/analysis/sentiment/${resolvedSymbol}/`).then((r) => r.json()),
    fetch(`/api/analysis/prediction/${resolvedSymbol}/?days=14`).then((r) => r.json()),
    fetch(`/api/analysis/fundamentals/${resolvedSymbol}/`).then((r) => r.json()),
  ]);

  const [sentResult, predResult, fundResult] = results;

  const list = byId('sentiment-list');
  list.innerHTML = '';
  if (sentResult.status === 'fulfilled' && !sentResult.value.error) {
    const sentiment = sentResult.value;
    byId('sentiment-score').textContent = `Overall: ${sentiment.overall} (${sentiment.score})`;
    byId('sentiment-model').textContent = `Model: ${sentiment.model_used || 'N/A'}`;
    (sentiment.articles || []).slice(0, 8).forEach((a) => {
      list.innerHTML += `<li>${a.sentiment_label}: ${a.headline}</li>`;
    });
  } else {
    byId('sentiment-score').textContent = 'Overall: Unavailable';
    byId('sentiment-model').textContent = '';
  }

  if (predResult.status === 'fulfilled' && !predResult.value.error) {
    renderPredictionChart(predResult.value);
  } else if (predictionChart) {
    predictionChart.destroy();
  }

  if (fundResult.status === 'fulfilled' && !fundResult.value.error) {
    renderFundamentals(fundResult.value);
  } else {
    const msg = fundResult.status === 'fulfilled' ? fundResult.value.error : 'Fundamentals request failed';
    renderFundamentalsFallback(resolvedSymbol, msg);
  }
}

function applyChartControlEvents() {
  byId('chart-type')?.addEventListener('change', () => {
    const symbol = byId('symbol-input')?.value.trim().toUpperCase();
    if (currentChartData && symbol) renderPriceChart(symbol, currentChartData);
  });

  byId('indicator-mode')?.addEventListener('change', () => {
    if (currentChartData) renderIndicatorChart(currentChartData);
  });

  document.querySelectorAll('.overlay-toggle').forEach((el) => {
    el.addEventListener('change', () => {
      const symbol = byId('symbol-input')?.value.trim().toUpperCase();
      if (currentChartData && symbol) renderPriceChart(symbol, currentChartData);
    });
  });

  byId('reset-zoom-btn')?.addEventListener('click', () => {
    const gd = byId('price-chart');
    if (!gd || !gd.data) return;
    Plotly.relayout(gd, {
      'xaxis.range': null,
      'yaxis.range': null,
      'xaxis.autorange': true,
      'yaxis.autorange': true,
      'xaxis.rangeslider.range': null,
    });
  });

  document.querySelectorAll('.draw-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDrawTool = btn.dataset.drawTool || 'pan';
      updateActiveToolButton();
      Plotly.relayout('price-chart', getDrawRelayoutPatch(activeDrawTool));
    });
  });

  byId('draw-color')?.addEventListener('change', () => {
    Plotly.relayout('price-chart', getDrawRelayoutPatch(activeDrawTool));
  });
  byId('draw-width')?.addEventListener('input', () => {
    Plotly.relayout('price-chart', getDrawRelayoutPatch(activeDrawTool));
  });

  byId('clear-drawings-btn')?.addEventListener('click', () => {
    const gd = byId('price-chart');
    if (gd) pushUndoState(gd);
    Plotly.relayout('price-chart', { shapes: [], annotations: [] });
    saveDrawings(currentResolvedSymbol || byId('symbol-input')?.value?.trim()?.toUpperCase() || '');
  });
  byId('undo-drawings-btn')?.addEventListener('click', undoDrawings);
  byId('redo-drawings-btn')?.addEventListener('click', redoDrawings);

  document.querySelectorAll('#range-controls [data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentRange = btn.dataset.range || '6mo';
      setActiveRangeButton();
      runAnalysis();
    });
  });

  byId('auto-refresh')?.addEventListener('change', (e) => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (e.target.checked) {
      autoRefreshTimer = setInterval(() => {
        runAnalysis();
      }, 20000);
    }
  });
}

function init() {
  byId('analyze-btn')?.addEventListener('click', runAnalysis);
  byId('analysis-buy-btn')?.addEventListener('click', () => placeAnalysisOrder('buy'));
  byId('analysis-sell-btn')?.addEventListener('click', () => placeAnalysisOrder('sell'));
  byId('symbol-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearAnalysisSuggestions();
      runAnalysis();
    }
  });
  byId('symbol-input')?.addEventListener('input', (e) => {
    clearTimeout(analysisSearchDebounce);
    analysisSearchDebounce = setTimeout(() => runAnalysisSymbolSearch(e.target.value), 220);
  });
  byId('analysis-search-results')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-analysis-symbol]');
    if (!btn) return;
    const input = byId('symbol-input');
    if (!input) return;
    input.value = btn.dataset.analysisSymbol || '';
    clearAnalysisSuggestions();
    runAnalysis();
  });
  byId('advanced-news-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    byId('advanced-news-panel')?.classList.toggle('d-none');
  });
  byId('advanced-news-run')?.addEventListener('click', runAdvancedNewsAnalysis);
  byId('advanced-news-count')?.addEventListener('input', (e) => {
    const val = Number(e.target.value || 0);
    if (Number.isNaN(val) || val < 1) return;
    if (val > ADVANCED_NEWS_MAX) e.target.value = String(ADVANCED_NEWS_MAX);
  });
  document.addEventListener('click', (e) => {
    const inInput = e.target.closest('#symbol-input');
    const inBox = e.target.closest('#analysis-search-results');
    if (!inInput && !inBox) clearAnalysisSuggestions();
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
    if (typing) return;
    const key = (e.key || '').toLowerCase();
    if (e.ctrlKey && !e.shiftKey && key === 'z') {
      e.preventDefault();
      undoDrawings();
    } else if ((e.ctrlKey && key === 'y') || (e.ctrlKey && e.shiftKey && key === 'z')) {
      e.preventDefault();
      redoDrawings();
    }
  });

  applyChartControlEvents();
  setActiveRangeButton();
  updateActiveToolButton();
  updateHistoryButtons();

  const symbolInputEl = byId('symbol-input');
  const urlSymbol = new URLSearchParams(window.location.search).get('symbol');
  let initialSymbol = '';
  if (urlSymbol && urlSymbol.trim()) {
    initialSymbol = urlSymbol.trim().toUpperCase();
  } else {
    try {
      initialSymbol = (localStorage.getItem('analysis:lastSymbol') || '').trim().toUpperCase();
    } catch (_) {
      initialSymbol = '';
    }
  }
  if (symbolInputEl && initialSymbol) symbolInputEl.value = initialSymbol;
  if (symbolInputEl && symbolInputEl.value.trim()) runAnalysis();
}

init();
