const MAX_NEWS_ITEMS = 20;
let naSearchDebounce = null;
let naProgressTimer = null;
let naProgressStart = 0;
let naProgressEstimateMs = 7000;

function naById(id) {
  return document.getElementById(id);
}

function clearNaSuggestions() {
  const box = naById('na-search-results');
  if (box) box.innerHTML = '';
}

function renderNaSuggestions(items) {
  const box = naById('na-search-results');
  if (!box) return;
  if (!items || !items.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = items
    .map(
      (it) => `
      <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-start" data-na-symbol="${it.symbol}">
        <span>
          <strong>${it.symbol}</strong><br>
          <small class="text-muted">${it.name || ''}</small>
        </span>
        <small class="text-muted">${it.exchange || ''}</small>
      </button>
    `
    )
    .join('');
}

async function runNaSymbolSearch(query) {
  const q = (query || '').trim();
  if (q.length < 2) {
    clearNaSuggestions();
    return;
  }
  try {
    const res = await fetch(`/api/trade/symbol-search/?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) {
      clearNaSuggestions();
      return;
    }
    renderNaSuggestions(data.results || []);
  } catch (_) {
    clearNaSuggestions();
  }
}

function startNaProgress() {
  const wrap = naById('na-progress-wrap');
  const bar = naById('na-progress-bar');
  if (!wrap || !bar) return;
  try {
    const cached = Number(localStorage.getItem('newsAnalysis:avgMs') || 0);
    if (!Number.isNaN(cached) && cached >= 1500) naProgressEstimateMs = Math.min(25000, cached);
  } catch (_) {}
  wrap.classList.remove('d-none');
  bar.style.width = '5%';
  naProgressStart = Date.now();
  if (naProgressTimer) clearInterval(naProgressTimer);
  naProgressTimer = setInterval(() => {
    const elapsed = Date.now() - naProgressStart;
    const pct = Math.max(5, Math.min(94, (elapsed / naProgressEstimateMs) * 94));
    bar.style.width = `${Math.round(pct)}%`;
  }, 110);
}

function stopNaProgress() {
  const wrap = naById('na-progress-wrap');
  const bar = naById('na-progress-bar');
  if (!wrap || !bar) return;
  if (naProgressTimer) {
    clearInterval(naProgressTimer);
    naProgressTimer = null;
  }
  bar.style.width = '100%';
  setTimeout(() => wrap.classList.add('d-none'), 350);
}

async function runNewsAnalysis() {
  const symbol = (naById('na-symbol')?.value || '').trim().toUpperCase();
  const source = naById('na-source')?.value || 'all';
  const countEl = naById('na-count');
  const statusEl = naById('na-status');
  const summaryEl = naById('na-summary');
  const modelEl = naById('na-model');
  const listEl = naById('na-list');

  if (!symbol) {
    statusEl.textContent = 'Enter a symbol.';
    statusEl.className = 'small text-danger';
    return;
  }

  let count = Number(countEl?.value || 8);
  if (Number.isNaN(count)) count = 8;
  count = Math.min(MAX_NEWS_ITEMS, Math.max(1, count));
  if (countEl) countEl.value = String(count);

  statusEl.textContent = 'Running advanced news analysis...';
  statusEl.className = 'small text-muted';
  summaryEl.textContent = '';
  modelEl.textContent = '';
  listEl.innerHTML = '';
  startNaProgress();
  const startedAt = Date.now();

  try {
    const res = await fetch(
      `/api/analysis/sentiment-advanced/${encodeURIComponent(symbol)}/?source=${encodeURIComponent(source)}&count=${count}`
    );
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || 'Analysis failed.';
      statusEl.className = 'small text-danger';
      return;
    }

    statusEl.textContent = `Done. Source: ${source}. Headlines analyzed: ${(data.articles || []).length}/${data.max_limit}.`;
    statusEl.className = 'small text-success';
    summaryEl.textContent = `Overall: ${data.overall} (${data.score})`;
    modelEl.textContent = `Model: ${data.model_used || 'N/A'}`;
    (data.articles || []).forEach((a) => {
      listEl.innerHTML += `<li>${a.sentiment_label}: ${a.headline}</li>`;
    });
    if (!(data.articles || []).length) {
      listEl.innerHTML = '<li>No headlines found.</li>';
    }
  } catch (_) {
    statusEl.textContent = 'Analysis failed.';
    statusEl.className = 'small text-danger';
  } finally {
    const took = Date.now() - startedAt;
    try {
      const prev = Number(localStorage.getItem('newsAnalysis:avgMs') || 0);
      const next = prev > 0 ? Math.round(prev * 0.7 + took * 0.3) : took;
      localStorage.setItem('newsAnalysis:avgMs', String(next));
    } catch (_) {}
    stopNaProgress();
  }
}

function initNa() {
  naById('na-run')?.addEventListener('click', runNewsAnalysis);
  naById('na-symbol')?.addEventListener('input', (e) => {
    clearTimeout(naSearchDebounce);
    naSearchDebounce = setTimeout(() => runNaSymbolSearch(e.target.value), 220);
  });
  naById('na-symbol')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearNaSuggestions();
      runNewsAnalysis();
    }
  });
  naById('na-search-results')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-na-symbol]');
    if (!btn) return;
    const input = naById('na-symbol');
    if (!input) return;
    input.value = btn.dataset.naSymbol || '';
    clearNaSuggestions();
  });
  naById('na-count')?.addEventListener('input', (e) => {
    const n = Number(e.target.value || 0);
    if (!Number.isNaN(n) && n > MAX_NEWS_ITEMS) e.target.value = String(MAX_NEWS_ITEMS);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#na-symbol') && !e.target.closest('#na-search-results')) clearNaSuggestions();
  });
}

initNa();
