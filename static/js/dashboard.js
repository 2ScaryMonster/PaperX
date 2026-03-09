function currency(v) {
  return `₹${Number(v || 0).toFixed(2)}`;
}

function csrfToken() {
  return document.cookie.split("; ").find((row) => row.startsWith("csrftoken="))?.split("=")[1] || "";
}

let watchItems = [];
let watchlists = [];
let selectedWatchlistId = null;
let searchDebounce;
let depthModal;
let orderModal;
let orderSide = "buy";
let orderBaseSymbol = "";
let orderNse = null;
let orderBse = null;
let dragState = null;
let orderMode = "quick";

function getExchangeLabel(symbol) {
  const s = (symbol || "").toUpperCase();
  if (s.endsWith(".NS")) return "NSE";
  if (s.endsWith(".BO")) return "BSE";
  if (s.endsWith("-USD")) return "CRYPTO";
  return "";
}

async function getLtp(symbol, fallback = null) {
  try {
    const res = await fetch(`/api/trade/live-price/${encodeURIComponent(symbol)}/`);
    const data = await res.json();
    if (!res.ok) return fallback;
    return Number(data.price);
  } catch (_) {
    return fallback;
  }
}

function baseSymbol(symbol) {
  return (symbol || "").trim().toUpperCase().replace(/\.NS$|\.BO$|-USD$/i, "");
}

function quoteSymbol(base, exchange) {
  if (exchange === "BSE") return `${base}.BO`;
  if (exchange === "CRYPTO") return `${base}-USD`;
  return `${base}.NS`;
}

function selectedOrderExchange() {
  return document.querySelector("input[name='ot-exchange']:checked")?.value || "NSE";
}

function currentQtyValue() {
  return Number((orderMode === "regular" ? document.getElementById("ot-qty-regular") : document.getElementById("ot-qty")).value || 0);
}

function currentPriceValue() {
  return Number((orderMode === "regular" ? document.getElementById("ot-price-regular") : document.getElementById("ot-price")).value || 0);
}

async function refreshOrderAvail() {
  const qty = currentQtyValue();
  const price = currentPriceValue();
  const req = qty * price;
  document.getElementById("ot-req").textContent = currency(req);
  try {
    const p = await fetch("/api/portfolio/").then((r) => r.json());
    document.getElementById("ot-avail").textContent = currency(p.balance || 0);
  } catch (_) {
    document.getElementById("ot-avail").textContent = "-";
  }
}

function syncOrderPriceFromExchange() {
  const exchange = selectedOrderExchange();
  const px = exchange === "BSE" ? orderBse : orderNse;
  if (px !== null && px !== undefined) {
    document.getElementById("ot-price").value = Number(px).toFixed(2);
    document.getElementById("ot-price-regular").value = Number(px).toFixed(2);
  }
  refreshOrderAvail();
}

function setOrderMode(mode) {
  orderMode = mode === "regular" ? "regular" : "quick";
  document.querySelectorAll(".kite-order-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.orderMode === orderMode);
  });
  document.getElementById("ot-quick-body").classList.toggle("d-none", orderMode !== "quick");
  document.getElementById("ot-regular-body").classList.toggle("d-none", orderMode !== "regular");
  refreshOrderAvail();
}

