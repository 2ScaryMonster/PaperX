function botCsrf() {
  return document.cookie.split("; ").find((r) => r.startsWith("csrftoken="))?.split("=")[1] || "";
}

function byId(id) {
  return document.getElementById(id);
}

let botTimer = null;
let botSearchDebounce = null;
let selectedBotSymbols = [];
let botChatHistory = [];
let activeBotProfile = "Default";
let strategyRows = [
  {
    key: "ai_custom",
    name: "AI Custom Strategy",
    type: "LLM-driven",
    timeframe: "User-defined",
    status: "Active",
    description: "Uses your full prompt text at runtime. Decision is generated dynamically as BUY/WAIT/REJECT.",
    executable: true,
    deletable: false,
  },
  {
    key: "ema_cross",
    name: "EMA Cross",
    type: "Trend-following",
    timeframe: "15m",
    status: "Active",
    description: "Buys when price is above EMA20 and sells when below EMA20.",
    executable: true,
    deletable: false,
  },
  {
    key: "trend_pullback",
    name: "Trend Pullback",
    type: "Swing",
    timeframe: "1D",
    status: "Active",
    description: "Market filter + 20/50/200 DMA trend + pullback + RSI + bullish trigger with <=3% risk.",
    executable: true,
    deletable: false,
  },
  {
    key: "rsi_mean",
    name: "RSI Mean Reversion",
    type: "Mean-reversion",
    timeframe: "15m",
    status: "Coming Soon",
    description: "Would buy oversold RSI and sell overbought RSI with risk caps.",
    executable: false,
    deletable: true,
  },
  {
    key: "breakout20",
    name: "Breakout 20",
    type: "Momentum",
    timeframe: "15m / 1h",
    status: "Coming Soon",
    description: "Would enter on 20-candle breakout with confirmation volume.",
    executable: false,
    deletable: true,
  },
  {
    key: "macd_signal",
    name: "MACD Signal",
    type: "Trend-momentum",
    timeframe: "15m",
    status: "Coming Soon",
    description: "Would trade MACD and signal-line crossover events.",
    executable: false,
    deletable: true,
  },
];

function loadDeletedStrategies() {
  try {
    const arr = JSON.parse(localStorage.getItem("bot:deletedStrategies") || "[]");
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (_) {
    return [];
  }
}

function saveDeletedStrategies(keys) {
  try {
    localStorage.setItem("bot:deletedStrategies", JSON.stringify(keys || []));
  } catch (_) {}
}

function loadBotProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem("bot:profiles") || "{}");
    if (raw && typeof raw === "object") return raw;
  } catch (_) {}
  return {};
}

function saveBotProfiles(profiles) {
  try {
    localStorage.setItem("bot:profiles", JSON.stringify(profiles || {}));
  } catch (_) {}
}

function profileFromCurrentForm() {
  return {
    strategy: byId("bot-strategy")?.value || "",
    strategy_prompt: byId("bot-custom-prompt")?.value || "",
    symbols: [...selectedBotSymbols],
    order_quantity: Number(byId("bot-qty")?.value || 1),
    poll_seconds: Number(byId("bot-poll")?.value || 60),
    max_daily_loss: Number(byId("bot-max-loss")?.value || 500),
    max_open_positions: Number(byId("bot-max-pos")?.value || 5),
  };
}

function applyProfileToForm(profile) {
  const p = profile || {};
  byId("bot-strategy").value = p.strategy || "";
  if (byId("bot-custom-prompt")) byId("bot-custom-prompt").value = p.strategy_prompt || "";
  selectedBotSymbols = Array.isArray(p.symbols) ? p.symbols.map((x) => String(x).toUpperCase()) : [];
  renderSymbolChips();
  byId("bot-qty").value = p.order_quantity || 1;
  byId("bot-poll").value = p.poll_seconds || 60;
  byId("bot-max-loss").value = p.max_daily_loss || 500;
  byId("bot-max-pos").value = p.max_open_positions || 5;
  updateCustomPromptVisibility();
  renderStrategyTable();
}

