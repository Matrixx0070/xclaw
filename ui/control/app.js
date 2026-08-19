const $ = (id) => document.getElementById(id);

// Every same-origin gateway call carries the operator token (if set).
// Call sites used to attach it ad-hoc — exactly 1 of ~35 did — so
// operator-gated panels (swarm merges, providers, channels) showed
// "unauthorized" in an otherwise-authorized session. Central wrapper so
// future call sites are covered automatically. (WS uses the subprotocol
// carrier; that path already handled the token.)
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

function kvHtml(rows) {
  return rows
    .map(([k, v, cls]) => {
      const c = cls ? ` v ${cls}` : " v";
      return `<div><span class="k">${k}</span><span class="${c}">${v}</span></div>`;
    })
    .join("");
}

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!r.ok) throw new Error(body.error || r.statusText || String(r.status));
  return body;
}

async function loadStatus() {
  // /gateway/info is the sanitized status endpoint (the old /status route
  // was dropped in a refactor and this card sat on "not found" ever since).
  const s = await getJSON("/gateway/info");
  const computer = s.computer || {};
  const running = Boolean(computer.healthy);
  const gw = s.gateway || {};
  $("statusKv").innerHTML = kvHtml([
    ["Host", `${gw.host || "—"}:${gw.port || "—"}`],
    ["Provider", s.agent?.provider || "—"],
    ["Model", s.agent?.model || "—"],
    ["Auth", gw.tokenSet ? (gw.authStrict ? "token · strict" : "token") : "open", gw.tokenSet ? "good" : "warn"],
    ["Computer", running ? "running" : "stopped", running ? "good" : "warn"],
    ["Version", s.version || s.name || "XClaw"],
  ]);
  $("computerKv").innerHTML = kvHtml([
    ["Running", running ? "yes" : "no", running ? "good" : "warn"],
    ["Host", computer.host ?? "—"],
    ["Port", computer.port ?? "—"],
  ]);
  const ch = s.channels || {};
  const messaging = Array.isArray(ch.messaging) ? ch.messaging : [];
  const chanState = (name) => messaging.find((m) => m.name === name);
  const chanRows = [
    ["WebChat", ch.webchat?.enabled !== false ? "on" : "off", "good"],
    ...["telegram", "discord", "slack", "email"].map((n) => {
      const st = chanState(n);
      const on = Boolean(st?.enabled);
      const label = n[0].toUpperCase() + n.slice(1);
      return [label, on ? "on" : "off", on ? "good" : ""];
    }),
  ];
  $("channelsKv").innerHTML = kvHtml(chanRows);
  $("footMeta").textContent = new Date().toLocaleString();
  return s;
}

async function loadConfigEviction() {
  try {
    // Sanitized summary from /gateway/info (the old raw /config route is
    // gone — and a full config dump would leak secrets anyway).
    const info = await getJSON("/gateway/info");
    const e = info.eviction || {};
    $("evictionKv").innerHTML = kvHtml([
      ["Policy", e.policy || "hybrid"],
      ["Max messages", fmtNum(e.maxMessages)],
      ["Max chars", fmtNum(e.maxChars)],
      ["Tool max", fmtNum(e.toolMaxChars)],
      ["LRU mode", e.lruMode || "size_weighted"],
      ["LRU dynamic", e.lruDynamic ? "on" : "off", e.lruDynamic ? "good" : ""],
    ]);
  } catch {
    $("evictionKv").innerHTML = kvHtml([["Config", "unavailable", "warn"]]);
  }
}

async function loadCostGovernor() {
  try {
    const g = await getJSON("/cost");
    let dash = null;
    try {
      dash = await getJSON("/usage/dashboard?days=7");
    } catch {
      /* optional */
    }
    const soft = g.limits?.dailySoftUsd;
    const hard = g.limits?.dailyHardUsd;
    const spent = g.spentUsd ?? 0;
    const softPct = soft ? Math.min(100, Math.round((spent / soft) * 100)) : 0;
    const mode = dash?.governor?.mode || (g.hard || g.paused ? "halt" : g.soft ? "economy" : "normal");
    const billed = dash?.governor?.spentBilledUsd;
    const estimated = dash?.governor?.spentEstimatedUsd;
    const week = dash?.usage?.totals;
    const el = $("costGov");
    if (el) {
      const rows = [
        ["Band", mode, mode === "halt" ? "bad" : mode === "economy" ? "warn" : "ok"],
        ["Spent today", `$${Number(spent).toFixed(4)}`, g.hard ? "bad" : g.soft ? "warn" : "ok"],
        ["Soft / Hard", `$${soft} / $${hard}`],
        ["Paused", g.paused ? "yes" : "no", g.paused ? "bad" : "ok"],
        ["Jobs", g.jobs ?? "—"],
        ["Soft pressure", softPct + "%"],
      ];
      if (billed != null || estimated != null) {
        rows.push(["Billed / estimated", `$${Number(billed || 0).toFixed(4)} / $${Number(estimated || 0).toFixed(4)}`]);
      }
      if (week) {
        rows.push(["7d runs", String(week.runs ?? "—")]);
        rows.push(["7d tokens", Number(week.totalTokens || week.promptTokens || 0).toLocaleString()]);
        rows.push(["7d USD", `$${Number(week.costUsd || 0).toFixed(4)}`]);
      }
      el.innerHTML = kvHtml(rows);
      const bar = $("costBar");
      if (bar) bar.style.width = Math.min(100, softPct) + "%";
    }
  } catch (e) {
    const el = $("costGov");
    if (el) el.textContent = e.message || String(e);
  }
}

async function loadCost() {
  try {
    await loadCostGovernor();
    const data = await getJSON("/tokens/cost?limit=30");
    // The ledger API's real field names are promptTokens/completionTokens/
    // cachedTokens per row and runs/promptTokens/completionTokens/costUsd/path
    // at the top level — this loader used to read inputTokens/prompt_tokens
    // etc., so the In/Out columns and the whole summary rendered as "—"
    // while the data sat right there in the payload.
    const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());
    $("costSummary").innerHTML = kvHtml([
      ["Runs", fmt(data.runs)],
      ["Tokens in (prompt)", fmt(data.promptTokens)],
      ["Tokens out (completion)", fmt(data.completionTokens)],
      ["Total USD", data.costUsdFormatted || (data.costUsd != null ? `$${Number(data.costUsd).toFixed(4)}` : "—")],
      ["Ledger", (data.path || "—").split("/").pop()],
    ]);
    const tbody = $("costTable").querySelector("tbody");
    const rows = data.rows || data.entries || [];
    tbody.innerHTML = rows
      .slice()
      .reverse()
      .slice(0, 25)
      .map((e) => {
        const when = e.at || e.ts || e.time || "";
        const d = fmtWhen(when);
        const est = e.hasRealUsage === false ? ' <span class="muted" title="estimated (no provider usage in response)">~</span>' : "";
        return `<tr>
          <td>${d}</td>
          <td>${e.model || "—"}</td>
          <td>${fmt(e.promptTokens ?? e.inputTokens)}${est}</td>
          <td>${fmt(e.completionTokens ?? e.outputTokens)}</td>
          <td>${fmt(e.cachedTokens)}</td>
          <td>${e.costUsdFormatted || (e.costUsd != null ? "$" + Number(e.costUsd).toFixed(6) : "—")}</td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    $("costSummary").innerHTML = kvHtml([["Error", err.message, "bad"]]);
  }
}

async function loadSessions() {
  try {
    const data = await getJSON("/channel/webchat/sessions");
    const list = data.sessions || data || [];
    const tbody = $("sessionsTable").querySelector("tbody");
    tbody.innerHTML = (Array.isArray(list) ? list : [])
      .map((s) => {
        const id = s.id || s.sessionId || "—";
        const title = s.title || s.name || "session";
        const updated = s.updatedAt || s.updated || "";
        return `<tr>
          <td><code>${id}</code></td>
          <td>${title}</td>
          <td title="${updated ? esc(new Date(updated).toLocaleString()) : ""}">${fmtWhen(updated)}</td>
          <td><a class="btn ghost" href="/chat/?sessionId=${encodeURIComponent(id)}">Open</a></td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    $("sessionsTable").querySelector("tbody").innerHTML =
      `<tr><td colspan="4" class="muted">${err.message}</td></tr>`;
  }
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadConfigEviction(), loadCost(), loadSessions(), loadPairing(), loadCronLogs()]);
}

$("btnRefresh").onclick = () => refreshAll().catch(console.error);

$("btnStartComputer").onclick = async () => {
  try {
    await getJSON("/computer/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await loadStatus();
  } catch (e) {
    alert(e.message);
  }
};
$("btnStopComputer").onclick = async () => {
  try {
    await getJSON("/computer/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await loadStatus();
  } catch (e) {
    alert(e.message);
  }
};

$("btnRun").onclick = async () => {
  const message = $("agentMsg").value.trim();
  if (!message) return;
  $("agentStatus").textContent = "Running…";
  $("agentOut").textContent = "";
  try {
    const res = await fetch("/agent/run/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        try {
          const ev = JSON.parse(data);
          if (ev.type === "cache" && ev.phase === "eviction") {
            $("agentOut").textContent +=
              "[eviction] " +
              JSON.stringify({
                policy: ev.policy,
                truncated: ev.truncated,
                dropped: ev.dropped,
                totalChars: ev.totalChars,
                wSize: ev.weights?.wSize,
                pressure: ev.weights?.pressure,
              }) +
              "\n";
          } else {
            $("agentOut").textContent += JSON.stringify(ev) + "\n";
          }
          $("agentOut").scrollTop = $("agentOut").scrollHeight;
          if (ev.type === "result" || ev.finalText) {
            $("agentStatus").textContent = "Done";
          }
        } catch {
          $("agentOut").textContent += data + "\n";
        }
      }
    }
    $("agentStatus").textContent = $("agentStatus").textContent || "Done";
    await loadCost();
    await loadEvictionHistory();
  } catch (e) {
    $("agentStatus").textContent = "Error";
    $("agentOut").textContent = e.message;
  }
};

refreshAll().catch((e) => {
  $("statusKv").textContent = e.message;
});


const evictSeries = []; // { pressure, wSize }
const MAX_SERIES = 40;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function updateEvictionViz(e) {
  const w = e.weights || {};
  const pressure = Number(w.pressure);
  const wSize = Number(w.wSize);
  const trunc = Number(e.truncated) || 0;
  const stub = Number(e.stubbed) || 0;
  const drop = Number(e.dropped) || 0;

  if (Number.isFinite(pressure)) {
    // map 0..1.5+ → 0..100% gauge
    const pct = clamp01(pressure / 1.5) * 100;
    const fill = $("vizPressureFill");
    fill.style.width = pct + "%";
    fill.className = "gauge-fill" + (pressure > 1.05 ? " danger" : pressure > 0.95 ? " warn" : "");
    $("vizPressureVal").textContent = pressure.toFixed(3) + (pressure > 1.05 ? "  over" : pressure > 0.95 ? "  near" : "");
  }

  if (Number.isFinite(wSize)) {
    // map 0.25..0.9 → gauge
    const pct = clamp01((wSize - 0.25) / (0.9 - 0.25)) * 100;
    $("vizWSizeFill").style.width = pct + "%";
    $("vizWSizeVal").textContent = wSize.toFixed(3);
  }

  const maxA = Math.max(1, trunc, stub, drop, 8);
  $("barTrunc").style.width = (100 * trunc) / maxA + "%";
  $("barStub").style.width = (100 * stub) / maxA + "%";
  $("barDrop").style.width = (100 * drop) / maxA + "%";
  $("barTruncN").textContent = trunc;
  $("barStubN").textContent = stub;
  $("barDropN").textContent = drop;

  const track = w.track || "—";
  const pillTrack = $("pillTrack");
  pillTrack.textContent = "track " + track;
  pillTrack.className = "pill" + (track.includes("fast") ? " on" : "");

  const pillStress = $("pillStress");
  if (w.stressed) {
    pillStress.textContent = "stressed";
    pillStress.className = "pill danger";
  } else if (Number.isFinite(pressure) && pressure > 0.95) {
    pillStress.textContent = "near";
    pillStress.className = "pill warn";
  } else {
    pillStress.textContent = "calm";
    pillStress.className = "pill on";
  }

  $("pillPolicy").textContent = "policy " + (e.policy || "—");
  $("vizMeta").textContent =
    (e.source || "event") +
    " · chars " +
    (e.totalChars ?? "—") +
    " · actions " +
    (e.actions ?? "—") +
    (e.at ? " · " + new Date(e.at).toLocaleTimeString() : "");

  if (Number.isFinite(pressure) || Number.isFinite(wSize)) {
    evictSeries.push({
      pressure: Number.isFinite(pressure) ? pressure : evictSeries.at(-1)?.pressure ?? 0,
      wSize: Number.isFinite(wSize) ? wSize : evictSeries.at(-1)?.wSize ?? 0.5,
    });
    while (evictSeries.length > MAX_SERIES) evictSeries.shift();
    renderSpark();
  }
}

function renderSpark() {
  const W = 400;
  const H = 80;
  const n = evictSeries.length;
  if (n < 2) return;

  const ptsP = [];
  const ptsW = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    // pressure 0..1.5 → y
    const p = evictSeries[i].pressure;
    const yP = H - clamp01(p / 1.5) * (H - 4) - 2;
    // wSize 0.25..0.9 → y
    const ws = evictSeries[i].wSize;
    const yW = H - clamp01((ws - 0.25) / 0.65) * (H - 4) - 2;
    ptsP.push(`${x.toFixed(1)},${yP.toFixed(1)}`);
    ptsW.push(`${x.toFixed(1)},${yW.toFixed(1)}`);
  }
  $("sparkPressure").setAttribute("points", ptsP.join(" "));
  $("sparkWSize").setAttribute("points", ptsW.join(" "));
}

function formatEvictRow(e) {
  const w = e.weights || {};
  const when = e.at ? new Date(e.at).toLocaleTimeString() : "—";
  return `<tr class="row-flash">
    <td>${when}</td>
    <td>${e.source || "—"}</td>
    <td>${e.policy || "—"}</td>
    <td>${e.truncated ?? "—"}</td>
    <td>${e.dropped ?? "—"}</td>
    <td>${e.totalChars ?? "—"}</td>
    <td>${w.wSize != null ? Number(w.wSize).toFixed(3) : "—"}</td>
    <td>${w.pressure != null ? Number(w.pressure).toFixed(2) : "—"}</td>
    <td>${w.track || (w.stressed ? "stressed" : "—")}</td>
  </tr>`;
}

function prependEvict(e) {
  updateEvictionViz(e);
  const tbody = $("evictTable")?.querySelector("tbody");
  if (!tbody) return;
  tbody.insertAdjacentHTML("afterbegin", formatEvictRow(e));
  while (tbody.rows.length > 40) tbody.deleteRow(-1);
}

async function loadEvictionHistory() {
  try {
    const data = await getJSON("/events/eviction?limit=30");
    const tbody = $("evictTable")?.querySelector("tbody");
    if (!tbody) return;
    const events = data.events || [];
    // oldest → newest into series, newest first in table
    for (const e of events) {
      const w = e.weights || {};
      if (w.pressure != null || w.wSize != null) {
        evictSeries.push({
          pressure: Number(w.pressure) || 0,
          wSize: Number(w.wSize) || 0.5,
        });
      }
    }
    while (evictSeries.length > MAX_SERIES) evictSeries.shift();
    renderSpark();
    if (events.length) updateEvictionViz(events[events.length - 1]);
    tbody.innerHTML = events.slice().reverse().map(formatEvictRow).join("");
  } catch (err) {
    const el = $("evictLiveStatus");
    if (el) el.textContent = err.message;
  }
}

/** SSE reconnect with exponential backoff + lastEventId resume */
let _evictAttempt = 0;
let _evictLastId = "";
let _evictTimer = null;

function _evictBackoffMs(attempt) {
  const base = 1000;
  const max = 30000;
  const exp = Math.min(max, base * Math.pow(2, attempt));
  return Math.floor(Math.random() * exp);
}

// fetch-based SSE reader instead of EventSource: /events/* is token-protected
// and EventSource can't set headers — a ?token= carrier would put the operator
// token in URLs (access logs, proxies; flagged by security review). fetch
// sends it as a header via the global wrapper, like every other call. Same
// frame parsing as the agent/swarm stream readers.
let _evictAbortCtl = null;
async function connectEvictionStream() {
  const status = $("evictLiveStatus");
  if (!status) return;
  if (_evictTimer) {
    clearTimeout(_evictTimer);
    _evictTimer = null;
  }
  try { _evictAbortCtl?.abort(); } catch {}
  const ac = new AbortController();
  _evictAbortCtl = ac;
  status.textContent = _evictAttempt === 0 ? "connecting…" : ("reconnecting · try " + _evictAttempt);
  try {
    const url =
      "/events/eviction/stream" +
      (_evictLastId ? "?lastEventId=" + encodeURIComponent(_evictLastId) : "");
    const r = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });
    if (!r.ok || !r.body) throw new Error("stream " + r.status);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const chunk of parts) {
        if (!chunk.trim()) continue;
        let event = "message";
        let id = null;
        const dataLines = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          else if (line.startsWith("id:")) id = line.slice(3).trim();
        }
        const data = dataLines.join("\n");
        if (id) _evictLastId = id;
        if (event === "ready") {
          _evictAttempt = 0;
          try {
            const j = JSON.parse(data);
            status.textContent = j.resumedFrom
              ? ("live · resumed " + (j.replayed || 0))
              : "live";
          } catch {
            status.textContent = "live";
          }
        } else if (event === "eviction") {
          try {
            prependEvict(JSON.parse(data));
            status.textContent = "live · " + new Date().toLocaleTimeString();
          } catch {}
        }
      }
    }
    throw new Error("stream ended");
  } catch (err) {
    if (ac.signal.aborted) return; // superseded by a newer connection
    status.textContent = "reconnecting…";
    const delay = _evictBackoffMs(_evictAttempt);
    _evictAttempt += 1;
    _evictTimer = setTimeout(connectEvictionStream, delay);
  }
}

loadEvictionHistory().then(connectEvictionStream);


