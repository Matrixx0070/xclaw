(() => {
  // Same-origin gateway calls carry the operator token when one is set
  // (localStorage.xclaw_token). With gateway.authStrict the /channel/ API
  // is token-gated and this client had NO token support at all — every
  // send failed 401. Tokenless lab setups are unaffected (nothing is sent
  // when no token is stored). Mirrors the control UI's central wrapper.
  const _rawFetch = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    try {
      // Resolve the real target origin — naive prefix checks leak the token:
      // "//evil.com/x" starts with "/", and "http://host:port.evil.com"
      // starts with location.origin as a plain string.
      const raw = typeof url === "string" ? url : url?.url != null ? url.url : String(url);
      const sameOrigin = new URL(raw, location.href).origin === location.origin;
      const tok = localStorage.getItem("xclaw_token");
      if (sameOrigin && tok) {
        if (opts.headers instanceof Headers) {
          if (!opts.headers.has("x-xclaw-token")) opts.headers.set("x-xclaw-token", tok);
        } else {
          opts = { ...opts, headers: { "x-xclaw-token": tok, ...(opts.headers || {}) } };
        }
      }
    } catch {
      /* unresolvable URL or storage unavailable — send unauthenticated */
    }
    return _rawFetch(url, opts);
  };

  const $ = (sel) => document.querySelector(sel);
  const messagesEl = $("#messages");
  const emptyEl = $("#empty");
  const form = $("#form");
  const input = $("#input");
  const sendBtn = $("#send");
  const sessionLabel = $("#session-label");

  let sessionId = localStorage.getItem("xclaw_session") || null;
  let busy = false;

  function setSession(id) {
    sessionId = id;
    if (id) localStorage.setItem("xclaw_session", id);
    else localStorage.removeItem("xclaw_session");
    sessionLabel.textContent = id ? `session ${id.slice(0, 8)}…` : "No session yet";
  }

  function clearMessages() {
    messagesEl.innerHTML = "";
    messagesEl.appendChild(emptyEl);
    emptyEl.style.display = "";
  }

  function hideEmpty() {
    emptyEl.style.display = "none";
  }

  function addBubble(role, content, meta) {
    hideEmpty();
    const div = document.createElement("div");
    div.className = `bubble ${role}`;
    div.textContent = content;
    if (meta) {
      const m = document.createElement("div");
      m.className = "meta";
      m.textContent = meta;
      div.appendChild(m);
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  /** Post-turn follow-up chips (same idea as Telegram ↳ buttons) */
  function renderSuggestionChips(items) {
    if (!items || !items.length) return;
    hideEmpty();
    // remove previous chip row
    messagesEl.querySelectorAll(".chip-row").forEach((el) => el.remove());
    const row = document.createElement("div");
    row.className = "chip-row";
    items.slice(0, 4).forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = "↳ " + (s.label || s.prompt || "Next");
      btn.title = s.prompt || "";
      btn.addEventListener("click", () => {
        recordChipFeedback(s, "tapped");
        row.remove();
        sendMessage(s.prompt || s.label);
      });
      row.appendChild(btn);
      recordChipFeedback(s, "shown");
    });
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function recordChipFeedback(s, event) {
    try {
      fetch("/channel/webchat/suggestions/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          source: s.source,
          kind: s.kind,
          prompt: s.prompt,
          suggestionId: s.id,
          sessionId,
        }),
      }).catch(() => {});
    } catch {
      /* optional */
    }
  }

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
    input.disabled = v;
  }

  async function refreshStatus() {
    try {
      const r = await fetch("/gateway/info");
      const j = await r.json();
      const gw = $("#st-gw");
      const comp = $("#st-comp");
      const model = $("#st-model");
      gw.textContent = "UP";
      gw.className = "up";
      const ok = j.computer?.healthy;
      comp.textContent = ok ? "UP" : "DOWN";
      comp.className = ok ? "up" : "down";
      model.textContent = j.agent?.model || "—";
    } catch {
      $("#st-gw").textContent = "DOWN";
      $("#st-gw").className = "down";
      $("#st-comp").textContent = "?";
      $("#st-model").textContent = "—";
    }
  }

  /**
   * Parse SSE stream from fetch body.
   * Calls onEvent(eventName, dataObj) for each event; resolves with result payload.
   */
  async function consumeSSE(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultPayload = null;
    let errorPayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const chunk of parts) {
        if (!chunk.trim() || chunk.startsWith(":")) continue; // comment / ping
        let eventName = "message";
        const dataLines = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        let data;
        try {
          data = JSON.parse(dataLines.join("\n"));
        } catch {
          data = { raw: dataLines.join("\n") };
        }
        onEvent(eventName, data);
        if (eventName === "result") resultPayload = data;
        if (eventName === "error") errorPayload = data;
      }
    }
    if (errorPayload) throw new Error(errorPayload.error || "stream error");
    return resultPayload;
  }

  async function sendMessage(text) {
    if (!text.trim() || busy) return;
    setBusy(true);
    addBubble("user", text.trim());
    input.value = "";
    autoSize();

    const thinking = addBubble("thinking", "Connecting…");
    let toolsBubble = null;

    try {
      const r = await fetch("/channel/webchat/message/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: text.trim(),
          sessionId,
          mode: document.getElementById("mode-job")?.checked ? "job" : undefined,
        }),
      });

      if (!r.ok) {
        const errBody = await r.text();
        thinking.remove();
        addBubble("assistant", `Error ${r.status}: ${errBody.slice(0, 300)}`);
        return;
      }

      const result = await consumeSSE(r, (eventName, data) => {
        if (eventName === "lifecycle" && data.phase === "start") {
          thinking.textContent = "Thinking…";
        }
        if (eventName === "model" && data.phase === "request") {
          thinking.textContent = `Model turn ${data.turn || "…"}…`;
        }
        if (eventName === "tool" && data.phase === "start") {
          thinking.textContent = `Running ${data.name}…`;
          const line = `→ ${data.name}${data.args ? " " + JSON.stringify(data.args).slice(0, 80) : ""}`;
          if (!toolsBubble) {
            toolsBubble = addBubble("tools", line);
          } else {
            toolsBubble.textContent += "\n" + line;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
        if (eventName === "tool" && data.phase === "end") {
          if (toolsBubble && data.preview) {
            toolsBubble.textContent += `\n← ${data.preview.slice(0, 120)}`;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
        if (eventName === "guard") {
          addBubble("tools", `! guard [${data.level}] ${data.message || ""}`);
        }
        if (eventName === "suggestions" || (eventName === "message" && data.type === "suggestions")) {
          const items = data.items || data.suggestions || [];
          if (items.length) {
            // stash for result if result omits them
            window.__xclawPendingChips = items;
          }
        }
        if (eventName === "turn_state" || (data && data.type === "turn_state")) {
          thinking.textContent = data.summary || data.phase || thinking.textContent;
        }
      });

      thinking.remove();
      if (!result || result.ok === false) {
        addBubble("assistant", result?.error || "No result from stream");
        return;
      }
      if (result.sessionId) setSession(result.sessionId);
      const content = result.reply?.content || result.text || "(empty)";
      const u = result.usage || result.reply?.usage;
      const meta = [
        result.model && `model ${result.model}`,
        result.turns != null && `${result.turns} turns`,
        result.job && `job ${result.job.status}${result.job.pass ? " ✓" : ""}`,
        u?.hasRealUsage && `in ${u.promptTokens} / out ${u.completionTokens}`,
        !u?.hasRealUsage && u?.estimatedPromptTokens != null && `~${u.estimatedPromptTokens} tok`,
        "SSE",
      ]
        .filter(Boolean)
        .join(" · ");
      addBubble("assistant", content, meta);
      const chips =
        result.suggestions ||
        result.reply?.suggestions ||
        window.__xclawPendingChips ||
        [];
      window.__xclawPendingChips = null;
      renderSuggestionChips(chips);
      if (result.turnState?.phase) {
        const phase = result.turnState.phase;
        if (phase === "blocked" || phase === "failed") {
          addBubble("tools", `phase: ${phase}` + (result.turnState.summary ? ` · ${result.turnState.summary}` : ""));
        }
      }
    } catch (err) {
      thinking.remove();
      addBubble("assistant", `Error: ${err.message}`);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function autoSize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
  input.addEventListener("input", autoSize);

  $("#btn-new").addEventListener("click", () => {
    setSession(null);
    clearMessages();
  });

  document.querySelectorAll(".suggestions button").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.prompt));
  });

  setSession(sessionId);
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();


async function loadCheckpoints() {
  const box = document.getElementById("cp-list");
  if (!box) return;
  try {
    const r = await fetch("/checkpoints?limit=8");
    if (!r.ok) throw new Error("checkpoints " + r.status);
    const data = await r.json();
    const list = data.checkpoints || [];
    if (!list.length) {
      box.textContent = "None yet";
      return;
    }
    box.innerHTML = "";
    for (const c of list) {
      const row = document.createElement("div");
      row.style.marginBottom = "0.35rem";
      row.innerHTML = `<div>${(c.goal || c.id || "").slice(0, 36)}</div>`;
      const btn = document.createElement("button");
      btn.textContent = "Resume";
      btn.className = "btn";
      btn.style.fontSize = "0.65rem";
      btn.onclick = async () => {
        const res = await fetch("/checkpoints/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: c.id }),
        });
        const j = await res.json();
        alert(j.pass ? "PASS " + j.id : (j.error || j.status || JSON.stringify(j)));
        loadCheckpoints();
      };
      row.appendChild(btn);
      box.appendChild(row);
    }
  } catch (e) {
    box.textContent = String(e.message || e);
  }
}
document.getElementById("btn-cp-refresh")?.addEventListener("click", loadCheckpoints);
loadCheckpoints();