function renderBotProfiles() {
  const select = byId("bot-profile-select");
  if (!select) return;
  const profiles = loadBotProfiles();
  const names = Object.keys(profiles);
  if (!names.length) {
    profiles.Default = profileFromCurrentForm();
    saveBotProfiles(profiles);
  }
  const finalNames = Object.keys(loadBotProfiles());
  if (!finalNames.includes(activeBotProfile)) activeBotProfile = finalNames[0] || "Default";
  select.innerHTML = finalNames.map((n) => `<option value="${n}" ${n === activeBotProfile ? "selected" : ""}>${n}</option>`).join("");
}

function saveActiveProfileSnapshot() {
  const profiles = loadBotProfiles();
  profiles[activeBotProfile] = profileFromCurrentForm();
  saveBotProfiles(profiles);
  renderBotProfiles();
}

function isSelectedStrategy(key) {
  return (byId("bot-strategy")?.value || "") === (key || "");
}

function updateCustomPromptVisibility() {
  const isCustom = (byId("bot-strategy")?.value || "") === "ai_custom";
  const wrap = byId("bot-custom-prompt-wrap");
  if (wrap) wrap.style.display = isCustom ? "block" : "none";
}

function renderStrategyTable() {
  const body = byId("bot-strategy-body");
  if (!body) return;
  const deleted = new Set(loadDeletedStrategies());
  const rows = strategyRows.filter((r) => !deleted.has(r.key));
  body.innerHTML = rows.map((r) => {
    const statusBadge = r.status === "Active"
      ? '<span class="badge text-bg-success">Active</span>'
      : '<span class="badge text-bg-secondary">Coming Soon</span>';
    const disabled = r.executable ? "" : "disabled";
    const deleteBtn = '<button class="btn btn-sm btn-outline-danger" data-strategy-action="delete">Delete</button>';
    return `
      <tr data-strategy-key="${r.key}">
        <td><strong>${r.name}</strong></td>
        <td>${r.type}</td>
        <td>${r.timeframe}</td>
        <td>${statusBadge}</td>
        <td>${r.description}</td>
        <td class="d-flex gap-1">
          <button class="btn btn-sm btn-success" data-strategy-action="start" ${disabled}>Start</button>
          <button class="btn btn-sm btn-warning" data-strategy-action="pause" ${disabled}>Pause</button>
          <button class="btn btn-sm btn-info" data-strategy-action="resume" ${disabled}>Resume</button>
          <button class="btn btn-sm btn-danger" data-strategy-action="stop" ${disabled}>Stop</button>
          ${deleteBtn}
        </td>
      </tr>
    `;
  }).join("");
}

function renderSymbolChips() {
  const host = byId("bot-symbol-chips");
  if (!host) return;
  host.innerHTML = "";
  if (!selectedBotSymbols.length) {
    host.innerHTML = '<span class="text-muted small">No symbols selected.</span>';
    return;
  }
  host.innerHTML = selectedBotSymbols.map((s) => `
    <span class="badge text-bg-light border d-inline-flex align-items-center gap-1" data-chip-symbol="${s}">
      ${s}
      <button type="button" class="btn btn-sm p-0 border-0 bg-transparent text-danger" data-chip-remove="${s}" title="Remove">x</button>
    </span>
  `).join("");
}

function addBotSymbol(symbol) {
  const s = (symbol || "").trim().toUpperCase();
  if (!s) return;
  if (selectedBotSymbols.includes(s)) return;
  if (selectedBotSymbols.length >= 20) {
    setBotStatus("Max 20 symbols allowed.", true);
    return;
  }
  selectedBotSymbols.push(s);
  renderSymbolChips();
  saveActiveProfileSnapshot();
}

function removeBotSymbol(symbol) {
  selectedBotSymbols = selectedBotSymbols.filter((s) => s !== symbol);
  renderSymbolChips();
  saveActiveProfileSnapshot();
}

