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
import { writeSync } from "node:fs";
import { gatewayBaseUrl } from "./gateway-client.mjs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripLiveScaffold } from "../agent/claims-scaffold.mjs";
import { isNewApprovalAsk } from "../security/approval-events.mjs";


const ESC = "\u001b";
const KEY_CTRL_C = "\u0003";
const KEY_BACKSPACE = "\u007f";
const KEY_CTRL_A = "\u0001";
const KEY_CTRL_E = "\u0005";
const KEY_CTRL_K = "\u000b";
const KEY_CTRL_U = "\u0015";
const KEY_CTRL_W = "\u0017";
const KEY_CTRL_D = "\u0004";
const KEY_CTRL_L = "\u000c";
const KEY_CTRL_R = "\u0012";

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
  const base = opts.base || gatewayBaseUrl(cfg);
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
    const indentCells = visibleWidth(indent);
    for (;;) {
      const budget = first ? w : Math.max(4, w - indentCells);
      if (visibleWidth(line) <= budget) break;
      // prefer a word break inside the cell budget; fall back to a hard cut
      const head = sliceCells(line, budget)[0];
      let cut = head.lastIndexOf(" ");
      if (cut <= 0) cut = head.length;
      out.push((first ? "" : indent) + line.slice(0, cut));
      line = line.slice(cut).replace(/^\s+/, "");
      first = false;
    }
    out.push((first ? "" : indent) + line);
  }
  return out;
}

/**
 * Minimal terminal markdown. Model replies are markdown; printing them raw left
 * literal `**bold**`, `#` headers and fence markers on screen.
 *
 * Deliberately small: headings, bullets, ordered lists, fenced and inline code,
 * bold/italic, and links reduced to their text. Anything else passes through.
 */
export function renderMarkdownLines(text, opts = {}) {
  const colour = opts.colour !== false;
  const width = Math.max(20, opts.width || 80);
  const b = (t) => (colour ? `${ESC}[1m${t}${ESC}[0m` : t);
  const dim = (t) => (colour ? `${C.grey}${t}${C.reset}` : t);
  const acc = (t) => (colour ? `${C.accent}${t}${C.reset}` : t);
  const code = (t) => (colour ? `${ESC}[38;5;180m${t}${ESC}[0m` : t);

  const inline = (s) => {
    let out = String(s);
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label) => label);
    out = out.replace(/`([^`]+)`/g, (_m, t) => code(t));
    out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t) => b(t));
    out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s.,;:)]|$)/g, (_m, pre, t) => pre + b(t));
    out = out.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s.,;:)]|$)/g, (_m, pre, t) => pre + b(t));
    return out;
  };

  const lines = [];
  let inFence = false;
  for (const raw of String(text ?? "").split("\n")) {
    const fence = raw.match(/^\s*```/);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(dim("  " + raw.replace(/\t/g, "  ")));
      continue;
    }
    if (!raw.trim()) {
      lines.push("");
      continue;
    }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      for (const l of wrapLine(inline(h[2]), width, "")) lines.push(acc(b(l)));
      continue;
    }
    const hr = raw.match(/^\s*([-*_])\1{2,}\s*$/);
    if (hr) {
      lines.push(dim("─".repeat(Math.min(width, 40))));
      continue;
    }
    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      const pad = bullet[1].length >= 2 ? "    " : "  ";
      const parts = wrapLine(inline(bullet[2]), width - pad.length - 2, "");
      lines.push(`${pad}${acc("•")} ${parts[0]}`);
      for (const rest of parts.slice(1)) lines.push(`${pad}  ${rest}`);
      continue;
    }
    const ordered = raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      const pad = ordered[1].length >= 2 ? "    " : "  ";
      const lead = `${ordered[2]}.`;
      const parts = wrapLine(inline(ordered[3]), width - pad.length - lead.length - 1, "");
      lines.push(`${pad}${acc(lead)} ${parts[0]}`);
      for (const rest of parts.slice(1)) lines.push(`${pad}${" ".repeat(lead.length + 1)}${rest}`);
      continue;
    }
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) {
      for (const l of wrapLine(inline(quote[1]), width - 2, "")) lines.push(dim("│ ") + l);
      continue;
    }
    for (const l of wrapLine(inline(raw.trim()), width, "")) lines.push(l);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Terminal cell width of a single code point. CJK, Hangul, and most emoji
 * occupy two cells; combining marks occupy none. Counting JavaScript string
 * length instead misaligns every rule, wrap and caret once such a character
 * appears.
 */
