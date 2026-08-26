/**
 * The Slack sender GATE wiring — WHO may command the agent over Slack.
 *
 * Slack was the sole channel of four that ran the agent for ANY inbound sender.
 * Every other channel authorizes the sender before invoking it:
 *
 *   telegram/index.mjs   if (dmPolicy === "allowlist") { policy.gateTelegram(update) … return }
 *   discord/index.mjs    if (!allowedDiscordChannel(id)) return
 *   email/index.mjs      if (!isEmailSenderAllowed(conf.allowFrom, fromAddr)) return
 *   slack/index.mjs      (nothing) → processInbound → agent
 *
 * Poll mode restricts WHERE (channelIds) but not WHO, and socket-mode
 * app_mentions arrive from ANY channel the bot is in — so an unauthorized user
 * in a monitored channel, or anyone who @-mentions the bot, drove the agent.
 * That is a real fail-OPEN, not a mere coverage hole.
 *
 * Sweep #35 (3.216.0): added `policy.gateSlack` (SENDER = msg.user) and wired it
 * into handleMessage under dmPolicy:"allowlist" (default "open" unchanged, so no
 * existing deployment regresses). The pure gate is pinned in
 * test/channel-allow-policy.test.mjs; THIS file drives the real inbound path
 * (handleInbound = handleMessage) and proves the wiring is load-bearing:
 *
 *  - allowlist + unlisted sender → DENIED  (agent NEVER invoked; no outbound)   ← the fail-open
 *  - allowlist + senderless msg  → DENIED  (no_sender; a subtype with no user must not fail open)
 *  - allowlist + listed sender   → ADMITTED (agent invoked exactly once)
 *  - default "open" + any sender → ADMITTED (pre-gate behavior preserved: no regression)
 *
 * Proof (fail-open protocol): with the gate line un-wired the DENY tests go RED —
 * an unlisted/senderless sender reaches the mock agent (calls.length === 1) —
 * while the ADMIT/open tests stay green. Wiring the gate flips the DENY tests to
 * calls.length === 0. Both directions exercised; the shipped gate line IS the fix.
 *
 * Seam: createSlackChannel(cfg, { replyWithAgent }) forwards the mock into
 * processInbound's opts (undefined in production → the real agent). The admit
 * path then calls sendMessage → global fetch, stubbed here so it stays hermetic;
 * the deny path makes NO outbound, which the fetch counter also confirms.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSlackChannel } from "../src/channels/slack/index.mjs";
import { configureSessionPersist } from "../src/sessions/router.mjs";

/** A mock agent that records each invocation and returns a deterministic reply. */
function mockReply(calls) {
  return async (opts) => {
    calls.push(opts);
    return { text: `echo:${opts.message}`, turns: 1, identity: `slack:${opts.userId}` };
  };
}

describe("slack sender gate wiring: dmPolicy allowlist gates msg.user before the agent", () => {
  let tmpDir;
  let prevFetch;
  let fetchCount;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-slack-gate-"));
    // Hermetic sessions: an admitted message resolves an in-memory binding only.
    configureSessionPersist({
      path: path.join(tmpDir, "sessions.json"),
      enabled: false,
      load: false,
    });
    // Stub the outbound so an ADMITTED message's sendMessage stays off the wire.
    prevFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ ok: true, ts: "1", result: { message_id: 1 } }) };
    };
  });

  after(() => {
    globalThis.fetch = prevFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchCount = 0;
  });

  /** dmPolicy defaults to "allowlist" here; allowFrom = one permitted user. */
  function mkChannel(calls, extra = {}) {
    const slack = {
      enabled: true,
      botToken: "xoxb-test",
      channelIds: ["C1"],
      dmPolicy: "allowlist",
      allowFrom: ["U123"],
      workingDir: tmpDir,
      ...extra,
    };
    // objectives disabled → processInbound routes straight to replyWithAgent.
    const cfg = { channels: { slack }, objectives: { enabled: false } };
    return createSlackChannel(cfg, { replyWithAgent: mockReply(calls) });
  }

  const msg = (over = {}) => ({ text: "hello", ts: "1", ...over });

  it("DENIES an unlisted sender — the agent is NEVER invoked (the fail-open)", async () => {
    const calls = [];
    const ch = mkChannel(calls);
    await ch.handleInbound(msg({ user: "U999" }), "C1");
    assert.equal(
      calls.length,
      0,
      "an unlisted Slack sender must NOT reach the agent — running it for anyone is a full sender-auth bypass"
    );
    assert.equal(fetchCount, 0, "a denied message must send no outbound");
  });

  it("DENIES a senderless message (no_sender) — a subtype with no user must not fail open", async () => {
    const calls = [];
    const ch = mkChannel(calls);
    await ch.handleInbound(msg({ user: undefined }), "C1");
    assert.equal(calls.length, 0, "a message with no msg.user must be denied, not admitted");
    assert.equal(fetchCount, 0);
  });

  it("ADMITS a listed sender — the agent runs exactly once", async () => {
    const calls = [];
    const ch = mkChannel(calls);
    await ch.handleInbound(msg({ user: "U123" }), "C1");
    assert.equal(calls.length, 1, "a listed sender must reach the agent");
    assert.equal(calls[0].channel, "slack");
    assert.equal(calls[0].userId, "U123");
    assert.equal(fetchCount, 1, "an admitted message sends its reply");
  });

  it("default dmPolicy 'open' admits ANY sender (no regression for existing deployments)", async () => {
    const calls = [];
    // No dmPolicy → "open"; allowFrom present but MUST be ignored (gate off).
    const ch = mkChannel(calls, { dmPolicy: undefined });
    await ch.handleInbound(msg({ user: "U999" }), "C1");
    assert.equal(
      calls.length,
      1,
      "with default/open policy an unlisted sender is still admitted — the gate must not activate unless dmPolicy:'allowlist'"
    );
  });

  it("the unimplemented-for-Slack 'pairing' policy falls through to open (documented)", async () => {
    const calls = [];
    const ch = mkChannel(calls, { dmPolicy: "pairing" });
    await ch.handleInbound(msg({ user: "U999" }), "C1");
    assert.equal(calls.length, 1, "'pairing' is not enforced for Slack → passes through like open");
  });
});
