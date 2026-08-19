/**
 * `xclaw tui` — full-screen conversational terminal UI.
 *
 * Shaped after the Claude Code TUI: a mascot header carrying version/model/cwd,
 * an accent notice line, a scrolling transcript that renders tool calls inline,
 * and a ruled input block pinned to the bottom with a status footer.
 *
 * Talks to the RUNNING gateway over HTTP (`/agent/run/stream`, NDJSON) rather
 * than in-process state — `xclaw status` calls `listActiveSessions()` inside the
 * CLI process, which is why it always reports 0 active sessions.
 *
 * Zero dependencies — plain ANSI, same rule as the Control UI.
 */

const ESC = "\u001b";
const KEY_CTRL_C = "\u0003";
const KEY_BACKSPACE = "\u007f";

const C = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  grey: `${ESC}[90m`,
  accent: `${ESC}[38;5;203m`,
};

const DOT_ON = "●";
const DOT_OFF = "○";
const MARK = "⏺";
const ELBOW = "⎿";
const CHEV = "⏵";

/** Small XClaw mark, sized to sit beside the header's meta lines. */
const MASCOT = [" ▄▖  ▗▄ ", " ▜█▀▀█▛ ", "  ▀▄▄▀  ", "  ▘  ▝  "];

function paint(text, colour, enabled) {
  return enabled === false ? String(text) : `${colour}${text}${C.reset}`;
}

function gatewayBase(cfg = {}) {
  const host = cfg.gateway?.host || "127.0.0.1";
  const port = cfg.gateway?.port || 18790;
  return `http://${host}:${port}`;
}

