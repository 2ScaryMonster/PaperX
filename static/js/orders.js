let allOrders = [];

function csrfToken() {
  return document.cookie.split("; ").find((row) => row.startsWith("csrftoken="))?.split("=")[1] || "";
}

function n(v) {
  if (v === null || v === undefined || v === "") return "-";
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function renderOrders() {
  const symbolQ = document.getElementById("orders-symbol").value.trim().toUpperCase();
  const actionQ = document.getElementById("orders-action").value;
  const statusQ = document.getElementById("orders-status").value;

  let rows = [...allOrders];
  if (symbolQ) rows = rows.filter((r) => String(r.symbol || "").toUpperCase().includes(symbolQ));
  if (actionQ) rows = rows.filter((r) => r.action === actionQ);
  if (statusQ) rows = rows.filter((r) => r.status === statusQ);

  const tbody = document.querySelector("#orders-table tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-muted">No orders found.</td></tr>';
    return;
  }

  rows.forEach((o) => {
    tbody.innerHTML += `
      <tr>
        <td>${new Date(o.timestamp).toLocaleString()}</td>
        <td>${o.symbol ? `<button class="btn btn-link btn-sm p-0 align-baseline" data-order-symbol="${o.symbol}">${o.symbol}</button>` : "-"}</td>
        <td>${o.exchange || "-"}</td>
        <td>${o.order_type || "-"}</td>
        <td>${(o.action || "-").toUpperCase()}</td>
        <td>${n(o.quantity)}</td>
        <td>${n(o.price)}</td>
        <td>${n(o.limit_price)}</td>
        <td>${n(o.stop_loss)}</td>
        <td>${o.status || "-"}</td>
        <td>${n(o.pnl)}</td>
        <td>${o.status === "pending" ? `<button class="btn btn-sm btn-outline-danger" data-cancel-order-id="${o.id}">Cancel</button>` : "-"}</td>
      </tr>
    `;
  });
}

async function cancelPendingOrder(tradeId) {
  const ok = window.confirm("Delete this pending order?");
  if (!ok) return;
  const res = await fetch(`/api/trade/pending/${tradeId}/`, {
    method: "DELETE",
    headers: { "X-CSRFToken": csrfToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Unable to delete pending order.");
    return;
  }
  await loadOrders();
}

async function loadOrders() {
  const symbol = document.getElementById("orders-symbol").value.trim();
  const action = document.getElementById("orders-action").value;
  const qs = new URLSearchParams();
  if (symbol) qs.set("symbol", symbol);
  if (action) qs.set("action", action);

  const res = await fetch(`/api/trade/history/${qs.toString() ? `?${qs.toString()}` : ""}`);
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Unable to load orders.");
    return;
  }
  allOrders = Array.isArray(data) ? data : [];
  renderOrders();
}

document.getElementById("orders-refresh").addEventListener("click", loadOrders);
document.getElementById("orders-symbol").addEventListener("input", renderOrders);
document.getElementById("orders-action").addEventListener("change", loadOrders);
document.getElementById("orders-status").addEventListener("change", renderOrders);
document.querySelector("#orders-table tbody").addEventListener("click", (e) => {
  const symbolBtn = e.target.closest("[data-order-symbol]");
  if (symbolBtn) {
    const symbol = symbolBtn.dataset.orderSymbol;
    window.location.href = `/analysis/?symbol=${encodeURIComponent(symbol)}`;
    return;
  }
  const btn = e.target.closest("[data-cancel-order-id]");
  if (!btn) return;
  cancelPendingOrder(btn.dataset.cancelOrderId);
});

loadOrders();
