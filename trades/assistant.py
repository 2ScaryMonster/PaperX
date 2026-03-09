import json
import os
import re

import requests


def _build_prompt(message: str, history: list[dict] | None = None):
    history = history or []
    history_txt = "\n".join([f"{(m.get('role') or 'user').upper()}: {m.get('content') or ''}" for m in history[-10:]])
    allowed = [
        "help",
        "add symbol <symbol>",
        "remove symbol <symbol>",
        "clear symbols",
        "set qty <number>",
        "set poll <number>",
        "set loss <number>",
        "set max positions <number>",
        "select strategy ema",
        "select strategy trend pullback",
        "select strategy ai custom",
        "set strategy prompt <text>",
        "save",
        "start bot",
        "pause bot",
        "resume bot",
        "stop bot",
        "show config",
    ]
    return f"""
You are a trading bot assistant for a paper trading app.
You can chat naturally OR emit one or more actionable commands from this list:
{', '.join(allowed)}

Return strict JSON only:
{{"mode":"chat|command", "command":"...", "commands":["..."], "reply":"..."}}

Rules:
- If user clearly asks for an action, set mode=command and output command.
- If user asks normal conversation/question, set mode=chat and command="".
- command must be concise and follow allowed grammar.
- For long strategy prompts, return a safe executable sequence in "commands".
- If symbol list is missing in prompt, do not invent symbols.
- keep reply short and practical.

Recent conversation:
{history_txt}

User message: {message}
""".strip()


def _extract_json_object(text: str):
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Empty response text")
    try:
        return json.loads(raw)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        raise ValueError("No JSON object in response")
    return json.loads(m.group(0))


def _ollama_endpoint_and_model():
    model = os.getenv("BOT_ASSISTANT_MODEL", "qwen2.5:3b")
    endpoint = os.getenv("BOT_ASSISTANT_URL", "http://localhost:11434/api/generate")
    return endpoint, model


def _ollama_generate(prompt: str):
    endpoint, model = _ollama_endpoint_and_model()
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    resp = requests.post(endpoint, json=payload, timeout=75)
    resp.raise_for_status()
    data = resp.json() or {}
    text = (data.get("response") or "").strip()
    if not text:
        raise ValueError("Empty AI response")
    return text


def _try_ollama(message: str, history: list[dict] | None = None):
    prompt = _build_prompt(message, history=history)
    # Pass 1: direct response
    text = _ollama_generate(prompt)
    try:
        parsed = _extract_json_object(text)
    except Exception:
        # Pass 2: ask model to normalize previous answer into strict JSON
        repair_prompt = (
            "Convert the following assistant output into strict JSON only with keys "
            "mode, command, commands, reply.\n\n"
            f"OUTPUT:\n{text}"
        )
        repaired = _ollama_generate(repair_prompt)
        parsed = _extract_json_object(repaired)
    mode = (parsed.get("mode") or "").strip().lower()
    cmd = (parsed.get("command") or "").strip()
    commands = parsed.get("commands") or []
    if not isinstance(commands, list):
        commands = []
    commands = [str(c).strip() for c in commands if str(c).strip()]
    reply = (parsed.get("reply") or "").strip()
    if mode not in {"chat", "command"}:
        mode = "command" if (cmd or commands) else "chat"
    if cmd and cmd not in commands:
        commands = [cmd] + commands
    return {"provider": "ollama", "mode": mode, "command": cmd, "commands": commands, "reply": reply}


def ai_decide_from_strategy(strategy_prompt: str, symbol: str, snapshot: dict):
    endpoint, model = _ollama_endpoint_and_model()
    sys_prompt = (
        "You are a trading strategy execution engine. "
        "Apply the user strategy exactly on given market snapshot. "
        "Return strict JSON only: "
        '{"decision":"BUY|WAIT|REJECT","reason":"...","entry":number|null,"stop":number|null,"target":number|null}. '
        "Do not add markdown."
    )
    user_prompt = (
        f"Strategy:\n{(strategy_prompt or '').strip()}\n\n"
        f"Symbol: {symbol}\n"
        f"Snapshot JSON:\n{json.dumps(snapshot, ensure_ascii=True)}"
    )
    payload = {
        "model": model,
        "prompt": f"{sys_prompt}\n\n{user_prompt}",
        "stream": False,
        "options": {"temperature": 0},
    }
    try:
        resp = requests.post(endpoint, json=payload, timeout=90)
        resp.raise_for_status()
        text = (resp.json() or {}).get("response", "").strip()
        parsed = _extract_json_object(text)
        decision = str(parsed.get("decision") or "WAIT").upper()
        if decision not in {"BUY", "WAIT", "REJECT"}:
            decision = "WAIT"
        return {
            "decision": decision,
            "reason": str(parsed.get("reason") or ""),
            "entry": parsed.get("entry"),
            "stop": parsed.get("stop"),
            "target": parsed.get("target"),
        }
    except Exception as exc:
        return {
            "decision": "WAIT",
            "reason": f"AI decision unavailable: {exc}",
            "entry": None,
            "stop": None,
            "target": None,
        }


def ai_normalize_command(message: str, history: list[dict] | None = None):
    msg = (message or "").strip()
    if not msg:
        return {"provider": "none", "mode": "chat", "command": "", "reply": "Type a command."}
    try:
        out = _try_ollama(msg, history=history)
        return {
            "provider": out["provider"],
            "mode": out.get("mode", "chat"),
            "command": out.get("command", ""),
            "commands": out.get("commands", []),
            "reply": out.get("reply", ""),
            "ai": True,
        }
    except Exception:
        return {
            "provider": "fallback",
            "mode": "command",
            "command": msg,
            "commands": [msg],
            "reply": "AI unavailable. Executing with local command parser.",
            "ai": False,
        }


def ollama_health():
    base = os.getenv("BOT_ASSISTANT_URL", "http://localhost:11434/api/generate")
    root = re.sub(r"/api/generate/?$", "", base.strip())
    model = os.getenv("BOT_ASSISTANT_MODEL", "qwen2.5:3b")
    try:
        tags = requests.get(f"{root}/api/tags", timeout=6)
        tags.raise_for_status()
        payload = tags.json() or {}
        models = payload.get("models") or []
        names = [(m.get("name") or "").strip() for m in models]
        has_model = any(n == model or n.startswith(f"{model}:") for n in names)
        return {
            "ok": True,
            "endpoint": root,
            "model": model,
            "model_available": has_model,
            "models": names[:30],
        }
    except Exception as exc:
        return {
            "ok": False,
            "endpoint": root,
            "model": model,
            "model_available": False,
            "error": str(exc),
            "models": [],
        }