async function getJson(url, token, timeoutMs = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: await res.json() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/** Fetch everything the status view renders. Never throws. */
export async function collectTuiSnapshot(cfg = {}, opts = {}) {
  const base = opts.base || gatewayBase(cfg);
  const token = opts.token ?? cfg.gateway?.token ?? null;
  const [info, ready, sessions, approvals, cost, channels] = await Promise.all([
    getJson(`${base}/info`, token),
    getJson(`${base}/ready`, token),
    getJson(`${base}/sessions`, token),
    getJson(`${base}/approvals`, token),
    getJson(`${base}/tokens/cost`, token),
    getJson(`${base}/channels/status`, token),
  ]);
  return {
    at: new Date().toISOString(),
    base,
    up: Boolean(info.ok),
    info: info.body || null,
    ready: ready.body || null,
    sessions: sessions.body?.sessions || [],
    approvals: approvals.body?.pending || [],
    cost: cost.body || null,
    channels: channels.body || null,
    errors: [info, ready, sessions, approvals, cost, channels]
      .filter((r) => !r.ok)
      .map((r) => r.error || `HTTP ${r.status}`),
  };
}

function relTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function row(label, value, dim = (t) => t) {
  return `  ${dim(label.padEnd(10))}${value}`;
}

/**
 * Status view — snapshot in, frame out. Pure, so it can be asserted on without
 * a running gateway. Reachable as `xclaw tui --status` and `/status`.
 */
export function renderTuiFrame(snap = {}, opts = {}) {
  const colour = opts.colour !== false;
  const p = (t, c) => paint(t, c, colour);
  const ok = (t) => p(t, C.green);
  const bad = (t) => p(t, C.red);
  const dim = (t) => p(t, C.grey);

  const lines = [];
  const version = snap.info?.version || "?";
  const clock = new Date(snap.at || Date.now()).toISOString().slice(11, 19);
  lines.push(`  ${p(`XClaw ${version}`, C.bold)}${dim(`   ${snap.base || ""}`)}${dim(`   ${clock}`)}`);
  lines.push("");

  if (!snap.up) {
    lines.push(`  ${bad(`${DOT_OFF} gateway unreachable`)} ${dim(snap.base || "")}`);
    if (snap.errors?.length) lines.push(dim(`  ${snap.errors[0]}`));
    lines.push("");
    lines.push(dim("  start it with:  xclaw gateway"));
    lines.push("");
    return lines.join("\n");
  }

  const readyOk = snap.ready?.ready !== false;
  lines.push(row("gateway", readyOk ? ok(`${DOT_ON} ready`) : bad(`${DOT_OFF} not ready`), dim));

  const comp = snap.info?.computer || {};
  const compUp = comp.healthy === true || comp.running === true || comp.up === true;
  lines.push(
    row("computer", compUp ? ok(`${DOT_ON} running`) : dim(`${DOT_OFF} stopped`), dim) +
      dim(comp.port ? `   :${comp.port}` : "")
  );

  const agent = snap.info?.agent || {};
  const model = agent.model || agent.modelRef || "";
  const provider = agent.provider || "";
  const turns = agent.maxTurns != null ? dim(`   maxTurns ${agent.maxTurns}`) : "";
  lines.push(row("agent", `${provider ? provider + " · " : ""}${model || dim("—")}${turns}`, dim));
  lines.push("");

  const sessions = snap.sessions || [];
  lines.push(row("sessions", `${sessions.length} active`, dim));
  for (const s of sessions.slice(0, 5)) {
    const who = s.sessionKey || s.id || "";
    lines.push(
      `    ${dim((s.channel || "?").padEnd(9))}${String(who).slice(0, 34).padEnd(36)}${dim(relTime(s.updatedAt))}`
    );
  }
  if (sessions.length > 5) lines.push(dim(`    … ${sessions.length - 5} more`));
  lines.push("");

  const pending = snap.approvals || [];
  lines.push(
    row("approvals", pending.length ? p(`${pending.length} pending`, C.yellow) : `${pending.length} pending`, dim)
  );
  for (const a of pending.slice(0, 3)) {
    const cmd = a.args?.command || a.tool || "";
    lines.push(`    ${p(String(a.risk?.tier || "?").padEnd(9), C.yellow)}${String(cmd).slice(0, 46)}`);
  }

  const cost = snap.cost || {};
  const usd = cost.costUsdFormatted || (cost.costUsd != null ? `$${Number(cost.costUsd).toFixed(4)}` : "—");
  lines.push(row("cost", `${usd}${cost.runs != null ? dim(`   ${cost.runs} runs`) : ""}`, dim));
  lines.push("");

  const msg = snap.channels?.messaging || [];
  const chips = [];
  if (snap.channels?.webchat) {
    chips.push(snap.channels.webchat.enabled ? ok(`${DOT_ON} webchat`) : dim(`${DOT_OFF} webchat`));
  }
  for (const m of msg) {
    chips.push(m.enabled ? ok(`${DOT_ON} ${m.name}`) : dim(`${DOT_OFF} ${m.name}`));
  }
  if (chips.length) lines.push(row("channels", chips.join(dim(" · ")), dim));

  if (snap.errors?.length) {
    lines.push("");
    lines.push(dim(`  ${snap.errors.length} endpoint(s) unavailable: ${snap.errors[0]}`));
  }
  lines.push("");
  lines.push(dim(`  q quit · r refresh${opts.intervalMs ? ` · auto ${Math.round(opts.intervalMs / 1000)}s` : ""}`));
  lines.push("");
  return lines.join("\n");
}

/** Compact one-line summary of a tool call. */
export function formatToolCall(name, args = {}) {
  const a = args || {};
  const primary = a.command ?? a.path ?? a.file_path ?? a.url ?? a.query ?? a.goal ?? null;
  const inner = primary == null ? "" : String(primary).replace(/\s+/g, " ").slice(0, 68);
  return `${name}(${inner})`;
}

/** Wrap to width; continuation lines carry `indent`. */
export function wrapLine(text, width, indent = "") {
  const w = Math.max(8, width);
  const out = [];
  for (const raw of String(text).split("\n")) {
    let line = raw;
    if (!line) {
      out.push("");
      continue;
    }
    let first = true;
    while (line.length > w) {
      let cut = line.lastIndexOf(" ", w);
      if (cut <= 0) cut = w;
      out.push((first ? "" : indent) + line.slice(0, cut));
      line = line.slice(cut).replace(/^\s+/, "");
      first = false;
    }
    out.push((first ? "" : indent) + line);
  }
  return out;
}

/**
 * Render the whole chat screen. Pure: state in, lines out, so the layout can be
 * asserted without a terminal.
 */
export function renderChatScreen(state = {}, opts = {}) {
  const colour = opts.colour !== false;
  const cols = Math.max(40, opts.columns || 80);
  const rows = Math.max(14, opts.rows || 24);
  const p = (t, c) => paint(t, c, colour);
  const dim = (t) => p(t, C.grey);
  const acc = (t) => p(t, C.accent);

  const head = [];
  const meta = [
    `${p("XClaw", C.bold)} ${dim("v" + (state.version || "?"))}`,
    dim(`${state.model || "no model"}${state.profile ? " · " + state.profile : ""}`),
    dim(state.cwd || ""),
    "",
  ];
  for (let i = 0; i < MASCOT.length; i += 1) {
    head.push(`${acc(MASCOT[i])}${meta[i] ? "  " + meta[i] : ""}`);
  }
  head.push("");
  if (state.notice) head.push(` ${acc(CHEV)} ${state.notice}`);
  head.push("");

  const rule = dim("─".repeat(Math.max(10, cols - 2)));
  const caret = state.busy ? acc("…") : acc("▌");
  const typed = state.input || "";
  const room = Math.max(10, cols - 8);
  const shown = typed.length > room ? typed.slice(typed.length - room) : typed;
  const foot = [
    ` ${rule}`,
    ` ${caret} ${shown}${state.busy ? dim("  working…") : ""}`,
    ` ${rule}`,
    ` ${acc(CHEV + CHEV)} ${state.footer || dim("Enter send · /help · Ctrl+C quit")}`,
  ];

  const budget = Math.max(1, rows - head.length - foot.length - 1);
  const body = (state.transcript || []).slice(-budget);
  while (body.length < budget) body.push("");

  return [...head, ...body, ...foot];
}

export function tuiHelp() {
  return [
    "xclaw tui — conversational terminal UI for the gateway",
    "",
    "Usage:",
    "  xclaw tui [--status] [--once] [--json] [--no-colour]",
    "",
    "Options:",
    "  --status     operator dashboard instead of the chat UI",
    "  --once       render one frame and exit (status view)",
    "  --json       print the raw status snapshot and exit",
    "  --interval   status auto-refresh seconds (default 5)",
    "  --no-colour  disable ANSI colour",
    "  --help       show this help",
    "",
    "In the chat UI:",
    "  /status      gateway, sessions, approvals, cost",
    "  /clear       clear the transcript",
    "  /help        this help",
    "  /quit        exit (or Ctrl+C)",
  ].join("\n");
}

async function streamAgent(base, token, message, onEvent, signal) {
  const res = await fetch(`${base}/agent/run/stream`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, channel: "tui" }),
  });
  if (!res.ok || !res.body) return { ok: false, error: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if ((ev.type || ev.event) === "result") result = ev;
      onEvent(ev);
    }
  }
  return { ok: true, result };
}

