/**
 * XClaw WebChat — streaming-first client.
 *
 * Renders the loop's real event stream: markdown deltas, live tool cards,
 * INLINE approval cards (Allow/Deny resolve /security/decide), budget
 * notices, suggestion chips, generated images (via /artifacts/file),
 * per-message usage. Zero dependencies.
 */
import { renderMarkdown, escapeHtml } from "./markdown.mjs";

// Same-origin gateway calls carry the operator token when one is set
// (localStorage.xclaw_token). Strict URL-origin resolution — naive prefix
// checks leak the token (see 3.93.3).
const _rawFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  try {
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
  } catch { /* unresolvable URL or storage unavailable */ }
  return _rawFetch(url, opts);
};

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const scrollEl = $("scroll");
const landingEl = $("landing");
const input = $("input");
const sendBtn = $("send");
const stopBtn = $("btn-stop");

let sessionId = localStorage.getItem("xclaw_session") || null;
let streaming = false;
let abortCtl = null;

// ——— point-and-prompt: pick an element from the running app, drop its
// descriptor + resolved source locations into the composer ————————————
const pointBtn = $("point");
pointBtn?.addEventListener("click", async () => {
  const lastUrl = localStorage.getItem("xclaw_point_url") || "http://127.0.0.1:8099/";
  const url = window.prompt("App URL to point at (opens in the Control browser):", lastUrl);
  if (!url) return;
  localStorage.setItem("xclaw_point_url", url);
  const lastRepo = localStorage.getItem("xclaw_point_repo") || "";
  const repoDir = window.prompt("Repository path (optional — resolves the element to source files):", lastRepo);
  if (repoDir != null) localStorage.setItem("xclaw_point_repo", repoDir);
  pointBtn.disabled = true;
  pointBtn.textContent = "…";
  try {
    const r = await fetch("/point/pick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((x) => x.json());
    if (r.cancelled) return;
    if (!r.ok) throw new Error(r.error || "pick failed");
    const e = r.element;
    const lines = [
      `[pointed element] <${e.tag}${e.id ? ` id="${e.id}"` : ""}${e.classes?.length ? ` class="${e.classes.join(" ")}"` : ""}>` +
        (e.text ? ` — "${e.text.slice(0, 80)}"` : ""),
      `page: ${e.url || url}${e.selector ? ` · selector: ${e.selector}` : ""}`,
    ];
    if (repoDir) {
      const rr = await fetch("/point/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoDir, element: e }),
      }).then((x) => x.json());
      if (rr.ok && rr.matches?.length) {
        lines.push(`likely sources (${repoDir}): ` + rr.matches.slice(0, 5).map((m) => `${m.file}:${m.line}`).join(", "));
      }
    }
    const block = lines.join("\n") + "\n\n";
    input.value = block + input.value;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input"));
  } catch (err) {
    window.alert("Point failed: " + (err.message || err));
  } finally {
    pointBtn.disabled = false;
    pointBtn.textContent = "🎯";
  }
});

// ——— helpers ————————————————————————————————————————————————————————

const nearBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 140;
const scrollDown = (force = false) => {
  if (force || nearBottom()) scrollEl.scrollTop = scrollEl.scrollHeight;
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function hideLanding() { if (landingEl) landingEl.style.display = "none"; }

function fmtDuration(ms) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function relTime(ts) {
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ——— message rows ———————————————————————————————————————————————————

function addUserRow(text) {
  hideLanding();
  const row = el("div", "row user");
  row.append(el("div", "avatar", "You".slice(0, 1)));
  const body = el("div", "body");
  body.append(el("div", "who", "You"));
  body.append(el("div", "content", renderMarkdown(text)));
  row.append(body);
  messagesEl.append(row);
  scrollDown(true);
  return row;
}

function addBotRow() {
  hideLanding();
  const row = el("div", "row bot");
  row.append(el("div", "avatar", "🦞"));
  const body = el("div", "body");
  body.append(el("div", "who", "XClaw"));
  const thinking = el("div", "thinking", `<span class="spin"></span><span class="t-label">Thinking…</span>`);
  const timeline = el("div", "timeline");
  const content = el("div", "content");
  body.append(thinking, timeline, content);
  row.append(body);
  messagesEl.append(row);
  scrollDown(true);
  return { row, body, thinking, timeline, content };
}

function setThinking(ctx, label) {
  const t = ctx.thinking.querySelector(".t-label");
  if (t) t.textContent = label;
}

// tool cards
function addToolCard(ctx, name, args) {
  const card = el("div", "tcard");
  const argsStr = args ? JSON.stringify(args) : "";
  card.innerHTML =
    `<div class="tcard-head"><span class="tdot run"></span>` +
    `<span class="tname">${escapeHtml(name)}</span>` +
    `<span class="targ">${escapeHtml(argsStr.slice(0, 140))}</span>` +
    `<span class="tdur"></span></div>` +
    `<div class="tcard-body">${escapeHtml(argsStr)}</div>`;
  card.querySelector(".tcard-head").addEventListener("click", () => card.classList.toggle("open"));
  card.dataset.started = String(Date.now());
  ctx.timeline.append(card);
  scrollDown();
  return card;
}

function endToolCard(card, { preview, error } = {}) {
  if (!card) return;
  const dot = card.querySelector(".tdot");
  dot.classList.remove("run");
  dot.classList.add(error ? "bad" : "ok");
  const dur = Date.now() - Number(card.dataset.started || Date.now());
  card.querySelector(".tdur").textContent = fmtDuration(dur);
  if (preview) {
    const body = card.querySelector(".tcard-body");
    body.textContent = `${body.textContent}\n\n— result —\n${preview}`;
  }
}

// approval cards
function addApprovalCard(ctx, { pendingId, name, args }) {
  const card = el("div", "apr");
  const cmd = args?.command || JSON.stringify(args || {});
  card.innerHTML =
    `<div class="apr-title">Approval required — <code>${escapeHtml(name)}</code></div>` +
    `<div class="apr-cmd">${escapeHtml(String(cmd))}</div>` +
    `<div class="apr-actions">` +
    `<button class="apr-btn apr-allow">Allow</button>` +
    `<button class="apr-btn apr-deny">Deny</button>` +
    `<span class="apr-state"></span></div>`;
  const state = card.querySelector(".apr-state");
  const resolve = async (approved) => {
    state.textContent = "…";
    try {
      const r = await fetch("/security/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingId, approved }),
      });
      const j = await r.json().catch(() => ({}));
      card.classList.add("resolved");
      card.querySelectorAll("button").forEach((b) => (b.disabled = true));
      state.textContent = r.ok ? (approved ? "✓ allowed" : "✗ denied") : `error: ${j.error || r.status}`;
    } catch (e) {
      state.textContent = `error: ${e.message}`;
    }
  };
  card.querySelector(".apr-allow").addEventListener("click", () => resolve(true));
  card.querySelector(".apr-deny").addEventListener("click", () => resolve(false));
  ctx.timeline.append(card);
  scrollDown(true);
  return card;
}

// generated images
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
function traceImagePaths(toolTrace) {
  const out = new Set();
  for (const t of toolTrace || []) {
    for (const a of t.artifacts || []) {
      const ref = a?.ref || a?.path || "";
      if (typeof ref === "string" && IMG_RE.test(ref)) out.add(ref);
    }
    const res = typeof t.result === "string" ? t.result : "";
    for (const m of res.matchAll(/(?:^|[\s"'`(])(\/[^\s"'`()]+\.(?:png|jpe?g|webp|gif))/gi)) {
      out.add(m[1]);
    }
  }
  return [...out];
}

async function renderImages(ctx, paths) {
  if (!paths.length) return;
  const wrap = el("div", "shots");
  let any = false;
  for (const p of paths.slice(0, 6)) {
    try {
      const r = await fetch(`/artifacts/file?path=${encodeURIComponent(p)}`);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob.type.startsWith("image/")) continue;
      const img = document.createElement("img");
      img.src = URL.createObjectURL(blob);
      img.alt = p.split("/").pop();
      img.title = p;
      wrap.append(img);
      any = true;
    } catch { /* skip */ }
  }
  if (any) {
    ctx.content.after(wrap);
    scrollDown();
  }
}

// footer: usage + actions
function addFooter(ctx, { usage, model, userText }) {
  const foot = el("div", "msg-foot");
  const bits = [];
  if (model) bits.push(escapeHtml(model));
  if (usage?.totalTokens) bits.push(`${usage.totalTokens} tok`);
  if (usage?.costUsdFormatted) bits.push(escapeHtml(usage.costUsdFormatted));
  foot.innerHTML = `<span>${bits.join(" · ")}</span>`;
  const actions = el("div", "msg-actions");
  const copyBtn = el("button", "act-btn", "Copy");
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(ctx.content.innerText).catch(() => {});
    copyBtn.textContent = "Copied ✓";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
  });
  actions.append(copyBtn);
  if (userText) {
    const retryBtn = el("button", "act-btn", "Retry");
    retryBtn.addEventListener("click", () => sendMessage(userText));
    actions.append(retryBtn);
  }
  foot.append(actions);
  ctx.body.append(foot);
}

function recordChipFeedback(s, event) {
  // Suggestion-learning loop: shown/tapped feedback feeds the durable
  // suggestion model server-side. Best-effort — never blocks the UI.
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
  } catch { /* optional */ }
}

