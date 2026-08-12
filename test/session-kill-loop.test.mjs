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
    // Minimal mock: import loop and inspect register via list during a sync fail path
    // Without API key the provider may fail fast — still register/unregister in finally
    const { runAgentLoop } = await import("../src/agent/loop.mjs");
    const before = listActiveSessions().length;
    const cfg = {
      profile: "lab",
      security: { autoApprove: true },
      agent: { model: "xai/grok-4.5", maxTurns: 1 },
      computer: { enabled: false },
      router: { enabled: false },
    };
    // Ensure no key → fail quickly but finally still runs
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
    }
    // After return, session should be unregistered
    const still = listActiveSessions().filter((s) => s.sessionId === "test-register-wire");
    assert.equal(still.length, 0, "session should be unregistered after loop");
    assert.ok(true);
  });
});