export async function runTui(cfg = {}, opts = {}) {
  const args = opts.args || [];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(tuiHelp());
    return { ok: true, help: true };
  }
  const colour = !args.includes("--no-colour") && !args.includes("--no-color");
  const base = opts.base || gatewayBase(cfg);
  const token = opts.token ?? cfg.gateway?.token ?? null;

  if (args.includes("--json")) {
    console.log(JSON.stringify(await collectTuiSnapshot(cfg, opts), null, 2));
    return { ok: true, json: true };
  }
  if (args.includes("--once") || !process.stdout.isTTY) {
    const snap = await collectTuiSnapshot(cfg, opts);
    console.log(renderTuiFrame(snap, { colour, intervalMs: null }));
    return { ok: true, once: true, up: snap.up };
  }
  if (args.includes("--status")) {
    const iIdx = args.indexOf("--interval");
    const intervalMs = Math.max(
      1000,
      (iIdx >= 0 && Number(args[iIdx + 1]) > 0 ? Number(args[iIdx + 1]) : 5) * 1000
    );
    return statusLoop(cfg, opts, { colour, intervalMs });
  }
  return chatLoop(cfg, { ...opts, base, token, colour });
}

function enterRaw() {
  process.stdout.write(`${ESC}[?25l`);
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
  } catch {
    /* not a tty */
  }
  process.stdin.resume();
}

function leaveRaw(clear) {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* not a tty */
  }
  process.stdin.pause();
  process.stdout.write(`${ESC}[?25h` + (clear ? `${ESC}[2J${ESC}[H` : "\n"));
}

async function statusLoop(cfg, opts, { colour, intervalMs }) {
  let timer = null;
  let stopped = false;
  const draw = async () => {
    const snap = await collectTuiSnapshot(cfg, opts);
    if (stopped) return;
    process.stdout.write(`${ESC}[2J${ESC}[H` + renderTuiFrame(snap, { colour, intervalMs }) + "\n");
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    leaveRaw(false);
  };
  enterRaw();
  process.stdin.on("data", (b) => {
    const k = String(b);
    if (k === "q" || k === KEY_CTRL_C) {
      stop();
      process.exit(0);
    }
    if (k === "r") draw();
  });
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  await draw();
  timer = setInterval(draw, intervalMs);
  await new Promise(() => {});
  return { ok: true };
}