async function loadPairing() {
  const ch = $("pairChannel")?.value || "telegram";
  try {
    const data = await getJSON("/pairing/pending?channel=" + encodeURIComponent(ch));
    const tbody = $("pairTable")?.querySelector("tbody");
    if (!tbody) return;
    const rows = [];
    for (const p of data.pending || []) {
      rows.push(`<tr>
        <td>pending</td>
        <td><code>${p.id}</code></td>
        <td><code>${p.code}</code></td>
        <td title="${p.createdAt ? esc(new Date(p.createdAt).toLocaleString()) : ""}">${fmtWhen(p.createdAt)}</td>
        <td><button class="btn ghost pair-apr" data-code="${p.code}">Approve</button></td>
      </tr>`);
    }
    for (const a of data.approved || []) {
      rows.push(`<tr>
        <td class="good">approved</td>
        <td><code>${a.id}</code></td>
        <td>—</td>
        <td>${a.approvedAt ? new Date(a.approvedAt).toLocaleString() : "—"}</td>
        <td><button class="btn ghost pair-rev" data-id="${a.id}">Revoke</button></td>
      </tr>`);
    }
    tbody.innerHTML = rows.join("") || `<tr><td colspan="5" class="muted">No entries</td></tr>`;
    tbody.querySelectorAll(".pair-apr").forEach((btn) => {
      btn.onclick = async () => {
        await getJSON("/pairing/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: ch, code: btn.dataset.code }),
        });
        await loadPairing();
      };
    });
    tbody.querySelectorAll(".pair-rev").forEach((btn) => {
      btn.onclick = async () => {
        await getJSON("/pairing/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: ch, senderId: btn.dataset.id }),
        });
        await loadPairing();
      };
    });
  } catch (err) {
    const tbody = $("pairTable")?.querySelector("tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">${err.message}</td></tr>`;
  }
}

$("btnPairRefresh") && ($("btnPairRefresh").onclick = () => loadPairing());
$("pairChannel") && ($("pairChannel").onchange = () => loadPairing());
$("btnPairApprove") && ($("btnPairApprove").onclick = async () => {
  const ch = $("pairChannel").value;
  const code = $("pairCode").value.trim();
  if (!code) return;
  await getJSON("/pairing/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: ch, code }),
  });
  $("pairCode").value = "";
  await loadPairing();
});

loadPairing().catch(() => {});


async function loadDoctor() {
  try {
    const d = await getJSON("/doctor");
    const el = $("doctorOut");
    if (el) {
      el.textContent = JSON.stringify(d, null, 2);
      el.className = d.ok ? "good" : "bad";
    }
  } catch (err) {
    const el = $("doctorOut");
    if (el) {
      el.textContent = err.message;
      el.className = "bad";
    }
  }
}
$("btnDoctor") && ($("btnDoctor").onclick = () => loadDoctor());


async function loadCronLogs() {
  try {
    const data = await getJSON("/cron/logs?lines=50");
    const meta = $("cronLogMeta");
    const out = $("cronLogOut");
    const last = data.doctorLog?.lastRun;
    if (meta) {
      meta.textContent = last
        ? `last doctor: ${last.at} ok=${last.ok}`
        : (data.doctorLog?.exists ? "doctor log present" : "no doctor log yet");
    }
    if (out) {
      const tail = (data.doctorLog?.tail || []).join("\n");
      const events = (data.cronEvents?.tail || []).slice(-10).join("\n");
      out.textContent = `=== doctor ===\n${tail || "(empty)"}\n\n=== events ===\n${events || "(empty)"}`;
    }
  } catch (err) {
    const out = $("cronLogOut");
    if (out) out.textContent = err.message;
  }
}
$("btnCronLogs") && ($("btnCronLogs").onclick = () => loadCronLogs());
loadCronLogs().catch(() => {});


/* —— Jobs (H1) —— */
async function runJobFromUi() {
  const goal = $("jobGoal").value.trim();
  if (!goal) {
    $("jobMeta").textContent = "Enter a goal";
    return;
  }
  $("jobMeta").textContent = "Running…";
  $("jobOut").textContent = "";
  $("btnJobRun").disabled = true;
  try {
    const r = await fetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal,
        verify: [],
        autoApprove: true,
      }),
    });
    const body = await r.json();
    $("jobMeta").textContent = `${body.status || r.status} · turns=${body.turns ?? "—"} · ${body.wallMs ?? "—"}ms`;
    $("jobOut").textContent = JSON.stringify(
      {
        id: body.id,
        status: body.status,
        pass: body.pass,
        text: body.text,
        verify: body.verify,
        evidence: body.evidence,
        error: body.error,
      },
      null,
      2
    );
  } catch (err) {
    $("jobMeta").textContent = "error";
    $("jobOut").textContent = String(err.message || err);
  } finally {
    $("btnJobRun").disabled = false;
  }
}

$("btnJobRun")?.addEventListener("click", runJobFromUi);


async function loadJobHistory() {
  try {
    const data = await getJSON("/jobs?limit=20");
    const tbody = $("jobHistory")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!(data.jobs || []).length) showEmptyRow(tbody, "No jobs yet");
    for (const j of data.jobs || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${(j.at || "").replace("T", " ").slice(0, 19)}</td>
        <td class="${j.pass ? "good" : "warn"}">${j.status || "—"}</td>
        <td>${j.turns ?? "—"}</td>
        <td title="${(j.goal || "").replace(/"/g, "&quot;")}">${(j.goal || "").slice(0, 60)}</td>`;
      tr.style.cursor = "pointer";
      tr.onclick = async () => {
        try {
          const full = await getJSON("/jobs/" + encodeURIComponent(j.id));
          $("jobOut").textContent = JSON.stringify(full, null, 2);
          $("jobMeta").textContent = j.id;
        } catch (e) {
          $("jobOut").textContent = String(e.message || e);
        }
      };
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.warn("job history", e);
  }
}

$("btnJobHistory")?.addEventListener("click", loadJobHistory);
loadJobHistory();


async function loadSkillsStats() {
  try {
    const data = await getJSON("/skills/stats");
    const skills = data.skills || {};
    const rows = Object.values(skills).slice(0, 12);
    $("skillsKv").innerHTML = kvHtml([
      ["Tracked", String(rows.length)],
      ["Proposals", "GET /skills/proposals"],
    ]);
    $("skillsOut").textContent = rows.length
      ? rows.map((s) => `${s.name} v${s.version} · rate=${((s.successRate || 0) * 100).toFixed(0)}% · runs=${s.runs}`).join("\n")
      : "No skill outcomes recorded yet.";
  } catch (e) {
    $("skillsOut").textContent = String(e.message || e);
  }
}
$("btnSkillsStats")?.addEventListener("click", loadSkillsStats);
loadSkillsStats();


async function loadEvalBaseline() {
  try {
    // served from static? use jobs as proxy — try fetch from known path via gateway file not available
    // Use last eval summary from /jobs pass rate as soft signal; baseline via optional endpoint
    const r = await fetch("/eval/baseline");
    if (!r.ok) throw new Error("no baseline endpoint or file");
    const j = await r.json();
    $("evalBaseOut").textContent = JSON.stringify({
      passRate: j.passRate,
      total: j.total,
      passed: j.passed,
      meanTurns: j.meanTurns,
      tokens: j.tokens,
      model: j.model,
      at: j.at,
    }, null, 2);
  } catch (e) {
    $("evalBaseOut").textContent = String(e.message || e);
  }
}
$("btnEvalBase")?.addEventListener("click", loadEvalBaseline);
loadEvalBaseline();


function waitMsLabel(q) {
  const start = Date.parse(q.enqueuedAt || q.createdAt || "") || 0;
  if (!start) return "—";
  if (q.startedAt || q.finishedAt) {
    const end = Date.parse(q.startedAt || q.finishedAt) || Date.now();
    return Math.max(0, end - start) + "ms";
  }
  return Math.max(0, Date.now() - start) + "ms";
}

async function loadQueue() {
  try {
    const data = await getJSON("/queue?limit=40");
    const tbody = $("queueTable")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!(data.queue || []).length) showEmptyRow(tbody, "Queue is empty");
    for (const q of data.queue || []) {
      const tr = document.createElement("tr");
      const st = q.status || "—";
      const cls =
        st === "succeeded" ? "good" :
        st === "failed" || st === "abandoned" ? "warn" : "";
      tr.innerHTML = `<td class="${cls}"><span class="pill">${st}</span></td>
        <td>${q.priority ?? 0}</td>
        <td title="${(q.goal || "").replace(/"/g, "&quot;")}">${(q.goal || "").slice(0, 60)}</td>
        <td style="font-size:0.7rem">${waitMsLabel(q)}</td>
        <td style="font-size:0.7rem">${(q.createdAt || "").replace("T", " ").slice(0, 19)}</td>`;
      tr.style.cursor = "pointer";
      tr.onclick = async () => {
        try {
          const full = await getJSON("/queue/" + encodeURIComponent(q.id));
          $("queueOut").textContent = JSON.stringify(full, null, 2);
        } catch (e) {
          $("queueOut").textContent = String(e.message || e);
        }
      };
      tbody.appendChild(tr);
    }
    // worker line in queueOut header if empty-ish
    if (data.worker || data.stats) {
      const w = data.worker || data.stats?.worker || {};
      const s = data.stats || {};
      const line = `worker c=${w.concurrency ?? "?"} run=${w.running ?? 0} paused=${!!w.paused} depth=${w.maxDepth ?? "?"} wait=${w.maxWaitMs ?? "?"}ms | queued=${s.queued ?? "?"} abandoned=${s.abandoned ?? 0}`;
      if ($("queueOut") && (!$("queueOut").textContent || $("queueOut").textContent === "—")) {
        $("queueOut").textContent = line;
      }
    }
    await loadAdmission().catch(() => {});
  } catch (e) {
    if ($("queueOut")) $("queueOut").textContent = String(e.message || e);
  }
}

async function loadAdmission() {
  const kv = $("admissionKv");
  const status = $("admLiveStatus");
  try {
    const data = await getJSON("/queue/admission");
    const m = data.metrics || {};
    const pol = data.policy || {};
    if (kv) {
      kv.innerHTML = kvHtml([
        ["c (servers)", String(pol.concurrency ?? "—"), ""],
        ["maxDepth K", String(pol.maxDepth ?? "—"), ""],
        ["maxWait T", (pol.maxWaitMs != null ? pol.maxWaitMs + "ms" : "—"), ""],
        ["admitted", String(m.admitted ?? 0), "good"],
        ["rejected full", String(m.rejectedFull ?? 0), m.rejectedFull ? "warn" : ""],
        ["abandoned wait", String(m.abandonedWait ?? 0), m.abandonedWait ? "warn" : ""],
        ["completed", String(m.completed ?? 0), "good"],
        ["failed", String(m.failed ?? 0), m.failed ? "warn" : ""],
      ]);
    }
    if (status) status.textContent = "live · " + new Date().toLocaleTimeString();
    return data;
  } catch (e) {
    if (status) status.textContent = "err";
    if (kv) kv.innerHTML = kvHtml([["admission", String(e.message || e), "warn"]]);
    return null;
  }
}

async function enqueueFromUi() {
  const goal = $("queueGoal")?.value?.trim();
  if (!goal) return;
  $("btnQueueAdd").disabled = true;
  try {
    const r = await fetch("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });
    const body = await r.json().catch(() => ({ error: r.statusText }));
    $("queueOut").textContent = JSON.stringify(body, null, 2);
    if (!r.ok) {
      // QUEUE_FULL / QUEUE_PAUSED surface in UI
      if ($("admLiveStatus")) $("admLiveStatus").textContent = body.code || body.error || "reject";
    } else {
      $("queueGoal").value = "";
    }
    await loadQueue();
    await loadAdmission().catch(() => {});
  } catch (e) {
    $("queueOut").textContent = String(e.message || e);
  } finally {
    $("btnQueueAdd").disabled = false;
  }
}

$("btnQueueRefresh")?.addEventListener("click", () => {
  loadQueue().catch(console.error);
  loadAdmission().catch(console.error);
});
$("btnQueueAdd")?.addEventListener("click", enqueueFromUi);
$("btnAdmRefresh")?.addEventListener("click", () => loadAdmission().catch(console.error));
$("btnAdmSuggest")?.addEventListener("click", async () => {
  const a = $("admA")?.value?.trim();
  const beta = $("admBeta")?.value?.trim() || "1";
  if (!a) {
    if ($("admSuggestOut")) $("admSuggestOut").textContent = "enter a (offered load)";
    return;
  }
  try {
    const data = await getJSON("/queue/admission?a=" + encodeURIComponent(a) + "&beta=" + encodeURIComponent(beta));
    const s = data.suggest;
    if ($("admSuggestOut")) {
      $("admSuggestOut").textContent = s
        ? `c≈${s.suggested} (a=${s.a}, β=${s.beta}, current=${s.current})`
        : "no suggest";
    }
  } catch (e) {
    if ($("admSuggestOut")) $("admSuggestOut").textContent = String(e.message || e);
  }
});

// Live admission poll every 8s
let _admTimer = null;

/* ── X3.1 WebSocket live events ───────────────────────────────── */
let _eventsWs = null;
let _eventsAttempt = 0;
let _eventsTimer = null;
let _eventsPrevDelay = 1000;

/**
 * Decorrelated jitter backoff (matches src/utils/backoff.mjs strategy "decorrelated").
 * delay ~ U(base, min(max, 3 * prev))
 */
function wsBackoffDelayMs(attempt, baseMs, maxDelayMs, prevDelayMs) {
  const base = baseMs || 1000;
  const max = maxDelayMs || 30000;
  const prev = Math.max(base, prevDelayMs || base);
  const hi = Math.min(max, prev * 3);
  const lo = base;
  if (lo >= hi) return hi;
  return lo + Math.random() * (hi - lo);
}


function eventsWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return proto + "//" + location.host + "/ws/events";
}