function clearBotSymbolSuggestions() {
  const box = byId("bot-symbol-results");
  if (box) box.innerHTML = "";
}

function renderBotSymbolSuggestions(items) {
  const box = byId("bot-symbol-results");
  if (!box) return;
  if (!items || !items.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = items.map((it) => `
    <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-start" data-bot-symbol="${it.symbol}">
      <span>
        <strong>${it.symbol}</strong><br>
        <small class="text-muted">${it.name || ""}</small>
      </span>
      <small class="text-muted">${it.exchange || ""}</small>
    </button>
  `).join("");
}

async function runBotSymbolSearch(q) {
  const query = (q || "").trim();
  if (query.length < 2) {
    clearBotSymbolSuggestions();
    return;
  }
  try {
    const res = await fetch(`/api/trade/symbol-search/?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok) {
      clearBotSymbolSuggestions();
      return;
    }
    renderBotSymbolSuggestions(data.results || []);
  } catch (_) {
    clearBotSymbolSuggestions();
  }
}

function setBotStatus(message, isError = false) {
  const el = byId("bot-status");
  if (!el) return;
  el.textContent = message || "";
  el.className = `small mt-2 ${isError ? "text-danger" : "text-muted"}`;
}

function appendChat(role, text) {
  const log = byId("bot-chat-log");
  if (!log) return;
  const row = document.createElement("div");
  const cls = role === "user" ? "text-primary" : role === "error" ? "text-danger" : "text-success";
  row.className = `small mb-1 ${cls}`;
  row.textContent = `${role === "user" ? "You" : "Bot"}: ${text}`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  const normalizedRole = role === "user" ? "user" : "assistant";
  botChatHistory.push({ role: normalizedRole, content: text });
  if (botChatHistory.length > 20) botChatHistory = botChatHistory.slice(botChatHistory.length - 20);
}

function setAssistantProvider(text, ok = true) {
  const el = byId("bot-chat-provider");
  if (!el) return;
  el.textContent = `AI provider: ${text}`;
  el.className = `small mb-1 ${ok ? "text-muted" : "text-warning"}`;
}

function setChatLoading(isLoading) {
  const load = byId("bot-chat-loading");
  const input = byId("bot-chat-input");
  const send = byId("bot-chat-send");
  if (load) load.classList.toggle("d-none", !isLoading);
  if (input) input.disabled = !!isLoading;
  if (send) send.disabled = !!isLoading;
}

function setOllamaBadge(ok, modelAvailable, message = "") {
  const badge = byId("bot-ollama-badge");
  if (!badge) return;
  if (ok && modelAvailable) {
    badge.textContent = "Ollama: Connected";
    badge.className = "badge text-bg-success";
    return;
  }
  if (ok && !modelAvailable) {
    badge.textContent = "Ollama: Model missing";
    badge.className = "badge text-bg-warning";
    return;
  }
  badge.textContent = message || "Ollama: Disconnected";
  badge.className = "badge text-bg-danger";
}

function setBotStateBadge(enabled) {
  const badge = byId("bot-state");
  if (!badge) return;
  const status = (byId("bot-last-status")?.textContent || "").toLowerCase();
  if (enabled) {
    badge.textContent = "Running";
    badge.className = "badge text-bg-success";
    return;
  }
  if (status.includes("paused")) {
    badge.textContent = "Paused";
    badge.className = "badge text-bg-warning";
    return;
  }
  badge.textContent = "Stopped";
  badge.className = "badge text-bg-secondary";
}

function botPayloadFromForm() {
  const selectedStrategy = byId("bot-strategy")?.value || "";
  return {
    strategy: selectedStrategy,
    strategy_prompt: byId("bot-custom-prompt")?.value || "",
    symbols: selectedBotSymbols.join(","),
    order_quantity: Number(byId("bot-qty")?.value || 1),
    poll_seconds: Number(byId("bot-poll")?.value || 60),
    max_daily_loss: Number(byId("bot-max-loss")?.value || 500),
    max_open_positions: Number(byId("bot-max-pos")?.value || 5),
  };
}

async function loadBotConfig() {
  const res = await fetch("/api/trade/bot/config/");
  const data = await res.json();
  if (!res.ok) {
    setBotStatus(data.error || "Unable to load bot config.", true);
    return;
  }
  byId("bot-strategy").value = data.strategy || "ema_cross";
  if (byId("bot-custom-prompt")) byId("bot-custom-prompt").value = data.strategy_prompt || "";
  selectedBotSymbols = (data.symbols || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  renderSymbolChips();
  byId("bot-qty").value = data.order_quantity || 1;
  byId("bot-poll").value = data.poll_seconds || 60;
  byId("bot-max-loss").value = data.max_daily_loss || 500;
  byId("bot-max-pos").value = data.max_open_positions || 5;
  byId("bot-last-status").textContent = data.last_status ? `Last: ${data.last_status}` : "";
  setBotStateBadge(!!data.is_enabled);
  updateCustomPromptVisibility();
  renderStrategyTable();
  saveActiveProfileSnapshot();
  renderBotProfiles();
  if (data.is_enabled) startBotTimer();
}

async function saveBotConfig() {
  const payload = botPayloadFromForm();
  const isAiCustom = payload.strategy === "ai_custom";
  const hasPrompt = String(payload.strategy_prompt || "").trim().length > 0;
  if (!payload.strategy) {
    setBotStatus("Select a strategy from Strategy List.", true);
    return false;
  }
  if (!payload.symbols && !(isAiCustom && hasPrompt)) {
    setBotStatus("Add at least one symbol using search.", true);
    return false;
  }
  if (isAiCustom && !hasPrompt) {
    setBotStatus("AI Custom Strategy requires a strategy prompt.", true);
    return false;
  }
  const res = await fetch("/api/trade/bot/config/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": botCsrf() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    setBotStatus(data.error || "Unable to save bot config.", true);
    return false;
  }
  setBotStatus(data.message || "Config saved.");
  saveActiveProfileSnapshot();
  renderStrategyTable();
  return true;
}

async function deleteBotConfig() {
  const ok = window.confirm("Delete current bot strategy/config and stop bot?");
  if (!ok) return false;
  const res = await fetch("/api/trade/bot/config/", {
    method: "DELETE",
    headers: { "X-CSRFToken": botCsrf() },
  });
  const data = await res.json();
  if (!res.ok) {
    setBotStatus(data.error || "Unable to delete bot config.", true);
    return false;
  }
  setBotStatus(data.message || "Bot config deleted.");
  await loadBotConfig();
  await loadBotLogs();
  return true;
}

async function toggleBot(action) {
  const res = await fetch("/api/trade/bot/toggle/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": botCsrf() },
    body: JSON.stringify({ action }),
  });
  const data = await res.json();
  if (!res.ok) {
    setBotStatus(data.error || "Unable to toggle bot.", true);
    return false;
  }
  setBotStatus(data.message || "Done.");
  if (byId("bot-last-status")) byId("bot-last-status").textContent = data.message ? `Last: ${data.message}` : "";
  setBotStateBadge(!!data.is_enabled);
  if (data.is_enabled) startBotTimer();
  else stopBotTimer();
  return true;
}

async function runBotTick() {
  const res = await fetch("/api/trade/bot/tick/", {
    method: "POST",
    headers: { "X-CSRFToken": botCsrf() },
  });
  const data = await res.json();
  if (!res.ok) {
    setBotStatus(data.error || "Bot cycle failed.", true);
    return false;
  }
  setBotStatus(data.message || "Bot cycle complete.");
  await loadBotLogs();
  await loadBotConfig();
  return true;
}

function stopBotTimer() {
  if (botTimer) {
    clearInterval(botTimer);
    botTimer = null;
  }
}

function startBotTimer() {
  stopBotTimer();
  const sec = Math.max(20, Math.min(300, Number(byId("bot-poll")?.value || 60)));
  botTimer = setInterval(runBotTick, sec * 1000);
}

async function loadBotLogs() {
  const res = await fetch("/api/trade/bot/logs/");
  const data = await res.json();
  const tbody = byId("bot-log-body");
  if (!tbody) return;
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${data.error || "Unable to load logs."}</td></tr>`;
    return;
  }
  const rows = data.rows || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No bot activity yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${new Date(r.timestamp).toLocaleString()}</td>
      <td>${(r.level || "").toUpperCase()}</td>
      <td>${r.symbol || "-"}</td>
      <td>${r.action || "-"}</td>
      <td>${r.message || ""}</td>
    </tr>
  `).join("");
}

async function resolveSymbolCommand(raw) {
  const q = (raw || "").trim().toUpperCase();
  if (!q) return "";
  if (q.endsWith(".NS") || q.endsWith(".BO")) return q;
  try {
    const res = await fetch(`/api/trade/symbol-search/?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) return q;
    const items = data.results || [];
    if (!items.length) return q;
    const exact = items.find((x) => (x.symbol || "").toUpperCase() === `${q}.NS`)
      || items.find((x) => (x.symbol || "").toUpperCase() === `${q}.BO`)
      || items.find((x) => (x.symbol || "").toUpperCase().startsWith(`${q}.`));
    return (exact?.symbol || items[0].symbol || q).toUpperCase();
  } catch (_) {
    return q;
  }
}

