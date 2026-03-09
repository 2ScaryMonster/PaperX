let screenerRows = [];
let screenerPage = 1;
let screenerSortKey = null;
let screenerSortDir = "asc";
let conditionSeed = 1;
let screenerConditions = [];
let screenerSectorOptions = [
  "Financial Services",
  "Healthcare",
  "Technology",
  "Consumer Defensive",
  "Industrials",
  "Energy",
  "Utilities",
  "Basic Materials",
  "Consumer Cyclical",
  "Real Estate",
  "Communication Services",
];
let screenerProgressTimer = null;
let screenerProgressStart = 0;
let screenerAvgMs = 7000;

const SCREENER_FIELDS = [
  { key: "sector", label: "Sector", kind: "text", defaultValue: "Financial Services" },
  { key: "from_52w_high", label: "From 52W High", kind: "numeric", defaultValue: "1" },
  { key: "volume", label: "Volume", kind: "numeric", defaultValue: "500000" },
  { key: "market_cap", label: "Market Capitalization", kind: "numeric", defaultValue: "5000000000" },
  { key: "current_price", label: "Current Price", kind: "numeric", defaultValue: "100" },
  { key: "pe", label: "Price to Earning", kind: "numeric", defaultValue: "30" },
  { key: "dma50", label: "DMA 50", kind: "numeric", defaultValue: "100" },
  { key: "current_gt_dma50", label: "Current Price vs DMA 50", kind: "relative" },
];

const OP_NUMERIC = [">", "<", ">=", "<=", "="];
const OP_RELATIVE = [">", "<", ">=", "<=", "="];
const OP_TEXT = ["=", "contains"];

function csrfToken() {
  return document.cookie.split("; ").find((row) => row.startsWith("csrftoken="))?.split("=")[1] || "";
}

function num(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });
}

function pageSize() {
  return Number(document.getElementById("scr-page-size").value || 25);
}

function fieldByKey(key) {
  return SCREENER_FIELDS.find((f) => f.key === key) || SCREENER_FIELDS[0];
}

function newCondition(fieldKey = "current_price") {
  const field = fieldByKey(fieldKey);
  return {
    id: conditionSeed += 1,
    field: field.key,
    op: field.kind === "relative" ? ">" : ">",
    value: field.kind === "relative" ? "" : field.key === "sector" ? (screenerSectorOptions[0] || field.defaultValue || "") : (field.defaultValue || "0"),
  };
}

function conditionToQueryLine(c) {
  const field = fieldByKey(c.field);
  if (field.kind === "relative") {
    return `Current price ${c.op} DMA 50`;
  }
  if (field.kind === "text") {
    const text = String(c.value || "").trim();
    if (!text) return "";
    return `${field.label} ${c.op} ${text}`;
  }
  const v = Number(c.value);
  if (Number.isNaN(v)) return "";
  return `${field.label} ${c.op} ${v}`;
}

function rebuildGeneratedQuery() {
  const lines = screenerConditions.map(conditionToQueryLine).filter(Boolean);
  document.getElementById("scr-query").value = lines.join(" AND\n");
}