function connectEventsWs() {
  const status = $("admLiveStatus");
  try {
    if (_eventsWs) {
      try { _eventsWs.close(); } catch {}
      _eventsWs = null;
    }
    // Carry an operator token (if set) via the WS subprotocol carrier so the
    // upgrade is authorized when the gateway requires a token.
    let _tok = null;
    try { _tok = localStorage.getItem("xclaw_token"); } catch {}
    const ws = _tok
      ? new WebSocket(eventsWsUrl(), ["xclaw.token." + _tok])
      : new WebSocket(eventsWsUrl());
    _eventsWs = ws;
    if (status) status.textContent = _eventsAttempt ? "ws reconnect…" : "ws connecting…";

    ws.onopen = () => {
      _eventsAttempt = 0;
      _eventsPrevDelay = 1000;
      if (status) status.textContent = "ws live";
      ws.send(JSON.stringify({
        type: "subscribe",
        channels: ["admission", "queue", "eviction", "swarm", "mission", "objective", "all"],
      }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "ready") {
        if (status) status.textContent = "ws live · hb " + (msg.heartbeatMs || "?") + "ms";
        return;
      }
      if (msg.type === "ping") {
        try {
          ws.send(JSON.stringify({ type: "pong", t: Date.now(), seq: msg.seq }));
        } catch {}
        if (status && status.textContent && status.textContent.startsWith("ws")) {
          status.textContent = "ws live · pong #" + (msg.seq ?? "—");
        }
        return;
      }
      if (msg.type === "event") {
        const ch = msg.channel;
        if (ch === "admission" || ch === "queue") {
          loadAdmission().catch(() => {});
          // light queue refresh on structural changes
          if (ch === "queue" && msg.data && (msg.data.kind === "enqueued" || msg.data.kind === "abandoned")) {
            loadQueue().catch(() => {});
          }
        }
        if (ch === "eviction" && typeof prependEvict === "function") {
          try { prependEvict(msg.data); } catch {}
        }
        if (ch === "swarm") {
          // B5 live canvas: patch node status in place — no refetch per event
          if (window.XClawCanvas) {
            try { XClawCanvas.onWsEvent(msg.data); } catch {}
          }
          // list view refresh only on run-level transitions, not every child event
          const p = msg.data?.phase || "";
          if ((p === "swarm_start" || p === "swarm_done" || p === "swarm_aborted") &&
              typeof loadSwarmRuns === "function") {
            loadSwarmRuns().catch(() => {});
          }
        }
        if (ch === "security") {
          // Approval lifecycle: refresh the table live + keep the nav badge
          // honest, so a pending approval is visible the moment it happens.
          if (typeof loadApprovals === "function") loadApprovals().catch(() => {});
          updateAprBadge().catch(() => {});
        }
        if (ch === "mission" && typeof loadMissions === "function") {
          loadMissions().catch(() => {});
        }
        if (ch === "objective" && typeof loadObjectivesCard === "function") {
          loadObjectivesCard().catch(() => {});
        }
        if (status && ch === "admission") {
          status.textContent = "ws · " + (msg.data?.kind || "event") + " · " + new Date().toLocaleTimeString();
        }
      }
    };

    ws.onclose = () => {
      _eventsWs = null;
      if (status) status.textContent = "ws closed · backoff reconnect";
      // Full jitter: U(0, min(max, base*2^attempt)) — same as server backoff.mjs
      const delay = Math.round(wsBackoffDelayMs(_eventsAttempt, 1000, 30000, _eventsPrevDelay));
      _eventsPrevDelay = Math.max(1000, delay);
      _eventsAttempt += 1;
      if (status) {
        status.textContent = "ws reconnect in " + delay + "ms · try " + _eventsAttempt;
      }
      if (_eventsTimer) clearTimeout(_eventsTimer);
      _eventsTimer = setTimeout(connectEventsWs, delay);
    };
    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  } catch (e) {
    if (status) status.textContent = "ws unavailable";
    startAdmissionLive(); // poll fallback
  }
}

function startAdmissionLive() {
  if (_admTimer) clearInterval(_admTimer);
  _admTimer = setInterval(() => {
    loadAdmission().catch(() => {});
  }, 8000);
  if (_admTimer.unref) _admTimer.unref();
}

loadQueue();
loadAdmission().then(() => { connectEventsWs(); startAdmissionLive(); }).catch(() => { connectEventsWs(); startAdmissionLive(); });


async function loadEvalHistory() {
  try {
    const data = await getJSON("/eval/history?limit=15");
    const lines = (data.history || []).map(
      (h) =>
        `${(h.at || "").slice(0, 19)}  pass=${((h.passRate || 0) * 100).toFixed(0)}%  turns=${Number(h.meanTurns || 0).toFixed(1)}  tok=${h.tokens?.total ?? "—"}`
    );
    $("evalBaseOut").textContent = lines.length ? lines.join("\n") : "No eval history yet.";
  } catch (e) {
    $("evalBaseOut").textContent = String(e.message || e);
  }
}
$("btnEvalHist")?.addEventListener("click", loadEvalHistory);


async function loadProfile() {
  try {
    const p = await getJSON("/profile");
    $("profileKv").innerHTML = kvHtml([
      ["Active", p.active || "—"],
      ["autoApprove", fmtBool(p.autoApprove), p.autoApprove ? "warn" : "good"],
      ["maxTurns", fmtNum(p.maxTurns)],
      ["eval cron", p.evalCron?.enabled ? `every ${fmtDuration(p.evalCron.everyMs)}` : "off"],
    ]);
  } catch (e) {
    $("profileKv").innerHTML = kvHtml([["Error", String(e.message || e), "warn"]]);
  }
}
$("btnProfile")?.addEventListener("click", loadProfile);
loadProfile();


async function loadEvalSpend() {
  try {
    const s = await getJSON("/eval/spend?limit=50");
    $("evalBaseOut").textContent = JSON.stringify({
      runs: s.runs,
      fullyPassedRuns: s.fullyPassedRuns,
      totalUsd: s.totalUsd,
      avgUsdPerRun: s.avgUsdPerRun,
      totalTokens: s.totalTokens,
    }, null, 2);
  } catch (e) {
    $("evalBaseOut").textContent = String(e.message || e);
  }
}
$("btnEvalSpend")?.addEventListener("click", loadEvalSpend);


$("btnQueuePause")?.addEventListener("click", async () => {
  try {
    const r = await fetch("/queue/pause", { method: "POST" });
    $("queueOut").textContent = JSON.stringify(await r.json(), null, 2);
    await loadQueue();
  } catch (e) {
    $("queueOut").textContent = String(e.message || e);
  }
});
$("btnQueueResume")?.addEventListener("click", async () => {
  try {
    const r = await fetch("/queue/resume", { method: "POST" });
    $("queueOut").textContent = JSON.stringify(await r.json(), null, 2);
    await loadQueue();
  } catch (e) {
    $("queueOut").textContent = String(e.message || e);
  }
});


$("btnQueueClear")?.addEventListener("click", async () => {
  try {
    const r = await fetch("/queue/clear", { method: "POST" });
    $("queueOut").textContent = JSON.stringify(await r.json(), null, 2);
    await loadQueue();
  } catch (e) {
    $("queueOut").textContent = String(e.message || e);
  }
});


$("btnQueueRetry")?.addEventListener("click", async () => {
  try {
    const r = await fetch("/queue/retry-failed", { method: "POST" });
    $("queueOut").textContent = JSON.stringify(await r.json(), null, 2);
    await loadQueue();
  } catch (e) {
    $("queueOut").textContent = String(e.message || e);
  }
});


async function loadDashboard() {
  try {
    const d = await getJSON("/dashboard");
    $("dashOut").textContent = JSON.stringify({
      at: d.at,
      profile: d.profile,
      computer: d.computer,
      queue: d.queue,
      agent: d.agent,
      evalSpend: d.eval?.spend && {
        runs: d.eval.spend.runs,
        totalUsd: d.eval.spend.totalUsd,
      },
      evalCron: d.eval?.cron,
    }, null, 2);
  } catch (e) {
    $("dashOut").textContent = String(e.message || e);
  }
}
$("btnDash")?.addEventListener("click", loadDashboard);
loadDashboard();


/**
 * Tables cleared to empty rendered a blank bar under the headers with no
 * explanation. Some views said "No entries"; most said nothing at all.
 */
function showEmptyRow(tbody, message) {
  if (!tbody || tbody.children.length) return;
  const cols = tbody.closest("table")?.querySelectorAll("thead th").length || 4;
  tbody.innerHTML = `<tr><td colspan="${cols}" class="muted">${esc(message)}</td></tr>`;
}

async function loadApprovals() {
  try {
    const pol = await getJSON("/security/policy").catch(() => ({}));
    if ($("aprPolicy")) {
      $("aprPolicy").textContent = pol.autoApprove
        ? "autoApprove ON"
        : `policy=${pol.approvalPolicy || "risky"} pending=${pol.pending ?? 0}`;
    }
    const data = await getJSON("/security/pending");
    const tbody = $("aprTable")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!(data.pending || []).length) showEmptyRow(tbody, "No pending approvals");
    for (const p of data.pending || []) {
      const tr = document.createElement("tr");
      const originBadge =
        p.origin === "hook"
          ? ' <span class="pill warn" title="a pre_tool_use hook demanded human review (decision: ask)">hook</span>'
          : "";
      tr.innerHTML = `<td>${p.tool}${originBadge}</td><td>${(p.at || "").replace("T", " ").slice(0, 19)} ${p.remainingMs!=null?"("+Math.round(p.remainingMs/1000)+"s left)":""}</td>
        <td>
          <button data-id="${p.id}" data-ok="1" class="btn primary apr-dec">Allow</button>
          <button data-id="${p.id}" data-ok="0" class="btn ghost apr-dec">Deny</button>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".apr-dec").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        const approved = btn.getAttribute("data-ok") === "1";
        const r = await fetch("/security/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, approved }),
        });
        $("aprOut").textContent = JSON.stringify(await r.json(), null, 2);
        await loadApprovals();
      };
    });
  } catch (e) {
    if ($("aprOut")) $("aprOut").textContent = String(e.message || e);
  }
}
$("btnAprRefresh")?.addEventListener("click", loadApprovals);
loadApprovals();
setInterval(() => { loadApprovals().catch(() => {}); }, 5000);


async function loadScoreboard() {
  try {
    const s = await getJSON("/eval/scoreboard");
    $("scoreOut").textContent = JSON.stringify({
      passRate: s.passRate,
      passed: s.passed,
      total: s.total,
      meanTurns: s.meanTurns,
      costUsd: s.costUsd,
      hardPack: s.hardPack,
      longPack: s.longPack,
      releaseGate: s.releaseGate,
      spendWindow: s.spendWindow,
    }, null, 2);
  } catch (e) {
    $("scoreOut").textContent = String(e.message || e);
  }
}
$("btnScoreboard")?.addEventListener("click", loadScoreboard);
loadScoreboard();


async function loadCheckpoints() {
  try {
    const data = await getJSON("/checkpoints?limit=20");
    const tbody = $("cpTable")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!(data.checkpoints || []).length) showEmptyRow(tbody, "No checkpoints");
    for (const c of data.checkpoints || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="font-size:0.7rem">${c.id}</td><td>${c.status}</td><td>${(c.goal||"").slice(0,40)}</td>
        <td><button class="btn ghost cp-pick" data-id="${c.id}">Select</button></td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".cp-pick").forEach((btn) => {
      btn.onclick = () => { $("cpId").value = btn.getAttribute("data-id"); };
    });
  } catch (e) {
    if ($("cpOut")) $("cpOut").textContent = String(e.message || e);
  }
}
$("btnCpRefresh")?.addEventListener("click", loadCheckpoints);
$("btnCpResume")?.addEventListener("click", async () => {
  const id = $("cpId")?.value?.trim();
  if (!id) return;
  try {
    const r = await fetch("/checkpoints/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    $("cpOut").textContent = JSON.stringify(await r.json(), null, 2);
    await loadCheckpoints();
  } catch (e) {
    $("cpOut").textContent = String(e.message || e);
  }
});
loadCheckpoints();

$("btnCostPause")?.addEventListener("click", async () => {
  await fetch("/cost/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: true }) });
  loadCostGovernor();
});
$("btnCostResume")?.addEventListener("click", async () => {
  await fetch("/cost/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: false }) });
  loadCostGovernor();
});


/* ── Phase D3: Swarm control panel ─────────────────────────────── */
let swarmAbort = null;

/**
 * Relative time for live tables ("5m ago"), falling back to an absolute stamp
 * once something is old enough that "37d ago" stops being useful. An absolute
 * locale string alone made it hard to see at a glance what was recent.
 */
function fmtWhen(iso) {
  if (!iso) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 19);
  const ms = Date.now() - t;
  if (ms < 0) return new Date(t).toLocaleString();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d <= 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

async function loadSwarmRuns() {
  const tbody = $("swarmTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/swarm?limit=40");
    tbody.innerHTML = "";
    const runs = data.runs || [];
    if ($("swarmLiveStatus")) {
      const n = runs.length;
      const active = runs.filter((r) => r.status === "running" || r.status === "pending").length;
      $("swarmLiveStatus").textContent = n ? `${n} runs · ${active} active` : "empty";
    }
    if (!runs.length) showEmptyRow(tbody, "No swarm runs");
    for (const r of runs) {
      const tr = document.createElement("tr");
      const id = r.id || r.swarmId || "";
      tr.innerHTML = `
        <td style="font-size:0.7rem">${id.slice(0, 12)}</td>
        <td><span class="pill">${r.status || "—"}</span></td>
        <td>${(r.goal || "").slice(0, 48)}</td>
        <td>${r.waves ?? r.waveCount ?? "—"}</td>
        <td style="font-size:0.7rem">${fmtWhen(r.createdAt || r.startedAt)}</td>
        <td><button class="btn ghost swarm-view" data-id="${id}">View</button></td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".swarm-view").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        try {
          const rec = await getJSON("/swarm/" + encodeURIComponent(id));
          if (window.XClawCanvas) {
            try { XClawCanvas.showRun(rec); } catch {}
          }
          const el = $("swarmDetailOut");
          if (el) {
            el.style.display = "block";
            el.textContent = JSON.stringify(rec, null, 2);
          }
        } catch (e) {
          if ($("swarmStreamOut")) $("swarmStreamOut").textContent = String(e.message || e);
        }
      };
    });
  } catch (e) {
    if ($("swarmStreamOut")) $("swarmStreamOut").textContent = "swarm list: " + (e.message || e);
  }
}

async function loadMerges() {
  const tbody = $("mergeTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/swarm/merges?limit=40");
    tbody.innerHTML = "";
    if (!(data.proposals || []).length) showEmptyRow(tbody, "No merge proposals");
    for (const m of data.proposals || []) {
      const tr = document.createElement("tr");
      const id = m.id || "";
      const pending = (m.status || "") === "pending" || (m.status || "") === "proposed";
      tr.innerHTML = `
        <td style="font-size:0.7rem">${id.slice(0, 12)}</td>
        <td>${m.status || "—"}</td>
        <td style="font-size:0.7rem">${(m.swarmId || "").slice(0, 10)}</td>
        <td style="font-size:0.7rem">${(m.repo || m.repoDir || "—").toString().slice(-32)}</td>
        <td class="row" style="gap:0.25rem;">
          ${pending ? `<button class="btn primary merge-approve" data-id="${id}">Approve</button>
                       <button class="btn ghost merge-reject" data-id="${id}">Reject</button>` : "—"}
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".merge-approve").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        try {
          const r = await fetch("/swarm/merges/" + encodeURIComponent(id) + "/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const body = await r.json();
          if ($("swarmStreamOut")) $("swarmStreamOut").textContent = JSON.stringify(body, null, 2);
          await loadMerges();
        } catch (e) {
          if ($("swarmStreamOut")) $("swarmStreamOut").textContent = String(e.message || e);
        }
      };
    });
    tbody.querySelectorAll(".merge-reject").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        try {
          const r = await fetch("/swarm/merges/" + encodeURIComponent(id) + "/reject", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "rejected from control UI" }),
          });
          const body = await r.json();
          if ($("swarmStreamOut")) $("swarmStreamOut").textContent = JSON.stringify(body, null, 2);
          await loadMerges();
        } catch (e) {
          if ($("swarmStreamOut")) $("swarmStreamOut").textContent = String(e.message || e);
        }
      };
    });
  } catch (e) {
    if ($("swarmStreamOut")) $("swarmStreamOut").textContent = "merges: " + (e.message || e);
  }
}

function parseSwarmBody() {
  const goal = $("swarmGoal")?.value?.trim() || "control-ui swarm";
  let tasks;
  const raw = $("swarmTasks")?.value?.trim();
  if (raw) {
    tasks = JSON.parse(raw);
  } else {
    tasks = [
      { id: "a", role: "research", task: "outline: " + goal },
      { id: "b", role: "writer", task: "summarize findings", dependsOn: ["a"] },
    ];
  }
  return { goal, tasks };
}

$("btnSwarmRefresh")?.addEventListener("click", () => {
  loadSwarmRuns().catch(console.error);
  loadMerges().catch(console.error);
});
$("btnMergeRefresh")?.addEventListener("click", () => loadMerges().catch(console.error));

$("btnSwarmRun")?.addEventListener("click", async () => {
  try {
    const body = parseSwarmBody();
    const r = await fetch("/swarm/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await r.json();
    if ($("swarmStreamOut")) $("swarmStreamOut").textContent = JSON.stringify(out, null, 2);
    await loadSwarmRuns();
  } catch (e) {
    if ($("swarmStreamOut")) $("swarmStreamOut").textContent = String(e.message || e);
  }
});

$("btnSwarmStream")?.addEventListener("click", async () => {
  if (swarmAbort) {
    swarmAbort.abort();
    swarmAbort = null;
  }
  const ac = new AbortController();
  swarmAbort = ac;
  if ($("btnSwarmAbort")) $("btnSwarmAbort").disabled = false;
  const out = $("swarmStreamOut");
  if (out) out.textContent = "connecting…\n";
  try {
    const body = parseSwarmBody();
    const r = await fetch("/swarm/run/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || r.statusText);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const chunk of parts) {
        if (!chunk.trim()) continue;
        const lines = chunk.split("\n");
        let event = "message";
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const data = dataLines.join("\n");
        if (out) {
          out.textContent += `[${event}] ${data}\n`;
          out.scrollTop = out.scrollHeight;
        }
      }
    }
    if (out) out.textContent += "— stream end —\n";
  } catch (e) {
    if (e.name === "AbortError") {
      if (out) out.textContent += "\n— aborted —\n";
    } else if (out) {
      out.textContent += "\nerror: " + (e.message || e) + "\n";
    }
  } finally {
    if ($("btnSwarmAbort")) $("btnSwarmAbort").disabled = true;
    swarmAbort = null;
    loadSwarmRuns().catch(() => {});
    loadMerges().catch(() => {});
  }
});

$("btnSwarmAbort")?.addEventListener("click", () => {
  if (swarmAbort) swarmAbort.abort();
});

loadSwarmRuns().catch(() => {});
loadMerges().catch(() => {});

// ── Providers panel ─────────────────────────────────────────────────────────
// Spine: paste API key → POST key → auto-fetch the provider's LIVE model list
// → dropdown fills with real models → pick → Use. Every provider renders the
// same shape; configured ones float to the top.
const _provLiveModels = {}; // provider id -> [modelId] (live-fetched)

// Escape untrusted values before HTML interpolation (model ids, base URLs,
// provider names all come from config/remote APIs — never trust them in HTML).
/**
 * Presentation helpers. Raw engine values were reaching the screen — an
 * interval as "86400000ms", booleans as "true"/"false", and six-figure limits
 * with no separators. Fine in a log, wrong on an operator console.
 */
const fmtBool = (v) => (v ? "yes" : "no");
const fmtNum = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString());
function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = n / 3_600_000;
  if (h < 48) return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  const d = h / 24;
  return `${Number.isInteger(d) ? d : d.toFixed(1)}d`;
}

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// Per-provider one-liners surfaced under the name (local daemon, public
// catalog, etc.). Keeps the paste-key flow honest where it differs.
const PROV_HINTS = {
  ollama: "local daemon · no key · install: <code>xclaw providers install ollama</code>",
  "ollama-cloud": "ollama.com cloud · needs an ollama.com API key",
  nvidia: "public catalog — models list without a key; key needed to run",
};

function provHeaders(jsonBody) {
  const h = jsonBody ? { "Content-Type": "application/json" } : {};
  try {
    const t = localStorage.getItem("xclaw_token");
    if (t) h["x-xclaw-token"] = t;
  } catch {}
  return h;
}

function provSetStatus(text, isErr) {
  const el = $("provStatus");
  if (!el) return;
  let msg = text || "";
  if (isErr && /unauthorized|401/i.test(String(text))) {
    msg = "operator token required — set localStorage.xclaw_token";
  }
  el.textContent = msg;
  el.className = isErr ? "muted err" : "muted";
}

// Disable a row's controls while a request is in flight (prevents double-submit
// and gives visible feedback).
function provBusy(tr, on) {
  if (!tr) return;
  tr.classList.toggle("prov-busy", !!on);
}

async function provCall(path, method, body) {
  const r = await fetch(path, {
    method: method || "GET",
    headers: provHeaders(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let out;
  try { out = JSON.parse(text); } catch { out = { raw: text }; }
  if (!r.ok) throw new Error(out.error || r.statusText || String(r.status));
  return out;
}

async function provFetchModels(id, tr) {
  const sel = tr?.querySelector(".prov-model");
  if (sel) { sel.innerHTML = `<option>fetching live models…</option>`; sel.disabled = true; }
  provSetStatus(`fetching live models for ${id}…`);
  try {
    const r = await provCall("/providers/manage/models", "POST", { provider: id });
    if (r.ok && r.models && r.models.length) {
      _provLiveModels[id] = r.models;
      provSetStatus(`${id}: ${r.models.length} live models`);
    } else {
      provSetStatus(`${id}: live fetch failed (${r.error || "empty"}) — using built-in list`, true);
    }
    return r;
  } finally {
    if (sel) sel.disabled = false;
  }
}

function provModelOptions(row) {
  const live = _provLiveModels[row.id];
  const models = live && live.length ? live : row.models || [];
  const current = row.isActive && window.__provActiveModel ? window.__provActiveModel : row.defaultModel;
  const opts = models
    .map((m) => `<option value="${esc(m)}"${m === current ? " selected" : ""}>${esc(m)}</option>`)
    .join("");
  const tag = live && live.length ? `live · ${models.length}` : models.length ? `built-in · ${models.length}` : "none";
  return { opts: opts || `<option value="">(no models)</option>`, tag };
}

function provRenderRow(row) {
  const { opts, tag } = provModelOptions(row);
  // One badge per stored credential (api-key and OAuth are SEPARATE profiles —
  // "<id>:apikey" vs "<id>:oauth"); click to prefer, × to remove.
  const credBadges = (row.profiles || [])
    .map((pr) => {
      const kind = pr.mode === "oauth" ? "oauth" : pr.mode === "token" ? "token" : "apikey";
      const cls = pr.expired ? "pill warn" : "pill on";
      const pref = pr.orderIndex === 0 ? " ★" : "";
      const exp = pr.expired ? " · expired" : "";
      return `<span class="${cls} prov-cred" data-profile="${esc(pr.id)}"
        title="${esc(pr.id)} — click to prefer">${kind}${exp}${pref}<span class="prov-cred-del" data-profile="${esc(pr.id)}" title="remove ${esc(pr.id)}">×</span></span>`;
    })
    .join(" ");
  const envBadge = row.hasEnvKey
    ? `<span class="pill on" title="env ${esc(row.envKey || "")}">env ✓</span>`
    : "";
  const noCred = !credBadges && !envBadge ? `<span class="pill">no credential</span>` : "";
  // Web OAuth: the button starts /providers/manage/oauth/start — paste-code
  // providers (anthropic) run entirely in the browser; others get the exact
  // CLI command shown in the flow area.
  const oauthHint = `
      <div class="prov-btnrow">
        <button class="btn ghost prov-oauth">OAuth login</button>
      </div>
      <div class="prov-oauth-flow" style="display:none;"></div>`;
  const hint = PROV_HINTS[row.id] ? `<div class="prov-sub muted">${PROV_HINTS[row.id]}</div>` : "";
  const active = row.isActive ? ` <span class="pill on">active</span>` : "";
  // Local ollama needs no credential to be usable.
  const usable = row.configured || row.id === "ollama";
  return `<tr data-prov="${esc(row.id)}" class="${row.isActive ? "prov-active" : ""}${row.configured ? "" : " prov-dim"}">
    <td class="prov-name"><b>${esc(row.name)}</b>${active}<br /><span class="muted">${esc(row.id)}</span>${hint}</td>
    <td class="prov-ep">
      <input type="text" class="prov-base" value="${row.baseUrlCustom ? esc(row.baseUrl) : ""}"
        placeholder="${esc(row.baseUrlDefault || "https://…")}" spellcheck="false" />
      <div class="prov-btnrow">
        <button class="btn prov-base-save" title="Save base URL (https, or http to loopback)">Save</button>
        ${row.baseUrlCustom ? `<button class="btn ghost prov-base-reset" title="Reset to default">Reset</button>` : ""}
      </div>
    </td>
    <td class="prov-creds">
      <div class="prov-badges">
        <span class="prov-health" title="Not tested — click Test">
          <span class="prov-dot"></span><span class="prov-health-txt muted">untested</span>
        </span>
        ${credBadges} ${envBadge} ${noCred}
      </div>
      <div class="prov-btnrow">
        <input type="password" class="prov-key" placeholder="paste API key…" autocomplete="off" />
        <button class="btn prov-key-save">Add</button>
        <button class="btn ghost prov-test" title="Live-test the stored credential">Test</button>
      </div>
      ${oauthHint}
    </td>
    <td class="prov-model-cell">
      <select class="prov-model" title="${esc(tag)}">${opts}</select>
      <div class="prov-btnrow">
        <input type="text" class="prov-model-custom" placeholder="custom model…" />
        <button class="btn ghost prov-models-refresh" title="Fetch live model list">↻</button>
      </div>
      <span class="prov-sub muted">${esc(tag)}</span>
    </td>
    <td><button class="btn primary prov-use" ${usable ? "" : "disabled title='add a key first'"}>Use</button></td>
  </tr>`;
}

async function loadProviders() {
  const tbody = document.querySelector("#provTable tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="muted">loading providers…</td></tr>`;
  try {
    const inv = await provCall("/providers/manage");
    window.__provActiveModel = inv.active?.model || null;
    const list = (inv.providers || []).slice();
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">no providers</td></tr>`;
      return;
    }
    // Configured first (active pinned to top of that group), unconfigured below.
    const rank = (p) => (p.isActive ? 0 : p.configured ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b));
    const firstUnconfigured = list.findIndex((p) => !p.configured);
    const rows = list.map((p, i) => {
      const divider =
        i === firstUnconfigured && firstUnconfigured > 0
          ? `<tr class="prov-divider"><td colspan="5">not configured</td></tr>`
          : "";
      return divider + provRenderRow(p);
    });
    tbody.innerHTML = rows.join("");
    provSetStatus(`active: ${inv.active?.provider || "—"} / ${inv.active?.model || "—"}`);
    provWireRows();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted err">${esc(e.message || e)}</td></tr>`;
    provSetStatus(String(e.message || e), true);
  }
}