function strategyKeyFromText(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("trend pullback") || t.includes("swing trading") || (t.includes("200 dma") && t.includes("rsi") && t.includes("pullback"))) return "trend_pullback";
  if (t.includes("ema")) return "ema_cross";
  return "";
}

function currentBotConfigText() {
  const promptLen = (byId("bot-custom-prompt")?.value || "").trim().length;
  return `strategy=${byId("bot-strategy")?.value || "-"}, promptChars=${promptLen}, symbols=${selectedBotSymbols.join(",") || "-"}, qty=${byId("bot-qty")?.value || "-"}, poll=${byId("bot-poll")?.value || "-"}s, maxLoss=${byId("bot-max-loss")?.value || "-"}, maxPos=${byId("bot-max-pos")?.value || "-"}`;
}

async function executeParsedCommand(text) {
  const cmd = (text || "").trim().toLowerCase();
  if (!cmd) return;

  if (cmd === "help") {
    appendChat("bot", "Commands: add/remove symbol, set qty/poll/loss/max positions, select strategy ema|trend pullback|ai custom, set strategy prompt <text>, save, start/pause/resume/stop, show config.");
    return;
  }
  if (cmd.startsWith("add symbol ")) {
    const raw = text.slice(11).trim();
    const resolved = await resolveSymbolCommand(raw);
    addBotSymbol(resolved);
    appendChat("bot", `Added symbol ${resolved}.`);
    return;
  }
  if (cmd.startsWith("remove symbol ")) {
    const raw = text.slice(14).trim().toUpperCase();
    removeBotSymbol(raw);
    appendChat("bot", `Removed symbol ${raw}.`);
    return;
  }
  if (cmd === "clear symbols") {
    selectedBotSymbols = [];
    renderSymbolChips();
    appendChat("bot", "Cleared all symbols.");
    return;
  }
  if (cmd.startsWith("set qty ")) {
    const n = Number(cmd.replace("set qty ", "").trim());
    if (!Number.isNaN(n) && n > 0) {
      byId("bot-qty").value = String(Math.floor(n));
      appendChat("bot", `Order quantity set to ${Math.floor(n)}.`);
    } else appendChat("error", "Invalid qty.");
    return;
  }
  if (cmd.startsWith("set poll ")) {
    const n = Number(cmd.replace("set poll ", "").trim());
    if (!Number.isNaN(n) && n >= 20 && n <= 300) {
      byId("bot-poll").value = String(Math.floor(n));
      appendChat("bot", `Poll seconds set to ${Math.floor(n)}.`);
    } else appendChat("error", "Poll must be between 20 and 300.");
    return;
  }
  if (cmd.startsWith("set loss ")) {
    const n = Number(cmd.replace("set loss ", "").trim());
    if (!Number.isNaN(n) && n > 0) {
      byId("bot-max-loss").value = String(n);
      appendChat("bot", `Max daily loss set to ${n}.`);
    } else appendChat("error", "Invalid loss.");
    return;
  }
  if (cmd.startsWith("set max positions ")) {
    const n = Number(cmd.replace("set max positions ", "").trim());
    if (!Number.isNaN(n) && n > 0) {
      byId("bot-max-pos").value = String(Math.floor(n));
      appendChat("bot", `Max open positions set to ${Math.floor(n)}.`);
    } else appendChat("error", "Invalid max positions.");
    return;
  }
  if (cmd.startsWith("select strategy ")) {
    const k = strategyKeyFromText(cmd.replace("select strategy ", ""));
    const raw = cmd.replace("select strategy ", "").trim();
    const chosen = raw.includes("custom") ? "ai_custom" : k;
    if (!chosen) {
      appendChat("error", "Strategy not recognized. Try: select strategy ema OR trend pullback OR ai custom");
      return;
    }
    byId("bot-strategy").value = chosen;
    updateCustomPromptVisibility();
    renderStrategyTable();
    appendChat("bot", `Strategy selected: ${chosen === "trend_pullback" ? "Trend Pullback" : chosen === "ai_custom" ? "AI Custom Strategy" : "EMA Cross"}.`);
    return;
  }
  if (cmd.startsWith("set strategy prompt ")) {
    const promptText = text.slice("set strategy prompt ".length).trim();
    if (!promptText) {
      appendChat("error", "Prompt text is empty.");
      return;
    }
    byId("bot-strategy").value = "ai_custom";
    updateCustomPromptVisibility();
    byId("bot-custom-prompt").value = promptText;
    const okSave = await saveBotConfig();
    appendChat(okSave ? "bot" : "error", okSave ? "AI custom strategy prompt saved." : "Failed to save strategy prompt.");
    return;
  }
  if (text.trim().length > 250 && (text.toLowerCase().includes("strategy") || text.toLowerCase().includes("entry") || text.toLowerCase().includes("stop loss"))) {
    byId("bot-strategy").value = "ai_custom";
    updateCustomPromptVisibility();
    byId("bot-custom-prompt").value = text.trim();
    const okSave = await saveBotConfig();
    appendChat(okSave ? "bot" : "error", okSave ? "Long strategy prompt saved to AI Custom Strategy." : "Failed to save long strategy prompt.");
    return;
  }
  if (cmd === "save" || cmd === "save config") {
    const ok = await saveBotConfig();
    appendChat(ok ? "bot" : "error", ok ? "Config saved." : "Failed to save config.");
    return;
  }
  if (cmd === "start bot" || cmd === "start") {
    const okSave = await saveBotConfig();
    if (!okSave) {
      appendChat("error", "Could not start: save/config validation failed.");
      return;
    }
    const ok = await toggleBot("start");
    appendChat(ok ? "bot" : "error", ok ? "Bot started." : "Failed to start bot.");
    return;
  }
  if (cmd === "pause bot" || cmd === "pause") {
    const ok = await toggleBot("pause");
    appendChat(ok ? "bot" : "error", ok ? "Bot paused." : "Failed to pause bot.");
    return;
  }
  if (cmd === "resume bot" || cmd === "resume") {
    const okSave = await saveBotConfig();
    if (!okSave) {
      appendChat("error", "Could not resume: save/config validation failed.");
      return;
    }
    const ok = await toggleBot("resume");
    appendChat(ok ? "bot" : "error", ok ? "Bot resumed." : "Failed to resume bot.");
    return;
  }
  if (cmd === "stop bot" || cmd === "stop") {
    const ok = await toggleBot("stop");
    appendChat(ok ? "bot" : "error", ok ? "Bot stopped." : "Failed to stop bot.");
    return;
  }
  if (cmd === "show config") {
    appendChat("bot", currentBotConfigText());
    return;
  }
  appendChat("error", "Command not understood. Type help.");
}