export function charWidth(cp) {
  if (cp === 0) return 0;
  // combining marks and variation selectors
  if ((cp >= 0x0300 && cp <= 0x036f) || cp === 0xfe0f || cp === 0x200d) return 0;
  if (cp < 0x1100) return 1;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals .. Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Printable cell count, ignoring SGR sequences and honouring wide glyphs. */
export function visibleWidth(text) {
  const s = String(text);
  let cells = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === ESC) {
      const m = s.slice(i + 1).match(/^\[[0-9;]*m/);
      if (m) {
        i += 1 + m[0].length;
        continue;
      }
    }
    const cp = s.codePointAt(i);
    cells += charWidth(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return cells;
}

/** Split plain text into segments of at most `w` terminal cells. */
export function sliceCells(text, w) {
  const s = String(text);
  const out = [];
  let cur = "";
  let cells = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (cells + cw > w) {
      out.push(cur);
      cur = "";
      cells = 0;
    }
    cur += ch;
    cells += cw;
    i += cp > 0xffff ? 2 : 1;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

/** Clamp a footer to the terminal width, counting only printable cells. */
export function fitToWidth(text, width) {
  const w = Math.max(8, width);
  // a string that already fits is returned untouched — no needless ellipsis
  if (visibleWidth(text) <= w) return String(text);
  let out = "";
  let cells = 0;
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    if (s[i] === ESC) {
      const m = s.slice(i + 1).match(/^\[[0-9;]*m/);
      if (m) {
        out += s[i] + m[0];
        i += 1 + m[0].length;
        continue;
      }
    }
    const cp = s.codePointAt(i);
    const cw = charWidth(cp);
    // reserve the last cell for the ellipsis so the result never exceeds `w`
    if (cells + cw > w - 1) {
      const needsReset = out.includes(ESC);
      return out + (needsReset ? C.reset : "") + "…";
    }
    out += String.fromCodePoint(cp);
    cells += cw;
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

/**
 * Split text into rows of at most `width` CELLS, keeping each row's offsets in
 * the source string. Character counting is not enough: one CJK glyph occupies
 * two cells, so a row measured in characters overflows the terminal and the
 * absolute-cursor repaint then writes over a line it does not own.
 */
export function chunkCells(text, width) {
  const w = Math.max(1, width);
  const s = String(text);
  const out = [];
  let start = 0;
  let cur = "";
  let cells = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const size = cp > 0xffff ? 2 : 1;
    const cw = charWidth(cp);
    if (cur && cells + cw > w) {
      out.push({ text: cur, from: start, to: i });
      start = i;
      cur = "";
      cells = 0;
    }
    cur += s.slice(i, i + size);
    cells += cw;
    i += size;
  }
  out.push({ text: cur, from: start, to: s.length });
  return out;
}

/** Character offset inside `text` that sits at terminal cell column `col`. */
export function indexAtCell(text, col) {
  const s = String(text);
  let cells = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const cw = charWidth(cp);
    if (cells + cw > col) break;
    cells += cw;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

/** Previous whole code point, so a surrogate pair is never bisected. */
export function prevCharIndex(text, i) {
  const s = String(text);
  const at = Math.min(Math.max(0, i), s.length);
  if (at <= 0) return 0;
  const cp = at >= 2 ? s.codePointAt(at - 2) : null;
  return at - (cp != null && cp > 0xffff ? 2 : 1);
}

/** Next whole code point. */
export function nextCharIndex(text, i) {
  const s = String(text);
  const at = Math.min(Math.max(0, i), s.length);
  if (at >= s.length) return s.length;
  return at + (s.codePointAt(at) > 0xffff ? 2 : 1);
}

/**
 * Lay the input buffer out as terminal rows.
 *
 * The buffer is no longer assumed to be one short line: a paste or Alt+Enter
 * can put newlines in it, and wide glyphs cost two cells. Rows are split on
 * newlines, wrapped by cells, and then windowed so the caret is always on a
 * visible row. Returns the caret's row/column in that window.
 */
export function layoutInput(input, cursor, width, maxRows = 6) {
  const s = String(input ?? "");
  const w = Math.max(4, width);
  const caret = Math.min(Math.max(0, cursor ?? s.length), s.length);
  const all = [];
  let cursorRowAbs = 0;
  let cursorCol = 0;
  let found = false;
  let base = 0;
  for (const logical of s.split("\n")) {
    for (const c of chunkCells(logical, w)) {
      const from = base + c.from;
      const to = base + c.to;
      if (!found && caret >= from && caret <= to) {
        cursorRowAbs = all.length;
        cursorCol = visibleWidth(c.text.slice(0, caret - from));
        found = true;
      }
      all.push({ text: c.text, from, to });
    }
    base += logical.length + 1; // the newline itself
  }
  const cap = Math.max(1, maxRows);
  let first = 0;
  if (all.length > cap) {
    first = Math.min(Math.max(0, cursorRowAbs - cap + 1), all.length - cap);
  }
  const view = all.slice(first, first + cap);
  return {
    all,
    rows: view.map((r) => r.text),
    first,
    total: all.length,
    hidden: all.length - view.length,
    cursorRowAbs,
    cursorRow: cursorRowAbs - first,
    cursorCol,
  };
}

/** Caret index one visual row up (-1) or down (+1); null when there is none. */
export function moveCaretByRow(input, cursor, width, delta) {
  const l = layoutInput(input, cursor, width, Number.MAX_SAFE_INTEGER);
  const target = l.cursorRowAbs + delta;
  if (target < 0 || target >= l.all.length) return null;
  const row = l.all[target];
  return row.from + indexAtCell(row.text, l.cursorCol);
}

/** Keep a growing line buffer bounded, in place. An all-day session must not grow forever. */
export function trimLines(lines, max) {
  const cap = Math.max(1, max);
  if (lines.length > cap) lines.splice(0, lines.length - cap);
  return lines;
}

/**
 * Decode a raw stdin chunk into key events. Without this, arrow keys arrive as
 * an escape sequence and their tail ("[A", "[D") is typed into the input.
 *
 * Also understands Shift+Tab (`CSI Z`) and bracketed paste (`CSI 200~` … `CSI 201~`).
 * Pass the same `carry` object across chunks so a paste that arrives split is
 * reassembled instead of being typed as raw CSI.
 */
export function decodeKeys(buf, carry = null) {
  const NAMED = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
  const TILDE = { 1: "home", 3: "delete", 4: "end", 5: "pageup", 6: "pagedown" };
  const keys = [];
  let i = 0;
  let pasting = Boolean(carry && carry.paste != null);
  let pasteAcc = pasting ? String(carry.paste) : "";
  const flushPaste = () => {
    if (pasteAcc) keys.push({ paste: pasteAcc });
    pasteAcc = "";
    pasting = false;
    if (carry) carry.paste = null;
  };
  while (i < buf.length) {
    const ch = buf[i];
    if (ch === ESC) {
      const rest = buf.slice(i + 1);
      let m = rest.match(/^\[200~/);
      if (m) {
        pasting = true;
        pasteAcc = "";
        i += 1 + m[0].length;
        continue;
      }
      m = rest.match(/^\[201~/);
      if (m) {
        if (pasting) flushPaste();
        i += 1 + m[0].length;
        continue;
      }
      if (pasting) {
        pasteAcc += ch;
        i += 1;
        continue;
      }
      // Alt+Enter arrives as ESC + CR/LF — insert a newline instead of sending
      m = rest.match(/^[\r\n]/);
      if (m) {
        keys.push({ name: "altenter" });
        i += 1 + m[0].length;
        continue;
      }
      m = rest.match(/^\[Z/);
      if (m) {
        keys.push({ name: "backtab" });
        i += 1 + m[0].length;
        continue;
      }
      m = rest.match(/^\[([ABCDHF])/);
      if (m) {
        keys.push({ name: NAMED[m[1]] });
        i += 1 + m[0].length;
        continue;
      }
      m = rest.match(/^\[([0-9]+)~/);
      if (m && TILDE[m[1]]) {
        keys.push({ name: TILDE[m[1]] });
        i += 1 + m[0].length;
        continue;
      }
      m = rest.match(/^\[[0-9;]*[A-Za-z~]/);
      if (m) {
        i += 1 + m[0].length;
        continue;
      }
      keys.push({ name: "escape" });
      i += 1;
      continue;
    }
    if (pasting) {
      pasteAcc += ch;
      i += 1;
      continue;
    }
    keys.push({ ch });
    i += 1;
  }
  if (pasting) {
    if (carry) carry.paste = pasteAcc;
    else if (pasteAcc) keys.push({ paste: pasteAcc });
  }
  return keys;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerFrame(tick) {
  return SPINNER[Math.abs(Math.trunc(tick || 0)) % SPINNER.length];
}

/** Session overlay: tighten this run only. Never loosens the machine flag. */
export const OVERLAY_MODES = ["bypass", "auto", "ask"];

export function overlayFlags(mode) {
  if (mode === "ask") return { forceHuman: true, ignoreBypass: false };
  if (mode === "auto") return { forceHuman: false, ignoreBypass: true };
  return { forceHuman: false, ignoreBypass: false };
}

export function cycleOverlay(mode, { machineBypass = true } = {}) {
  const order = machineBypass ? ["bypass", "auto", "ask"] : ["auto", "ask"];
  const i = order.indexOf(mode);
  return order[i < 0 ? 0 : (i + 1) % order.length];
}

export function overlayLabel(mode) {
  if (mode === "ask") return "ask before every tool";
  if (mode === "auto") return "auto-approve (bypass off)";
  return "bypass permissions on";
}

function padCells(text, width) {
  const w = visibleWidth(text);
  if (w >= width) return fitToWidth(text, width);
  return text + " ".repeat(width - w);
}

/**
 * Welcome card shown on an empty transcript — version, model, cwd, tips.
 * Pure so tests can assert the box without a terminal.
 */
export function renderWelcomeBox(state = {}, opts = {}) {
  const colour = opts.colour !== false;
  const cols = Math.max(40, opts.columns || 80);
  const p = (t, c) => paint(t, c, colour);
  const dim = (t) => p(t, C.grey);
  const acc = (t) => p(t, C.accent);
  const inner = Math.max(32, cols - 4);
  const title = `${p("XClaw", C.bold)} ${dim("v" + (state.version || "?"))}`;
  const titleCells = visibleWidth(` XClaw v${state.version || "?"} `);
  const dash = Math.max(2, inner - titleCells - 1);
  const top = ` ${acc("╭")} ${title} ${acc("─".repeat(dash))}${acc("╮")}`;
  const bottom = ` ${acc("╰")}${acc("─".repeat(inner))}${acc("╯")}`;
  const rows = [
    "Welcome.",
    `${state.model || "no model"}${state.profile ? " · " + state.profile : ""}`,
    state.cwd || "",
    "/mcp · /model · /approvals · Shift+Tab cycles permissions",
  ];
  const body = [];
  for (let i = 0; i < MASCOT.length; i += 1) {
    const left = acc(MASCOT[i]);
    const right = i < rows.length ? (i === 0 ? p(rows[i], C.bold) : dim(rows[i])) : "";
    const content = `${left}  ${right}`;
    body.push(` ${acc("│")}${padCells(content, inner)}${acc("│")}`);
  }
  return [top, ...body, bottom];
}

/**
 * Inline approval prompt. Before this the TUI told the user to go and approve
 * the tool call in Telegram or the Control UI, which made Shift+Tab's "ask
 * before every tool" mode a dead end on a machine with no other channel wired.
 */
export function renderApprovalPrompt(approval = {}, opts = {}) {
  const colour = opts.colour !== false;
  const cols = Math.max(20, opts.columns || 80);
  const p = (t, c) => paint(t, c, colour);
  const dim = (t) => p(t, C.grey);
  const tier = String(approval.riskTier || "unknown");
  const call = formatToolCall(approval.name || "tool", approval.args || {});
  // "always allow" is deliberately absent for critical calls: the rest of the
  // codebase (see /trust) never lets a blanket grant cover that tier.
  const keys = tier === "critical"
    ? `${p("y", C.accent)} approve   ${p("n", C.red)} deny`
    : `${p("y", C.accent)} approve   ${p("n", C.red)} deny   ${p("a", C.accent)} always allow this tool`;
  return [
    ` ${p("▲", C.yellow)} ${p(`approval required · ${tier}`, C.yellow)}`,
    `   ${call}`,
    ` ${p(">", C.accent)} ${keys}${dim("   esc cancels the run")}`,
  ];
}

/**
 * Render the whole chat screen. Pure: state in, lines out, so the layout can be
 * asserted without a terminal.
 *
 * Every returned line is clamped to `cols` on the way out. The draw loop paints
 * with absolute cursor positioning, so a single over-wide line would wrap and
 * shift every row below it — the frame must never contain one.
 */
export function renderChatScreen(state = {}, opts = {}) {
  const colour = opts.colour !== false;
  const cols = Math.max(20, opts.columns || 80);
  const rows = Math.max(8, opts.rows || 24);
  const p = (t, c) => paint(t, c, colour);
  const dim = (t) => p(t, C.grey);
  const acc = (t) => p(t, C.accent);
  const cursorOn = (t) => (colour ? `${ESC}[7m${t}${ESC}[0m` : `[${t}]`);
  // below this the mascot column plus any useful text no longer fits
  const narrow = cols < 46;

  const empty = !(state.transcript && state.transcript.length) && !state.live;
  const head = [];
  if (narrow) {
    head.push(`${p("XClaw", C.bold)} ${dim("v" + (state.version || "?"))}`);
    head.push(dim(`${state.model || "no model"}${state.profile ? " · " + state.profile : ""}`));
  } else if (empty) {
    head.push(...renderWelcomeBox(state, { colour, columns: cols }));
  } else {
    const meta = [
      `${p("XClaw", C.bold)} ${dim("v" + (state.version || "?"))}`,
      dim(`${state.model || "no model"}${state.profile ? " · " + state.profile : ""}`),
      dim(state.cwd || ""),
      "",
    ];
    for (let i = 0; i < MASCOT.length; i += 1) {
      head.push(`${acc(MASCOT[i])}${meta[i] ? "  " + meta[i] : ""}`);
    }
  }
  head.push("");
  if (state.notice) head.push(` ${acc(CHEV)} ${state.notice}`);
  if (state.mcpBanner) head.push(` ${p("▲", C.yellow)} ${p(state.mcpBanner, C.yellow)}`);
  head.push("");

  const rule = dim("─".repeat(Math.max(6, cols - 2)));
  // " > " prefix plus a spare cell so the caret at end-of-row still fits
  const inputWidth = Math.max(8, cols - 4);
  let block;
  if (state.approval) {
    block = renderApprovalPrompt(state.approval, { colour, columns: cols });
  } else if (state.busy && !state.live) {
    block = [` ${acc(state.spinner || SPINNER[0])} ${dim(state.busyLabel || "working")}${dim("  esc to cancel")}`];
  } else if (state.search) {
    const q = state.search.query || "";
    block = [` ${acc("?")} ${dim(`(reverse-i-search)\`${q}': `)}${state.search.match || ""}`];
  } else {
    const maxInputRows = Math.max(1, Math.min(8, rows - 10));
    const l = layoutInput(state.input || "", state.cursor, inputWidth, maxInputRows);
    block = l.rows.map((line, i) => {
      const prefix = i === 0 && l.first === 0 ? ` ${acc(">")} ` : "   ";
      if (i !== l.cursorRow) return `${prefix}${line}`;
      const at = indexAtCell(line, l.cursorCol);
      const end = nextCharIndex(line, at);
      const under = line.slice(at, end) || " ";
      return `${prefix}${line.slice(0, at)}${cursorOn(under)}${line.slice(end)}`;
    });
    if (l.hidden > 0) block.push(dim(`   … ${l.hidden} more line(s)`));
  }

  const perm = overlayLabel(state.overlay || "bypass");
  const defaultFooter = `${perm} (shift+tab) · Enter send · /help`;
  const foot = [
    ` ${rule}`,
    ...block,
    ` ${rule}`,
    ` ${acc(CHEV + CHEV)} ${state.footer || dim(defaultFooter)}`,
  ];

  const budget = Math.max(1, rows - head.length - foot.length - 1);
  let body = [...(state.transcript || [])];
  if (state.live) {
    const liveLines = wrapLine(state.live, Math.max(12, cols - 6), "  ");
    body.push(`${acc(MARK)} ${liveLines[0] ?? ""}`);
    for (const l of liveLines.slice(1)) body.push(l ? `  ${l}` : "");
  }
  if (!body.length && state.hint) body = ["", dim(`  ${state.hint}`)];
  const maxScroll = Math.max(0, body.length - budget);
  // the draw loop needs the real body budget to page by; computing it a second
  // time in the caller is how PgUp and the frame drifted out of step before
  if (typeof opts.onLayout === "function") opts.onLayout({ budget, maxScroll, bodyLength: body.length });
  const scroll = Math.max(0, Math.min(state.scroll || 0, maxScroll));
  const end = body.length - scroll;
  const out = body.slice(Math.max(0, end - budget), end);
  while (out.length < budget) out.push("");
  // only while scrolled back: at the live tail these would eat a content row
  // for no information. Both directions are labelled — "below" alone left the
  // user with no clue that PgUp had more.
  if (scroll > 0) {
    const above = Math.max(0, end - budget);
    if (out.length > 1) out[0] = dim(`  ↑ ${above} more line(s) above · PgUp`);
    out[out.length - 1] = dim(`  ↓ ${scroll} more line(s) below · PgDn`);
  }
  return [...head, ...out, ...foot].map((line) => fitToWidth(line, cols));
}

export function tuiHelp() {
  return [
    "xclaw tui — conversational terminal UI for the gateway",
    "",
    "Usage:",
    "  xclaw tui [--continue] [--status] [--once] [--json] [--no-colour]",
    "",
    "Options:",
    "  --continue   resume the last chat session (alias -c)",
    "  --status     operator dashboard instead of the chat UI",
    "  --once       render one frame and exit (status view)",
    "  --json       print the raw status snapshot and exit",
    "  --interval   status auto-refresh seconds (default 5)",
    "  --no-colour  disable ANSI colour",
    "  --help       show this help",
    "",
    "In the chat UI:",
    "  /status      gateway, sessions, approvals, cost",
    "  /mcp         MCP servers and auth",
    "  /model       current provider / model",
    "  /approvals   permission overlay (Shift+Tab cycles)",
    "  /cost        today's spend against the daily cap",
    "  /session     current session id and where it is stored",
    "  /clear       clear the transcript",
    "  /help        this help",
    "  /quit        exit (or Ctrl+C, or Ctrl+D on an empty line)",
    "",
    "Keys:",
    "  Shift+Tab    cycle permissions: bypass → auto → ask",
    "  Alt+Enter    newline (or end the line with a backslash)",
    "  Ctrl+A/E     start / end of line",
    "  Ctrl+U/K/W   kill to start / end / previous word",
    "  Ctrl+R       search input history",
    "  Ctrl+L       redraw the screen",
    "  PgUp/PgDn    scroll the transcript",
    "",
    "When a tool needs approval: y approve · n deny · a always allow that tool.",
  ].join("\n");
}

async function streamAgent(base, token, message, onEvent, signal, extra = {}) {
  const res = await fetch(`${base}/agent/run/stream`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      channel: "tui",
      sessionId: extra.sessionId || undefined,
      forceHuman: extra.forceHuman === true,
      ignoreBypass: extra.ignoreBypass === true,
    }),
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
  const base = opts.base || gatewayBaseUrl(cfg);
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

let rawActive = false;
let guardsInstalled = false;

/**
 * Put the terminal back however we leave. Without this the alternate screen,
 * the hidden cursor and bracketed paste all survive the process: closing the
 * window, `kill`, or any uncaught throw left the user typing blind until they
 * ran `reset`. Idempotent, and safe to call from a synchronous exit handler.
 */
function installExitGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  process.on("exit", leaveRaw);
  for (const sig of ["SIGTERM", "SIGHUP", "SIGQUIT"]) {
    process.on(sig, () => {
      leaveRaw();
      process.exit(0);
    });
  }
  const die = (err) => {
    leaveRaw();
    console.error(err?.stack || String(err));
    process.exit(1);
  };
  process.on("uncaughtException", die);
  process.on("unhandledRejection", die);
}

function enterRaw() {
  // Alternate screen: the frame owns an exactly-sized screen and the shell's
  // scrollback comes back untouched on exit, so a clipped footer can only ever
  // mean the terminal really is that short.
  installExitGuards();
  rawActive = true;
  process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?2004h`);
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
  } catch {
    /* not a tty */
  }
  process.stdin.resume();
}

function leaveRaw() {
  if (!rawActive) return;
  rawActive = false;
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* not a tty */
  }
  try {
    process.stdin.pause();
  } catch {
    /* already gone */
  }
  // writeSync, not stdout.write: on the "exit" path nothing async can flush
  try {
    writeSync(1, `${ESC}[?2004l${ESC}[?25h${ESC}[?1049l`);
  } catch {
    /* stdout closed */
  }
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
    leaveRaw();
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

/** Where the TUI keeps its own session — same convention as the other stores. */
function tuiStatePath(cfg) {
  const dir = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(dir, "tui-session.json");
}

async function loadTuiState(cfg) {
  try {
    const raw = await fsp.readFile(tuiStatePath(cfg), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // missing or truncated file: start fresh rather than refuse to open
    return {};
  }
}

async function saveTuiState(cfg, patch) {
  // best-effort: a read-only home must never take the UI down with it
  try {
    const file = tuiStatePath(cfg);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const next = { ...(await loadTuiState(cfg)), ...patch, updatedAt: new Date().toISOString() };
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2));
    await fsp.rename(tmp, file);
  } catch {
    /* persistence is a convenience, not a requirement */
  }
}

async function postJson(url, token, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    const parsed = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e?.message || e) } };
  }
}

async function chatLoop(cfg, opts) {
  const { base, token, colour } = opts;
  const p = (t, c) => paint(t, c, colour);
  const dim = (t) => p(t, C.grey);
  const acc = (t) => p(t, C.accent);

  const info = await getJson(`${base}/info`, token);
  const approvals = await getJson(`${base}/approvals`, token);
  const mcp = await getJson(`${base}/mcp/status`, token);
  const agent = info.body?.agent || {};
  const pendingN = approvals.body?.pending?.length || 0;
  const machineBypass = cfg.security?.bypassApprovals === true;
  const mcpServers = mcp.body?.servers || [];
  const mcpNeedAuth = mcpServers.filter((s) => s && s.connected === false).length;
  const mcpOk = mcpServers.filter((s) => s && s.connected).length;

  const state = {
    version: info.body?.version || "?",
    model: agent.provider ? `${agent.provider}/${agent.model || "?"}` : agent.model || "",
    profile: cfg.profile || "",
    cwd: process.cwd(),
    transcript: [],
    input: "",
    cursor: 0,
    scroll: 0,
    busy: false,
    live: "",
    overlay: machineBypass ? "bypass" : "auto",
    spinner: spinnerFrame(0),
    busyLabel: "working",
    hint: "ask anything · /help for commands",
    notice: info.ok
      ? `${dim("gateway ready")}${pendingN ? p(` · ${pendingN} approval(s) pending`, C.yellow) : ""}`
      : p(`gateway unreachable at ${base} — start it with: xclaw gateway`, C.red),
    mcpBanner: mcpNeedAuth
      ? `${mcpNeedAuth} MCP server${mcpNeedAuth === 1 ? "" : "s"} need authentication · /mcp`
      : mcpOk
        ? `${mcpOk} MCP server${mcpOk === 1 ? "" : "s"} connected`
        : "",
    footer: "",
  };

  // input history outlives the process; the agent session only when asked
  const saved = await loadTuiState(cfg);
  const wantContinue = opts.args?.includes("--continue") || opts.args?.includes("-c");
  const history = Array.isArray(saved.history) ? saved.history.filter((h) => typeof h === "string") : [];
  let histIdx = -1;
  let draft = "";
  let inFlight = null;
  let spinTimer = null;
  let tick = 0;
  let lastFrame = [];
  let armedQuit = false;
  const freshId = () => `tui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const resumed = wantContinue && typeof saved.sessionId === "string" && saved.sessionId;
  let sessionId = resumed || freshId();
  if (resumed) state.notice = `${dim("resumed session")} ${acc(sessionId)}`;
  const keyCarry = { paste: null };
  // pendings arrive one at a time in practice, but never drop a second one
  const approvalQueue = [];
  const trustedTools = new Set();

  const setFooter = (bits = []) => {
    state.footer = dim(
      [
        overlayLabel(state.overlay) + " (shift+tab)",
        "Enter send",
        "/help",
        trustedTools.size ? `${trustedTools.size} tool(s) trusted` : null,
        ...bits.filter(Boolean),
      ]
        .filter(Boolean)
        .join(" · ")
    );
  };
  setFooter();

  const cols = () => process.stdout.columns || 80;
  const rowsN = () => process.stdout.rows || 24;
  // an all-day session would otherwise keep every line forever, and each
  // keystroke copies this array to render
  const MAX_TRANSCRIPT = 5000;
  const push = (l) => {
    state.transcript.push(l);
    trimLines(state.transcript, MAX_TRANSCRIPT);
  };
  const pushWrapped = (text, indent = "  ") => {
    for (const l of wrapLine(text, cols() - 4, indent)) push(l);
  };

  /**
   * Repaint only the rows that changed. A full ESC[2J clear on every keystroke
   * made the whole screen flash while typing.
   */
  let layout = { budget: 10, maxScroll: 0, bodyLength: 0 };
  const draw = () => {
    const frame = renderChatScreen(state, {
      colour,
      columns: cols(),
      rows: rowsN(),
      onLayout: (l) => {
        layout = l;
      },
    });
    let out = `${ESC}[H`;
    for (let i = 0; i < frame.length; i += 1) {
      if (frame[i] === lastFrame[i]) continue;
      out += `${ESC}[${i + 1};1H${frame[i]}${ESC}[K`;
    }
    // erase BELOW the frame — positioning at frame.length would wipe the footer
    out += `${ESC}[${frame.length + 1};1H${ESC}[J`;
    process.stdout.write(out);
    lastFrame = frame;
  };
  const redrawAll = () => {
    lastFrame = [];
    process.stdout.write(`${ESC}[2J`);
    draw();
  };

  const startSpinner = (label) => {
    state.busy = true;
    state.busyLabel = label || "working";
    tick = 0;
    state.spinner = spinnerFrame(tick);
    spinTimer = setInterval(() => {
      tick += 1;
      state.spinner = spinnerFrame(tick);
      const secs = Math.floor(tick / 10);
      state.busyLabel = `${label || "working"}  ${secs}s`;
      draw();
    }, 100);
  };
  const stopSpinner = () => {
    if (spinTimer) clearInterval(spinTimer);
    spinTimer = null;
    state.busy = false;
    state.live = "";
  };

  /** POST one approval decision. The prompt has already left the screen. */
  const sendDecision = async (ask, approve, note) => {
    const res = await postJson(`${base}/approvals/${approve ? "approve" : "deny"}`, token, {
      id: ask.id,
      ...(approve ? {} : { reason: note || "Denied from the TUI" }),
    });
    if (res.ok) {
      push(
        approve
          ? p(`  ${ELBOW} approved ${ask.name || "tool"}`, C.green)
          : p(`  ${ELBOW} denied ${ask.name || "tool"}`, C.yellow)
      );
    } else {
      const why = res.body?.error || res.body?.code || `HTTP ${res.status}`;
      push(p(`  ${ELBOW} approval failed: ${why}`, C.red));
    }
  };

  const answerCurrent = async (approve, note) => {
    const ask = state.approval;
    if (!ask) return;
    state.approval = approvalQueue.shift() || null;
    draw();
    await sendDecision(ask, approve, note);
    draw();
  };

  const persist = () => {
    void saveTuiState(cfg, { sessionId, cwd: process.cwd(), history: history.slice(-200) });
  };

  const submit = async (text) => {
    history.push(text);
    histIdx = -1;
    state.scroll = 0;
    persist();
    push("");
    pushWrapped(`${acc(">")} ${text}`);
    push("");
    startSpinner("thinking");
    draw();

    const controller = new AbortController();
    inFlight = controller;
    let tools = 0;
    let streamed = "";
    try {
      const flags = overlayFlags(state.overlay);
      const out = await streamAgent(
        base,
        token,
        text,
        (ev) => {
          const kind = ev.type || ev.event;
          if (kind === "model" && ev.phase === "delta") {
            streamed = String(ev.accumulated || streamed + (ev.content || ""));
            // deltas are raw: hide the grounding scaffold as it arrives so it
            // never types itself out in front of the user
            state.live = stripLiveScaffold(streamed);
            draw();
          } else if (kind === "tool" && ev.phase === "start") {
            if (state.live) {
              const md = renderMarkdownLines(state.live, { colour, width: cols() - 6 });
              push(`${acc(MARK)} ${md[0] ?? ""}`);
              for (const l of md.slice(1)) push(l ? `  ${l}` : "");
              state.live = "";
              streamed = "";
            }
            tools += 1;
            state.busyLabel = `running ${ev.name || "tool"}`;
            push(`${acc(MARK)} ${formatToolCall(ev.name, ev.args)}`);
            draw();
          } else if (kind === "tool" && ev.phase === "end") {
            const res = String(ev.preview ?? ev.resultText ?? ev.result ?? "").trim();
            if (res) {
              const all = wrapLine(res, cols() - 8, "     ");
              const shown = all.slice(0, 4);
              push(`  ${dim(ELBOW)} ${shown[0]}`);
              for (const extra of shown.slice(1)) push(`     ${dim(extra.trim())}`);
              if (all.length > 4) push(dim(`     +${all.length - 4} more line(s)`));
            }
            state.busyLabel = "thinking";
            draw();
          } else if (kind === "tool" && ev.phase === "blocked") {
            push(p(`  ${ELBOW} blocked: ${ev.reason || "policy"}`, C.yellow));
            draw();
          } else if (kind === "security" && isNewApprovalAsk(ev)) {
            // the loop re-emits this event as a state update once authorize
            // times out; isNewApprovalAsk keeps the restate from prompting twice
            const ask = {
              id: ev.pendingId || ev.id || null,
              name: ev.name || ev.tool || "tool",
              args: ev.args || {},
              riskTier: ev.riskTier || null,
            };
            if (!ask.id) {
              push(p(`  ${ELBOW} approval required — approve in the Control UI`, C.yellow));
            } else if (trustedTools.has(ask.name) && ask.riskTier !== "critical") {
              push(dim(`  ${ELBOW} auto-approved ${ask.name} — trusted this session`));
              void sendDecision(ask, true, "");
            } else if (state.approval) {
              approvalQueue.push(ask);
            } else {
              state.approval = ask;
            }
            draw();
          }
        },
        controller.signal,
        { sessionId, ...flags }
      );
      if (out.result?.sessionId) sessionId = out.result.sessionId;
      // result.text is stripped server-side; finalText is raw, so clean either
      const answer = stripLiveScaffold(out.result?.text || out.result?.finalText || "");
      state.live = "";
      push("");
      if (answer) {
        const md = renderMarkdownLines(answer, { colour, width: cols() - 6 });
        push(`${acc(MARK)} ${md[0] ?? ""}`);
        for (const l of md.slice(1)) push(l ? `  ${l}` : "");
        push("");
      } else {
        push(dim(`  ${ELBOW} ${out.error || "(no reply)"}`));
      }
      const usd = out.result?.usage?.costUsd;
      const turns = out.result?.turns;
      setFooter([
        turns ? `${turns} turn(s)` : null,
        tools ? `${tools} tool call(s)` : null,
        usd != null ? `$${Number(usd).toFixed(4)}` : null,
      ]);
    } catch (e) {
      state.live = "";
      if (controller.signal.aborted) push(dim(`  ${ELBOW} cancelled`));
      else push(p(`  ${ELBOW} ${String(e?.message || e)}`, C.red));
    } finally {
      inFlight = null;
      // the run is over: any prompt still on screen can no longer be answered
      state.approval = null;
      approvalQueue.length = 0;
      stopSpinner();
      persist();
      draw();
    }
  };

  const slash = async (cmd) => {
    if (cmd === "/quit" || cmd === "/exit") {
      persist();
      leaveRaw();
      process.exit(0);
    }
    if (cmd === "/cost") {
      const st = await getJson(`${base}/tokens/cost`, token);
      const c = st.body || {};
      push("");
      push(acc("cost"));
      if (!st.ok) {
        push(dim(`  unavailable (HTTP ${st.status || 0})`));
        return;
      }
      const today = c.today || c.daily || c;
      const spend = today.usd ?? today.spendUsd ?? today.totalUsd;
      push(`  ${dim("today")}      ${spend != null ? `$${Number(spend).toFixed(4)}` : "—"}`);
      if (today.limitUsd != null) push(`  ${dim("daily cap")}  $${Number(today.limitUsd).toFixed(2)}`);
      if (c.band) push(`  ${dim("band")}       ${c.band}`);
      return;
    }
    if (cmd === "/session") {
      push("");
      push(`  ${acc("session")}  ${sessionId}`);
      push(dim(`  ${resumed ? "resumed from" : "stored at"} ${tuiStatePath(cfg)}`));
      push(dim("  start with --continue to resume this session next time"));
      return;
    }
    if (cmd === "/clear") {
      state.transcript = [];
      state.scroll = 0;
      redrawAll();
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
    if (cmd === "/mcp") {
      const st = await getJson(`${base}/mcp/status`, token);
      const servers = st.body?.servers || [];
      push("");
      push(acc("MCP servers"));
      if (!servers.length) {
        push(dim("  none configured"));
        return;
      }
      for (const s of servers) {
        const mark = s.connected ? p(DOT_ON, C.green) : p(DOT_OFF, C.yellow);
        const extra = s.connected
          ? dim(`${s.toolCount ?? 0} tools`)
          : p(s.error || "needs authentication", C.yellow);
        push(`  ${mark} ${s.name}  ${extra}`);
      }
      return;
    }
    if (cmd === "/model") {
      push("");
      push(`  ${acc("model")}  ${state.model || "—"}`);
      push(`  ${dim("profile")}  ${state.profile || "—"}`);
      return;
    }
    if (cmd === "/approvals" || cmd === "/permissions") {
      push("");
      push(`  ${acc("overlay")}  ${overlayLabel(state.overlay)}  (session only)`);
      push(dim("  Shift+Tab cycles bypass → auto → ask. Never loosens the machine flag."));
      return;
    }
    push(dim(`  unknown command ${cmd} — try /help`));
  };

  const pageBy = (n) => {
    const step = Math.max(1, layout.budget - 1);
    state.scroll = Math.max(0, Math.min(state.scroll + n * step, layout.maxScroll));
    draw();
  };

  const inputW = () => Math.max(8, cols() - 4);
  const insert = (text) => {
    state.input = state.input.slice(0, state.cursor) + text + state.input.slice(state.cursor);
    state.cursor += text.length;
  };
  /** Newest history index at or below `start` matching `q`; -1 for none. */
  const searchFrom = (start, q) => {
    const needle = q.toLowerCase();
    for (let i = Math.min(start, history.length - 1); i >= 0; i -= 1) {
      if (!needle || history[i].toLowerCase().includes(needle)) return i;
    }
    return -1;
  };
  const endSearch = (accept) => {
    const s = state.search;
    state.search = null;
    if (accept && s?.match) {
      state.input = s.match;
      state.cursor = state.input.length;
    }
    setFooter();
    draw();
  };

  const onKey = async (k) => {
    if (k.ch === KEY_CTRL_C) {
      if (state.search) return endSearch(false);
      if (inFlight) {
        inFlight.abort();
        return;
      }
      if (state.input) {
        state.input = "";
        state.cursor = 0;
        armedQuit = false;
        draw();
        return;
      }
      if (!armedQuit) {
        armedQuit = true;
        state.footer = dim("press Ctrl+C again to quit");
        draw();
        return;
      }
      persist();
      leaveRaw();
      process.exit(0);
    }
    armedQuit = false;

    // an approval owns the keyboard until it is answered — anything else typed
    // here would land in the input box behind a prompt the user cannot see
    if (state.approval) {
      const c = (k.ch || "").toLowerCase();
      if (c === "y") return answerCurrent(true, "");
      if (c === "n") return answerCurrent(false, "Denied from the TUI");
      if (c === "a" && state.approval.riskTier !== "critical") {
        trustedTools.add(state.approval.name);
        setFooter();
        return answerCurrent(true, "");
      }
      if (k.name === "escape") {
        if (inFlight) inFlight.abort();
        return;
      }
      return;
    }

    if (state.search) {
      if (k.name === "escape") return endSearch(false);
      if (k.ch === "\r" || k.ch === "\n") return endSearch(true);
      if (k.ch === KEY_CTRL_R) {
        const next = searchFrom(state.search.idx - 1, state.search.query);
        if (next >= 0) {
          state.search.idx = next;
          state.search.match = history[next];
        }
        return draw();
      }
      if (k.ch === KEY_BACKSPACE || k.ch === "\b") {
        state.search.query = state.search.query.slice(0, -1);
      } else if (k.ch && k.ch >= " ") {
        state.search.query += k.ch;
      } else {
        return;
      }
      const hit = searchFrom(history.length - 1, state.search.query);
      state.search.idx = hit;
      state.search.match = hit >= 0 ? history[hit] : "";
      return draw();
    }

    if (k.name === "escape") {
      if (inFlight) inFlight.abort();
      return;
    }
    if (k.name === "pageup") return pageBy(1);
    if (k.name === "pagedown") return pageBy(-1);
    if (k.name === "backtab") {
      state.overlay = cycleOverlay(state.overlay, { machineBypass });
      setFooter();
      return draw();
    }
    if (k.paste != null) {
      if (state.busy) return;
      // newlines are kept: the input is a real multi-line buffer now, so a
      // pasted block no longer has to be flattened to survive the frame
      insert(String(k.paste).replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      return draw();
    }
    if (k.ch === KEY_CTRL_L) return redrawAll();
    if (state.busy) return;

    if (k.name === "altenter") {
      insert("\n");
      return draw();
    }
    if (k.ch === KEY_CTRL_R) {
      // opens even with no history: a prompt that silently does nothing on a
      // fresh install reads as a broken key, not as an empty history
      const hit = searchFrom(history.length - 1, "");
      state.search = { query: "", idx: hit, match: hit >= 0 ? history[hit] : "" };
      state.footer = dim("Ctrl+R again for older · Enter accepts · Esc cancels");
      return draw();
    }
    if (k.ch === KEY_CTRL_A) {
      state.cursor = 0;
      return draw();
    }
    if (k.ch === KEY_CTRL_E) {
      state.cursor = state.input.length;
      return draw();
    }
    if (k.ch === KEY_CTRL_K) {
      state.input = state.input.slice(0, state.cursor);
      return draw();
    }
    if (k.ch === KEY_CTRL_U) {
      state.input = state.input.slice(state.cursor);
      state.cursor = 0;
      return draw();
    }
    if (k.ch === KEY_CTRL_W) {
      const head = state.input.slice(0, state.cursor).replace(/\s+$/, "").replace(/\S+$/, "");
      state.input = head + state.input.slice(state.cursor);
      state.cursor = head.length;
      return draw();
    }
    if (k.ch === KEY_CTRL_D) {
      // shell convention: Ctrl+D on an empty prompt ends the session
      if (!state.input) {
        persist();
        leaveRaw();
        process.exit(0);
      }
      state.input = state.input.slice(0, state.cursor) + state.input.slice(nextCharIndex(state.input, state.cursor));
      return draw();
    }

    if (k.name === "left") {
      state.cursor = prevCharIndex(state.input, state.cursor);
      return draw();
    }
    if (k.name === "right") {
      state.cursor = nextCharIndex(state.input, state.cursor);
      return draw();
    }
    if (k.name === "home") {
      state.cursor = 0;
      return draw();
    }
    if (k.name === "end") {
      state.cursor = state.input.length;
      return draw();
    }
    if (k.name === "delete") {
      state.input = state.input.slice(0, state.cursor) + state.input.slice(nextCharIndex(state.input, state.cursor));
      return draw();
    }
    if (k.name === "up") {
      // inside a multi-line buffer the arrows move between rows; only at the
      // top row do they fall through to history
      const up = moveCaretByRow(state.input, state.cursor, inputW(), -1);
      if (up != null) {
        state.cursor = up;
        return draw();
      }
      if (!history.length) return;
      if (histIdx === -1) draft = state.input;
      histIdx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      state.input = history[histIdx];
      state.cursor = state.input.length;
      return draw();
    }
    if (k.name === "down") {
      const down = moveCaretByRow(state.input, state.cursor, inputW(), 1);
      if (down != null) {
        state.cursor = down;
        return draw();
      }
      if (histIdx === -1) return;
      histIdx += 1;
      if (histIdx >= history.length) {
        histIdx = -1;
        state.input = draft;
      } else {
        state.input = history[histIdx];
      }
      state.cursor = state.input.length;
      return draw();
    }

    const ch = k.ch;
    if (ch === undefined) return;
    if (ch === "\r" || ch === "\n") {
      // trailing backslash continues onto the next line, as in a shell
      if (state.cursor === state.input.length && state.input.endsWith("\\")) {
        state.input = `${state.input.slice(0, -1)}\n`;
        state.cursor = state.input.length;
        return draw();
      }
      const text = state.input.trim();
      state.input = "";
      state.cursor = 0;
      state.scroll = 0;
      if (!text) return draw();
      if (text.startsWith("/")) {
        // slash commands belong in history too, and persisting here is what
        // makes the session id survive a kill that never reaches an exit hook
        if (history.at(-1) !== text) history.push(text);
        histIdx = -1;
        persist();
        await slash(text);
        return draw();
      }
      return submit(text);
    }
    if (ch === KEY_BACKSPACE || ch === "\b") {
      if (state.cursor > 0) {
        const back = prevCharIndex(state.input, state.cursor);
        state.input = state.input.slice(0, back) + state.input.slice(state.cursor);
        state.cursor = back;
      }
      return draw();
    }
    if (ch < " ") return;
    insert(ch);
    draw();
  };

  enterRaw();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    for (const k of decodeKeys(String(chunk), keyCarry)) await onKey(k);
  });
  process.on("SIGINT", () => {
    if (inFlight) {
      inFlight.abort();
      return;
    }
    persist();
    leaveRaw();
    process.exit(0);
  });
  process.stdout.on("resize", redrawAll);
  redrawAll();
  await new Promise(() => {});
  return { ok: true };
}

export default {
  runTui,
  visibleWidth,
  charWidth,
  sliceCells,
  renderMarkdownLines,
  fitToWidth,
  decodeKeys,
  spinnerFrame,
  collectTuiSnapshot,
  renderTuiFrame,
  renderChatScreen,
  renderWelcomeBox,
  overlayFlags,
  cycleOverlay,
  overlayLabel,
  formatToolCall,
  wrapLine,
  tuiHelp,
  chunkCells,
  indexAtCell,
  prevCharIndex,
  nextCharIndex,
  layoutInput,
  moveCaretByRow,
  trimLines,
  renderApprovalPrompt,
};
