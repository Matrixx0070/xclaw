import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listActiveSessions,
  killSession,
} from "../src/agent/session-control.mjs";

describe("session kill integration", () => {
  it("registerSession still works standalone", async () => {
    const { registerSession, unregisterSession } = await import(
      "../src/agent/session-control.mjs"
    );
    const { sessionId, signal } = registerSession("kill-loop-test");
    assert.equal(listActiveSessions().some((s) => s.sessionId === sessionId), true);
    killSession(sessionId);
    assert.equal(signal.aborted, true);
    unregisterSession(sessionId);
  });

  it("runAgentLoop registers and unregisters session", async () => {
    // HERMETIC: this test once assumed "delete XAI_API_KEY = no credential →
    // fast failure". After credentials moved into the profile store, the key
    // resolved from ~/.xclaw anyway and every `npm test` made a REAL paid
    // grok-4.5 call and wrote it to the REAL cost ledger (38 calls / $0.55
    // before the Logs UI made it visible, 2026-08-13). Isolate HOME/state so
    // no stored credential can resolve, pin the baseUrl to a dead loopback
    // port so nothing can escape even if one does, and disable the ledger.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-kill-loop-"));
    const savedHome = process.env.HOME;
    const savedState = process.env.XCLAW_STATE_DIR;
    process.env.HOME = tmpHome;
    process.env.XCLAW_STATE_DIR = path.join(tmpHome, ".xclaw");

    const { runAgentLoop } = await import("../src/agent/loop.mjs");
    const before = listActiveSessions().length;
    const cfg = {
      profile: "lab",
      security: { autoApprove: true },
      agent: {
        model: "xai/grok-4.5",
        maxTurns: 1,
        baseUrl: "http://127.0.0.1:1", // dead port — no request can succeed
      },
      tokens: { ledger: false },
      paths: { configDir: process.env.XCLAW_STATE_DIR },
      computer: { enabled: false },
      router: { enabled: false },
    };
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.XCLAW_API_KEY;
    try {
      await runAgentLoop({
        userMessage: "noop",
        cfg,
        chatSessionId: "test-register-wire",
        workingDir: process.cwd(),
      }).catch(() => null);
    } finally {
      if (prev) process.env.XAI_API_KEY = prev;
      process.env.HOME = savedHome;
      if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
      else process.env.XCLAW_STATE_DIR = savedState;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
    // After return, session should be unregistered
    const still = listActiveSessions().filter((s) => s.sessionId === "test-register-wire");
    assert.equal(still.length, 0, "session should be unregistered after loop");
    assert.ok(true);
  });
});
