import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTuiFrame,
  collectTuiSnapshot,
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
    for (const flag of ["--once", "--json", "--interval", "--no-colour"]) {
      assert.ok(h.includes(flag), flag);
    }
  });
});