async function chatLoop(cfg, opts) {
  const { base, token, colour } = opts;
  const p = (t, c) => paint(t, c, colour);
  const dim = (t) => p(t, C.grey);
  const acc = (t) => p(t, C.accent);

  const info = await getJson(`${base}/info`, token);
  const approvals = await getJson(`${base}/approvals`, token);
  const agent = info.body?.agent || {};
  const pendingN = approvals.body?.pending?.length || 0;

  const state = {
    version: info.body?.version || "?",
    model: agent.provider ? `${agent.provider}/${agent.model || "?"}` : agent.model || "",
    profile: cfg.profile || "",
    cwd: process.cwd(),
    transcript: [],
    input: "",
    busy: false,
    notice: info.ok
      ? `${dim("gateway ready")}${pendingN ? p(` · ${pendingN} approval(s) pending`, C.yellow) : ""}`
      : p(`gateway unreachable at ${base} — start it with: xclaw gateway`, C.red),
    footer: dim("Enter send · /help · Ctrl+C quit"),
  };

  const cols = () => process.stdout.columns || 80;
  const rowsN = () => process.stdout.rows || 24;
  const push = (l) => state.transcript.push(l);
  const pushWrapped = (text, indent = "  ") => {
    for (const l of wrapLine(text, cols() - 4, indent)) push(l);
  };
  const draw = () => {
    const frame = renderChatScreen(state, { colour, columns: cols(), rows: rowsN() });
    process.stdout.write(`${ESC}[2J${ESC}[H` + frame.join("\n"));
  };

  const submit = async (text) => {
    state.busy = true;
    push("");
    pushWrapped(`${acc(">")} ${text}`);
    push("");
    draw();
    try {
      const out = await streamAgent(base, token, text, (ev) => {
        const kind = ev.type || ev.event;
        if (kind === "tool" && ev.phase === "start") {
          push(`${acc(MARK)} ${formatToolCall(ev.name, ev.args)}`);
          draw();
        } else if (kind === "tool" && (ev.phase === "end" || ev.phase === "result")) {
          const res = String(ev.preview ?? ev.resultText ?? ev.result ?? ev.text ?? "").trim();
          if (res) {
            const shown = wrapLine(res, cols() - 8, "     ").slice(0, 4);
            push(`  ${dim(ELBOW)} ${shown[0]}`);
            for (const extra of shown.slice(1)) push(`     ${dim(extra.trim())}`);
            draw();
          }
        } else if (kind === "security" && ev.phase === "pending") {
          push(p(`  ${ELBOW} approval required — approve in Telegram or the Control UI`, C.yellow));
          draw();
        }
      });
      const answer = out.result?.text || out.result?.finalText || "";
      push("");
      if (answer) pushWrapped(`${acc(MARK)} ${answer}`);
      else push(dim(`  ${ELBOW} ${out.error || "(no reply)"}`));
      const usd = out.result?.usage?.costUsd;
      state.footer = dim(
        `Enter send · /help · Ctrl+C quit${usd != null ? ` · last turn $${Number(usd).toFixed(4)}` : ""}`
      );
    } catch (e) {
      push(p(`  ${ELBOW} ${String(e?.message || e)}`, C.red));
    } finally {
      state.busy = false;
      draw();
    }
  };

  const slash = async (cmd) => {
    if (cmd === "/quit" || cmd === "/exit") {
      leaveRaw(true);
      process.exit(0);
    }
    if (cmd === "/clear") {
      state.transcript = [];
      return;
    }
    if (cmd === "/help") {
      push("");
      for (const l of tuiHelp().split("\n")) push(dim("  " + l));
      return;
    }
    if (cmd === "/status") {
      const snap = await collectTuiSnapshot(cfg, opts);
      push("");
      for (const l of renderTuiFrame(snap, { colour }).split("\n")) push(l);
      return;
    }
    push(dim(`  unknown command ${cmd} — try /help`));
  };

  enterRaw();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    for (const ch of String(chunk)) {
      if (ch === KEY_CTRL_C) {
        leaveRaw(true);
        process.exit(0);
      }
      if (state.busy) continue;
      if (ch === "\r" || ch === "\n") {
        const text = state.input.trim();
        state.input = "";
        if (!text) {
          draw();
          continue;
        }
        if (text.startsWith("/")) {
          await slash(text);
          draw();
          continue;
        }
        await submit(text);
        continue;
      }
      if (ch === KEY_BACKSPACE || ch === "\b") {
        state.input = state.input.slice(0, -1);
        draw();
        continue;
      }
      if (ch < " ") continue;
      state.input += ch;
      draw();
    }
  });
  process.on("SIGINT", () => {
    leaveRaw(true);
    process.exit(0);
  });
  process.stdout.on("resize", draw);
  draw();
  await new Promise(() => {});
  return { ok: true };
}

export default {
  runTui,
  collectTuiSnapshot,
  renderTuiFrame,
  renderChatScreen,
  formatToolCall,
  wrapLine,
  tuiHelp,
};