function renderSuggestionChips(ctx, items) {
  if (!items?.length) return;
  const wrap = el("div", "chip-row");
  for (const it of items.slice(0, 4)) {
    const s = typeof it === "string" ? { prompt: it } : it;
    const text = s.prompt || s.label || s.text || "";
    if (!text) continue;
    const chip = el("button", "chip", escapeHtml(text.slice(0, 70)));
    chip.addEventListener("click", () => {
      recordChipFeedback(s, "tapped");
      sendMessage(text);
    });
    wrap.append(chip);
    recordChipFeedback(s, "shown");
  }
  if (wrap.children.length) ctx.body.append(wrap);
}

// ——— SSE consumption ————————————————————————————————————————————————

async function consumeSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const chunk of parts) {
      if (!chunk.trim()) continue;
      let event = "message";
      const dataLines = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join("\n")); } catch { continue; }
      if (event === "result" || data?.type === "result") result = data;
      else onEvent(event, data);
    }
  }
  return result;
}

// ——— send ————————————————————————————————————————————————————————————

async function sendMessage(raw) {
  const text = String(raw ?? input.value).trim();
  if (!text || streaming) return;
  input.value = "";
  autoSize();
  streaming = true;
  sendBtn.disabled = true;
  stopBtn.hidden = false;

  addUserRow(text);
  const ctx = addBotRow();
  const liveText = { buf: "", raf: 0 };
  const toolCards = new Map(); // name -> most recent running card
  abortCtl = new AbortController();

  const paintLive = () => {
    liveText.raf = 0;
    ctx.content.innerHTML = renderMarkdown(liveText.buf) + `<span class="caret"></span>`;
    scrollDown();
  };

  try {
    const r = await fetch("/channel/webchat/message/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message: text,
        sessionId,
        mode: $("mode-job")?.checked ? "job" : undefined,
      }),
      signal: abortCtl.signal,
    });
    if (!r.ok) {
      const errBody = await r.text();
      ctx.thinking.remove();
      ctx.content.innerHTML = renderMarkdown(`**Error ${r.status}** — ${errBody.slice(0, 400)}`);
      return;
    }

    const result = await consumeSSE(r, (event, data) => {
      const type = data?.type || event;
      const phase = data?.phase;

      if (type === "model" && phase === "delta" && data.content) {
        ctx.thinking.style.display = "none";
        liveText.buf += data.content;
        if (!liveText.raf) liveText.raf = requestAnimationFrame(paintLive);
        return;
      }
      if (type === "model" && phase === "request") {
        setThinking(ctx, data.turn > 1 ? `Turn ${data.turn}…` : "Thinking…");
        return;
      }
      if (type === "tool" && phase === "start") {
        setThinking(ctx, `Running ${data.name}…`);
        toolCards.set(data.name, addToolCard(ctx, data.name, data.args));
        return;
      }
      if (type === "tool" && phase === "end") {
        endToolCard(toolCards.get(data.name), { preview: data.preview });
        toolCards.delete(data.name);
        return;
      }
      if (type === "security" && phase === "approval_required") {
        setThinking(ctx, "Waiting for your approval…");
        addApprovalCard(ctx, { pendingId: data.pendingId, name: data.name, args: data.args });
        return;
      }
      if (type === "security" && (phase === "approved" || phase === "plan_revalidated")) {
        setThinking(ctx, "Approved — running…");
        return;
      }
      if (type === "security" && /denied|deny/.test(phase || "")) {
        ctx.timeline.append(el("div", "notice warn", `Security: ${escapeHtml(data.message || phase)}`));
        return;
      }
      if (type === "budget" && phase === "exceeded") {
        ctx.timeline.append(
          el("div", "notice warn",
            `Budget cap hit — ${escapeHtml(data.reason || "")} (${data.used}/${data.limit})`)
        );
        return;
      }
      if (type === "guard") {
        ctx.timeline.append(el("div", "notice", `Guard: ${escapeHtml(data.message || data.level || "")}`));
        return;
      }
      if (type === "turn_state" && data.summary) {
        setThinking(ctx, data.summary);
      }
    });

    if (liveText.raf) cancelAnimationFrame(liveText.raf);
    ctx.thinking.remove();

    if (!result || result.ok === false) {
      if (!liveText.buf) ctx.content.innerHTML = renderMarkdown(result?.error || "*No result from stream.*");
      else ctx.content.innerHTML = renderMarkdown(liveText.buf);
      return;
    }
    if (result.sessionId && result.sessionId !== sessionId) {
      sessionId = result.sessionId;
      localStorage.setItem("xclaw_session", sessionId);
      refreshSessions();
    }
    let final = result.reply?.content || result.text || liveText.buf || "";
    // The model sometimes ends a tool turn with no prose (the server stores
    // "(no response)") — surface the last tool result instead of a shrug.
    if (!final || final === "(no response)") {
      const trace = result.reply?.toolTrace || [];
      const lastResult = [...trace].reverse().find((t) => typeof t.result === "string" && t.result.trim());
      final = lastResult
        ? "```\n" + lastResult.result.trim().slice(0, 2000) + "\n```"
        : "*Done.*";
    }
    ctx.content.innerHTML = renderMarkdown(final);
    wireCopyButtons(ctx.content);
    $("head-session").textContent = `Session ${String(sessionId || "").slice(0, 8)}`;
    addFooter(ctx, {
      usage: result.usage || result.reply?.usage,
      model: result.model || result.reply?.model,
      userText: text,
    });
    renderSuggestionChips(ctx, result.suggestions);
    await renderImages(ctx, traceImagePaths(result.reply?.toolTrace));
    scrollDown();
  } catch (e) {
    ctx.thinking?.remove?.();
    if (e.name === "AbortError") {
      ctx.content.innerHTML = renderMarkdown(liveText.buf + "\n\n*— stopped —*");
    } else {
      ctx.content.innerHTML = renderMarkdown(`**Error** — ${e.message}`);
    }
  } finally {
    streaming = false;
    sendBtn.disabled = false;
    stopBtn.hidden = true;
    abortCtl = null;
    input.focus();
  }
}