async function executeCommandList(commands) {
  const list = Array.isArray(commands) ? commands : [];
  for (const cmd of list) {
    await executeParsedCommand(cmd);
  }
}

async function askAssistant(message) {
  try {
    const res = await fetch("/api/trade/bot/assistant/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": botCsrf() },
      body: JSON.stringify({ message, history: botChatHistory.slice(-10) }),
    });
    const data = await res.json();
    if (!res.ok) return { provider: "local parser", command: message, reply: data.error || "", ai: false };
    return {
      provider: data.provider || "local parser",
      mode: data.mode || "command",
      command: data.command || message,
      commands: Array.isArray(data.commands) ? data.commands : [],
      reply: data.reply || "",
      ai: !!data.ai,
    };
  } catch (_) {
    return { provider: "local parser", mode: "command", command: message, commands: [message], reply: "", ai: false };
  }
}

async function checkAssistantHealth() {
  try {
    const res = await fetch("/api/trade/bot/assistant-health/");
    const data = await res.json();
    if (!res.ok) {
      setOllamaBadge(false, false, "Ollama: Error");
      return;
    }
    setOllamaBadge(!!data.ok, !!data.model_available);
    if (data.ok && !data.model_available) {
      appendChat("error", `Ollama connected but model "${data.model}" not found. Run: ollama pull ${data.model}`);
    }
  } catch (_) {
    setOllamaBadge(false, false, "Ollama: Disconnected");
  }
}

