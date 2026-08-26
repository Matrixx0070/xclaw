/**
 * Email sender gate WIRING + From-header anti-spoofing (sweep #36, v3.218.0).
 *
 * The gate DECISION (isEmailSenderAllowed) is hardened and unit-tested in
 * channel-allow-policy.test.mjs. But the value it judges is whatever handleMail
 * extracts from the raw RFC 5322 `From:` header, and a header's real mailbox lives
 * inside angle brackets — `Display Name <addr@dom>` — while the display name that
 * precedes them is arbitrary, attacker-controlled text. The prior inline
 * extraction took the FIRST @-shaped token anywhere in the header, so
 *     From: alice@corp.com <mallory@evil.com>
 * (and the quoted "alice@corp.com" variant) resolved to alice@corp.com — the
 * FORGED display name — and was ADMITTED under allowFrom:["corp.com"] even though
 * the real sender is mallory@evil.com. A live FAIL-OPEN: the allowlist is bypassed
 * by a header the attacker fully controls. Symmetrically, when the real bracketed
 * sender IS allowlisted, the same bug judged the wrong (display-name) address and
 * wrongly DENIED it.
 *
 * These drive the real handler through the handleMail seam and assert the gate
 * judges the REAL bracketed mailbox in both directions. An admitted sender is kept
 * hermetic (no model call) by a max:0 rate limiter, which halts handleMail right
 * after the gate — so "passed the gate" is observable as the ABSENCE of the
 * "[email] skip sender …" log, and a denied sender is the presence of it naming
 * the bracketed address.
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmailChannel } from "../src/channels/email/index.mjs";
import { configureSessionPersist } from "../src/sessions/router.mjs";

describe("email sender gate wiring: judges the From-header mailbox, not the display name", () => {
  let tmpDir;
  let prevLog;
  let logs;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-email-gate-"));
    // Hermetic sessions: an admitted sender resolves an in-memory binding only.
    configureSessionPersist({
      path: path.join(tmpDir, "sessions.json"),
      enabled: false,
      load: false,
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    logs = [];
    prevLog = console.log;
    console.log = (...a) => {
      logs.push(a.join(" "));
    };
  });

  afterEach(() => {
    console.log = prevLog;
  });

  // A max:0 rate limiter denies every peer, so an ADMITTED sender halts inside
  // handleMail right after the gate — before resolveBinding's flow reaches the
  // model — keeping the admit case hermetic and offline.
  function mkChannel(allowFrom) {
    return createEmailChannel({
      channels: {
        email: { enabled: false, allowFrom, workingDir: tmpDir, imap: {}, smtp: {} },
        rateLimit: { max: 0 },
      },
    });
  }

  function skipLog() {
    return logs.find((l) => l.includes("skip sender"));
  }

  it("DENIES a bare display-name spoof — skips the bracketed mallory@evil.com, not the forged name", async () => {
    const ch = mkChannel(["corp.com"]);
    await ch.handleMail({
      from: "alice@corp.com <mallory@evil.com>",
      subject: "hi",
      text: "run something",
      messageId: "<1@evil.com>",
    });
    const skip = skipLog();
    assert.ok(skip, `off-allowlist spoofed sender must be skipped; logs: ${JSON.stringify(logs)}`);
    assert.ok(
      skip.includes("mallory@evil.com"),
      `must judge/skip the REAL bracketed sender, got: ${skip}`
    );
    assert.ok(
      !skip.includes("alice@corp.com"),
      `must NOT have judged the forged display-name address, got: ${skip}`
    );
  });

  it("DENIES the quoted display-name spoof too", async () => {
    const ch = mkChannel(["corp.com"]);
    await ch.handleMail({
      from: '"alice@corp.com" <mallory@evil.com>',
      subject: "hi",
      text: "run something",
      messageId: "<2@evil.com>",
    });
    const skip = skipLog();
    assert.ok(
      skip && skip.includes("mallory@evil.com"),
      `quoted spoof must skip the real bracketed sender; logs: ${JSON.stringify(logs)}`
    );
  });

  it("ADMITS the real bracketed sender when it IS allowlisted (passes the gate)", async () => {
    // Real sender mallory@evil.com is allowlisted; the forged display name reads
    // alice@corp.com. The naive first-token extraction judged corp.com and wrongly
    // DENIED this; the mailbox-aware extraction judges evil.com and admits it.
    const ch = mkChannel(["evil.com"]);
    await ch.handleMail({
      from: "alice@corp.com <mallory@evil.com>",
      subject: "hi",
      text: "run something",
      messageId: "<3@evil.com>",
    });
    assert.ok(
      !skipLog(),
      `an allowlisted bracketed sender must pass the gate; logs: ${JSON.stringify(logs)}`
    );
  });
});