function wireCopyButtons(scope) {
  scope.querySelectorAll(".copy-code").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.closest(".codeblock")?.querySelector("code")?.innerText || "";
      await navigator.clipboard.writeText(code).catch(() => {});
      btn.textContent = "Copied ✓";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  });
}

// ——— sessions sidebar ———————————————————————————————————————————————

async function refreshSessions() {
  try {
    const r = await fetch("/channel/webchat/sessions");
    if (!r.ok) return;
    const { sessions } = await r.json();
    const list = $("session-list");
    list.innerHTML = "";
    const sorted = [...(sessions || [])].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    for (const s of sorted.slice(0, 30)) {
      const btn = el(
        "button",
        "session-item" + (s.id === sessionId ? " active" : ""),
        `Session ${escapeHtml(s.id.slice(0, 8))}` +
          `<span class="s-meta">${s.messageCount} messages · ${relTime(s.updatedAt)}</span>`
      );
      btn.addEventListener("click", () => switchSession(s.id));
      list.append(btn);
    }
  } catch { /* sidebar is best-effort */ }
}

async function switchSession(id) {
  if (streaming) return;
  sessionId = id;
  localStorage.setItem("xclaw_session", id);
  messagesEl.innerHTML = "";
  hideLanding();
  $("head-session").textContent = `Session ${id.slice(0, 8)}`;
  try {
    const r = await fetch(`/channel/webchat/history?sessionId=${encodeURIComponent(id)}`);
    if (r.ok) {
      const hist = await r.json();
      for (const m of hist.messages || []) {
        if (m.role === "user") addUserRow(m.content);
        else if (m.role === "assistant") {
          const ctx = addBotRow();
          ctx.thinking.remove();
          const text = !m.content || m.content === "(no response)" ? "*Done.*" : m.content;
          ctx.content.innerHTML = renderMarkdown(text);
          wireCopyButtons(ctx.content);
        }
      }
    }
  } catch { /* */ }
  refreshSessions();
  scrollDown(true);
}