function provWireRows() {
  document.querySelectorAll("#provTable tr[data-prov]").forEach((tr) => {
    const id = tr.getAttribute("data-prov");
    // Wrap a handler so it disables the row, surfaces errors, and refreshes.
    const guard = (fn) => async () => {
      provBusy(tr, true);
      try { await fn(); } catch (e) { provSetStatus(String(e.message || e), true); }
      finally { provBusy(tr, false); }
    };

    tr.querySelector(".prov-base-save")?.addEventListener("click", guard(async () => {
      const url = tr.querySelector(".prov-base").value.trim();
      await provCall("/providers/manage/base-url", "POST", { provider: id, url: url || null });
      provSetStatus(`${id}: base URL ${url ? "set" : "cleared"}`);
      await loadProviders();
    }));
    tr.querySelector(".prov-base-reset")?.addEventListener("click", guard(async () => {
      await provCall("/providers/manage/base-url", "POST", { provider: id, url: null });
      provSetStatus(`${id}: base URL reset to default`);
      await loadProviders();
    }));

    tr.querySelector(".prov-key-save")?.addEventListener("click", guard(async () => {
      const input = tr.querySelector(".prov-key");
      const apiKey = input.value.trim();
      if (!apiKey) return provSetStatus(`${id}: paste a key first`, true);
      await provCall("/providers/manage/key", "POST", { provider: id, apiKey });
      input.value = ""; // never keep the secret in the DOM
      provSetStatus(`${id}: key stored — fetching live models…`);
      await provFetchModels(id, tr); // the spine: key → real models
      await loadProviders();
    }));

    tr.querySelector(".prov-models-refresh")?.addEventListener("click", guard(async () => {
      await provFetchModels(id, tr);
      await loadProviders();
    }));

    tr.querySelector(".prov-test")?.addEventListener("click", guard(async () => {
      const health = tr.querySelector(".prov-health");
      const dot = tr.querySelector(".prov-dot");
      const txt = tr.querySelector(".prov-health-txt");
      dot.className = "prov-dot testing";
      txt.textContent = "testing…";
      txt.className = "prov-health-txt muted";
      const r = await provCall("/providers/manage/verify", "POST", { provider: id });
      if (r.ok) {
        dot.className = "prov-dot ok";
        txt.textContent = `live · ${r.models} models`;
        txt.className = "prov-health-txt ok";
        health.title = `credential resolves (${r.source || "?"}) and the live API answered`;
      } else {
        dot.className = "prov-dot bad";
        txt.textContent = r.stage === "credential" ? "no credential" : "auth failed";
        txt.className = "prov-health-txt bad";
        health.title = r.error || "verification failed";
      }
    }));

    tr.querySelector(".prov-oauth")?.addEventListener("click", guard(async () => {
      const flow = tr.querySelector(".prov-oauth-flow");
      const start = await provCall("/providers/manage/oauth/start", "POST", { provider: id });
      flow.style.display = "block";
      if (start.flow === "cli") {
        flow.innerHTML =
          `<span class="prov-sub muted">Web OAuth isn't available for this provider — run:<br />` +
          `<code>${esc(start.command || `xclaw providers oauth --provider ${id}`)}</code></span>`;
        return;
      }
      // paste-code flow: open the authorize URL, collect the code here.
      window.open(start.authorizeUrl, "_blank", "noopener");
      flow.innerHTML =
        `<span class="prov-sub muted">A Claude login tab opened — approve access, copy the code, paste it here:</span>` +
        `<div class="prov-btnrow">` +
        `<input type="text" class="prov-oauth-code" placeholder="paste authorization code…" autocomplete="off" spellcheck="false" />` +
        `<button class="btn primary prov-oauth-complete">Complete</button>` +
        `<a class="prov-sub muted" href="${esc(start.authorizeUrl)}" target="_blank" rel="noopener">reopen login</a>` +
        `</div>`;
      flow.querySelector(".prov-oauth-complete").addEventListener("click", guard(async () => {
        const codeInput = flow.querySelector(".prov-oauth-code");
        const code = codeInput.value.trim();
        if (!code) return provSetStatus(`${id}: paste the authorization code first`, true);
        const done = await provCall("/providers/manage/oauth/complete", "POST", {
          state: start.state,
          code,
        });
        codeInput.value = ""; // never keep the code in the DOM
        if (!done.ok) return provSetStatus(`${id}: oauth failed — ${done.error || "unknown"}`, true);
        provSetStatus(`${id}: OAuth stored (${done.profileId}) — fetching live models…`);
        await provFetchModels(id, tr);
        await loadProviders();
      }));
    }));

    tr.querySelectorAll(".prov-cred").forEach((badge) => {
      // Click the badge body → prefer this credential. Click its × → remove it.
      badge.addEventListener("click", guard(async (ev) => {
        const profileId = badge.getAttribute("data-profile");
        if (ev && ev.target && ev.target.classList.contains("prov-cred-del")) {
          await provCall("/providers/manage/key", "DELETE", { provider: id, profileId });
          provSetStatus(`${id}: removed ${profileId}`);
        } else {
          await provCall("/providers/manage/prefer", "POST", { provider: id, profileId });
          provSetStatus(`${id}: preferring ${profileId}`);
        }
        await loadProviders();
      }));
    });

    tr.querySelector(".prov-use")?.addEventListener("click", guard(async () => {
      const custom = tr.querySelector(".prov-model-custom").value.trim();
      const model = custom || tr.querySelector(".prov-model").value || undefined;
      const r = await provCall("/providers/manage/use", "POST", { provider: id, model });
      provSetStatus(`now using ${r.provider} / ${r.model} — ${r.note || ""}`);
      await loadProviders();
    }));
  });
}

$("btnProvRefresh")?.addEventListener("click", () => loadProviders().catch(console.error));
loadProviders().catch(() => {});

// ── Channels panel ─────────────────────────────────────────────────────────
// Same shape as Providers: manage every channel (enable + credentials) from the
// UI, mirroring `xclaw channels …`. Secrets are write-only (POST /field); the
// inventory only reports set/not-set. Reuses esc()/provHeaders/provCall.
const CHAN_HINTS = {
  webchat: "built-in browser chat at <code>/chat/</code> — no credentials",
  telegram: "bot token from <code>@BotFather</code>",
  slack: "bot token <code>xoxb-…</code> (+ app token for socket mode)",
  discord: "bot token from the Discord developer portal",
  email: "IMAP inbox to read, SMTP to reply",
};

function chanSetStatus(text, isErr) {
  const el = $("chanStatus");
  if (!el) return;
  let msg = text || "";
  if (isErr && /unauthorized|401/i.test(String(text))) {
    msg = "operator token required — set localStorage.xclaw_token";
  }
  el.textContent = msg;
  el.className = isErr ? "muted err" : "muted";
}

function chanFieldInput(chId, f) {
  const idAttr = `data-ch="${esc(chId)}" data-key="${esc(f.key)}"`;
  const label = `<label class="chan-flabel" title="${esc(f.key)}">${esc(f.label)}${f.required ? " *" : ""}</label>`;
  if (f.type === "bool") {
    return `<div class="chan-field">${label}
      <input type="checkbox" class="chan-bool" ${idAttr} ${f.set && f.value ? "checked" : ""} /></div>`;
  }
  if (f.secret) {
    // Write-only: never render the value. Show whether it's set.
    const state = f.set ? `<span class="pill on">set</span>` : `<span class="pill">not set</span>`;
    return `<div class="chan-field">${label} ${state}
      <input type="password" class="chan-secret" ${idAttr} placeholder="${f.set ? "replace…" : "paste…"}" autocomplete="off" />
      <button class="btn chan-secret-save" ${idAttr}>Save</button>
      ${f.set ? `<button class="btn ghost chan-secret-clear" ${idAttr} title="clear">×</button>` : ""}</div>`;
  }
  const val = f.value == null ? "" : Array.isArray(f.value) ? f.value.join(",") : String(f.value);
  return `<div class="chan-field">${label}
    <input type="text" class="chan-text" ${idAttr} value="${esc(val)}" placeholder="${esc(f.type === "list" ? "comma,list" : "")}" spellcheck="false" />
    <button class="btn chan-text-save" ${idAttr}>Save</button></div>`;
}

function chanRenderRow(ch) {
  const hint = CHAN_HINTS[ch.id] ? `<div class="prov-sub muted">${CHAN_HINTS[ch.id]}</div>` : "";
  // Live status (channelManager.status() merge — was silently broken by an
  // array-vs-map mismatch until 3.95.4, so these pills never showed).
  let running = "";
  if (ch.status) {
    const st = ch.status;
    if (st.running || st.ok) {
      const msgs = st.messagesHandled != null ? ` · ${st.messagesHandled} msg` : "";
      running = ` <span class="pill on" title="${esc(st.username ? "@" + st.username : ch.id)}${st.lastOkAt ? " · last ok " + esc(st.lastOkAt) : ""}">running${msgs}</span>`;
    } else if (ch.enabled) {
      running = ` <span class="pill danger" title="${esc(st.lastError || "not running")}">stopped</span>`;
    }
    if (st.lastError && (st.running || st.ok)) {
      running += ` <span class="pill warn" title="${esc(st.lastError)}">err</span>`;
    }
  }
  const cfgBadge = ch.configured
    ? `<span class="pill on">configured</span>`
    : `<span class="pill">needs setup</span>`;
  const note = ch.note ? `<div class="prov-sub muted">${esc(ch.note)}</div>` : "";
  const fields = ch.fields && ch.fields.length
    ? ch.fields.map((f) => chanFieldInput(ch.id, f)).join("")
    : `<span class="muted">no credentials</span>`;
  const restart = `<button class="btn ghost chan-restart" data-ch="${esc(ch.id)}" title="restart this channel">Restart</button>`;
  return `<tr data-ch="${esc(ch.id)}" class="${ch.enabled ? "" : "prov-dim"}">
    <td class="prov-name"><b>${esc(ch.name)}</b>${running}<br /><span class="muted">${esc(ch.id)}</span>${hint}</td>
    <td>
      <label class="chan-toggle"><input type="checkbox" class="chan-enabled" data-ch="${esc(ch.id)}" ${ch.enabled ? "checked" : ""} /> ${cfgBadge}</label>
    </td>
    <td class="chan-cfg">${fields}${note}</td>
    <td>${restart}</td>
  </tr>`;
}

async function loadChannels() {
  const tbody = document.querySelector("#chanTable tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="muted">loading channels…</td></tr>`;
  try {
    const inv = await provCall("/channels/manage");
    const list = (inv.channels || []).slice();
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">no channels</td></tr>`;
      return;
    }
    // Enabled first, then the rest.
    list.sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0));
    tbody.innerHTML = list.map(chanRenderRow).join("");
    const on = list.filter((c) => c.enabled).map((c) => c.id);
    chanSetStatus(on.length ? `enabled: ${on.join(", ")}` : "no channels enabled");
    chanWireRows();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted err">${esc(e.message || e)}</td></tr>`;
    chanSetStatus(String(e.message || e), true);
  }
}

function chanWireRows() {
  document.querySelectorAll("#chanTable tr[data-ch]").forEach((tr) => {
    const id = tr.getAttribute("data-ch");
    const guard = (fn) => async (ev) => {
      provBusy(tr, true);
      try { await fn(ev); } catch (e) { chanSetStatus(String(e.message || e), true); }
      finally { provBusy(tr, false); }
    };

    tr.querySelector(".chan-enabled")?.addEventListener("change", guard(async (ev) => {
      const enabled = !!ev.target.checked;
      await provCall("/channels/manage/enabled", "POST", { channel: id, enabled });
      chanSetStatus(`${id}: ${enabled ? "enabled" : "disabled"} — applies on restart`);
      await loadChannels();
    }));

    tr.querySelectorAll(".chan-secret-save").forEach((btn) => {
      btn.addEventListener("click", guard(async () => {
        const key = btn.getAttribute("data-key");
        const input = tr.querySelector(`.chan-secret[data-key="${CSS.escape(key)}"]`);
        const value = input.value.trim();
        if (!value) return chanSetStatus(`${id}.${key}: paste a value first`, true);
        await provCall("/channels/manage/field", "POST", { channel: id, key, value });
        input.value = ""; // never keep the secret in the DOM
        chanSetStatus(`${id}.${key}: saved`);
        await loadChannels();
      }));
    });
    tr.querySelectorAll(".chan-secret-clear").forEach((btn) => {
      btn.addEventListener("click", guard(async () => {
        const key = btn.getAttribute("data-key");
        await provCall("/channels/manage/field", "POST", { channel: id, key, value: null });
        chanSetStatus(`${id}.${key}: cleared`);
        await loadChannels();
      }));
    });
    tr.querySelectorAll(".chan-text-save").forEach((btn) => {
      btn.addEventListener("click", guard(async () => {
        const key = btn.getAttribute("data-key");
        const input = tr.querySelector(`.chan-text[data-key="${CSS.escape(key)}"]`);
        const raw = input.value.trim();
        await provCall("/channels/manage/field", "POST", { channel: id, key, value: raw || null });
        chanSetStatus(`${id}.${key}: saved`);
        await loadChannels();
      }));
    });
    tr.querySelectorAll(".chan-bool").forEach((box) => {
      box.addEventListener("change", guard(async () => {
        const key = box.getAttribute("data-key");
        await provCall("/channels/manage/field", "POST", { channel: id, key, value: !!box.checked });
        chanSetStatus(`${id}.${key}: ${box.checked}`);
      }));
    });

    tr.querySelector(".chan-restart")?.addEventListener("click", guard(async () => {
      const r = await provCall("/channels/manage/restart", "POST", { channel: id });
      chanSetStatus(r.restarted ? `${id}: restarted` : `${id}: ${r.note || r.error || "not running"}`);
    }));
  });
}

$("btnChanRefresh")?.addEventListener("click", () => loadChannels().catch(console.error));
loadChannels().catch(() => {});

// ═══════════════════ Usage & Logs (per-provider) ═══════════════════
// Provider separation is the organizing principle: one provider on screen at
// a time (or an explicit "All"), selected by the chip bar — usage charts,
// breakdown, models and logs all rescope together so nothing ever mixes.

const UL_PROV_COLORS = {
  xai: "#1DA1F2",
  anthropic: "#D4A27F",
  openai: "#10A37F",
  google: "#EA4335",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
  ollama: "#EEEEEE",
  nvidia: "#76B900",
  unknown: "#8b98a8",
};
const UL_TYPE_COLORS = {
  prompt: "#6ea8ff",
  cached: "#3dd68c",
  completion: "#e0af68",
  reasoning: "#ff7ab2",
};

let ulProvider = localStorage.getItem("xclaw_ul_provider") || "all";
let ulDays = 7;

function ulFmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "K";
  return Number(n).toLocaleString();
}
function ulUsd(n) {
  if (n == null || !(n > 0)) return "$0.00";
  return n < 0.01 ? "<$0.01" : "$" + n.toFixed(2);
}