async function openOrderTicket(symbol, side, fallbackLtp = null) {
  orderSide = side === "sell" ? "sell" : "buy";
  orderBaseSymbol = baseSymbol(symbol);
  orderNse = null;
  orderBse = null;

  const card = document.getElementById("order-ticket-card");
  card.classList.toggle("sell-mode", orderSide === "sell");
  card.classList.toggle("buy-mode", orderSide !== "sell");
  document.getElementById("ot-submit-btn").textContent = orderSide === "sell" ? "Sell" : "Buy";
  document.getElementById("ot-symbol").textContent = orderBaseSymbol || symbol;
  document.getElementById("ot-status").textContent = "";
  document.getElementById("ot-qty").value = 1;
  document.getElementById("ot-qty-regular").value = 1;
  document.getElementById("ot-price").value = "";
  document.getElementById("ot-price-regular").value = "";
  document.getElementById("ot-order-type").value = "market";
  document.getElementById("ot-sl-mode").value = "sl";
  document.getElementById("ot-use-stoploss").checked = false;
  document.getElementById("ot-trigger-price").value = "";
  document.getElementById("ot-trigger-price").disabled = true;
  setOrderMode("quick");

  const [nse, bse] = await Promise.all([
    getLtp(quoteSymbol(orderBaseSymbol, "NSE"), fallbackLtp),
    getLtp(quoteSymbol(orderBaseSymbol, "BSE"), null),
  ]);
  orderNse = nse;
  orderBse = bse;
  document.getElementById("ot-nse-price").textContent = nse == null ? "-" : `₹${Number(nse).toFixed(2)}`;
  document.getElementById("ot-bse-price").textContent = bse == null ? "-" : `₹${Number(bse).toFixed(2)}`;

  const nseRadio = document.querySelector("input[name='ot-exchange'][value='NSE']");
  const bseRadio = document.querySelector("input[name='ot-exchange'][value='BSE']");
  if (nse != null) {
    nseRadio.checked = true;
  } else if (bse != null) {
    bseRadio.checked = true;
  } else {
    nseRadio.checked = true;
  }

  syncOrderPriceFromExchange();
  orderModal.show();
}

async function submitOrderTicket() {
  const qty = currentQtyValue();
  if (!orderBaseSymbol || qty < 1) {
    document.getElementById("ot-status").textContent = "Enter valid quantity.";
    document.getElementById("ot-status").className = "small mt-2 text-danger";
    return;
  }
  const exchange = selectedOrderExchange();
  let orderType = orderMode === "regular" ? document.getElementById("ot-order-type").value : "market";
  const triggerEnabled = orderMode === "regular" && document.getElementById("ot-use-stoploss").checked;
  const triggerPrice = Number(document.getElementById("ot-trigger-price").value || 0);
  const price = currentPriceValue();
  const livePx = exchange === "BSE" ? orderBse : orderNse;

  // In quick mode, if user-entered price is different from live, treat it as a limit order.
  if (orderMode === "quick" && price > 0 && livePx !== null && livePx !== undefined) {
    if (Math.abs(Number(price) - Number(livePx)) > 0.001) {
      orderType = "limit";
    }
  }

  const payload = {
    symbol: quoteSymbol(orderBaseSymbol, exchange),
    exchange,
    order_type: orderType,
    action: orderSide,
    quantity: qty,
  };
  if (orderType === "limit") {
    if (!price || price <= 0) {
      document.getElementById("ot-status").textContent = "Enter valid limit price.";
      document.getElementById("ot-status").className = "small mt-2 text-danger";
      return;
    }
    payload.limit_price = price;
  }
  if (triggerEnabled) {
    if (!triggerPrice || triggerPrice <= 0) {
      document.getElementById("ot-status").textContent = "Enter valid trigger price.";
      document.getElementById("ot-status").className = "small mt-2 text-danger";
      return;
    }
    payload.stop_loss = triggerPrice;
    payload.sl_mode = document.getElementById("ot-sl-mode").value;
  }
  const res = await fetch("/api/trade/execute/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("ot-status").textContent = data.error || "Order failed";
    document.getElementById("ot-status").className = "small mt-2 text-danger";
    return;
  }
  document.getElementById("ot-status").textContent = data.message || "Order placed";
  document.getElementById("ot-status").className = "small mt-2 text-success";
  await refreshAll();
  setTimeout(() => orderModal.hide(), 500);
}

function enableOrderTicketDragging() {
  const modalEl = document.getElementById("orderTicketModal");
  const dialogEl = modalEl?.querySelector(".kite-order-dialog");
  const headEl = modalEl?.querySelector(".kite-order-head");
  if (!modalEl || !dialogEl || !headEl) return;

  headEl.addEventListener("mousedown", (e) => {
    if (e.target.closest("input,button,label")) return;
    const rect = dialogEl.getBoundingClientRect();
    dragState = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    dialogEl.style.position = "fixed";
    dialogEl.style.margin = "0";
    dialogEl.style.left = `${rect.left}px`;
    dialogEl.style.top = `${rect.top}px`;
    dialogEl.style.transform = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const left = Math.max(8, Math.min(window.innerWidth - dialogEl.offsetWidth - 8, e.clientX - dragState.dx));
    const top = Math.max(8, Math.min(window.innerHeight - dialogEl.offsetHeight - 8, e.clientY - dragState.dy));
    dialogEl.style.left = `${left}px`;
    dialogEl.style.top = `${top}px`;
  });

  document.addEventListener("mouseup", () => {
    dragState = null;
  });

  modalEl.addEventListener("shown.bs.modal", () => {
    if (!dialogEl.style.left) {
      const left = Math.max(8, Math.round((window.innerWidth - dialogEl.offsetWidth) / 2));
      const top = Math.max(8, Math.round((window.innerHeight - dialogEl.offsetHeight) / 2));
      dialogEl.style.position = "fixed";
      dialogEl.style.margin = "0";
      dialogEl.style.left = `${left}px`;
      dialogEl.style.top = `${top}px`;
      dialogEl.style.transform = "none";
    }
  });
}

