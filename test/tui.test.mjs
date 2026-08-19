import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTuiFrame,
  renderChatScreen,
  collectTuiSnapshot,
  formatToolCall,
  wrapLine,
  tuiHelp,
} from "../src/cli/tui.mjs";

const UP = {
  at: "2026-08-19T09:41:17.000Z",
  base: "http://127.0.0.1:18790",
  up: true,
  info: {
    version: "3.134.0",
    computer: { host: "127.0.0.1", port: 4243, healthy: true },
    agent: { provider: "xai", model: "grok-4.6", maxTurns: 15 },
  },
  ready: { ready: true },
  sessions: [
    { channel: "telegram", sessionKey: "telegram:dm:1", updatedAt: new Date().toISOString() },
  ],
  approvals: [],
  cost: { costUsdFormatted: "$36.8976", runs: 449 },
  channels: { webchat: { enabled: true }, messaging: [{ name: "telegram", enabled: true }] },
  errors: [],
};

describe("tui frame", () => {
  it("renders the live surfaces without colour", () => {
    const out = renderTuiFrame(UP, { colour: false });
    assert.match(out, /XClaw 3\.134\.0/);
    assert.match(out, /gateway\s+● ready/);
    // /info reports the computer as `healthy`, not `running` — regression guard
    assert.match(out, /computer\s+● running/);
    assert.match(out, /xai · grok-4\.6/);
    assert.match(out, /maxTurns 15/);
    assert.match(out, /sessions\s+1 active/);
    assert.match(out, /\$36\.8976/);
    assert.ok(!out.includes("["), "colour:false must emit no ANSI");
  });

  it("emits ANSI when colour is on", () => {
    assert.ok(renderTuiFrame(UP, { colour: true }).includes("["));
  });

  it("shows an actionable message when the gateway is down", () => {
    const out = renderTuiFrame(
      { at: UP.at, base: UP.base, up: false, errors: ["fetch failed"] },
      { colour: false }
    );
    assert.match(out, /gateway unreachable/);
    assert.match(out, /xclaw gateway/);
    assert.ok(!/sessions/.test(out), "must not render panels it has no data for");
  });

  it("surfaces pending approvals with their tier", () => {
    const out = renderTuiFrame(
      { ...UP, approvals: [{ tool: "xclaw_bash", args: { command: "npm publish" }, risk: { tier: "critical" } }] },
      { colour: false }
    );
    assert.match(out, /approvals\s+1 pending/);
    assert.match(out, /critical/);
    assert.match(out, /npm publish/);
  });

  it("never throws when the gateway is unreachable", async () => {
    // port 1 refuses fast; collect must degrade, not reject
    const snap = await collectTuiSnapshot({}, { base: "http://127.0.0.1:1", token: null });
    assert.equal(snap.up, false);
    assert.ok(snap.errors.length >= 1);
    assert.deepEqual(snap.sessions, []);
  });

  it("help documents the flags it accepts", () => {
    const h = tuiHelp();
    for (const flag of ["--once", "--json", "--interval", "--no-colour", "--status"]) {
      assert.ok(h.includes(flag), flag);
    }
  });
});

describe("tui chat screen", () => {
  const state = {
    version: "3.136.0",
    model: "xai/grok-4.6",
    profile: "lab",
    cwd: "/root/xclaw",
    transcript: ["> hello", "\u23fa xclaw_bash(whoami)", "  \u23bf root"],
    input: "what is up",
    busy: false,
    notice: "gateway ready",
  };

  it("lays out header, transcript and the ruled input block", () => {
    const rows = 24;
    const frame = renderChatScreen(state, { colour: false, columns: 80, rows });
    assert.equal(frame.length, rows - 1, "frame must fit the terminal");
    const text = frame.join("\n");
    assert.match(text, /XClaw v3\.136\.0/);
    assert.match(text, /xai\/grok-4\.6 · lab/);
    assert.match(text, /\/root\/xclaw/);
    assert.match(text, /gateway ready/);
    assert.match(text, /xclaw_bash\(whoami\)/);
    // input block: rule, caret + typed text, rule, footer
    assert.match(frame.at(-4), /^ ─+$/);
    assert.match(frame.at(-3), /▌ what is up/);
    assert.match(frame.at(-2), /^ ─+$/);
    assert.match(frame.at(-1), /Enter send/);
    assert.ok(!text.includes("\u001b"), "colour:false must emit no ANSI");
  });

  it("marks the input block busy while a turn is running", () => {
    const frame = renderChatScreen({ ...state, busy: true }, { colour: false, columns: 80, rows: 24 });
    assert.match(frame.at(-3), /working…/);
  });

  it("keeps the frame inside the terminal for a long transcript", () => {
    const long = { ...state, transcript: Array.from({ length: 500 }, (_, i) => `line ${i}`) };
    const frame = renderChatScreen(long, { colour: false, columns: 80, rows: 30 });
    assert.equal(frame.length, 29);
    assert.match(frame.join("\n"), /line 499/, "must show the newest lines");
  });
});

describe("tui formatting", () => {
  it("summarises a tool call by its primary argument", () => {
    assert.equal(formatToolCall("xclaw_bash", { command: "whoami" }), "xclaw_bash(whoami)");
    assert.equal(formatToolCall("xclaw_file_read", { path: "/etc/hosts" }), "xclaw_file_read(/etc/hosts)");
    assert.equal(formatToolCall("mystery", {}), "mystery()");
  });

  it("collapses whitespace and truncates long arguments", () => {
    const out = formatToolCall("xclaw_bash", { command: "echo   a\n\nb" + "x".repeat(200) });
    assert.ok(out.length < 90, out.length);
    assert.ok(!out.includes("\n"));
  });

  it("wraps with a hanging indent", () => {
    const out = wrapLine("aaaa bbbb cccc dddd", 10, "  ");
    assert.ok(out.length > 1);
    assert.ok(!out[0].startsWith("  "), "first line is not indented");
    assert.ok(out[1].startsWith("  "), "continuations are indented");
  });
});
