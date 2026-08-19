/**
 * `xclaw tui` — operator terminal dashboard.
 *
 * Reads the RUNNING gateway over HTTP rather than in-process state: sessions,
 * approvals and cost live in the gateway process, which is why `xclaw status`
 * reports 0 active sessions when run from a separate CLI process.
 *
 * Zero dependencies — plain ANSI, same as the Control UI's "zero deps" rule.
 */

const C = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  grey: "\u001b[90m",
};

const DOT_ON = "●";
const DOT_OFF = "○";

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

/** Fetch everything the dashboard renders. Never throws. */
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

/** `dim` is passed in so --no-colour really emits no ANSI, labels included. */
function row(label, value, dim = (t) => t) {
  return `  ${dim(label.padEnd(10))}${value}`;
}

/**
 * Pure renderer — a snapshot in, a frame out. Kept separate from the loop so
 * it can be asserted on without a running gateway.
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
    lines.push(`    ${dim((s.channel || "?").padEnd(9))}${String(who).slice(0, 34).padEnd(36)}${dim(relTime(s.updatedAt))}`);
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

export function tuiHelp() {
  return [
    "xclaw tui — operator dashboard (gateway, sessions, approvals, cost)",
    "",
    "Usage:",
    "  xclaw tui [--once] [--json] [--interval <seconds>] [--no-colour]",
    "",
    "Options:",
    "  --once            render a single frame and exit (non-interactive)",
    "  --json            print the raw snapshot as JSON and exit",
    "  --interval <s>    refresh interval, default 5",
    "  --no-colour       disable ANSI colour",
    "  --help            show this help",
    "",
    "Keys:  q or Ctrl-C quit · r refresh now",
  ].join("\n");
}

export async function runTui(cfg = {}, opts = {}) {
  const args = opts.args || [];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(tuiHelp());
    return { ok: true, help: true };
  }
  const colour = !args.includes("--no-colour") && !args.includes("--no-color");
  const iIdx = args.indexOf("--interval");
  const intervalMs = Math.max(
    1000,
    (iIdx >= 0 && Number(args[iIdx + 1]) > 0 ? Number(args[iIdx + 1]) : 5) * 1000
  );

  if (args.includes("--json")) {
    console.log(JSON.stringify(await collectTuiSnapshot(cfg, opts), null, 2));
    return { ok: true, json: true };
  }
  if (args.includes("--once") || !process.stdout.isTTY) {
    const snap = await collectTuiSnapshot(cfg, opts);
    console.log(renderTuiFrame(snap, { colour, intervalMs: null }));
    return { ok: true, once: true, up: snap.up };
  }

  let timer = null;
  let stopped = false;
  const draw = async () => {
    const snap = await collectTuiSnapshot(cfg, opts);
    if (stopped) return;
    process.stdout.write("\u001b[2J\u001b[H");
    process.stdout.write(renderTuiFrame(snap, { colour, intervalMs }) + "\n");
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      /* not a tty */
    }
    process.stdin.pause();
    process.stdout.write("\u001b[?25h");
  };

  process.stdout.write("\u001b[?25l");
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
  } catch {
    /* not a tty */
  }
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const k = String(buf);
    if (k === "q" || k === "") {
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

export default { runTui, collectTuiSnapshot, renderTuiFrame, tuiHelp };