function buildDepthRows(ltp) {
  const rows = [];
  const base = Number(ltp || 0);
  for (let i = 0; i < 5; i += 1) {
    const step = (i + 1) * 0.05;
    const bidPrice = Math.max(0.01, base - step);
    const askPrice = base + step;
    const bidQty = Math.floor(100 + Math.random() * 900);
    const askQty = Math.floor(100 + Math.random() * 900);
    rows.push({
      bid_qty: bidQty,
      bid_price: bidPrice,
      ask_price: askPrice,
      ask_qty: askQty,
    });
  }
  return rows;
}

async function openMarketDepth(symbol, fallbackLtp) {
  const ltp = await getLtp(symbol, fallbackLtp);
  const body = document.getElementById("depth-table-body");
  document.getElementById("depth-symbol").textContent = symbol;
  document.getElementById("depth-ltp").textContent = ltp ? `₹${ltp.toFixed(2)}` : "-";
  body.innerHTML = "";

  const rows = buildDepthRows(ltp || 0);
  rows.forEach((r) => {
    body.innerHTML += `
      <tr>
        <td class="text-success">${r.bid_qty}</td>
        <td class="text-success">${r.bid_price.toFixed(2)}</td>
        <td class="text-danger">${r.ask_price.toFixed(2)}</td>
        <td class="text-danger">${r.ask_qty}</td>
      </tr>
    `;
  });
  depthModal.show();
}

function renderWatchlist(filter = "") {
  const panel = document.getElementById("watchlist-panel");
  const q = filter.trim().toUpperCase();
  const rows = watchItems.filter((it) => !q || it.symbol.includes(q));
  panel.innerHTML = "";
  if (!rows.length) {
    panel.innerHTML = '<div class="kite-watch-empty">No symbols</div>';
    return;
  }

  rows.forEach((it) => {
    const ltp = it.ltp === null || it.ltp === undefined ? "-" : Number(it.ltp).toFixed(2);
    const changeVal = it.change === null || it.change === undefined ? null : Number(it.change);
    const changePctVal = it.change_pct === null || it.change_pct === undefined ? null : Number(it.change_pct);
    const changeText = changeVal === null ? "-" : `${changeVal >= 0 ? "+" : ""}${changeVal.toFixed(2)}`;
    const pctText = changePctVal === null ? "-" : `${changePctVal >= 0 ? "+" : ""}${changePctVal.toFixed(2)}%`;
    const toneClass = changeVal === null ? "" : changeVal > 0 ? "is-up" : changeVal < 0 ? "is-down" : "is-flat";
    const exchange = getExchangeLabel(it.symbol);
    panel.innerHTML += `
      <div class="kite-watch-row ${toneClass}" data-item-id="${it.id}" data-symbol="${it.symbol}" data-ltp="${ltp}">
        <div class="kite-watch-symbol"><button class="btn btn-link btn-sm p-0 align-baseline" data-symbol-link="${it.symbol}">${it.symbol}</button> ${exchange ? `<span class="kite-exch">${exchange}</span>` : ""}</div>
        <div class="kite-watch-metrics">
          <div class="kite-watch-change">${changeText}</div>
          <div class="kite-watch-pct">${pctText}</div>
          <div class="kite-watch-dot">o</div>
          <div class="kite-watch-ltp">${ltp}</div>
        </div>
        <div class="kite-watch-actions">
          <button class="kite-act kite-act-buy" data-row-action="buy" title="Buy">B</button>
          <button class="kite-act kite-act-sell" data-row-action="sell" title="Sell">S</button>
          <button class="kite-act" data-row-action="analysis" title="Analysis">A</button>
          <button class="kite-act" data-row-action="depth" title="Market Depth">D</button>
          <button class="kite-act" data-row-action="remove" title="Remove">X</button>
          <button class="kite-act" data-row-action="more" title="More">...</button>
        </div>
      </div>`;
  });
}