async function handleChatCommand(input) {
  const text = (input || "").trim();
  if (!text) return;
  appendChat("user", text);
  setChatLoading(true);
  try {
    const ai = await askAssistant(text);
    setAssistantProvider(ai.provider || "local parser", !!ai.ai);
    if (ai.mode === "chat") {
      appendChat("bot", ai.reply || "I can help. Ask me to configure/start/stop the bot or manage symbols.");
      return;
    }
    if (ai.reply) appendChat(ai.ai ? "bot" : "error", ai.reply);
    const cmds = (ai.commands && ai.commands.length) ? ai.commands : [ai.command || text];
    if (cmds.length > 1) appendChat("bot", `Executing ${cmds.length} commands...`);
    await executeCommandList(cmds);
  } finally {
    setChatLoading(false);
  }
}

byId("bot-save")?.addEventListener("click", saveBotConfig);
byId("bot-strategy")?.addEventListener("change", () => {
  updateCustomPromptVisibility();
  saveActiveProfileSnapshot();
});
byId("bot-custom-prompt")?.addEventListener("input", saveActiveProfileSnapshot);
byId("bot-strategy-body")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-strategy-action]");
  const row = e.target.closest("[data-strategy-key]");
  if (!btn || !row) return;
  const action = btn.dataset.strategyAction;
  const key = row.dataset.strategyKey;
  const strategy = strategyRows.find((s) => s.key === key);
  if (action === "delete") {
    if (!strategy) {
      setBotStatus("Strategy not found.", true);
      return;
    }
    const ok = window.confirm(`Delete strategy "${strategy.name}" from your list?`);
    if (!ok) return;
    const deleted = new Set(loadDeletedStrategies());
    deleted.add(strategy.key);
    saveDeletedStrategies(Array.from(deleted));
    if ((byId("bot-strategy")?.value || "") === strategy.key) {
      byId("bot-strategy").value = "";
    }
    saveActiveProfileSnapshot();
    renderStrategyTable();
    setBotStatus(`Strategy "${strategy.name}" deleted from list.`);
    return;
  }
  if (!strategy || !strategy.executable) {
    setBotStatus("This strategy is not available yet.", true);
    return;
  }
  byId("bot-strategy").value = key;
  saveActiveProfileSnapshot();
  renderStrategyTable();
  if (action === "start" || action === "resume") {
    saveBotConfig().then((okSave) => {
      if (!okSave) return;
      toggleBot(action);
    });
    return;
  }
  if (action === "pause" || action === "stop") {
    toggleBot(action);
  }
});
byId("bot-symbol-search")?.addEventListener("input", (e) => {
  clearTimeout(botSearchDebounce);
  botSearchDebounce = setTimeout(() => runBotSymbolSearch(e.target.value), 220);
});
byId("bot-symbol-search")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const raw = (e.target.value || "").trim().toUpperCase();
    if (raw) addBotSymbol(raw);
    e.target.value = "";
    clearBotSymbolSuggestions();
  }
});
byId("bot-symbol-results")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-bot-symbol]");
  if (!btn) return;
  addBotSymbol(btn.dataset.botSymbol);
  byId("bot-symbol-search").value = "";
  clearBotSymbolSuggestions();
});
byId("bot-symbol-chips")?.addEventListener("click", (e) => {
  const remove = e.target.closest("[data-chip-remove]");
  if (!remove) return;
  removeBotSymbol(remove.dataset.chipRemove);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#bot-symbol-search") && !e.target.closest("#bot-symbol-results")) {
    clearBotSymbolSuggestions();
  }
});
byId("bot-profile-create")?.addEventListener("click", () => {
  const name = window.prompt("Profile name");
  if (!name || !name.trim()) return;
  const key = name.trim();
  const profiles = loadBotProfiles();
  profiles[key] = profileFromCurrentForm();
  saveBotProfiles(profiles);
  activeBotProfile = key;
  renderBotProfiles();
  setBotStatus(`Profile "${key}" created.`);
});
byId("bot-profile-delete")?.addEventListener("click", () => {
  const profiles = loadBotProfiles();
  const names = Object.keys(profiles);
  if (names.length <= 1) {
    setBotStatus("At least one profile is required.", true);
    return;
  }
  const ok = window.confirm(`Delete profile "${activeBotProfile}"?`);
  if (!ok) return;
  delete profiles[activeBotProfile];
  const next = Object.keys(profiles)[0];
  activeBotProfile = next;
  saveBotProfiles(profiles);
  applyProfileToForm(profiles[next]);
  renderBotProfiles();
  setBotStatus("Profile deleted.");
});
byId("bot-profile-select")?.addEventListener("change", (e) => {
  saveActiveProfileSnapshot();
  activeBotProfile = e.target.value || "Default";
  const profiles = loadBotProfiles();
  applyProfileToForm(profiles[activeBotProfile] || {});
  setBotStatus(`Profile switched to "${activeBotProfile}".`);
});
byId("bot-start")?.addEventListener("click", async () => {
  await saveBotConfig();
  if (!(byId("bot-strategy")?.value || "")) return;
  if (!selectedBotSymbols.length) return;
  await toggleBot("start");
  await runBotTick();
});
byId("bot-pause")?.addEventListener("click", () => toggleBot("pause"));
byId("bot-resume")?.addEventListener("click", async () => {
  const okSave = await saveBotConfig();
  if (!okSave) return;
  await toggleBot("resume");
});
byId("bot-stop")?.addEventListener("click", () => toggleBot("stop"));
byId("bot-delete")?.addEventListener("click", deleteBotConfig);
byId("bot-chat-send")?.addEventListener("click", async () => {
  const input = byId("bot-chat-input");
  if (!input) return;
  const text = input.value || "";
  input.value = "";
  await handleChatCommand(text);
});
byId("bot-ollama-check")?.addEventListener("click", checkAssistantHealth);
byId("bot-chat-input")?.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const input = byId("bot-chat-input");
  if (!input) return;
  const text = input.value || "";
  input.value = "";
  await handleChatCommand(text);
});

loadBotConfig();
loadBotLogs();
appendChat("bot", "Assistant ready. You can chat normally or give commands. Type help for actions.");
checkAssistantHealth();
