function csrfToken() {
  return document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] || '';
}

const form = document.getElementById('trade-form');
const symbolInput = form.querySelector('input[name="symbol"]');
const livePrice = document.getElementById('live-price');
const statusBox = document.getElementById('trade-status');
const graphSymbol = document.getElementById('graph-symbol');
const graphPrice = document.getElementById('graph-price');
const graphChange = document.getElementById('graph-change');
const rangeButtonsWrap = document.getElementById('range-buttons');

let activeRange = '1d';
let chart;
let debounceTimer;

const DEFAULT_SYMBOL = 'RELIANCE.NS';

function clearStickyValuesOnReload() {
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav && nav.type === 'reload') {
    form.reset();
    symbolInput.value = DEFAULT_SYMBOL;
    form.querySelector('input[name="quantity"]').value = '1';
  }
}

function setStatus(html) {
  statusBox.innerHTML = html;
}

function setRangeButton(rangeKey) {
  rangeButtonsWrap.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === rangeKey);
  });
}

function renderLineChart(canvasId, dataset, options = {}) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: dataset,
    options,
  });
}

function renderTradeChart(labels, prices, isPositive) {
  if (chart) chart.destroy();
  const color = isPositive ? '#16a34a' : '#dc2626';
  chart = renderLineChart(
    'trade-chart',
    {
      labels,
      datasets: [
        {
          label: 'Price',
          data: prices,
          borderColor: color,
          backgroundColor: isPositive ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    },
    {
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { ticks: { callback: (value) => `₹${value}` } },
      },
    }
  );
}

async function fetchTradeChart(symbol) {
  const url = `/api/trade/chart/${encodeURIComponent(symbol)}/?range=${activeRange}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Unable to load chart data.');

  const positive = data.change >= 0;
  graphSymbol.textContent = data.symbol;
  graphPrice.textContent = Number(data.latest).toFixed(2);
  graphChange.textContent = `${positive ? '+' : ''}${data.change} (${positive ? '+' : ''}${data.change_pct}%) past ${activeRange.toUpperCase()}`;
  graphChange.className = positive ? 'fw-semibold text-success' : 'fw-semibold text-danger';

  renderTradeChart(data.labels, data.prices, positive);
}

async function refreshPrice(symbol) {
  const res = await fetch(`/api/trade/live-price/${encodeURIComponent(symbol)}/`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Unable to fetch live price.');
  livePrice.textContent = Number(data.price).toFixed(2);
}

async function syncSymbolData() {
  const symbol = symbolInput.value.trim().toUpperCase();
  if (!symbol) {
    livePrice.textContent = '-';
    return;
  }

  try {
    await Promise.all([refreshPrice(symbol), fetchTradeChart(symbol)]);
    setStatus('');
  } catch (err) {
    setStatus(`<div class="alert alert-warning">${err.message}</div>`);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  const res = await fetch('/api/trade/execute/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  setStatus(
    res.ok
      ? `<div class="alert alert-success">${data.message}</div>`
      : `<div class="alert alert-danger">${data.error || 'Trade failed'}</div>`
  );
  if (res.ok) syncSymbolData();
});

symbolInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncSymbolData(), 450);
});

rangeButtonsWrap.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (!btn) return;
  activeRange = btn.dataset.range;
  setRangeButton(activeRange);
  syncSymbolData();
});

clearStickyValuesOnReload();
setRangeButton(activeRange);
syncSymbolData();
setInterval(() => syncSymbolData(), 20000);