function renderWatchTabs() {
  const tabs = document.getElementById("watch-tabs");
  tabs.innerHTML = "";
  const shown = watchlists.slice(0, 7);
  shown.forEach((w, idx) => {
    const active = w.id === selectedWatchlistId ? "active" : "";
    tabs.innerHTML += `<button class="kite-tab ${active}" data-id="${w.id}" title="${w.name}">${idx + 1}</button>`;
  });
  tabs.innerHTML += `<button id="watch-tab-plus" class="kite-tab-plus" title="New group">+</button>`;
}

async function addSymbolToSelectedWatchlist(symbol) {
  if (!selectedWatchlistId) return;
  const res = await fetch("/api/watchlist/add/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    body: JSON.stringify({ symbol, watchlist_id: selectedWatchlistId }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Unable to add symbol");
    return;
  }
  document.getElementById("watch-search").value = "";
  document.getElementById("watch-search-results").innerHTML = "";
  loadWatchlistPanel();
}

async function removeWatchItem(itemId) {
  if (!itemId) return;
  const res = await fetch(`/api/watchlist/remove/${itemId}/`, {
    method: "DELETE",
    headers: { "X-CSRFToken": csrfToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Unable to remove symbol");
    return;
  }
  await loadWatchlistPanel();
}

function renderSearchResults(items) {
  const box = document.getElementById("watch-search-results");
  if (!items.length) {
    box.innerHTML = '<div class="kite-search-empty">No matching symbols</div>';
    return;
  }
  box.innerHTML = "";
  items.forEach((it) => {
    box.innerHTML += `
      <div class="kite-search-row-item" data-symbol="${it.symbol}">
        <div>
          <div class="kite-search-symbol">${it.symbol}</div>
          <div class="kite-search-name">${it.name}</div>
        </div>
        <div class="kite-search-right">
          <div class="kite-search-exchange">${it.exchange || it.type || ""}</div>
          <div class="kite-search-actions">
            <button type="button" class="kite-act kite-act-buy" data-search-action="buy" data-symbol="${it.symbol}" title="Buy">B</button>
            <button type="button" class="kite-act kite-act-sell" data-search-action="sell" data-symbol="${it.symbol}" title="Sell">S</button>
            <button type="button" class="kite-act" data-search-action="depth" data-symbol="${it.symbol}" title="Market Depth">D</button>
            <button type="button" class="kite-act" data-search-action="add" data-symbol="${it.symbol}" title="Add to Watchlist">+</button>
          </div>
        </div>
      </div>
    `;
  });
}

async function runGlobalSymbolSearch(q) {
  const box = document.getElementById("watch-search-results");
  if (!q || q.trim().length < 2) {
    box.innerHTML = "";
    return;
  }
  const res = await fetch(`/api/trade/symbol-search/?q=${encodeURIComponent(q.trim())}`);
  const data = await res.json();
  if (!res.ok) {
    box.innerHTML = '<div class="kite-search-empty">Search unavailable</div>';
    return;
  }
  renderSearchResults(data.results || []);
}

async function loadWatchlistPanel() {
  const query = selectedWatchlistId ? `?watchlist_id=${selectedWatchlistId}` : "";
  const data = await fetch(`/api/watchlist/${query}`).then((r) => r.json());
  const selected = data.selected_watchlist || { name: "Default Watchlist", items: [] };
  watchlists = data.watchlists || [];
  selectedWatchlistId = data.selected_watchlist_id;
  const idx = Math.max(0, watchlists.findIndex((w) => w.id === selectedWatchlistId));
  const itemCount = (selected.items || []).length;
  document.getElementById("watch-meta-title").textContent = `Watchlist ${idx + 1} (${itemCount} / 250)`;
  document.getElementById("watch-group-name").textContent = `${selected.name} (${itemCount})`;
  watchItems = selected.items || [];
  renderWatchTabs();
  renderWatchlist();
}

async function createWatchGroup() {
  const name = window.prompt("New watchlist name");
  if (!name || !name.trim()) return;
  const res = await fetch("/api/watchlist/create/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json();
  if (res.ok) {
    selectedWatchlistId = data.id;
    loadWatchlistPanel();
  }
}

async function renameSelectedWatchlist() {
  if (!selectedWatchlistId) return;
  const current = watchlists.find((w) => w.id === selectedWatchlistId);
  const nextName = window.prompt("Rename watchlist", current?.name || "");
  if (!nextName || !nextName.trim()) return;
  const res = await fetch(`/api/watchlist/rename/${selectedWatchlistId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    body: JSON.stringify({ name: nextName.trim() }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Unable to rename watchlist");
    return;
  }
  await loadWatchlistPanel();
}

async function deleteSelectedWatchlist() {
  if (!selectedWatchlistId) return;
  const current = watchlists.find((w) => w.id === selectedWatchlistId);
  const ok = window.confirm(`Delete watchlist "${current?.name || "this"}"?`);
  if (!ok) return;
  const res = await fetch(`/api/watchlist/delete/${selectedWatchlistId}/`, {
    method: "DELETE",
    headers: { "X-CSRFToken": csrfToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Unable to delete watchlist");
    return;
  }
  selectedWatchlistId = null;
  await loadWatchlistPanel();
}

async function loadDashboard() {
  const [p, s] = await Promise.all([
    fetch("/api/portfolio/").then((r) => r.json()),
    fetch("/api/portfolio/summary/").then((r) => r.json()),
  ]);

  document.getElementById("balance").textContent = currency(p.balance);
  document.getElementById("balance-2").textContent = currency(p.balance);
  document.getElementById("portfolio-value").textContent = currency(p.portfolio_value);
  document.getElementById("portfolio-value-2").textContent = currency(p.portfolio_value);
  document.getElementById("pnl").textContent = currency(p.pnl);
  document.getElementById("pnl-large").textContent = currency(p.pnl);
  document.getElementById("open-positions").textContent = s.open_positions ?? 0;

  const holdings = document.querySelector("#holdings-table tbody");
  holdings.innerHTML = "";
  const activePositions = (p.positions || []).filter((pos) => Number(pos.quantity || 0) > 0);
  activePositions.forEach((pos) => {
    holdings.innerHTML += `
      <tr class="holdings-row" data-hold-symbol="${pos.symbol}">
        <td>
          <div class="holdings-symbol-wrap">
            <button class="btn btn-link btn-sm p-0 align-baseline" data-symbol-link="${pos.symbol}">${pos.symbol}</button>
            <div class="holdings-actions">
              <button class="kite-act kite-act-buy" data-hold-action="buy" data-symbol="${pos.symbol}" title="Buy">B</button>
              <button class="kite-act kite-act-sell" data-hold-action="sell" data-symbol="${pos.symbol}" title="Sell">S</button>
            </div>
          </div>
        </td>
        <td>${pos.quantity}</td>
        <td>${Number(pos.avg_buy_price).toFixed(2)}</td>
        <td>${Number(pos.current_value).toFixed(2)}</td>
      </tr>`;
  });
  if (!activePositions.length) {
    holdings.innerHTML = '<tr><td colspan="4" class="text-muted">No holdings yet.</td></tr>';
  }

  const recent = document.querySelector("#recent-trades tbody");
  recent.innerHTML = "";
  (s.recent_trades || []).forEach((t) => {
    recent.innerHTML += `<tr><td>${new Date(t.timestamp).toLocaleString()}</td><td><button class="btn btn-link btn-sm p-0 align-baseline" data-symbol-link="${t.symbol}">${t.symbol}</button></td><td>${t.action.toUpperCase()}</td><td>${t.quantity}</td><td>${Number(t.price).toFixed(2)}</td><td>${t.status}</td></tr>`;
  });
  if (!s.recent_trades || !s.recent_trades.length) {
    recent.innerHTML = '<tr><td colspan="6" class="text-muted">No recent trades.</td></tr>';
  }
}

document.getElementById("watch-search").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runGlobalSymbolSearch(e.target.value), 260);
});
document.addEventListener("click", (e) => {
  const symbolBtn = e.target.closest("[data-symbol-link]");
  if (!symbolBtn) return;
  const symbol = symbolBtn.dataset.symbolLink;
  if (!symbol) return;
  e.preventDefault();
  e.stopPropagation();
  window.location.href = `/analysis/?symbol=${encodeURIComponent(symbol)}`;
});
document.querySelector("#holdings-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-hold-action][data-symbol]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openOrderTicket(btn.dataset.symbol, btn.dataset.holdAction);
});

document.getElementById("new-group-btn").addEventListener("click", createWatchGroup);
document.getElementById("rename-watchlist-btn").addEventListener("click", renameSelectedWatchlist);
document.getElementById("delete-watchlist-btn").addEventListener("click", deleteSelectedWatchlist);
document.getElementById("watch-search-results").addEventListener("click", (e) => {
  const actionBtn = e.target.closest("[data-search-action][data-symbol]");
  if (actionBtn) {
    const symbol = actionBtn.dataset.symbol;
    const action = actionBtn.dataset.searchAction;
    if (action === "add") {
      addSymbolToSelectedWatchlist(symbol);
      return;
    }
    if (action === "buy" || action === "sell") {
      openOrderTicket(symbol, action);
      return;
    }
    if (action === "depth") {
      openMarketDepth(symbol, null);
      return;
    }
  }

  const row = e.target.closest(".kite-search-row-item[data-symbol]");
  if (!row) return;
  window.location.href = `/analysis/?symbol=${encodeURIComponent(row.dataset.symbol)}`;
});
document.getElementById("watch-tabs").addEventListener("click", (e) => {
  if (e.target.id === "watch-tab-plus") {
    createWatchGroup();
    return;
  }
  const btn = e.target.closest(".kite-tab[data-id]");
  if (!btn) return;
  selectedWatchlistId = Number(btn.dataset.id);
  loadWatchlistPanel();
});
document.getElementById("watchlist-panel").addEventListener("click", async (e) => {
  const row = e.target.closest(".kite-watch-row[data-symbol]");
  if (!row) return;

  const symbol = row.dataset.symbol;
  const itemId = Number(row.dataset.itemId || 0);
  const fallbackLtp = Number(row.dataset.ltp);
  const actionBtn = e.target.closest("[data-row-action]");

  if (!actionBtn) {
    window.location.href = `/analysis/?symbol=${encodeURIComponent(symbol)}`;
    return;
  }

  const action = actionBtn.dataset.rowAction;
  if (action === "buy" || action === "sell") {
    await openOrderTicket(symbol, action, Number.isNaN(fallbackLtp) ? null : fallbackLtp);
    return;
  }
  if (action === "analysis") {
    window.location.href = `/analysis/?symbol=${encodeURIComponent(symbol)}`;
    return;
  }
  if (action === "depth") {
    await openMarketDepth(symbol, Number.isNaN(fallbackLtp) ? null : fallbackLtp);
    return;
  }
  if (action === "remove") {
    await removeWatchItem(itemId);
    return;
  }
  if (action === "more") {
    alert(`Symbol: ${symbol}\nMore actions coming soon.`);
  }
});

async function refreshAll() {
  await Promise.all([loadDashboard(), loadWatchlistPanel()]);
}

depthModal = new bootstrap.Modal(document.getElementById("marketDepthModal"));
orderModal = new bootstrap.Modal(document.getElementById("orderTicketModal"));
enableOrderTicketDragging();
document.querySelectorAll("input[name='ot-exchange']").forEach((el) => el.addEventListener("change", syncOrderPriceFromExchange));
document.getElementById("ot-qty").addEventListener("input", refreshOrderAvail);
document.getElementById("ot-price").addEventListener("input", refreshOrderAvail);
document.getElementById("ot-qty-regular").addEventListener("input", refreshOrderAvail);
document.getElementById("ot-price-regular").addEventListener("input", refreshOrderAvail);
document.querySelectorAll(".kite-order-tab").forEach((tab) => {
  tab.addEventListener("click", () => setOrderMode(tab.dataset.orderMode));
});
document.getElementById("ot-use-stoploss").addEventListener("change", (e) => {
  document.getElementById("ot-trigger-price").disabled = !e.target.checked;
});
document.getElementById("ot-submit-btn").addEventListener("click", submitOrderTicket);
refreshAll();
setInterval(refreshAll, 20000);
