import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTuiFrame,
  renderChatScreen,
  renderWelcomeBox,
  decodeKeys,
  spinnerFrame,
  renderMarkdownLines,
  fitToWidth,
  visibleWidth,
  charWidth,
  sliceCells,
  collectTuiSnapshot,
  formatToolCall,
  wrapLine,
  tuiHelp,
  overlayFlags,
  cycleOverlay,
  overlayLabel,
  renderMcpServers,
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
    for (const cmd of ["/mcp", "/model", "/approvals", "Shift+Tab"]) {
      assert.ok(h.includes(cmd), cmd);
    }
    for (const cmd of ["/mcp", "/model", "/approvals", "Shift+Tab"]) {
      assert.ok(h.includes(cmd), cmd);
    }
    for (const cmd of ["/mcp", "/model", "/approvals", "Shift+Tab"]) {
      assert.ok(h.includes(cmd), cmd);
    }
    for (const cmd of ["/mcp", "/model", "/approvals", "Shift+Tab"]) {
      assert.ok(h.includes(cmd), cmd);
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
    assert.match(frame.at(-3), /> what is up/);
    assert.match(frame.at(-2), /^ ─+$/);
    assert.match(frame.at(-1), /Enter send/);
    assert.ok(!text.includes("\u001b"), "colour:false must emit no ANSI");
  });

  it("marks the input block busy while a turn is running", () => {
    const frame = renderChatScreen({ ...state, busy: true }, { colour: false, columns: 80, rows: 24 });
    assert.match(frame.at(-3), /working/);
    assert.match(frame.at(-3), /esc to cancel/);
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
    // A truncated preview must say so — an approval prompt showing a silent
    // cut invites approving a command that was not fully shown.
    const long = "echo " + "x".repeat(80);
    const cut = formatToolCall("xclaw_bash", { command: long });
    assert.ok(cut.endsWith("…)"), `expected ellipsis marker, got ${cut}`);
    assert.equal(cut.length, "xclaw_bash(".length + 68 + 1);
    assert.equal(formatToolCall("xclaw_bash", { command: "x".repeat(68) }), `xclaw_bash(${"x".repeat(68)})`);
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

  it("sliceCells skips SGR so wrap does not tear sequences or spend cells on them", () => {
    const red = "[31m";
    const reset = "[0m";
    const painted = `${red}HELLO WORLD${reset}`;
    // 11 visible cells. A 5-cell budget must cut after HELLO, keeping the
    // opening SGR intact — the pre-fix walker counted each SGR byte as a cell
    // and could split `ESC[31m` across rows.
    const parts = sliceCells(painted, 5);
    assert.equal(visibleWidth(parts[0]), 5);
    assert.equal(visibleWidth(parts[1]), 5);
    assert.ok(parts[0].startsWith(red), parts[0]);
    assert.equal(parts.map((p) => p.replace(/\[[0-9;]*m/g, "")).join(""), "HELLO WORLD");
    for (const p of parts) {
      assert.doesNotMatch(p, /\[[0-9;]*$/);
    }
    assert.deepEqual(sliceCells("HELLO WORLD", 5), ["HELLO", " WORL", "D"]);
  });
});

const ESC = "\u001b";

describe("tui key decoding", () => {
  it("decodes plain characters", () => {
    assert.deepEqual(decodeKeys("abc"), [{ ch: "a" }, { ch: "b" }, { ch: "c" }]);
  });

  it("decodes arrows as names and never as typed text", () => {
    // regression: arrow keys used to leave "[A"/"[D" sitting in the input box
    assert.deepEqual(decodeKeys(ESC + "[A"), [{ name: "up" }]);
    assert.deepEqual(decodeKeys(ESC + "[B"), [{ name: "down" }]);
    assert.deepEqual(decodeKeys(ESC + "[C"), [{ name: "right" }]);
    assert.deepEqual(decodeKeys(ESC + "[D"), [{ name: "left" }]);
    const mixed = decodeKeys("a" + ESC + "[D" + "b");
    assert.deepEqual(mixed, [{ ch: "a" }, { name: "left" }, { ch: "b" }]);
    assert.ok(!mixed.some((k) => k.ch === "[" || k.ch === "D"));
  });

  it("decodes home/end/delete and paging", () => {
    assert.deepEqual(decodeKeys(ESC + "[H"), [{ name: "home" }]);
    assert.deepEqual(decodeKeys(ESC + "[F"), [{ name: "end" }]);
    assert.deepEqual(decodeKeys(ESC + "[3~"), [{ name: "delete" }]);
    assert.deepEqual(decodeKeys(ESC + "[5~"), [{ name: "pageup" }]);
    assert.deepEqual(decodeKeys(ESC + "[6~"), [{ name: "pagedown" }]);
  });

  it("treats a bare escape as escape and swallows unknown sequences", () => {
    assert.deepEqual(decodeKeys(ESC), [{ name: "escape" }]);
    assert.deepEqual(decodeKeys(ESC + "[200~"), []);
  });

  it("decodes Shift+Tab as backtab", () => {
    assert.deepEqual(decodeKeys(ESC + "[Z"), [{ name: "backtab" }]);
  });

  it("reassembles a bracketed paste across chunks", () => {
    const carry = { paste: null };
    assert.deepEqual(decodeKeys(ESC + "[200~hel", carry), []);
    assert.equal(carry.paste, "hel");
    assert.deepEqual(decodeKeys("lo" + ESC + "[201~", carry), [{ paste: "hello" }]);
    assert.equal(carry.paste, null);
  });

  it("spinner animates and never indexes out of range", () => {
    const frames = new Set();
    for (let i = 0; i < 40; i += 1) {
      const f = spinnerFrame(i);
      assert.equal(typeof f, "string");
      assert.equal(f.length, 1);
      frames.add(f);
    }
    assert.ok(frames.size > 1, "spinner must animate");
    assert.equal(typeof spinnerFrame(undefined), "string");
  });
});

describe("tui chat screen — interaction affordances", () => {
  const base = {
    version: "9.9.9",
    model: "xai/grok-4.6",
    cwd: "/root/xclaw",
    transcript: [],
    input: "",
    cursor: 0,
  };

  it("shows a hint instead of an empty void", () => {
    const out = renderChatScreen(
      { ...base, hint: "ask for anything" },
      { colour: false, columns: 80, rows: 24 }
    );
    assert.match(out.join("\n"), /ask for anything/);
  });

  it("renders the caret inside the typed text", () => {
    const out = renderChatScreen(
      { ...base, input: "abc", cursor: 1 },
      { colour: false, columns: 80, rows: 24 }
    );
    // with colour off the cursor cell is bracketed
    assert.match(out.at(-3), /a\[b\]c/);
  });

  it("replaces the input line with a spinner while busy", () => {
    const out = renderChatScreen(
      { ...base, busy: true, spinner: "*", busyLabel: "thinking 3s" },
      { colour: false, columns: 80, rows: 24 }
    );
    assert.match(out.at(-3), /\* thinking 3s/);
    assert.match(out.at(-3), /esc to cancel/);
  });

  it("indicates hidden lines when scrolled back", () => {
    const long = {
      ...base,
      transcript: Array.from({ length: 200 }, (_, i) => `l${i}`),
      scroll: 30,
    };
    const out = renderChatScreen(long, { colour: false, columns: 80, rows: 24 });
    assert.match(out.join("\n"), /30 more line\(s\) below/);
  });
});

describe("tui markdown", () => {
  const md = (t, w = 60) => renderMarkdownLines(t, { colour: false, width: w });

  it("strips bold, italic and inline-code markers", () => {
    const out = md("Some **bold** and `code` and *italic* here.").join("\n");
    assert.match(out, /Some bold and code and italic here\./);
    assert.ok(!out.includes("**"));
    assert.ok(!out.includes("`"));
  });

  it("renders headings without hashes", () => {
    const out = md("## What it needs").join("\n");
    assert.equal(out, "What it needs");
    assert.ok(!out.includes("#"));
  });

  it("turns bullets into a bullet glyph and wraps them hanging", () => {
    const out = md("- a bullet that is long enough to need wrapping at this width", 30);
    assert.match(out[0], /^ {2}• a bullet/);
    assert.ok(out.length > 1, "should wrap");
    assert.match(out[1], /^ {4}\S/, "continuation aligns under the text");
  });

  it("keeps ordered list numbering", () => {
    const out = md("1. first\n2. second");
    assert.match(out[0], /^ {2}1\. first$/);
    assert.match(out[1], /^ {2}2\. second$/);
  });

  it("drops code fences but keeps their contents indented", () => {
    const out = md("before\n```js\nconst a = 1;\n```\nafter").join("\n");
    assert.ok(!out.includes("```"));
    assert.match(out, /const a = 1;/);
    assert.match(out, /before/);
    assert.match(out, /after/);
  });

  it("reduces links to their text", () => {
    assert.equal(md("see [the docs](https://example.com) now").join("\n"), "see the docs now");
  });

  it("marks block quotes", () => {
    assert.match(md("> quoted").join("\n"), /│ quoted/);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(md(""), []);
    assert.deepEqual(md(null), []);
  });
});

describe("tui width fitting", () => {
  it("counts printable cells, ignoring colour codes", () => {
    assert.equal(visibleWidth("abc"), 3);
    assert.equal(visibleWidth(ESC + "[31mabc" + ESC + "[0m"), 3);
  });

  it("leaves a string that already fits untouched", () => {
    assert.equal(fitToWidth("exactlyten", 10), "exactlyten");
    assert.equal(fitToWidth("short", 10), "short");
  });

  it("clips to the width including the ellipsis", () => {
    const out = fitToWidth("abcdefghijklmnop", 10);
    assert.equal(visibleWidth(out), 10);
    assert.ok(out.endsWith("…"));
  });

  it("does not introduce ANSI into plain text", () => {
    assert.ok(!fitToWidth("abcdefghijklmnop", 10).includes(ESC));
  });
});

describe("tui terminal cell width", () => {
  it("counts wide glyphs as two cells", () => {
    assert.equal(visibleWidth("abc"), 3);
    assert.equal(visibleWidth("日本語"), 6);
    assert.equal(visibleWidth("🦞"), 2);
    assert.equal(visibleWidth("a🦞b"), 4);
  });

  it("ignores colour codes and combining marks", () => {
    assert.equal(visibleWidth(ESC + "[31mabc" + ESC + "[0m"), 3);
    assert.equal(charWidth(0x0301), 0);
  });

  it("wraps wide text without overflowing the budget, indent included", () => {
    const out = wrapLine("日本語のテキストです、これは長い行", 10, "  ");
    assert.ok(out.length > 1);
    for (const l of out) {
      assert.ok(visibleWidth(l) <= 10, `${JSON.stringify(l)} is ${visibleWidth(l)} cells`);
    }
  });

  it("clamps wide text to the width including the ellipsis", () => {
    for (const [t, w] of [["🦞🦞🦞🦞🦞🦞", 10], ["日本語のテキストです", 12]]) {
      const r = fitToWidth(t, w);
      assert.ok(visibleWidth(r) <= w, `${JSON.stringify(r)} is ${visibleWidth(r)} > ${w}`);
      assert.ok(r.endsWith("…"));
    }
  });

  it("splits into cell-bounded segments", () => {
    for (const seg of sliceCells("日本語abc🦞", 4)) {
      assert.ok(visibleWidth(seg) <= 4, seg);
    }
  });
});

describe("tui welcome + overlay", () => {
  it("draws a welcome box on an empty transcript", () => {
    const box = renderWelcomeBox(
      { version: "3.144.0", model: "xai/grok-4.6", profile: "lab", cwd: "/root/xclaw" },
      { colour: false, columns: 80 }
    );
    const text = box.join("\n");
    assert.match(text, /╭/);
    assert.match(text, /XClaw/);
    assert.match(text, /3\.144\.0/);
    assert.match(text, /Welcome/);
    assert.match(text, /xai\/grok-4\.6/);
    assert.match(text, /\/root\/xclaw/);
    assert.match(text, /Shift\+Tab/);
  });

  it("shows the MCP banner and a > prompt", () => {
    const frame = renderChatScreen(
      {
        version: "3.144.0",
        model: "xai/grok-4.6",
        cwd: "/root/xclaw",
        transcript: ["hi"],
        input: "next",
        mcpBanner: "2 MCP servers need authentication · /mcp",
        overlay: "bypass",
      },
      { colour: false, columns: 80, rows: 24 }
    );
    const text = frame.join("\n");
    assert.match(text, /2 MCP servers need authentication/);
    assert.match(frame.at(-3), /> next/);
    assert.match(text, /bypass permissions on/);
  });

  it("paints live tokens in the transcript while keeping the prompt", () => {
    const frame = renderChatScreen(
      {
        version: "3.144.0",
        model: "xai/grok-4.6",
        cwd: "/root/xclaw",
        transcript: ["> ping"],
        live: "pong from the model",
        busy: true,
        input: "",
      },
      { colour: false, columns: 80, rows: 24 }
    );
    const text = frame.join("\n");
    assert.match(text, /pong from the model/);
    assert.match(frame.at(-3), /> /);
    assert.ok(!/esc to cancel/.test(frame.at(-3)));
  });

  it("cycles the overlay tighten-only", () => {
    assert.equal(cycleOverlay("bypass"), "auto");
    assert.equal(cycleOverlay("auto"), "ask");
    assert.equal(cycleOverlay("ask"), "bypass");
    assert.equal(cycleOverlay("auto", { machineBypass: false }), "ask");
    assert.equal(cycleOverlay("ask", { machineBypass: false }), "auto");
    assert.deepEqual(overlayFlags("ask"), { forceHuman: true, ignoreBypass: false });
    assert.deepEqual(overlayFlags("auto"), { forceHuman: false, ignoreBypass: true });
    assert.deepEqual(overlayFlags("bypass"), { forceHuman: false, ignoreBypass: false });
    assert.match(overlayLabel("bypass"), /bypass permissions on/);
  });
});

describe("renderMcpServers", () => {
  const base = "http://127.0.0.1:18790";

  it("names both auth pathways when a server needs credentials — the list alone is a dead end", () => {
    const lines = renderMcpServers(
      [
        { name: "github", connected: false },
        { name: "deepwiki", connected: false, error: "401 unauthorized" },
      ],
      { base, colour: false },
    );
    const text = lines.join("\n");
    assert.match(text, /github\s+needs authentication/);
    assert.match(text, /deepwiki\s+401 unauthorized/);
    assert.match(text, /xclaw mcp login <name>/);
    assert.ok(text.includes(`${base}/control/#/mcp`), "hint must carry the real Control URL");
  });

  it("stays quiet when every server is connected — no hint to authenticate what already is", () => {
    const lines = renderMcpServers(
      [{ name: "github", connected: true, toolCount: 7 }],
      { base, colour: false },
    );
    const text = lines.join("\n");
    assert.match(text, /github\s+7 tools/);
    assert.doesNotMatch(text, /mcp login|control\/#\/mcp/);
  });

  it("says none configured for an empty list, without pathways", () => {
    const text = renderMcpServers([], { base, colour: false }).join("\n");
    assert.match(text, /none configured/);
    assert.doesNotMatch(text, /mcp login/);
  });
});
