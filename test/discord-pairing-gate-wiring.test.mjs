/**
 * The Discord composite pairing GATE wiring — `!staticOk && !approved` at the
 * live call site (src/channels/discord/index.mjs:265-285):
 *
 *   const staticOk = isAllowed(channelId);
 *   const approved = pairing.isApproved("discord", authorId);
 *   if (!staticOk && !approved) { ...pairing request...; return; }  // <- stops here
 *
 * The two ARMS are pinned in isolation — the static allowlist (isSenderIdAllowed
 * sweep #21 / gateDiscord #23) and the pure isApproved store (#24). But every one
 * of those files carried the SAME honest limit: they pin the pure decision, not
 * the channel handler's `!staticOk && !approved` COMBINATION. Telegram's twin was
 * closed by pairing-gate-wiring.test.mjs (sweep #30) through its webhook seam;
 * that file's own note recorded Discord as the next candidate: "its handler has no
 * webhook-style seam; still open." No test drove the Discord handler, so nothing
 * proved that `approved` is even consulted at THIS call site.
 *
 * Why it matters (sweep #35, 3.217.0): dropping the approval arm — `if (!staticOk)`
 * — so an APPROVED (but not statically-allowed) DM is re-pairing-requested instead
 * of admitted, left the FULL suite green (3617/0): the wiring that consults
 * `approved` here could silently break and ship. In pairing mode that turns an
 * approved user away AND, symmetrically, a mutation that drops `!staticOk` would
 * let the wrong arm decide. The pure-store test (#24) cannot catch either — only a
 * test that drives the real handler and observes admission can.
 *
 * The seam: Discord dispatches inbound over the gateway WebSocket (connect() calls
 * handleMessage(pkt.d)); the handler is exposed as `handleInbound` so this test can
 * drive the live inbound path directly, and globalThis.fetch is stubbed to capture
 * the outbound REST calls (an admitted `/status` DM sends a DETERMINISTIC reply —
 * "XClaw Discord up …" — and returns BEFORE the agent runs, so admission is
 * observable with no model call, exactly as #30 did for Telegram).
 *
 * These pin BOTH admit arms AND the deny direction through the live handler:
 *  - static-allowlist match -> ADMITTED (reaches /status reply, no pairing request)
 *  - pairing approval       -> ADMITTED (proves `approved` is consulted here)
 *  - neither                -> DENIED  (pairing reply + a pending request recorded)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDiscordChannel } from "../src/channels/discord/index.mjs";
import { createPairingStore } from "../src/pairing/pairing-store.mjs";
import { configureSessionPersist } from "../src/sessions/router.mjs";

describe("discord pairing gate wiring: !staticOk && !approved at the live call site", () => {
  let tmpDir;
  let prevFetch;
  let calls;
  let seq = 0;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dc-pair-wire-"));
    // Hermetic sessions: an admitted DM resolves a binding; keep it in-memory,
    // no writes to ~/.xclaw and no load of real state.
    configureSessionPersist({
      path: path.join(tmpDir, "sessions.json"),
      enabled: false,
      load: false,
    });
    // Capture Discord's outbound REST (rest() -> fetch(`${REST}${path}`, …)).
    prevFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = async (url, init = {}) => {
      let body = {};
      try {
        body = JSON.parse(init.body || "{}");
      } catch {
        /* non-JSON (unused) */
      }
      calls.push({ url: String(url), method: init.method, content: body.content });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "1", message_id: 1 }),
      };
    };
  });

  after(() => {
    globalThis.fetch = prevFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function storePath() {
    seq += 1;
    return path.join(tmpDir, `pair-${seq}.json`);
  }

  function mkChannel({ allowedChannelIds, pairingStorePath }) {
    const discord = {
      enabled: true,
      token: "TEST:token",
      dmPolicy: "pairing",
      workingDir: tmpDir,
      allowedChannelIds,
      pairingStorePath,
    };
    return createDiscordChannel({ channels: { discord } });
  }

  /** A private-DM `/status`: no guild_id => isDm; an admitted sender sends a
   *  deterministic reply and returns before the agent runs. */
  function statusDm(channelId, userId) {
    return {
      id: "m10",
      channel_id: String(channelId),
      author: { id: String(userId), username: "probe" },
      content: "/status",
    };
  }

  async function drive(ch, msg) {
    const start = calls.length;
    await ch.handleInbound(msg);
    return calls
      .slice(start)
      .find((c) => c.method === "POST" && /\/channels\/.+\/messages$/.test(c.url));
  }

  it("ADMITS a statically-allowlisted DM (reaches /status, not the pairing reply)", async () => {
    const channelId = 900001;
    const userId = 700001;
    const sp = storePath();
    // staticOk arm: the DM channel id IS in the allowlist -> admitted with no approval.
    const ch = mkChannel({ allowedChannelIds: [String(channelId)], pairingStorePath: sp });
    const sent = await drive(ch, statusDm(channelId, userId));
    assert.ok(sent, "an admitted DM must produce an outbound reply");
    assert.ok(
      String(sent.content).startsWith("XClaw Discord up"),
      `a statically-allowed DM must be ADMITTED to /status, got: ${String(sent.content).slice(0, 48)}`
    );
    const pending = createPairingStore({ storePath: sp }).listPending("discord");
    assert.equal(pending.length, 0, "an admitted sender must NOT be pairing-requested");
  });

  it("ADMITS a pairing-APPROVED DM — proves `approved` is consulted at the call site", async () => {
    const channelId = 900002;
    const userId = 700002;
    const sp = storePath();
    // NON-matching static allowlist (so staticOk=false); pre-seed an APPROVED
    // pairing for this AUTHOR id -> ONLY the approval arm can admit.
    const seed = createPairingStore({ storePath: sp });
    const { code } = seed.upsertPairingRequest({ channel: "discord", id: String(userId) });
    assert.equal(seed.approve("discord", code).ok, true, "setup: approve must succeed");
    const ch = mkChannel({ allowedChannelIds: ["1"], pairingStorePath: sp });
    const sent = await drive(ch, statusDm(channelId, userId));
    assert.ok(sent, "an approved DM must produce an outbound reply");
    assert.ok(
      String(sent.content).startsWith("XClaw Discord up"),
      `an approved DM must be ADMITTED (dropping && !approved re-pairs it), got: ${String(sent.content).slice(0, 48)}`
    );
  });

  it("DENIES a DM that is neither allowlisted nor approved (pairing reply + pending request)", async () => {
    const channelId = 900003;
    const userId = 700003;
    const sp = storePath();
    const ch = mkChannel({ allowedChannelIds: ["1"], pairingStorePath: sp });
    const sent = await drive(ch, statusDm(channelId, userId));
    assert.ok(sent, "a denied DM sends the pairing reply");
    assert.ok(
      String(sent.content).startsWith("XClaw: access not configured"),
      `an unpaired DM must get the pairing reply, got: ${String(sent.content).slice(0, 48)}`
    );
    const pending = createPairingStore({ storePath: sp }).listPending("discord");
    assert.equal(pending.length, 1, "a denied sender must be recorded as a pending pairing request");
    assert.equal(String(pending[0].id), String(userId));
  });
});