function renderConditionBuilder() {
  const host = document.getElementById("scr-conditions");
  host.innerHTML = "";

  if (!screenerConditions.length) {
    host.innerHTML = '<div class="text-muted small">No conditions added. Click "Add Condition".</div>';
    rebuildGeneratedQuery();
    return;
  }

  screenerConditions.forEach((c) => {
    const field = fieldByKey(c.field);
    const ops = field.kind === "relative" ? OP_RELATIVE : field.kind === "text" ? OP_TEXT : OP_NUMERIC;
    const valueControl = field.key === "sector"
      ? `<select class="form-select form-select-sm" data-cond-value style="min-width:180px;max-width:260px;">
          ${(screenerSectorOptions || []).map((s) => `<option value="${s}" ${String(c.value || "") === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>`
      : `<input class="form-control form-control-sm" data-cond-value placeholder="Value" style="width:160px;" value="${c.value || ""}" ${field.kind === "relative" ? "disabled" : ""}>`;
    host.innerHTML += `
      <div class="border rounded p-2 d-flex gap-2 align-items-center flex-wrap" data-cond-id="${c.id}">
        <select class="form-select form-select-sm" data-cond-field style="min-width:220px;max-width:280px;">
          ${SCREENER_FIELDS.map((f) => `<option value="${f.key}" ${f.key === c.field ? "selected" : ""}>${f.label}</option>`).join("")}
        </select>
        <select class="form-select form-select-sm" data-cond-op style="width:90px;">
          ${ops.map((op) => `<option value="${op}" ${op === c.op ? "selected" : ""}>${op}</option>`).join("")}
        </select>
        ${valueControl}
        <button class="btn btn-sm btn-outline-danger" data-cond-remove type="button">Remove</button>
      </div>
    `;
  });

  rebuildGeneratedQuery();
}

function renderRows() {
  const tbody = document.querySelector("#scr-table tbody");
  const size = pageSize();
  let rowsToRender = [...screenerRows];
  if (screenerSortKey) {
    rowsToRender.sort((a, b) => {
      const rawA = a[screenerSortKey];
      const rawB = b[screenerSortKey];
      const av = Number(rawA);
      const bv = Number(rawB);
      const aIsNum = !Number.isNaN(av);
      const bIsNum = !Number.isNaN(bv);
      if (aIsNum && bIsNum) {
        return screenerSortDir === "asc" ? av - bv : bv - av;
      }
      const sa = (rawA || "").toString().toLowerCase();
      const sb = (rawB || "").toString().toLowerCase();
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      return screenerSortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }

  const total = rowsToRender.length;
  const pages = Math.max(1, Math.ceil(total / size));
  screenerPage = Math.min(screenerPage, pages);
  const start = (screenerPage - 1) * size;
  const rows = rowsToRender.slice(start, start + size);

  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No stocks matched this query.</td></tr>';
  } else {
    rows.forEach((r, i) => {
      tbody.innerHTML += `
        <tr>
          <td>${start + i + 1}</td>
          <td><button class="btn btn-link btn-sm p-0" data-symbol-link="${r.symbol}">${r.company}</button></td>
          <td>${r.sector || "-"}</td>
          <td>${num(r.current_price)}</td>
          <td>${num(r.pe)}</td>
          <td>${num(r.market_cap, 0)}</td>
          <td>${num(r.volume, 0)}</td>
          <td>${num(r.from_52w_high, 4)}</td>
          <td>${num(r.dma50)}</td>
        </tr>
      `;
    });
  }

  document.getElementById("scr-page-info").textContent = `${total} results | Page ${screenerPage} of ${pages}`;
}

function refreshSortIndicators() {
  document.querySelectorAll("[data-sort-indicator]").forEach((el) => {
    const key = el.dataset.sortIndicator;
    if (key !== screenerSortKey) {
      el.textContent = "";
      return;
    }
    el.textContent = screenerSortDir === "asc" ? "▲" : "▼";
  });
}

function startScreenerProgress() {
  const wrap = document.getElementById("scr-progress-wrap");
  const bar = document.getElementById("scr-progress-bar");
  if (!wrap || !bar) return;
  try {
    const cached = Number(localStorage.getItem("screener:avgMs") || 0);
    if (!Number.isNaN(cached) && cached >= 1500) screenerAvgMs = Math.min(30000, cached);
  } catch (_) {}
  wrap.classList.remove("d-none");
  bar.style.width = "4%";
  screenerProgressStart = Date.now();
  if (screenerProgressTimer) clearInterval(screenerProgressTimer);
  screenerProgressTimer = setInterval(() => {
    const elapsed = Date.now() - screenerProgressStart;
    const pct = Math.max(4, Math.min(94, (elapsed / screenerAvgMs) * 94));
    bar.style.width = `${Math.round(pct)}%`;
    const status = document.getElementById("scr-status");
    if (status) status.textContent = `Running query... ${Math.round(pct)}%`;
  }, 120);
}

function stopScreenerProgress() {
  const wrap = document.getElementById("scr-progress-wrap");
  const bar = document.getElementById("scr-progress-bar");
  if (!wrap || !bar) return;
  if (screenerProgressTimer) {
    clearInterval(screenerProgressTimer);
    screenerProgressTimer = null;
  }
  bar.style.width = "100%";
  setTimeout(() => wrap.classList.add("d-none"), 350);
}

async function runScreener() {
  const status = document.getElementById("scr-status");
  status.textContent = "Running query...";
  status.className = "small text-muted";
  const tbody = document.querySelector("#scr-table tbody");
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">Loading screener data...</td></tr>';
  }
  rebuildGeneratedQuery();
  const query = document.getElementById("scr-query").value || "";
  const form = new URLSearchParams();
  form.set("query", query);
  startScreenerProgress();
  const startedAt = Date.now();

  try {
    const res = await fetch("/api/screener/run/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-CSRFToken": csrfToken() },
      body: form.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || "Unable to run query.";
      status.className = "small text-danger";
      return;
    }
    screenerRows = data.rows || [];
    screenerPage = 1;
    renderRows();
    refreshSortIndicators();
    const meta = data.meta || {};
    const scanned = Number(meta.scanned || 0);
    const total = Number(meta.total || 0);
    const failures = Number(meta.failures || 0);
    status.textContent = `Done. ${screenerRows.length} match(es). Scanned ${scanned}/${total || scanned}${failures ? `, failures: ${failures}` : ""}.`;
    status.className = "small text-success";
  } catch (_) {
    status.textContent = "Unable to run query.";
    status.className = "small text-danger";
  } finally {
    const took = Date.now() - startedAt;
    try {
      const prev = Number(localStorage.getItem("screener:avgMs") || 0);
      const next = prev > 0 ? Math.round(prev * 0.7 + took * 0.3) : took;
      localStorage.setItem("screener:avgMs", String(next));
    } catch (_) {}
    stopScreenerProgress();
  }
}

async function loadSectorOptions() {
  try {
    const res = await fetch("/api/screener/sectors/");
    const data = await res.json();
    if (!res.ok) return;
    const fetched = Array.isArray(data.sectors) ? data.sectors.filter(Boolean) : [];
    if (fetched.length) {
      screenerSectorOptions = fetched;
    }
  } catch (_) {
    // keep default list
  }
  // Ensure existing sector conditions always have valid value from options.
  screenerConditions.forEach((c) => {
    if (c.field === "sector" && !screenerSectorOptions.includes(String(c.value || ""))) {
      c.value = screenerSectorOptions[0];
    }
  });
  renderConditionBuilder();
}

document.getElementById("scr-run").addEventListener("click", runScreener);
document.getElementById("scr-add-condition").addEventListener("click", () => {
  screenerConditions.push(newCondition("current_price"));
  renderConditionBuilder();
});
document.getElementById("scr-clear-conditions").addEventListener("click", () => {
  screenerConditions = [];
  renderConditionBuilder();
});
document.getElementById("scr-conditions").addEventListener("click", (e) => {
  const row = e.target.closest("[data-cond-id]");
  if (!row) return;
  if (!e.target.closest("[data-cond-remove]")) return;
  const id = Number(row.dataset.condId);
  screenerConditions = screenerConditions.filter((c) => c.id !== id);
  renderConditionBuilder();
});
document.getElementById("scr-conditions").addEventListener("change", (e) => {
  const row = e.target.closest("[data-cond-id]");
  if (!row) return;
  const id = Number(row.dataset.condId);
  const cond = screenerConditions.find((c) => c.id === id);
  if (!cond) return;

  if (e.target.matches("[data-cond-field]")) {
    const field = fieldByKey(e.target.value);
    cond.field = field.key;
    cond.op = ">";
    cond.value = field.kind === "relative" ? "" : field.key === "sector" ? (screenerSectorOptions[0] || field.defaultValue || "") : (field.defaultValue || "0");
    renderConditionBuilder();
    return;
  }
  if (e.target.matches("[data-cond-op]")) {
    cond.op = e.target.value;
    rebuildGeneratedQuery();
  }
});
document.getElementById("scr-conditions").addEventListener("input", (e) => {
  const row = e.target.closest("[data-cond-id]");
  if (!row || !e.target.matches("[data-cond-value]")) return;
  const id = Number(row.dataset.condId);
  const cond = screenerConditions.find((c) => c.id === id);
  if (!cond) return;
  cond.value = e.target.value;
  rebuildGeneratedQuery();
});
document.getElementById("scr-page-size").addEventListener("change", () => {
  screenerPage = 1;
  renderRows();
});
document.getElementById("scr-prev").addEventListener("click", () => {
  screenerPage = Math.max(1, screenerPage - 1);
  renderRows();
});
document.getElementById("scr-next").addEventListener("click", () => {
  const pages = Math.max(1, Math.ceil(screenerRows.length / pageSize()));
  screenerPage = Math.min(pages, screenerPage + 1);
  renderRows();
});
document.querySelector("#scr-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-symbol-link]");
  if (!btn) return;
  window.location.href = `/analysis/?symbol=${encodeURIComponent(btn.dataset.symbolLink)}`;
});
document.querySelector("#scr-table thead").addEventListener("click", (e) => {
  const th = e.target.closest("[data-sort-key]");
  if (!th) return;
  const key = th.dataset.sortKey;
  if (screenerSortKey === key) {
    screenerSortDir = screenerSortDir === "asc" ? "desc" : "asc";
  } else {
    screenerSortKey = key;
    screenerSortDir = "asc";
  }
  screenerPage = 1;
  renderRows();
  refreshSortIndicators();
});

screenerConditions = [
  newCondition("from_52w_high"),
  newCondition("volume"),
  newCondition("current_gt_dma50"),
];
renderConditionBuilder();
loadSectorOptions().finally(runScreener);