/** Zero-dep SVG bar chart. series: [{values:[…], color}] stacked per index. */
function ulBars(el, series, labels = []) {
  if (!el) return;
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const sums = Array.from({ length: n }, (_, i) =>
    series.reduce((a, s) => a + (s.values[i] || 0), 0)
  );
  const max = Math.max(...sums, 1);
  const W = 100, H = 34, gap = 0.6;
  const bw = W / n - gap;
  let rects = "";
  for (let i = 0; i < n; i++) {
    let y = H;
    for (const s of series) {
      const v = s.values[i] || 0;
      const h = (v / max) * (H - 2);
      if (h > 0.1) {
        y -= h;
        rects += `<rect x="${(i * W) / n + gap / 2}" y="${y}" width="${bw}" height="${h}" rx="0.8" fill="${s.color}"><title>${labels[i] || ""}: ${ulFmt(sums[i])}</title></rect>`;
      }
    }
    if (sums[i] === 0) {
      rects += `<rect x="${(i * W) / n + gap / 2}" y="${H - 0.8}" width="${bw}" height="0.8" fill="#232b37"/>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}</svg>`;
}

async function ulLoadProviders() {
  const bar = $("ulProviders");
  if (!bar) return;
  let ids = [];
  try {
    const inv = await getJSON("/providers/manage");
    ids = (inv.providers || []).filter((p) => p.configured).map((p) => p.id);
  } catch { /* chips fall back to All */ }
  const chips = ["all", ...ids];
  bar.innerHTML = chips
    .map((id) => {
      const label = id === "all" ? "All providers" : id;
      return `<button class="chip ul-prov-chip${id === ulProvider ? " active" : ""}" data-prov="${esc(id)}">${esc(label)}</button>`;
    })
    .join("");
  bar.querySelectorAll(".ul-prov-chip").forEach((c) =>
    c.addEventListener("click", () => {
      ulProvider = c.dataset.prov;
      localStorage.setItem("xclaw_ul_provider", ulProvider);
      bar.querySelectorAll(".ul-prov-chip").forEach((x) => x.classList.toggle("active", x === c));
      ulLoadUsage().catch(console.error);
      ulLoadLogs().catch(console.error);
    })
  );
}

async function ulLoadCacheMonitor() {
  try {
    const mon = await getJSON(`/usage/cache?days=${ulDays}&recent=12&warnBelow=40`);
    const tb = $("ulCacheRecent")?.querySelector("tbody");
    if (!tb) return;
    const rows = mon.recent || [];
    tb.innerHTML = rows.length
      ? rows
          .map((r) => {
            const warn = r.warn ? ' style="color:#ff5d5d"' : "";
            const when = (r.at || "—").toString().slice(0, 19).replace("T", " ");
            return `<tr${warn}>
              <td>${esc(when)}</td>
              <td>${r.cacheHitRatePct != null ? r.cacheHitRatePct + "%" : "—"}</td>
              <td>${ulFmt(r.cachedTokens)}/${ulFmt(r.promptTokens)}</td>
              <td>${esc(r.model || "—")}</td>
              <td>${r.turnCount ?? "—"}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="muted">No ledger runs yet — run an agent session</td></tr>`;
    const al = $("ulCacheAlerts");
    if (al) {
      const t = mon.totals || {};
      al.textContent = t.cacheHitRatePct != null
        ? `Window hit rate ${t.cacheHitRatePct}% · ${t.turnsWithCache || 0}/${t.turns || 0} turns with cache` +
          (mon.alerts?.lowHitRuns ? ` · ${mon.alerts.lowHitRuns} low-hit run(s)` : "")
        : "";
    }
  } catch (e) {
    console.warn("cache monitor", e);
  }
}

async function ulLoadUsage() {
  ulLoadCacheMonitor().catch(() => {});
  const data = await getJSON(`/usage?provider=${encodeURIComponent(ulProvider)}&days=${ulDays}`);
  const t = data.totals || {};
  $("ulTitle").textContent =
    (ulProvider === "all" ? "Usage — all providers" : `Usage — ${ulProvider}`) + ` · last ${data.days}d`;
  $("ulSpend").textContent = ulUsd(t.costUsd);
  $("ulTokens").textContent = ulFmt(t.totalTokens);
  $("ulRequests").textContent = ulFmt(t.requests);
  if ($("ulCacheHit")) {
    const pct = t.cacheHitRatePct != null ? t.cacheHitRatePct : (t.cacheHitRate != null ? Math.round(t.cacheHitRate * 1000) / 10 : null);
    $("ulCacheHit").textContent = pct != null ? pct + "%" : "—";
    if ($("ulCacheNote")) {
      $("ulCacheNote").textContent = t.cachedTokens
        ? `${ulFmt(t.cachedTokens)} cached of ${ulFmt(t.promptTokens)} prompt`
        : "no cache tokens reported";
    }
  }

  const days = data.daily || [];
  const labels = days.map((d) => d.day.slice(5));
  ulBars($("ulSpendChart"), [{ values: days.map((d) => d.costUsd), color: "#ff5d5d" }], labels);
  ulBars(
    $("ulTokensChart"),
    [
      { values: days.map((d) => d.promptTokens), color: UL_TYPE_COLORS.prompt },
      { values: days.map((d) => d.cachedTokens), color: UL_TYPE_COLORS.cached },
      { values: days.map((d) => d.completionTokens), color: UL_TYPE_COLORS.completion },
      { values: days.map((d) => d.reasoningTokens), color: UL_TYPE_COLORS.reasoning },
    ],
    labels
  );
  ulBars($("ulRequestsChart"), [{ values: days.map((d) => d.requests), color: "#8b98a8" }], labels);

  $("ulLegend").innerHTML = Object.entries(UL_TYPE_COLORS)
    .map(([k, c]) => `<span class="ul-lg"><i style="background:${c}"></i>${k}</span>`)
    .join("");

  const totalForShare = Math.max(
    1,
    (t.promptTokens || 0) + (t.cachedTokens || 0) + (t.completionTokens || 0) + (t.reasoningTokens || 0)
  );
  $("ulBreakdown").querySelector("tbody").innerHTML = (data.breakdown || [])
    .map((b) => {
      const pct = Math.round(((b.tokens || 0) / totalForShare) * 100);
      return `<tr>
        <td><i class="ul-dot" style="background:${UL_TYPE_COLORS[b.type] || "#888"}"></i> ${esc(b.label)}</td>
        <td>${ulFmt(b.tokens)}</td>
        <td><div class="ul-share"><div style="width:${pct}%"></div></div> ${pct}%</td>
      </tr>`;
    })
    .join("");

  $("ulByModel").querySelector("tbody").innerHTML = (data.byModel || [])
    .slice(0, 8)
    .map(
      (m) => `<tr><td>${esc(m.model)}</td><td>${ulFmt(m.runs)}</td><td>${ulFmt(m.tokens)}</td><td>${ulUsd(m.costUsd)}</td></tr>`
    )
    .join("") || `<tr><td colspan="4" class="muted">no runs in range</td></tr>`;

  await ulRenderProviderCosts(data);
}

async function ulRenderProviderCosts(scopedData) {
  const bars = $("ulByProviderBars");
  const table = $("ulByProvider")?.querySelector("tbody");
  if (!bars || !table) return;

  let rows = scopedData.byProvider || [];
  if (ulProvider !== "all" || !rows.length) {
    try {
      const all = await getJSON(`/usage?provider=all&days=${ulDays}`);
      rows = all.byProvider || rows;
    } catch {
      /* keep scoped */
    }
  }
  rows = [...rows].sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0));
  const totalSpend = rows.reduce((s, r) => s + (Number(r.costUsd) || 0), 0) || 1;

  if (!rows.length) {
    bars.innerHTML = `<div class="muted" style="font-size:0.85rem;">No provider spend in this window.</div>`;
    table.innerHTML = "";
    return;
  }

  bars.innerHTML = rows
    .map((r) => {
      const pct = Math.max(1, Math.round(((r.costUsd || 0) / totalSpend) * 100));
      const color = UL_PROV_COLORS[r.provider] || UL_PROV_COLORS.unknown;
      return `<div class="ul-prov-row" title="${esc(r.provider)}: ${ulUsd(r.costUsd)} (${pct}%)">
        <span class="name">${esc(r.provider)}</span>
        <div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="usd">${ulUsd(r.costUsd)}</span>
      </div>`;
    })
    .join("");

  table.innerHTML = rows
    .map((r) => {
      const pct = Math.round(((r.costUsd || 0) / totalSpend) * 100);
      const color = UL_PROV_COLORS[r.provider] || UL_PROV_COLORS.unknown;
      const cachePct = r.cacheHitRatePct != null ? r.cacheHitRatePct : (r.promptTokens > 0 && r.cachedTokens != null
        ? Math.round(Math.min(1, r.cachedTokens / r.promptTokens) * 1000) / 10
        : null);
      return `<tr>
        <td><i class="ul-dot" style="background:${color}"></i> ${esc(r.provider)}</td>
        <td>${ulFmt(r.runs)}</td>
        <td>${ulFmt(r.promptTokens)}</td>
        <td>${ulFmt(r.completionTokens)}</td>
        <td>${cachePct != null ? cachePct + "%" : "—"}</td>
        <td>${ulUsd(r.costUsd)}</td>
        <td><div class="ul-share"><div style="width:${pct}%;background:${color}"></div></div> ${pct}%</td>
      </tr>`;
    })
    .join("");
}

async function ulLoadLogs() {
  const q = $("ulLogFilter")?.value?.trim();
  const data = await getJSON(
    `/logs?provider=${encodeURIComponent(ulProvider)}&limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`
  );
  $("ulLogMeta").textContent = `· ${data.total} requests${ulProvider !== "all" ? ` · ${ulProvider}` : ""}`;
  const tbody = $("ulLogTable").querySelector("tbody");
  tbody.innerHTML = (data.rows || [])
    .map(
      (r) => `<tr class="ul-log-row" data-run="${esc(r.runId)}" title="click for detail">
        <td>${new Date(r.at).toLocaleString()}</td>
        <td><span class="pill">${esc(r.provider)}</span></td>
        <td>${esc(r.model)}</td>
        <td>${ulFmt(r.promptTokens)}${r.estimated ? '<span class="muted" title="estimated">~</span>' : ""}</td>
        <td>${ulFmt(r.completionTokens)}</td>
        <td>${ulFmt(r.cachedTokens)}</td>
        <td>${r.costUsd != null ? "$" + Number(r.costUsd).toFixed(6) : "—"}</td>
        <td class="ul-preview">${esc((r.preview || "").slice(0, 48))}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="8" class="muted">no requests</td></tr>`;
  tbody.querySelectorAll(".ul-log-row").forEach((tr) =>
    tr.addEventListener("click", async () => {
      try {
        const d = await getJSON(`/logs/run?id=${encodeURIComponent(tr.dataset.run)}`);
        $("ulDetailTitle").textContent = `${d.entry.provider} · ${d.entry.model} · ${new Date(d.entry.at).toLocaleString()}`;
        $("ulDetailBody").textContent = JSON.stringify(d.entry, null, 2);
        $("ulLogDetail").style.display = "block";
        $("ulLogDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (e) {
        $("ulDetailBody").textContent = String(e.message || e);
        $("ulLogDetail").style.display = "block";
      }
    })
  );
}

document.querySelectorAll(".ul-range-btn").forEach((b) =>
  b.addEventListener("click", () => {
    ulDays = Number(b.dataset.days) || 7;
    document.querySelectorAll(".ul-range-btn").forEach((x) => x.classList.toggle("active", x === b));
    ulLoadUsage().catch(console.error);
  })
);
$("ulRefresh")?.addEventListener("click", () => {
  ulLoadUsage().catch(console.error);
  ulLoadLogs().catch(console.error);
});
$("ulLogRefresh")?.addEventListener("click", () => ulLoadLogs().catch(console.error));
$("ulLogFilter")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ulLoadLogs().catch(console.error);
});
$("ulDetailClose")?.addEventListener("click", () => ($("ulLogDetail").style.display = "none"));

if ($("ulProviders")) {
  ulLoadProviders()
    .then(() => Promise.all([ulLoadUsage(), ulLoadLogs()]))
    .catch(console.error);
}

// Two open Control windows share localStorage but chips didn't live-sync —
// window A could show "anthropic" while B shows "nvidia" (observed on the
// operator display with both surfaces open). Follow storage events so every
// window converges on the same provider selection.
window.addEventListener("storage", (e) => {
  if (e.key !== "xclaw_ul_provider" || !$("ulProviders")) return;
  const next = e.newValue || "all";
  if (next === ulProvider) return;
  ulProvider = next;
  document.querySelectorAll(".ul-prov-chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.prov === ulProvider)
  );
  ulLoadUsage().catch(console.error);
  ulLoadLogs().catch(console.error);
});

// ═══════════ First-run auth overlay (fresh-install onboarding) ═══════════
// A new install on a strict gateway used to greet the operator with silent
// "unauthorized" panels and no way to sign in from the page (the token had
// to be planted in localStorage by hand). Any same-origin 401 now raises a
// token-entry overlay; the token is verified against a protected endpoint
// before reload. Tokenless lab gateways never see this.
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
      <button id="xa-save" class="btn primary">Connect</button>
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
      const r = await fetch("/providers/manage");
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

// Pending-approval badge on the Approvals nav item — updated live by the
// WS security channel and on boot, so a waiting approval is visible from
// any view without polling or clicking.
async function updateAprBadge() {
  const badge = document.getElementById("aprBadge");
  if (!badge) return;
  try {
    const d = await getJSON("/security/pending");
    const n = d.count ?? (d.pending || []).length;
    badge.hidden = !n;
    badge.textContent = n > 9 ? "9+" : String(n);
  } catch {
    badge.hidden = true;
  }
}
updateAprBadge().catch(() => {});

// ═══════════════ 8-gap sections (Automations · Alerts · Skills · MCP ·
// Images · Sessions · Subagents · Memory) — every editable surface the
// gateway already exposed but the UI didn't. Same helpers as the rest
// (getJSON carries the operator token via the fetch wrapper).

const postJSON = (url, body) =>
  getJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

/* ── Automations (cron jobs) ─────────────────────────────────────── */
// schedule is an object: {kind:"every", everyMs} or {kind:"cron", expr}
function autoSchedFmt(s, intervalMs) {
  if (!s) return intervalMs ? `every ${autoMs(intervalMs)}` : "—";
  if (typeof s === "string") return s;
  if (s.everyMs || s.kind === "every") return "every " + autoMs(s.everyMs || s.intervalMs);
  if (s.expr || s.cron) return s.expr || s.cron;
  return JSON.stringify(s);
}
function autoMs(ms) {
  if (!ms) return "?";
  if (ms % 3_600_000 === 0) return ms / 3_600_000 + "h";
  if (ms % 60_000 === 0) return ms / 60_000 + "m";
  if (ms % 1000 === 0) return ms / 1000 + "s";
  return ms + "ms";
}
async function loadAutomations() {
  try {
    const data = await getJSON("/cron/jobs");
    const tbody = $("autoTable")?.querySelector("tbody");
    if (!tbody) return;
    const jobs = data.jobs || [];
    if ($("autoStatus")) $("autoStatus").textContent = `${jobs.length} jobs`;
    tbody.innerHTML = jobs
      .map((j) => {
        const deliv = j.delivery
          ? typeof j.delivery === "string" ? j.delivery : j.delivery.channel || "custom"
          : j.sessionKey || (j.payload?.kind ? j.payload.kind : j.payload?.message ? "announce" : "log");
        const lastCls = j.lastStatus === "ok" ? "on" : j.lastStatus === "error" ? "danger" : "";
        const last = j.lastRunAt
          ? `<span class="pill ${lastCls}">${esc(j.lastStatus || "ran")}</span> ${new Date(j.lastRunAt).toLocaleTimeString()}`
          : "—";
        return `<tr>
          <td><b>${esc(j.name || j.id)}</b><br /><span class="muted" style="font-size:0.7rem;">${esc((j.id || "").slice(0, 12))}</span></td>
          <td>${esc(autoSchedFmt(j.schedule, j.intervalMs))}</td>
          <td>${j.enabled !== false ? '<span class="pill on">on</span>' : '<span class="pill">off</span>'}</td>
          <td style="font-size:0.75rem;">${esc(String(deliv))}</td>
          <td style="font-size:0.7rem;">${last}</td>
          <td style="font-size:0.7rem;">${j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : "—"}</td>
          <td class="row" style="gap:0.25rem;">
            <button class="btn ghost auto-run" data-id="${esc(j.id)}">Run now</button>
            <button class="btn ghost auto-del" data-id="${esc(j.id)}" title="delete">×</button>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="7" class="muted">No automations yet — create one above.</td></tr>`;
    tbody.querySelectorAll(".auto-run").forEach((b) => {
      b.onclick = async () => {
        try {
          const r = await postJSON("/cron/jobs/" + encodeURIComponent(b.dataset.id) + "/run", {});
          $("autoOut").textContent = JSON.stringify(r, null, 2);
          await loadAutomations();
        } catch (e) { $("autoOut").textContent = String(e.message || e); }
      };
    });
    tbody.querySelectorAll(".auto-del").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("Delete this automation?")) return;
        try {
          await getJSON("/cron/jobs/" + encodeURIComponent(b.dataset.id), { method: "DELETE" });
          $("autoOut").textContent = "deleted " + b.dataset.id;
          await loadAutomations();
        } catch (e) { $("autoOut").textContent = String(e.message || e); }
      };
    });
  } catch (e) {
    const tbody = $("autoTable")?.querySelector("tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}

$("btnAutoCreate")?.addEventListener("click", async () => {
  const name = $("autoName").value.trim();
  const sched = $("autoSchedule").value.trim();
  if (!name || !sched) {
    $("autoOut").textContent = "name and schedule are required";
    return;
  }
  const body = { name, enabled: true };
  if (/^\d+$/.test(sched)) body.intervalMs = Number(sched);
  else body.schedule = sched;
  const msg = $("autoMsg").value.trim();
  if (msg) body.payload = { message: msg };
  const sk = $("autoSessionKey").value.trim();
  if (sk) body.sessionKey = sk;
  try {
    const r = await postJSON("/cron/jobs", body);
    $("autoOut").textContent = JSON.stringify(r, null, 2);
    $("autoName").value = ""; $("autoSchedule").value = ""; $("autoMsg").value = "";
    await loadAutomations();
  } catch (e) { $("autoOut").textContent = String(e.message || e); }
});
$("btnAutoRefresh")?.addEventListener("click", () => loadAutomations().catch(console.error));

async function loadAutoLogs() {
  try {
    const data = await getJSON("/cron/logs?lines=60");
    const events = (data.cronEvents?.tail || []).join("\n");
    $("autoLogOut").textContent = events || "(no cron events yet)";
  } catch (e) { $("autoLogOut").textContent = String(e.message || e); }
}
$("btnAutoLogs")?.addEventListener("click", () => loadAutoLogs().catch(console.error));
if ($("autoTable")) { loadAutomations().catch(() => {}); loadAutoLogs().catch(() => {}); }

/* ── Alerts + PagerDuty ──────────────────────────────────────────── */
async function loadAlerts() {
  try {
    const st = await getJSON("/alerts/status");
    const sinks = st.sinks || st.channels || {};
    const rows = [["Enabled", String(st.enabled ?? true), st.enabled === false ? "warn" : "good"]];
    for (const [k, v] of Object.entries(sinks)) {
      const on = v === true || v?.enabled || v?.configured;
      rows.push([k, on ? "configured" : "off", on ? "good" : ""]);
    }
    if (st.lastAlertAt) rows.push(["Last alert", new Date(st.lastAlertAt).toLocaleString()]);
    $("alertStatusKv").innerHTML = kvHtml(rows);
  } catch (e) {
    $("alertStatusKv").innerHTML = kvHtml([["Error", esc(e.message || e), "bad"]]);
  }
  try {
    const h = await getJSON("/alerts/history?limit=25");
    const tbody = $("alertHistTable")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = (h.history || [])
        .map((a) => `<tr>
          <td style="font-size:0.7rem;">${a.at ? new Date(a.at).toLocaleString() : "—"}</td>
          <td><span class="pill${a.severity === "critical" || a.severity === "error" ? " danger" : a.severity === "warning" ? " warn" : ""}">${esc(a.severity || "—")}</span></td>
          <td>${esc(a.title || a.summary || "—")}</td>
          <td style="font-size:0.7rem;">${esc(Array.isArray(a.sinks || a.sent) ? (a.sinks || a.sent).map((s) => s.sink || s).join(", ") : String(a.sinks || "—"))}</td>
        </tr>`)
        .join("") || `<tr><td colspan="4" class="muted">No alerts recorded.</td></tr>`;
    }
  } catch { /* history optional */ }
}
$("btnAlertRefresh")?.addEventListener("click", () => loadAlerts().catch(console.error));
$("btnAlertTest")?.addEventListener("click", async () => {
  try {
    const r = await postJSON("/alerts/test", {
      title: $("alertTitle").value.trim() || "Test alert",
      severity: $("alertSeverity").value,
      body: "Manual test fired from the Control UI",
    });
    $("alertOut").textContent = JSON.stringify(r, null, 2);
    await loadAlerts();
  } catch (e) { $("alertOut").textContent = String(e.message || e); }
});
const PD_HINTS = {
  no_api_token: "PagerDuty is not configured — set alerts.pagerduty.apiToken to use this.",
  not_configured: "PagerDuty is not configured.",
  disabled: "PagerDuty alerting is disabled in config.",
};
const pdShow = (p) => async () => {
  $("pdOut").textContent = "loading…";
  try {
    const out = await getJSON(p);
    const hint = out && out.ok === false ? PD_HINTS[String(out.reason || "")] : null;
    $("pdOut").textContent = hint || JSON.stringify(out, null, 2);
  } catch (e) {
    $("pdOut").textContent = String(e.message || e);
  }
};
$("btnPdSetup")?.addEventListener("click", pdShow("/alerts/pd/setup"));
$("btnPdPolicies")?.addEventListener("click", pdShow("/alerts/pd/policies"));
$("btnPdServices")?.addEventListener("click", pdShow("/alerts/pd/services"));
$("btnPdLevels")?.addEventListener("click", pdShow("/alerts/pd/levels"));
$("btnPdLevelsDiff")?.addEventListener("click", pdShow("/alerts/pd/levels?mode=diff"));
$("btnPdHooks")?.addEventListener("click", pdShow("/webhooks/pagerduty/recent"));
if ($("alertStatusKv")) loadAlerts().catch(() => {});

/* ── Skills (catalog + proposals) ────────────────────────────────── */
async function loadSkillCatalog() {
  try {
    const data = await getJSON("/skills");
    const tbody = $("sklTable")?.querySelector("tbody");
    const skills = data.skills || [];
    if ($("sklStatus")) $("sklStatus").textContent = `${skills.length} skills loaded`;
    if (tbody) {
      tbody.innerHTML = skills
        .map((s) => `<tr>
          <td><b>${esc(s.name)}</b></td>
          <td>${esc(s.description || "—")}</td>
          <td style="font-size:0.7rem;" class="muted">${esc((s.path || "").replace(/^\/root/, "~"))}</td>
        </tr>`)
        .join("") || `<tr><td colspan="3" class="muted">No skills installed.</td></tr>`;
    }
  } catch (e) {
    if ($("sklStatus")) $("sklStatus").textContent = String(e.message || e);
  }
  try {
    const st = await getJSON("/skills/stats");
    const rows = Object.values(st.skills || {});
    $("sklStatsOut").textContent = rows.length
      ? rows.map((s) => `${s.name} v${s.version} · rate=${((s.successRate || 0) * 100).toFixed(0)}% · runs=${s.runs}`).join("\n")
      : "No skill outcomes recorded yet.";
  } catch (e) { $("sklStatsOut").textContent = String(e.message || e); }
}
async function loadSkillProposals() {
  try {
    const data = await getJSON("/skills/proposals");
    const tbody = $("sklPropTable")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data.proposals || [])
      .map((p) => `<tr>
        <td><code>${esc(p.file)}</code></td>
        <td style="font-size:0.7rem;">${p.mtime ? new Date(p.mtime).toLocaleString() : "—"}</td>
        <td class="row" style="gap:0.25rem;">
          <button class="btn primary skl-install" data-file="${esc(p.file)}">Install</button>
          <button class="btn ghost skl-reject" data-file="${esc(p.file)}">Reject</button>
        </td>
      </tr>`)
      .join("") || `<tr><td colspan="3" class="muted">No proposals waiting for review.</td></tr>`;
    tbody.querySelectorAll(".skl-install").forEach((b) => {
      b.onclick = async () => {
        try {
          const r = await postJSON("/skills/proposals/decide", { file: b.dataset.file, action: "install" });
          $("sklOut").textContent = JSON.stringify(r, null, 2);
          await loadSkillProposals(); await loadSkillCatalog();
        } catch (e) { $("sklOut").textContent = String(e.message || e); }
      };
    });
    tbody.querySelectorAll(".skl-reject").forEach((b) => {
      b.onclick = async () => {
        const reason = prompt("Reason for rejecting (optional):") || "";
        try {
          const r = await postJSON("/skills/proposals/decide", { file: b.dataset.file, action: "reject", reason });
          $("sklOut").textContent = JSON.stringify(r, null, 2);
          await loadSkillProposals();
        } catch (e) { $("sklOut").textContent = String(e.message || e); }
      };
    });
  } catch (e) {
    const tbody = $("sklPropTable")?.querySelector("tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnSklRefresh")?.addEventListener("click", () => {
  loadSkillCatalog().catch(console.error);
  loadSkillProposals().catch(console.error);
});
if ($("sklTable")) { loadSkillCatalog().catch(() => {}); loadSkillProposals().catch(() => {}); }

/* ── MCP servers (config CRUD + OAuth + live test) ───────────────── */
async function loadMcpServers() {
  const tbody = $("mcpSrvTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/mcp/servers");
    const list = data.servers || [];
    tbody.innerHTML = list
      .map((s) => {
        const creds = [
          s.hasApiKey ? '<span class="pill on">apikey</span>' : "",
          s.hasOAuth
            ? `<span class="pill on" title="expires ${s.oauthExpiresAt ? new Date(s.oauthExpiresAt).toLocaleString() : "never"}">oauth</span>`
            : "",
        ].filter(Boolean).join(" ") ||
          (s.transport === "stdio"
            ? '<span class="pill">local</span>'
            : '<span class="pill">none</span>');
        const filters = [
          s.allowTools?.length ? `allow: ${s.allowTools.join(", ")}` : "",
          s.denyTools?.length ? `deny: ${s.denyTools.join(", ")}` : "",
        ].filter(Boolean).join(" · ") || "—";
        return `<tr data-srv="${esc(s.name)}">
          <td><b>${esc(s.name)}</b><br /><span class="muted" style="font-size:0.7rem;">${esc(s.url || s.command || "")}</span></td>
          <td><span class="pill">${esc(s.transport)}</span></td>
          <td>${creds}</td>
          <td style="font-size:0.75rem;">${esc(filters)}</td>
          <td class="row" style="gap:0.25rem;flex-wrap:wrap;">
            <button class="btn ghost mcp-srv-test" data-srv="${esc(s.name)}">Test</button>
            ${s.transport === "http" ? `<button class="btn ghost mcp-srv-oauth" data-srv="${esc(s.name)}">OAuth login</button>` : ""}
            <button class="btn ghost mcp-srv-del" data-srv="${esc(s.name)}" title="remove">×</button>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="5" class="muted">No MCP servers configured — add one above.</td></tr>`;

    tbody.querySelectorAll(".mcp-srv-test").forEach((b) => {
      b.onclick = async () => {
        $("mcpSrvOut").textContent = `testing ${b.dataset.srv}…`;
        try {
          const r = await postJSON("/mcp/servers/test", { name: b.dataset.srv });
          $("mcpSrvOut").textContent = JSON.stringify(r, null, 2);
        } catch (e) { $("mcpSrvOut").textContent = String(e.message || e); }
      };
    });
    tbody.querySelectorAll(".mcp-srv-del").forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`Remove MCP server "${b.dataset.srv}"?`)) return;
        try {
          await getJSON("/mcp/servers", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: b.dataset.srv }),
          });
          await loadMcpServers(); await loadMcpTools();
        } catch (e) { $("mcpSrvOut").textContent = String(e.message || e); }
      };
    });
    tbody.querySelectorAll(".mcp-srv-oauth").forEach((b) => {
      b.onclick = async () => {
        const flow = $("mcpOauthFlow");
        flow.style.display = "block";
        flow.textContent = `discovering authorization server for ${b.dataset.srv}…`;
        try {
          const start = await postJSON("/mcp/oauth/start", { server: b.dataset.srv });
          window.open(start.authorizeUrl, "_blank", "noopener");
          flow.innerHTML =
            `A sign-in tab opened — approve access there. The server authorizes automatically when the callback lands. ` +
            `<a href="${esc(start.authorizeUrl)}" target="_blank" rel="noopener">reopen login</a>`;
          // poll for the grant landing via the callback
          for (let i = 0; i < 90; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const st = await getJSON("/mcp/oauth/status").catch(() => ({ grants: [] }));
            if (st.grants?.some((g) => g.server === b.dataset.srv)) {
              flow.textContent = `${b.dataset.srv}: authorized ✓`;
              await loadMcpServers(); await loadMcpTools();
              return;
            }
          }
          flow.textContent = `${b.dataset.srv}: still waiting — reopen the login and approve, then Refresh.`;
        } catch (e) {
          flow.textContent = `OAuth: ${e.message || e}`;
        }
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnMcpSrvRefresh")?.addEventListener("click", () => loadMcpServers().catch(console.error));
$("btnMcpSrvAdd")?.addEventListener("click", async () => {
  const name = $("mcpSrvName").value.trim();
  const target = $("mcpSrvUrl").value.trim();
  if (!name || !target) { $("mcpSrvOut").textContent = "name and url/command are required"; return; }
  const def = { name };
  if (/^https?:\/\//i.test(target)) def.url = target;
  else {
    const parts = target.split(/\s+/);
    def.command = parts[0];
    if (parts.length > 1) def.args = parts.slice(1);
  }
  const key = $("mcpSrvKey").value.trim();
  if (key) def.apiKey = key;
  const allow = $("mcpSrvAllow").value.trim();
  if (allow) def.allowTools = allow.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const r = await postJSON("/mcp/servers", def);
    $("mcpSrvKey").value = ""; // never keep the secret in the DOM
    $("mcpSrvOut").textContent = JSON.stringify(r, null, 2);
    $("mcpSrvName").value = ""; $("mcpSrvUrl").value = ""; $("mcpSrvAllow").value = "";
    await loadMcpServers(); await loadMcpTools();
  } catch (e) { $("mcpSrvOut").textContent = String(e.message || e); }
});
if ($("mcpSrvTable")) loadMcpServers().catch(() => {});

/* ── MCP ─────────────────────────────────────────────────────────── */
async function loadMcpTools() {
  const tbody = $("mcpTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/mcp/tools");
    const tools = data.tools || [];
    if ($("mcpCount")) $("mcpCount").textContent = `${tools.length} tools`;
    tbody.innerHTML = tools
      .map((t) => `<tr class="mcp-row" data-name="${esc(t.name)}" style="cursor:pointer;" title="click to load into call console">
        <td><b>${esc(t.name)}</b>${t.server ? `<br /><span class="muted" style="font-size:0.7rem;">${esc(t.server)}</span>` : ""}</td>
        <td style="font-size:0.8rem;">${esc((t.description || "—").slice(0, 140))}</td>
      </tr>`)
      .join("") || `<tr><td colspan="2" class="muted">No MCP tools — add servers under <code>mcp.servers</code> in xclaw.json, then reload config.</td></tr>`;
    tbody.querySelectorAll(".mcp-row").forEach((tr) => {
      tr.onclick = () => {
        $("mcpToolName").value = tr.dataset.name;
        $("mcpOut").textContent = "→ " + tr.dataset.name + " loaded — fill arguments and Call";
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="2" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnMcpRefresh")?.addEventListener("click", () => loadMcpTools().catch(console.error));
$("btnMcpCall")?.addEventListener("click", async () => {
  const name = $("mcpToolName").value.trim();
  if (!name) { $("mcpOut").textContent = "pick a tool first"; return; }
  let args = {};
  try { args = JSON.parse($("mcpArgs").value || "{}"); }
  catch (e) { $("mcpOut").textContent = "arguments JSON invalid: " + e.message; return; }
  $("mcpOut").textContent = "calling…";
  try {
    const r = await postJSON("/mcp/call", { name, arguments: args });
    $("mcpOut").textContent = JSON.stringify(r, null, 2);
  } catch (e) { $("mcpOut").textContent = String(e.message || e); }
});
if ($("mcpTable")) loadMcpTools().catch(() => {});

/* MCP resources & prompts browser */
function mcpResRender(rows, kind) {
  const tbody = $("mcpResTable")?.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = rows
    .map((r) => {
      if (r.error) {
        return `<tr><td>${esc(r.server)}</td><td colspan="2" class="muted">${esc(r.error)}</td></tr>`;
      }
      const label = kind === "resource" ? r.uri || r.name : r.name;
      return `<tr>
        <td>${esc(r.server)}</td>
        <td><b>${esc(r.name || "")}</b> <span class="muted" style="font-size:0.7rem;">${esc(r.uri || r.description || "")}</span></td>
        <td><button class="btn ghost mcp-res-open" data-kind="${kind}" data-server="${esc(r.server)}" data-ref="${esc(label)}">${kind === "resource" ? "Read" : "Get"}</button></td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="3" class="muted">none exposed</td></tr>`;
  tbody.querySelectorAll(".mcp-res-open").forEach((b) => {
    b.onclick = async () => {
      $("mcpResOut").textContent = "loading…";
      try {
        const out =
          b.dataset.kind === "resource"
            ? await postJSON("/mcp/resources/read", { server: b.dataset.server, uri: b.dataset.ref })
            : await postJSON("/mcp/prompts/get", { server: b.dataset.server, name: b.dataset.ref });
        $("mcpResOut").textContent = JSON.stringify(out, null, 2).slice(0, 8000);
      } catch (e) { $("mcpResOut").textContent = String(e.message || e); }
    };
  });
}
$("btnMcpRes")?.addEventListener("click", async () => {
  try { mcpResRender((await getJSON("/mcp/resources")).resources || [], "resource"); }
  catch (e) { $("mcpResOut").textContent = String(e.message || e); }
});
$("btnMcpPrompts")?.addEventListener("click", async () => {
  try { mcpResRender((await getJSON("/mcp/prompts")).prompts || [], "prompt"); }
  catch (e) { $("mcpResOut").textContent = String(e.message || e); }
});

/* ── Images (media jobs) ─────────────────────────────────────────── */
function mediaRenderResult(job) {
  const img = $("mediaImg");
  const wrap = $("mediaImgWrap");
  const first = job?.result?.images?.[0];
  if (first && (first.b64 || first.url)) {
    img.src = first.b64 ? "data:image/png;base64," + first.b64 : first.url;
    wrap.style.display = "block";
  } else {
    wrap.style.display = "none";
  }
  $("mediaOut").textContent = JSON.stringify(
    { id: job.id, status: job.status, provider: job.result?.provider, model: job.result?.model, error: job.error, attempts: job.attempts },
    null, 2
  );
}
async function loadMediaProviders() {
  try {
    const data = await getJSON("/media/providers");
    const provs = data.providers || [];
    $("mediaProvKv").innerHTML = kvHtml(
      provs.length
        ? provs.map((p) => [p.id, esc(p.defaultModel || (p.models || []).join(", ") || "ready"), "good"])
        : [["Image providers", "none registered — add an xAI/OpenAI-style key in Providers", "warn"]]
    );
    const sel = $("mediaProvider");
    if (sel) {
      sel.innerHTML = `<option value="">auto provider</option>` +
        provs.map((p) => `<option value="${esc(p.id)}">${esc(p.id)}</option>`).join("");
    }
  } catch (e) {
    $("mediaProvKv").innerHTML = kvHtml([["Error", esc(e.message || e), "bad"]]);
  }
}
async function loadMediaJobs() {
  const tbody = $("mediaJobsTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/media/jobs");
    const jobs = (data.jobs || []).slice().reverse();
    tbody.innerHTML = jobs
      .map((j) => `<tr>
        <td style="font-size:0.7rem;">${j.createdAt ? new Date(j.createdAt).toLocaleString() : "—"}</td>
        <td><span class="pill${j.status === "done" ? " on" : j.status === "error" ? " danger" : ""}">${esc(j.status)}</span></td>
        <td>${esc((j.prompt || "—").slice(0, 60))}</td>
        <td><button class="btn ghost media-view" data-id="${esc(j.id)}">View</button></td>
      </tr>`)
      .join("") || `<tr><td colspan="4" class="muted">No image jobs yet.</td></tr>`;
    tbody.querySelectorAll(".media-view").forEach((b) => {
      b.onclick = async () => {
        try { mediaRenderResult(await getJSON("/media/jobs/" + encodeURIComponent(b.dataset.id))); }
        catch (e) { $("mediaOut").textContent = String(e.message || e); }
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnMediaGen")?.addEventListener("click", async () => {
  const prompt = $("mediaPrompt").value.trim();
  if (!prompt) { $("mediaOut").textContent = "enter a prompt"; return; }
  $("btnMediaGen").disabled = true;
  $("mediaOut").textContent = "generating…";
  try {
    const body = { type: "image", prompt };
    if ($("mediaProvider").value) body.provider = $("mediaProvider").value;
    if ($("mediaModel").value.trim()) body.model = $("mediaModel").value.trim();
    const job = await postJSON("/media/jobs", body);
    mediaRenderResult(job);
    await loadMediaJobs();
  } catch (e) { $("mediaOut").textContent = String(e.message || e); }
  finally { $("btnMediaGen").disabled = false; }
});
$("btnMediaJobs")?.addEventListener("click", () => loadMediaJobs().catch(console.error));
if ($("mediaProvKv")) { loadMediaProviders().catch(() => {}); loadMediaJobs().catch(() => {}); }

/* ── Sessions + transcripts ──────────────────────────────────────── */
async function loadSessAdmin() {
  const tbody = $("sessTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/sessions");
    const list = data.sessions || [];
    if ($("sessCount")) $("sessCount").textContent = `${list.length} live`;
    tbody.innerHTML = list
      .map((s) => `<tr>
        <td style="font-size:0.7rem;"><code>${esc((s.id || "").slice(0, 12))}</code></td>
        <td style="font-size:0.75rem;">${esc(s.sessionKey || "—")}</td>
        <td>${esc(s.channel || "—")}</td>
        <td style="font-size:0.7rem;" title="${s.updatedAt ? esc(new Date(s.updatedAt).toLocaleString()) : ""}">${fmtWhen(s.updatedAt)}</td>
      </tr>`)
      .join("") || `<tr><td colspan="4" class="muted">No live sessions (they appear as channels talk).</td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnSessRefresh")?.addEventListener("click", () => loadSessAdmin().catch(console.error));
$("btnSessNew")?.addEventListener("click", async () => {
  try {
    const s = await postJSON("/sessions", {});
    $("sessOut").textContent = JSON.stringify(s, null, 2);
    await loadSessAdmin();
  } catch (e) { $("sessOut").textContent = String(e.message || e); }
});
$("btnSessBind")?.addEventListener("click", async () => {
  const channel = $("bindChannel").value.trim();
  const peerId = $("bindPeer").value.trim();
  const sessionId = $("bindSession").value.trim();
  if (!channel || !peerId || !sessionId) {
    $("sessOut").textContent = "channel, peerId and sessionId are all required";
    return;
  }
  try {
    const r = await postJSON("/sessions/bind", { channel, peerId, sessionId });
    $("sessOut").textContent = JSON.stringify(r, null, 2);
    await loadSessAdmin();
  } catch (e) { $("sessOut").textContent = String(e.message || e); }
});
async function loadTranscripts() {
  const tbody = $("trTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/transcripts");
    const list = (data.transcripts || []).slice().sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));
    tbody.innerHTML = list
      .slice(0, 40)
      .map((t) => `<tr>
        <td style="font-size:0.75rem;"><code>${esc((t.sessionId || "").slice(0, 24))}</code></td>
        <td>${t.bytes != null ? (t.bytes / 1024).toFixed(1) + " KB" : "—"}</td>
        <td style="font-size:0.7rem;">${t.mtime ? new Date(t.mtime).toLocaleString() : "—"}</td>
        <td><button class="btn ghost tr-view" data-id="${esc(t.sessionId)}">Read</button></td>
      </tr>`)
      .join("") || `<tr><td colspan="4" class="muted">No transcripts recorded yet.</td></tr>`;
    tbody.querySelectorAll(".tr-view").forEach((b) => {
      b.onclick = async () => {
        $("trOut").textContent = "loading…";
        try {
          const d = await getJSON("/transcripts/" + encodeURIComponent(b.dataset.id) + "?limit=60");
          $("trOut").textContent = (d.history || [])
            .map((m) => `[${m.role || m.type || "?"}] ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`.slice(0, 500))
            .join("\n\n") || "(empty transcript)";
        } catch (e) { $("trOut").textContent = String(e.message || e); }
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnTrRefresh")?.addEventListener("click", () => loadTranscripts().catch(console.error));
if ($("sessTable")) { loadSessAdmin().catch(() => {}); loadTranscripts().catch(() => {}); }

/* ── Subagents ───────────────────────────────────────────────────── */
async function loadSubagents() {
  const tbody = $("saTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/subagents");
    const list = (data.subagents || []).slice().reverse();
    if ($("saCount")) $("saCount").textContent = `${list.length} tracked`;
    tbody.innerHTML = list
      .map((s) => `<tr>
        <td style="font-size:0.7rem;"><code>${esc((s.id || "").slice(0, 12))}</code></td>
        <td><span class="pill${s.status === "done" || s.ok ? " on" : s.status === "error" ? " danger" : ""}">${esc(s.status || (s.ok ? "done" : "—"))}</span></td>
        <td>${esc((s.task || "").slice(0, 56))}</td>
        <td style="font-size:0.7rem;">${s.startedAt || s.at ? new Date(s.startedAt || s.at).toLocaleString() : "—"}</td>
        <td><button class="btn ghost sa-view" data-id="${esc(s.id)}">View</button></td>
      </tr>`)
      .join("") || `<tr><td colspan="5" class="muted">No subagents spawned yet.</td></tr>`;
    tbody.querySelectorAll(".sa-view").forEach((b) => {
      b.onclick = async () => {
        try {
          const d = await getJSON("/subagents/" + encodeURIComponent(b.dataset.id));
          $("saOut").textContent = JSON.stringify(d, null, 2);
          $("saMergeId").value = b.dataset.id;
        } catch (e) { $("saOut").textContent = String(e.message || e); }
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnSaRefresh")?.addEventListener("click", () => loadSubagents().catch(console.error));
$("btnSaSpawn")?.addEventListener("click", async () => {
  const task = $("saTask").value.trim();
  if (!task) { $("saOut").textContent = "enter a task"; return; }
  $("btnSaSpawn").disabled = true;
  $("saOut").textContent = "spawning… (runs the task to completion)";
  try {
    const body = { task };
    const turns = Number($("saTurns").value.trim());
    if (turns > 0) body.maxTurns = turns;
    const r = await postJSON("/subagents/spawn", body);
    $("saOut").textContent = JSON.stringify(r, null, 2);
    $("saTask").value = "";
    await loadSubagents();
  } catch (e) { $("saOut").textContent = String(e.message || e); }
  finally { $("btnSaSpawn").disabled = false; }
});
$("btnSaMerge")?.addEventListener("click", async () => {
  const subagentId = $("saMergeId").value.trim();
  if (!subagentId) { $("saOut").textContent = "enter a subagent id (View fills it)"; return; }
  try {
    const r = await postJSON("/subagents/merge", { subagentId, checkOnly: $("saCheckOnly").checked });
    $("saOut").textContent = JSON.stringify(r, null, 2);
  } catch (e) { $("saOut").textContent = String(e.message || e); }
});
if ($("saTable")) loadSubagents().catch(() => {});

/* ── Mission Control (autonomous engineering) ────────────────────── */
let msnSelected = null;

const MSN_STATUS_CLS = {
  done: " on", merge_ready: " on", verifying: " warn", repairing: " warn",
  executing: " warn", planning: " warn", merging: " warn",
  failed: " danger", interrupted: " danger", rolled_back: "",
};

const OBJ_STATUS_CLS = { running: " ok", done: " ok", awaiting_human: " warn", interrupted: " warn", paused_budget: " warn", failed: " err", stopped: "" };
async function loadObjectivesCard() {
  const tbody = $("objTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/objectives");
    const list = data.objectives || [];
    if ($("objCount")) {
      const attn = list.filter((o) => ["awaiting_human", "interrupted", "paused_budget"].includes(o.status)).length;
      $("objCount").textContent = `${list.length} missions${attn ? ` · ${attn} need attention` : ""}`;
    }
    tbody.innerHTML = list.slice(0, 12)
      .map((o) => `<tr>
        <td><span class="pill${OBJ_STATUS_CLS[o.status] ?? ""}">${esc(o.status)}</span></td>
        <td title="${esc(o.objective)}">${esc(o.objective.slice(0, 52))}${o.humanQuestion ? `<div class="muted" style="font-size:0.72rem;">❓ ${esc(o.humanQuestion.slice(0, 60))}</div>` : ""}</td>
        <td>${o.segments}</td><td>${o.toolCalls}</td>
        <td>${o.criteriaDone}/${o.criteriaTotal}</td>
        <td style="font-size:0.72rem;" class="muted">${esc((o.currentSubtask || "").slice(0, 40))}</td>
        <td>${o.status === "running"
          ? `<button class="btn ghost obj-stop" data-id="${esc(o.id)}">Stop</button>`
          : ["awaiting_human", "interrupted", "paused_budget", "stopped"].includes(o.status)
            ? `<button class="btn ghost obj-resume" data-id="${esc(o.id)}">Resume</button>`
            : ""}</td>
      </tr>`)
      .join("") || `<tr><td colspan="7" class="muted">No long-run objectives yet — start one with /objective in chat or POST /objectives.</td></tr>`;
    tbody.querySelectorAll(".obj-stop").forEach((b) =>
      b.addEventListener("click", async () => {
        await fetch("/objectives/" + encodeURIComponent(b.dataset.id) + "/stop", { method: "POST" });
        loadObjectivesCard().catch(() => {});
      })
    );
    tbody.querySelectorAll(".obj-resume").forEach((b) =>
      b.addEventListener("click", async () => {
        await fetch("/objectives/" + encodeURIComponent(b.dataset.id) + "/resume", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        loadObjectivesCard().catch(() => {});
      })
    );
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">objectives unavailable: ${esc(e.message || String(e))}</td></tr>`;
  }
}

async function loadMissions() {
  const tbody = $("msnTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/missions");
    const list = data.missions || [];
    if ($("msnCount")) {
      const active = list.filter((x) => x.running).length;
      $("msnCount").textContent = `${list.length} missions · ${active} active`;
    }
    tbody.innerHTML = list
      .map((mi) => `<tr class="msn-row" data-id="${esc(mi.id)}" style="cursor:pointer;">
        <td><span class="pill${MSN_STATUS_CLS[mi.status] ?? ""}">${esc(mi.status)}</span>${mi.running ? ' <span class="pill warn">live</span>' : ""}</td>
        <td title="${esc(mi.goal)}">${esc(mi.goal.slice(0, 56))}</td>
        <td style="font-size:0.72rem;" class="muted">${esc((mi.repoDir || "").split("/").slice(-2).join("/"))}</td>
        <td>${mi.attempts}/${mi.maxAttempts}</td>
        <td style="font-size:0.72rem;">${esc((mi.lastEvent?.note || "").slice(0, 48))}</td>
        <td><button class="btn ghost msn-open" data-id="${esc(mi.id)}">Open</button></td>
      </tr>`)
      .join("") || `<tr><td colspan="6" class="muted">No missions yet — launch one above.</td></tr>`;
    tbody.querySelectorAll(".msn-open").forEach((b) => {
      b.onclick = (ev) => { ev.stopPropagation(); openMission(b.dataset.id); };
    });
    tbody.querySelectorAll(".msn-row").forEach((tr) => {
      tr.onclick = () => openMission(tr.dataset.id);
    });
    if (msnSelected) await openMission(msnSelected, { silent: true });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}

async function openMission(id, { silent } = {}) {
  msnSelected = id;
  try {
    const m = await getJSON("/missions/" + encodeURIComponent(id));
    const card = $("cardMissionDetail");
    card.style.display = "block";
    $("msnDetailTitle").textContent = m.goal.slice(0, 90);
    $("msnDetailStatus").textContent = m.status + (m.running ? " · live" : "");
    $("msnDetailStatus").className = "pill" + (MSN_STATUS_CLS[m.status] ?? "");
    $("msnDetailKv").innerHTML = kvHtml([
      ["Repo", m.repoDir],
      ["Workspace", m.worktree ? m.worktree.branch : "—"],
      ["Attempts", `${m.attempts}/${m.maxAttempts}`],
      ["Verified", m.verify?.history?.length ? (m.verify.history.at(-1).ok ? "yes" : "no") : "—",
        m.verify?.history?.at(-1)?.ok ? "good" : "warn"],
      ["Strategy", (m.strategy || "solo") + (m.swarm?.runId ? ` · run ${m.swarm.runId.slice(0, 14)}` : "")],
      ["Swarm nodes", m.swarm?.nodes?.length
        ? m.swarm.nodes.map((n) => `${n.id}(${n.role})${n.ok ? "✓" : n.status === "skipped" ? "→skip" : "✗"}${n.merged ? "·merged" : ""}`).join("  ")
        : "—"],
      ["Diff", m.diff ? `${m.diff.patchChars} chars` : "—"],
      ["New files", m.diff?.untracked?.length ? m.diff.untracked.join(", ").slice(0, 200) : "—"],
      ["Excluded", m.diff?.excludedUntracked?.length
        ? `${m.diff.excludedUntracked.length} artifact(s) won't merge: ${m.diff.excludedUntracked.join(", ").slice(0, 160)}`
        : "—"],
      ["Agent runs", String((m.agentRuns || []).length)],
    ]);
    $("msnVerify").textContent = (m.verify?.history || [])
      .map((h) => `[${h.at.slice(11, 19)}] attempt ${h.attempt}: ${h.ok ? "PASS" : "FAIL"} — ${h.summary}`)
      .join("\n") +
      "\n\n" +
      (m.verify?.results || [])
        .map((r) => `$ ${r.cmd}\n${r.pass ? "PASS" : "FAIL (exit " + r.exitCode + ")"}\n${(r.output || "").slice(-1200)}`)
        .join("\n\n") || "—";
    $("msnPlan").textContent = m.plan?.summary || "—";
    $("msnEvents").querySelector("tbody").innerHTML = (m.events || [])
      .slice()
      .reverse()
      .map((e) => `<tr>
        <td style="font-size:0.7rem;">${esc((e.at || "").slice(11, 19))}</td>
        <td><span class="pill">${esc(e.phase)}</span></td>
        <td style="font-size:0.78rem;">${esc(e.note)}</td>
      </tr>`)
      .join("");
    $("btnMsnMerge").disabled = m.status !== "merge_ready";
    $("btnMsnResume").disabled = !["interrupted", "failed", "merge_ready"].includes(m.status) || m.running;
    $("btnMsnRollback").disabled = ["done", "rolled_back"].includes(m.status);
    $("btnMsnDiff").disabled = !m.diff;
    if (!silent) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    $("msnDetailKv").innerHTML = kvHtml([["Error", esc(e.message || e), "bad"]]);
  }
}

// ── Remote workers (mission federation)
async function loadWorkers() {
  try {
    const r = await getJSON("/missions/workers");
    const tbody = $("mwTable").querySelector("tbody");
    tbody.innerHTML = (r.workers || [])
      .map((w) => `<tr>
        <td>${esc(w.name)}</td>
        <td style="font-size:0.72rem;">${esc(w.url)}</td>
        <td><span class="pill${w.ping?.ok ? " good" : " bad"}">${w.ping?.ok ? "reachable" : esc(w.ping?.error || "unreachable").slice(0, 30)}</span></td>
        <td>${esc(w.ping?.version || "—")}</td>
        <td>
          <button class="btn ghost mw-show" data-w="${esc(w.name)}">Missions</button>
          <button class="btn ghost mw-del" data-w="${esc(w.name)}">Remove</button>
        </td>
      </tr>`)
      .join("") || `<tr><td colspan="5" class="muted">no workers configured</td></tr>`;
    // launch-target selector mirrors the worker list
    const sel = $("msnTarget");
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = `<option value="local">local</option>` +
        (r.workers || []).map((w) => `<option value="${esc(w.name)}">${esc(w.name)}</option>`).join("");
      if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    }
    tbody.querySelectorAll(".mw-del").forEach((b) => b.addEventListener("click", async () => {
      await fetch("/missions/workers/" + encodeURIComponent(b.dataset.w), { method: "DELETE" });
      await loadWorkers();
    }));
    tbody.querySelectorAll(".mw-show").forEach((b) => b.addEventListener("click", () => showWorkerMissions(b.dataset.w)));
  } catch (e) {
    $("mwStatus").textContent = String(e.message || e).slice(0, 50);
  }
}
async function showWorkerMissions(name) {
  try {
    const r = await getJSON("/missions/remote/" + encodeURIComponent(name));
    $("mwMissionsWrap").style.display = "block";
    $("mwMissionsTitle").textContent = `missions on ${name}`;
    const tbody = $("mwMissionsTable").querySelector("tbody");
    tbody.innerHTML = (r.missions || [])
      .map((m) => `<tr>
        <td><span class="pill${MSN_STATUS_CLS[m.status] ?? ""}">${esc(m.status)}</span></td>
        <td style="font-size:0.78rem;">${esc((m.goal || "").slice(0, 70))}</td>
        <td>${m.verified ? "✓" : "—"}</td>
        <td>
          ${m.status === "merge_ready" ? `<button class="btn mw-merge" data-w="${esc(name)}" data-id="${esc(m.id)}">Merge</button>` : ""}
          ${!["done", "rolled_back"].includes(m.status) ? `<button class="btn ghost mw-rb" data-w="${esc(name)}" data-id="${esc(m.id)}">Rollback</button>` : ""}
        </td>
      </tr>`)
      .join("") || `<tr><td colspan="4" class="muted">no missions on ${esc(name)}</td></tr>`;
    tbody.querySelectorAll(".mw-merge").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Merge on worker ${b.dataset.w}?`)) return;
      await postJSON(`/missions/remote/${encodeURIComponent(b.dataset.w)}/${encodeURIComponent(b.dataset.id)}/merge`, {});
      await showWorkerMissions(b.dataset.w);
    }));
    tbody.querySelectorAll(".mw-rb").forEach((b) => b.addEventListener("click", async () => {
      await postJSON(`/missions/remote/${encodeURIComponent(b.dataset.w)}/${encodeURIComponent(b.dataset.id)}/rollback`, {});
      await showWorkerMissions(b.dataset.w);
    }));
  } catch (e) {
    $("mwStatus").textContent = String(e.message || e).slice(0, 50);
  }
}
$("btnMwAdd")?.addEventListener("click", async () => {
  const name = $("mwName").value.trim();
  const url = $("mwUrl").value.trim();
  const token = $("mwToken").value;
  if (!name || !url) {
    $("mwStatus").textContent = "name + url required";
    return;
  }
  try {
    const r = await postJSON("/missions/workers", { name, url, token: token || undefined });
    $("mwStatus").textContent = r.ok ? "added" : r.error;
    if (r.ok) {
      $("mwName").value = ""; $("mwUrl").value = ""; $("mwToken").value = "";
      await loadWorkers();
    }
  } catch (e) {
    $("mwStatus").textContent = String(e.message || e).slice(0, 50);
  }
});
if (document.getElementById("cardMissionWorkers")) loadWorkers();

// ── Point & Prompt: pick an element from the running app, launch a pinned mission
let ppPicked = null;
$("btnPpPick")?.addEventListener("click", async () => {
  $("ppStatus").textContent = "picking… click an element in the app tab";
  $("btnPpPick").disabled = true;
  try {
    const body = {};
    const url = $("ppUrl").value.trim();
    if (url) body.url = url;
    const r = await postJSON("/point/pick", body);
    if (r.cancelled) {
      $("ppStatus").textContent = "cancelled";
    } else if (r.ok) {
      ppPicked = r.element;
      $("ppStatus").textContent = `picked <${r.element.tag}> ${r.element.selector || ""}`.slice(0, 60);
      $("ppElement").textContent = JSON.stringify(r.element, null, 1);
      // preview resolved source locations when repo is set
      const repoDir = $("ppRepo").value.trim();
      if (repoDir) {
        const rr = await postJSON("/point/resolve", { repoDir, element: ppPicked });
        if (rr.ok && rr.matches.length) {
          $("ppElement").textContent += "\n\nresolved:\n" + rr.matches.map((m) => `${m.file}:${m.line} [${m.score}] ${m.matchedOn.join(",")}`).join("\n");
        }
      }
      $("btnPpLaunch").disabled = false;
    } else {
      $("ppStatus").textContent = r.error || "pick failed";
    }
  } catch (e) {
    $("ppStatus").textContent = String(e.message || e).slice(0, 60);
  } finally {
    $("btnPpPick").disabled = false;
  }
});
$("btnPpLaunch")?.addEventListener("click", async () => {
  const repoDir = $("ppRepo").value.trim();
  const prompt = $("ppPrompt").value.trim();
  if (!ppPicked || !repoDir || !prompt) {
    $("ppStatus").textContent = "pick an element + repo + prompt first";
    return;
  }
  $("btnPpLaunch").disabled = true;
  try {
    const strategy = $("ppStrategy")?.value === "swarm" ? "swarm" : undefined;
    const r = await postJSON("/point/mission", { repoDir, element: ppPicked, prompt, strategy });
    if (r.ok) {
      $("ppStatus").textContent = "mission " + r.mission.id.slice(0, 14);
      await loadMissions();
      await openMission(r.mission.id);
    } else {
      $("ppStatus").textContent = r.error || "launch failed";
    }
  } catch (e) {
    $("ppStatus").textContent = String(e.message || e).slice(0, 60);
  } finally {
    $("btnPpLaunch").disabled = false;
  }
});

$("btnMsnStart")?.addEventListener("click", async () => {
  const goal = $("msnGoal").value.trim();
  const repoDir = $("msnRepo").value.trim();
  if (!goal || !repoDir) {
    $("msnLive").textContent = "goal + repo required";
    return;
  }
  $("btnMsnStart").disabled = true;
  try {
    const strategy = $("msnStrategy")?.value === "swarm" ? "swarm" : undefined;
    const target = $("msnTarget")?.value || "local";
    if (target !== "local") {
      const r = await postJSON("/missions/remote", { worker: target, goal, repoDir, strategy });
      $("msnGoal").value = "";
      $("msnLive").textContent = r.ok ? `launched on ${target}: ${(r.mission.id || "").slice(0, 12)}` : r.error;
      if (r.ok) await showWorkerMissions(target);
    } else {
      const r = await postJSON("/missions", { goal, repoDir, strategy });
      $("msnGoal").value = "";
      $("msnLive").textContent = "launched " + r.mission.id.slice(0, 12);
      await loadMissions();
      await openMission(r.mission.id);
    }
  } catch (e) {
    $("msnLive").textContent = String(e.message || e).slice(0, 60);
  } finally {
    $("btnMsnStart").disabled = false;
  }
});
$("btnMsnRefresh")?.addEventListener("click", () => loadMissions());
$("btnMsnMerge")?.addEventListener("click", async () => {
  if (!msnSelected) return;
  if (!confirm("Merge the verified changes into the repository?")) return;
  try {
    const r = await postJSON(`/missions/${encodeURIComponent(msnSelected)}/merge`, {});
    $("msnLive").textContent = r.ok ? "merged ✓" : `merge: ${r.merge?.error || r.merge?.code || "failed"}`;
    await loadMissions();
  } catch (e) { $("msnLive").textContent = String(e.message || e).slice(0, 60); }
});
$("btnMsnResume")?.addEventListener("click", async () => {
  if (!msnSelected) return;
  try {
    await postJSON(`/missions/${encodeURIComponent(msnSelected)}/resume`, {});
    $("msnLive").textContent = "resuming";
    await loadMissions();
  } catch (e) { $("msnLive").textContent = String(e.message || e).slice(0, 60); }
});
$("btnMsnRollback")?.addEventListener("click", async () => {
  if (!msnSelected) return;
  if (!confirm("Discard this mission's workspace? The repository stays untouched.")) return;
  try {
    await postJSON(`/missions/${encodeURIComponent(msnSelected)}/rollback`, {});
    $("msnLive").textContent = "rolled back";
    await loadMissions();
  } catch (e) { $("msnLive").textContent = String(e.message || e).slice(0, 60); }
});
$("btnMsnDiff")?.addEventListener("click", async () => {
  if (!msnSelected) return;
  try {
    const d = await getJSON(`/missions/${encodeURIComponent(msnSelected)}/diff`);
    $("msnDiff").textContent = (d.stat ? d.stat + "\n\n" : "") + (d.patch || "(empty diff)");
  } catch (e) { $("msnDiff").textContent = String(e.message || e); }
});
if ($("msnTable")) {
  loadMissions().catch(() => {});
  loadObjectivesCard().catch(() => {});
  // live refresh straight from mission WS events + a slow safety poll
  setInterval(() => {
    if (location.hash.includes("missions")) { loadMissions().catch(() => {}); loadObjectivesCard().catch(() => {}); }
  }, 10_000);
}

/* ── Hooks (lifecycle hook system) ───────────────────────────────── */
async function loadHooks() {
  try {
    const data = await getJSON("/hooks");
    if ($("hkStatus")) {
      $("hkStatus").textContent = data.enabled
        ? `${data.hooks.length} hooks · on`
        : "disabled";
    }
    // per-category toggles
    const tg = $("hkToggles");
    if (tg) {
      tg.innerHTML = (data.categoriesAll || [])
        .map((c) => {
          const on = data.categories[c] !== false;
          return `<button class="chip hk-tgl${on ? " active" : ""}" data-cat="${esc(c)}" title="toggle ${esc(c)}">${esc(c)}</button>`;
        })
        .join("");
      tg.querySelectorAll(".hk-tgl").forEach((b) => {
        b.onclick = async () => {
          const on = b.classList.contains("active");
          try {
            await postJSON("/hooks/toggle", { category: b.dataset.cat, enabled: !on });
            await loadHooks();
          } catch (e) { $("hkOut").textContent = String(e.message || e); }
        };
      });
    }
    const tbody = $("hkTable")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = (data.hooks || [])
        .map((h) => `<tr>
          <td><span class="pill">${esc(h.category)}</span></td>
          <td><b>${esc(h.name)}</b></td>
          <td><span class="pill${h.tier === "system" ? " danger" : h.tier === "trusted" ? " warn" : ""}">${esc(h.tier)}</span></td>
          <td style="font-size:0.75rem;">${esc(h.matcher || "*")}</td>
          <td class="muted" style="font-size:0.75rem;">${esc(h.source || "code")}</td>
        </tr>`)
        .join("") || `<tr><td colspan="5" class="muted">No hooks registered — add a command hook below or declare modules in xclaw.json.</td></tr>`;
    }
    const ev = $("hkEvent");
    if (ev && !ev.options.length) {
      ev.innerHTML = (data.categoriesAll || [])
        .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
        .join("");
    }
    const ct = $("hkCmdTable")?.querySelector("tbody");
    if (ct) {
      ct.innerHTML = (data.commands || [])
        .map((c) => `<tr>
          <td><b>${esc(c.name)}</b></td>
          <td>${esc(c.event)}${c.matcher ? ` <span class="muted" style="font-size:0.7rem;">${esc(c.matcher)}</span>` : ""}</td>
          <td>${esc(c.tier)}</td>
          <td style="font-size:0.75rem;"><code>${esc((c.command || "").slice(0, 60))}</code></td>
          <td><button class="btn ghost hk-cmd-del" data-name="${esc(c.name)}">×</button></td>
        </tr>`)
        .join("") || `<tr><td colspan="5" class="muted">No command hooks configured.</td></tr>`;
      ct.querySelectorAll(".hk-cmd-del").forEach((b) => {
        b.onclick = async () => {
          if (!confirm(`Remove command hook "${b.dataset.name}"?`)) return;
          try {
            await getJSON("/hooks/commands", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: b.dataset.name }),
            });
            await loadHooks();
          } catch (e) { $("hkOut").textContent = String(e.message || e); }
        };
      });
    }
  } catch (e) {
    if ($("hkOut")) $("hkOut").textContent = String(e.message || e);
  }
}
async function loadHookHistory() {
  const tbody = $("hkHistTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/hooks/history?limit=60");
    tbody.innerHTML = (data.history || [])
      .slice()
      .reverse()
      .map((h) => `<tr>
        <td style="font-size:0.7rem;">${h.at ? new Date(h.at).toLocaleTimeString() : "—"}</td>
        <td><span class="pill${h.event === "executed" ? (h.ok === false ? " danger" : " on") : ""}">${esc(h.event)}</span></td>
        <td>${esc(h.category || "—")}</td>
        <td>${esc(h.name || h.path || "—")}</td>
        <td>${esc(h.tier || "—")}</td>
        <td>${h.ms != null ? h.ms : "—"}</td>
        <td style="font-size:0.72rem;" class="muted">${esc(
          [h.error, h.mutated ? "mutated:" + h.mutated.join(",") : "", h.decision ? "decision:" + h.decision : "", h.aborted ? "aborted" : "", h.requested ? `clamped ${h.requested}→${h.capped}` : ""]
            .filter(Boolean).join(" · ")
        )}</td>
      </tr>`)
      .join("") || `<tr><td colspan="7" class="muted">No hook activity yet.</td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnHkRefresh")?.addEventListener("click", () => { loadHooks(); loadHookHistory(); });
$("btnHkHist")?.addEventListener("click", () => loadHookHistory());
$("btnHkAdd")?.addEventListener("click", async () => {
  const body = {
    name: $("hkName").value.trim() || undefined,
    event: $("hkEvent").value,
    command: $("hkCommand").value.trim(),
    matcher: $("hkMatcher").value.trim() || undefined,
    tier: $("hkTier").value,
  };
  if (!body.command) { $("hkOut").textContent = "command required"; return; }
  try {
    const r = await postJSON("/hooks/commands", body);
    $("hkOut").textContent = JSON.stringify(r, null, 2);
    $("hkName").value = ""; $("hkCommand").value = ""; $("hkMatcher").value = "";
    await loadHooks();
  } catch (e) { $("hkOut").textContent = String(e.message || e); }
});
if ($("hkTable")) { loadHooks().catch(() => {}); loadHookHistory().catch(() => {}); }

/* ── Memory viewer ───────────────────────────────────────────────── */
async function loadMemoryFilesUi() {
  const tbody = $("memTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/memory?full=1");
    const files = data.files || [];
    tbody.innerHTML = files
      .map((f, i) => `<tr class="mem-row" data-i="${i}" style="cursor:pointer;" title="click to read">
        <td><b>${esc(f.name)}</b></td>
        <td>${Number(f.chars).toLocaleString()}</td>
        <td style="font-size:0.7rem;" class="muted">${esc((f.path || "").replace(/^\/root/, "~"))}</td>
      </tr>`)
      .join("") || `<tr><td colspan="3" class="muted">No memory files found for the gateway working dir.</td></tr>`;
    tbody.querySelectorAll(".mem-row").forEach((tr) => {
      tr.onclick = () => {
        const f = files[Number(tr.dataset.i)];
        $("memOut").textContent = f?.body || f?.preview || "(empty)";
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}
$("btnMemRefresh")?.addEventListener("click", () => loadMemoryFilesUi().catch(console.error));
if ($("memTable")) loadMemoryFilesUi().catch(() => {});

/* ── Health & Ops additions: doctor record + config reload ───────── */
$("btnDoctorRecord")?.addEventListener("click", async () => {
  const el = $("doctorOut");
  el.textContent = "running doctor (recorded)…";
  try {
    const r = await postJSON("/doctor/run", { notifyOnFail: false });
    el.textContent = JSON.stringify(r, null, 2);
    el.className = r.report?.ok ? "good" : "bad";
  } catch (e) { el.textContent = String(e.message || e); el.className = "bad"; }
});
$("btnCfgReload")?.addEventListener("click", async () => {
  const el = $("doctorOut");
  el.textContent = "reloading config…";
  try {
    const r = await postJSON("/config/reload", {});
    el.textContent = JSON.stringify(r, null, 2);
    el.className = r.ok === false ? "bad" : "good";
  } catch (e) { el.textContent = String(e.message || e); el.className = "bad"; }
});

// ——— Kill switch ——————————————————————————————————————————————————————
// POST /stop existed and worked, but the operator console had no button for it:
// the most safety-critical control was CLI-only.

async function runStop(dryRun) {
  const out = $("stopOut");
  if (out) {
    out.classList.remove("placeholder");
    out.textContent = dryRun ? "dry run…" : "stopping…";
  }
  try {
    const r = await fetch("/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dryRun ? { dryRun: true } : {}),
    });
    const j = await r.json();
    const drain = j.drain || {};
    const lines = [
      dryRun ? "DRY RUN — nothing was stopped" : "STOPPED",
      `sessions before : ${drain.sessionsBefore ?? "—"}`,
      `sessions killed : ${drain.sessionsKilled ?? 0}`,
      `websockets      : ${drain.wsClosed ?? 0}`,
      `sse subscribers : ${drain.sseClosed ?? 0}`,
      `auth            : ${j.authMethod || "—"}`,
    ];
    if (out) out.textContent = lines.join("\n");
  } catch (e) {
    if (out) out.textContent = `failed: ${e.message || e}`;
  }
}

if ($("btnStopDry")) $("btnStopDry").onclick = () => runStop(true);
if ($("btnStopAll")) {
  $("btnStopAll").onclick = () => {
    if (!confirm("Abort every running agent session and drain all streams?")) return;
    runStop(false);
  };
}

// ——— Ledger ————————————————————————————————————————————————————————————

function ledgerSummary(ev) {
  const d = ev?.data || {};
  if (ev?.kind === "tool") {
    const arg = d.argsSummary || d.command || d.path || "";
    return `${d.name || "tool"}${arg ? " · " + String(arg).slice(0, 60) : ""}${d.status ? " → " + d.status : ""}`;
  }
  return String(d.summary || d.message || d.goal || d.name || ev?.kind || "").slice(0, 80);
}

async function loadLedger() {
  try {
    const stats = await getJSON("/ledger/stats");
    const kv = $("ledgerStats");
    if (kv) {
      const w = stats.writer || {};
      kv.innerHTML = [
        ["Segments", stats.segments ?? "—"],
        ["Days", `${stats.firstDay || "—"} → ${stats.lastDay || "—"}`],
        ["Size", stats.bytes != null ? `${(stats.bytes / 1024 / 1024).toFixed(2)} MB` : "—"],
        ["Writer", w.enabled ? "on" : "off"],
        ["Append errors", w.appendErrors ?? 0],
      ]
        .map(([k, v]) => `<div><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`)
        .join("");
    }
  } catch (e) {
    const kv = $("ledgerStats");
    if (kv) kv.innerHTML = `<div><span class="k muted">${esc(e.message || e)}</span><span class="v"></span></div>`;
  }

  const tbody = $("ledgerTable")?.querySelector("tbody");
  if (!tbody) return;
  try {
    const data = await getJSON("/ledger?limit=60");
    const events = (data.events || []).slice().reverse();
    tbody.innerHTML = "";
    if (!events.length) showEmptyRow(tbody, "No ledger events yet");
    for (const ev of events) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td style="font-size:0.7rem;" title="${esc(ev.ts || "")}">${esc(fmtWhen(ev.ts))}</td>` +
        `<td><span class="pill">${esc(ev.kind || "—")}</span></td>` +
        `<td style="font-size:0.75rem;">${esc(ev.actor || "—")}</td>` +
        `<td style="font-size:0.75rem;">${esc(ledgerSummary(ev))}</td>`;
      tr.onclick = () => {
        const out = $("ledgerOut");
        if (out) {
          out.classList.remove("placeholder");
          out.textContent = JSON.stringify(ev, null, 2);
        }
      };
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}

async function loadWhoTouched() {
  const tbody = $("whoTable")?.querySelector("tbody");
  if (!tbody) return;
  const path = ($("whoPath")?.value || "").trim();
  if (!path) {
    tbody.innerHTML = "";
    showEmptyRow(tbody, "Enter a path to look up");
    return;
  }
  tbody.innerHTML = `<tr><td colspan="4" class="muted">searching…</td></tr>`;
  try {
    const data = await getJSON(`/ledger/who-touched?path=${encodeURIComponent(path)}`);
    const hits = data.hits || [];
    tbody.innerHTML = "";
    if (!hits.length) showEmptyRow(tbody, `Nothing in the ledger touched ${path}`);
    for (const h of hits.slice(-100).reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td style="font-size:0.7rem;" title="${esc(h.ts || "")}">${esc(fmtWhen(h.ts))}</td>` +
        `<td style="font-size:0.75rem;">${esc(h.via || "—")}</td>` +
        `<td><span class="pill ${h.status === "ok" ? "ok" : "warn"}">${esc(h.status || "—")}</span></td>` +
        `<td style="font-size:0.7rem;"><code>${esc((h.ids?.sessionId || "").slice(0, 14))}</code></td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message || e)}</td></tr>`;
  }
}

if ($("btnLedgerRefresh")) $("btnLedgerRefresh").onclick = () => loadLedger();
if ($("btnWhoTouched")) $("btnWhoTouched").onclick = () => loadWhoTouched();
if ($("whoPath")) {
  $("whoPath").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadWhoTouched();
  });
}
if ($("ledgerTable")) loadLedger().catch(() => {});