function newChat() {
  if (streaming) return;
  sessionId = null;
  localStorage.removeItem("xclaw_session");
  messagesEl.innerHTML = "";
  if (landingEl) landingEl.style.display = "";
  $("head-session").textContent = "New conversation";
  refreshSessions();
  input.focus();
}

// ——— status chips ———————————————————————————————————————————————————

async function refreshStatus() {
  try {
    const r = await fetch("/gateway/info");
    if (!r.ok) throw new Error(String(r.status));
    const info = await r.json();
    $("st-gw").className = "st-dot up";
    $("st-comp").className = "st-dot " + (info.computer?.healthy ? "up" : "down");
    $("st-model").textContent = info.agent?.model || "—";
    $("st-model").title = info.agent?.model || "";
    $("brand-sub").textContent = `v${info.version || "?"}`;
    $("head-meta").textContent = info.agent?.model || "";
  } catch {
    $("st-gw").className = "st-dot down";
    $("st-comp").className = "st-dot down";
  }
}

// ——— composer wiring ————————————————————————————————————————————————

function autoSize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 220) + "px";
}
input.addEventListener("input", autoSize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", () => sendMessage());
stopBtn.addEventListener("click", () => abortCtl?.abort());
$("btn-new").addEventListener("click", newChat);
$("btn-collapse")?.addEventListener("click", () => $("sidebar").classList.toggle("collapsed"));
$("btn-sidebar")?.addEventListener("click", () => $("sidebar").classList.toggle("open"));
document.querySelectorAll("#landing-chips .chip").forEach((c) =>
  c.addEventListener("click", () => sendMessage(c.dataset.q))
);

// ——— boot ————————————————————————————————————————————————————————————

refreshStatus();
setInterval(refreshStatus, 20_000);
refreshSessions();
if (sessionId) switchSession(sessionId);
input.focus();

// First-run auth overlay — same onboarding as the Control UI: any
// same-origin 401 (strict gateways token-gate /channel/) raises a
// token-entry card instead of a dead chat. Tokenless labs never see it.
let _xaShown = false;
function showAuthOverlay() {
  if (_xaShown || document.getElementById("xclaw-auth-overlay")) return;
  _xaShown = true;
  const ov = document.createElement("div");
  ov.id = "xclaw-auth-overlay";
  ov.innerHTML = `
    <div class="xa-card">
      <div class="xa-mark">🦞</div>
      <h2>Operator token required</h2>
      <p class="xa-sub">This gateway is token-protected. The token lives in
        <code>~/.xclaw/xclaw.json</code> → <code>gateway.token</code> on the host.</p>
      <input type="password" id="xa-token" placeholder="xclaw_…" autocomplete="off" spellcheck="false" />
      <button id="xa-save" class="xa-btn">Connect</button>
      <div id="xa-err"></div>
    </div>`;
  document.body.append(ov);
  const input = ov.querySelector("#xa-token");
  const err = ov.querySelector("#xa-err");
  const submit = async () => {
    const t = input.value.trim();
    if (!t) return;
    localStorage.setItem("xclaw_token", t);
    err.textContent = "checking…";
    try {
      const r = await fetch("/channel/webchat/sessions");
      if (r.ok) { location.reload(); return; }
      err.textContent = "Token rejected — check it and try again.";
    } catch (e) {
      err.textContent = String(e.message || e);
    }
  };
  ov.querySelector("#xa-save").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  input.focus();
}
{
  const _wrapped = window.fetch;
  window.fetch = (url, opts) =>
    _wrapped(url, opts).then((resp) => {
      try {
        const raw = typeof url === "string" ? url : url?.url != null ? url.url : String(url);
        if (resp.status === 401 && new URL(raw, location.href).origin === location.origin) {
          showAuthOverlay();
        }
      } catch { /* */ }
      return resp;
    });
}

// —— Local / browser voice (TTS via gateway, STT via Web Speech API) ——
// Grafted from the 3.80.0 voice stack; adapted to this app's helpers.
{
  const voiceStatus = $("voice-status");
  const btnMic = $("btn-mic");
  const btnSpeak = $("btn-speak");
  let lastAssistantText = "";

  function setVoiceStatus(s) {
    if (voiceStatus) voiceStatus.textContent = s || "";
  }

  // Probe local stack once — server STT decides whether the mic records here
  // and transcribes on the gateway, or falls back to browser speech.
  let serverSttReady = false;
  fetch("/api/voice/probe")
    .then((r) => r.json())
    .then((v) => {
      serverSttReady = Boolean(v.stt?.ok);
      const parts = [];
      if (v.tts?.ok) parts.push("TTS " + (v.tts.provider || "ok"));
      else parts.push("TTS off");
      if (serverSttReady) parts.push("STT local");
      setVoiceStatus(parts.join(" · "));
    })
    .catch(() => setVoiceStatus(""));

  // Track the latest assistant reply text for 🔊
  const obs = new MutationObserver(() => {
    const contents = messagesEl.querySelectorAll(".row.bot .content");
    if (contents.length) {
      const t = contents[contents.length - 1].textContent || "";
      if (t.trim()) lastAssistantText = t.trim();
    }
  });
  obs.observe(messagesEl, { childList: true, subtree: true, characterData: true });

  if (btnSpeak) {
    btnSpeak.addEventListener("click", async () => {
      const text = lastAssistantText || input.value.trim();
      if (!text) {
        setVoiceStatus("nothing to speak");
        return;
      }
      setVoiceStatus("speaking…");
      try {
        const r = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 500) }),
        });
        const j = await r.json();
        if (!j.ok) {
          setVoiceStatus("TTS: " + (j.error || j.reason || "failed"));
          return;
        }
        setVoiceStatus("TTS " + (j.provider || "ok"));
      } catch (e) {
        setVoiceStatus("TTS error: " + e.message);
      }
    });
  }

  if (btnMic) {
    let recorder = null;
    let recChunks = [];

    // Server-side STT: record here, transcribe with the gateway's local whisper.
    // Works in any browser with a mic and keeps the audio on your own box,
    // unlike the browser SpeechRecognition fallback below (which is
    // Chrome/Edge-only and ships audio to a cloud speech service).
    async function startServerRecording() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) recChunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        btnMic.classList.remove("recording");
        const blob = new Blob(recChunks, { type: recorder.mimeType || "audio/webm" });
        recorder = null;
        if (!blob.size) {
          setVoiceStatus("no audio captured");
          btnMic.disabled = false;
          return;
        }
        setVoiceStatus("transcribing…");
        try {
          const buf = await blob.arrayBuffer();
          let bin = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          }
          const r = await fetch("/api/voice/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: btoa(bin), mime: blob.type }),
          });
          const j = await r.json();
          if (j.ok && j.text) {
            input.value = (input.value ? input.value + " " : "") + j.text.trim();
            setVoiceStatus("heard: " + j.text.trim().slice(0, 60));
          } else {
            setVoiceStatus("STT: " + (j.error || "no transcript"));
          }
        } catch (e) {
          setVoiceStatus("STT error: " + e.message);
        }
        btnMic.disabled = false;
      };
      recorder.start();
      btnMic.classList.add("recording");
      setVoiceStatus("recording… click to stop");
    }

    btnMic.addEventListener("click", async () => {
      if (recorder && recorder.state === "recording") {
        recorder.stop();
        btnMic.disabled = true;
        return;
      }
      if (serverSttReady && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
        try {
          await startServerRecording();
          return;
        } catch (e) {
          setVoiceStatus("mic: " + (e.message || "denied") + " — trying browser STT");
        }
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        setVoiceStatus("No mic access and no browser STT — use Telegram voice notes");
        return;
      }
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      setVoiceStatus("listening…");
      btnMic.disabled = true;
      rec.onresult = (ev) => {
        const text = ev.results[0][0].transcript;
        input.value = (input.value ? input.value + " " : "") + text;
        setVoiceStatus("heard: " + text);
        btnMic.disabled = false;
      };
      rec.onerror = (ev) => {
        setVoiceStatus("mic: " + (ev.error || "error"));
        btnMic.disabled = false;
      };
      rec.onend = () => {
        btnMic.disabled = false;
      };
      rec.start();
    });
  }
}
