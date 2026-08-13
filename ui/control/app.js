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
      ["Max messages", e.maxMessages ?? "—"],
      ["Max chars", e.maxChars ?? "—"],
      ["Tool max", e.toolMaxChars ?? "—"],
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
    const soft = g.limits?.dailySoftUsd;
    const hard = g.limits?.dailyHardUsd;
    const spent = g.spentUsd ?? 0;
    const softPct = soft ? Math.min(100, Math.round((spent / soft) * 100)) : 0;
    const el = $("costGov");
    if (el) {
      el.innerHTML = kvHtml([
        ["Spent today", `$${Number(spent).toFixed(4)}`, g.hard ? "bad" : g.soft ? "warn" : "ok"],
        ["Soft / Hard", `$${soft} / $${hard}`],
        ["Paused", String(Boolean(g.paused)), g.paused ? "bad" : "ok"],
        ["Jobs", g.jobs ?? "—"],
        ["Soft pressure", softPct + "%"],
      ]);
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
    const sum = data.summary || data;
    $("costSummary").innerHTML = kvHtml([
      ["Entries", sum.count ?? data.entries?.length ?? "—"],
      ["Total USD", sum.totalUsd != null ? `$${Number(sum.totalUsd).toFixed(6)}` : sum.totalFormatted || "—"],
      ["Ledger", sum.ledgerPath || data.ledgerPath || "—"],
    ]);
    const tbody = $("costTable").querySelector("tbody");
    const rows = data.entries || data.rows || data.recent || [];
    tbody.innerHTML = rows
      .slice()
      .reverse()
      .slice(0, 25)
      .map((e) => {
        const when = e.ts || e.time || e.at || "";
        const d = when ? new Date(when).toLocaleString() : "—";
        return `<tr>
          <td>${d}</td>
          <td>${e.model || "—"}</td>
          <td>${e.inputTokens ?? e.prompt_tokens ?? "—"}</td>
          <td>${e.outputTokens ?? e.completion_tokens ?? "—"}</td>
          <td>${e.cachedTokens ?? e.cached_tokens ?? "—"}</td>
          <td>${e.costUsd != null ? "$" + Number(e.costUsd).toFixed(6) : e.usd || "—"}</td>
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
          <td>${updated ? new Date(updated).toLocaleString() : "—"}</td>
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
let _evictES = null;
let _evictAttempt = 0;
let _evictLastId = "";
let _evictTimer = null;

function _evictBackoffMs(attempt) {
  const base = 1000;
  const max = 30000;
  const exp = Math.min(max, base * Math.pow(2, attempt));
  return Math.floor(Math.random() * exp);
}

function connectEvictionStream() {
  const status = $("evictLiveStatus");
  if (!status) return;
  if (_evictTimer) {
    clearTimeout(_evictTimer);
    _evictTimer = null;
  }
  try {
    if (_evictES) {
      try { _evictES.close(); } catch {}
      _evictES = null;
    }
    let url = "/events/eviction/stream";
    if (_evictLastId) {
      url += "?lastEventId=" + encodeURIComponent(_evictLastId);
    }
    status.textContent = _evictAttempt === 0 ? "connecting…" : ("reconnecting · try " + _evictAttempt);
    const es = new EventSource(url);
    _evictES = es;

    es.addEventListener("ready", (msg) => {
      _evictAttempt = 0;
      try {
        const j = JSON.parse(msg.data);
        status.textContent = j.resumedFrom
          ? ("live · resumed " + (j.replayed || 0))
          : "live";
      } catch {
        status.textContent = "live";
      }
    });
    es.addEventListener("eviction", (msg) => {
      if (msg.lastEventId) _evictLastId = msg.lastEventId;
      try {
        prependEvict(JSON.parse(msg.data));
        status.textContent = "live · " + new Date().toLocaleTimeString();
      } catch {}
    });
    es.onerror = () => {
      try { es.close(); } catch {}
      if (_evictES === es) _evictES = null;
      status.textContent = "reconnecting…";
      const delay = _evictBackoffMs(_evictAttempt);
      _evictAttempt += 1;
      _evictTimer = setTimeout(connectEvictionStream, delay);
    };
  } catch (err) {
    status.textContent = err.message;
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
        <td>${p.createdAt ? new Date(p.createdAt).toLocaleString() : "—"}</td>
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
        channels: ["admission", "queue", "eviction", "swarm", "all"],
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
        if (ch === "swarm" && typeof loadSwarmRuns === "function") {
          loadSwarmRuns().catch(() => {});
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
      ["autoApprove", String(p.autoApprove)],
      ["maxTurns", String(p.maxTurns ?? "—")],
      ["eval cron", p.evalCron?.enabled ? `on (${p.evalCron.everyMs || "?"}ms)` : "off"],
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


async function loadApprovals() {
  try {
    const pol = await getJSON("/security/policy").catch(() => ({}));
    if ($("aprPolicy")) {
      $("aprPolicy").textContent = pol.autoApprove
        ? "autoApprove ON"
        : `policy=${pol.approvalPolicy || "risky"} pending=${pol.pending ?? "—"}`;
    }
    const data = await getJSON("/security/pending");
    const tbody = $("aprTable")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    for (const p of data.pending || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.tool}</td><td>${(p.at || "").replace("T", " ").slice(0, 19)} ${p.remainingMs!=null?"("+Math.round(p.remainingMs/1000)+"s left)":""}</td>
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

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso).slice(0, 19);
  }
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
      <div class="prov-badges">${credBadges} ${envBadge} ${noCred}</div>
      <div class="prov-btnrow">
        <input type="password" class="prov-key" placeholder="paste API key…" autocomplete="off" />
        <button class="btn prov-key-save">Add</button>
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
  const running =
    ch.status && (ch.status.running || ch.status.ok)
      ? ` <span class="pill on">running</span>`
      : "";
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
