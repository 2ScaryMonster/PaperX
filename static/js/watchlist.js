function csrfToken() {
  return document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] || '';
}

const selectEl = document.getElementById('watchlist-select');
const statusEl = document.getElementById('watchlist-status');
let watchlists = [];
let selectedWatchlistId = null;
let selectedWatchlistData = null;

function showStatus(message, type = 'info') {
  statusEl.innerHTML = `<div class="alert alert-${type} py-2 mb-2">${message}</div>`;
}

function clearStatus() {
  statusEl.innerHTML = '';
}

function selectedWatchlist() {
  return selectedWatchlistData;
}

function renderWatchlistSelect() {
  selectEl.innerHTML = '';
  watchlists.forEach((w) => {
    selectEl.innerHTML += `<option value="${w.id}">${w.name} (${w.item_count})</option>`;
  });
  if (selectedWatchlistId) {
    selectEl.value = String(selectedWatchlistId);
  }
}

function renderRows() {
  const tbody = document.querySelector('#watch-table tbody');
  tbody.innerHTML = '';

  const w = selectedWatchlistData;
  if (!w) return;

  if (!w.items || w.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No symbols in this watchlist.</td></tr>';
    return;
  }

  w.items.forEach((item) => {
    const ltp = item.ltp === null || item.ltp === undefined ? '-' : Number(item.ltp).toFixed(2);
    const added = new Date(item.added_at).toLocaleString();
    tbody.innerHTML += `
      <tr>
        <td>${item.symbol}</td>
        <td>${ltp}</td>
        <td>${added}</td>
        <td><button class="btn btn-sm btn-danger" onclick="removeWatch(${item.id})">Remove</button></td>
      </tr>
    `;
  });
}

async function loadWatchlists(silent = false) {
  const query = selectedWatchlistId ? `?watchlist_id=${selectedWatchlistId}` : '';
  const res = await fetch(`/api/watchlist/${query}`);
  const data = await res.json();
  if (!res.ok) {
    if (!silent) showStatus(data.error || 'Failed to load watchlists.', 'danger');
    return;
  }

  watchlists = data.watchlists || [];
  selectedWatchlistId = data.selected_watchlist_id;
  selectedWatchlistData = data.selected_watchlist;
  renderWatchlistSelect();
  renderRows();
  if (!silent) clearStatus();
}

async function createWatchlist() {
  const nameInput = document.getElementById('new-watchlist-name');
  const name = nameInput.value.trim();
  if (!name) return;

  const res = await fetch('/api/watchlist/create/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) {
    showStatus(data.error || 'Unable to create watchlist.', 'danger');
    return;
  }
  nameInput.value = '';
  selectedWatchlistId = data.id;
  showStatus(`Watchlist created: ${data.name}`, 'success');
  await loadWatchlists(true);
}

async function renameWatchlist() {
  const renameInput = document.getElementById('rename-watchlist-name');
  const name = renameInput.value.trim();
  if (!name || !selectedWatchlistId) return;

  const res = await fetch(`/api/watchlist/rename/${selectedWatchlistId}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) {
    showStatus(data.error || 'Unable to rename watchlist.', 'danger');
    return;
  }
  renameInput.value = '';
  showStatus(`Renamed to: ${data.name}`, 'success');
  await loadWatchlists(true);
}

async function deleteWatchlist() {
  if (!selectedWatchlistId) return;
  const res = await fetch(`/api/watchlist/delete/${selectedWatchlistId}/`, {
    method: 'DELETE',
    headers: { 'X-CSRFToken': csrfToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showStatus(data.error || 'Unable to delete watchlist.', 'danger');
    return;
  }
  showStatus('Watchlist deleted.', 'warning');
  selectedWatchlistId = null;
  await loadWatchlists(true);
}

async function addSymbol() {
  const symbolInput = document.getElementById('watch-symbol');
  const symbol = symbolInput.value.trim().toUpperCase();
  if (!symbol || !selectedWatchlistId) return;

  const res = await fetch('/api/watchlist/add/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
    body: JSON.stringify({ symbol, watchlist_id: selectedWatchlistId }),
  });
  const data = await res.json();
  if (!res.ok) {
    showStatus(data.error || 'Unable to add symbol.', 'danger');
    return;
  }
  symbolInput.value = '';
  await loadWatchlists(true);
  showStatus(`Added ${data.symbol}`, 'success');
}

async function removeWatch(itemId) {
  const res = await fetch(`/api/watchlist/remove/${itemId}/`, {
    method: 'DELETE',
    headers: { 'X-CSRFToken': csrfToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showStatus(data.error || 'Unable to remove symbol.', 'danger');
    return;
  }
  await loadWatchlists(true);
}

window.removeWatch = removeWatch;

selectEl.addEventListener('change', () => {
  selectedWatchlistId = Number(selectEl.value);
  loadWatchlists(true);
});

document.getElementById('create-watchlist').addEventListener('click', createWatchlist);
document.getElementById('rename-watchlist').addEventListener('click', renameWatchlist);
document.getElementById('delete-watchlist').addEventListener('click', deleteWatchlist);
document.getElementById('add-watch').addEventListener('click', addSymbol);

document.getElementById('watch-symbol').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSymbol();
  }
});

loadWatchlists();
setInterval(() => loadWatchlists(true), 20000);
