/**
 * stop-all / killAll: in-flight sessions abort promptly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  registerSession,
  killAll,
  listActiveSessions,
  unregisterSession,
  killSession,
  getSessionSignal,
} from "../src/agent/session-control.mjs";

describe("session kill-switch", () => {
  it("killSession aborts signal for in-flight waiter", async () => {
    const { sessionId, signal } = registerSession("ks-one");
    assert.equal(signal.aborted, false);
    const aborted = new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve(true), { once: true });
    });
    const r = killSession(sessionId);
    assert.equal(r.ok, true);
    assert.equal(await aborted, true);
    assert.equal(getSessionSignal(sessionId).aborted, true);
    unregisterSession(sessionId);
  });

  it("killAll aborts every active session", async () => {
    const a = registerSession("ks-a");
    const b = registerSession("ks-b");
    assert.ok(listActiveSessions().length >= 2);
    const both = Promise.all([
      new Promise((r) => a.signal.addEventListener("abort", () => r("a"), { once: true })),
      new Promise((r) => b.signal.addEventListener("abort", () => r("b"), { once: true })),
    ]);
    const out = await killAll({ stopComputer: false });
    assert.equal(out.ok, true);
    assert.ok(out.killedSessions.includes("ks-a"));
    assert.ok(out.killedSessions.includes("ks-b"));
    const names = await both;
    assert.deepEqual(names.sort(), ["a", "b"]);
    unregisterSession("ks-a");
    unregisterSession("ks-b");
  });

  it("unknown session kill is not ok", () => {
    const r = killSession("does-not-exist-xyz");
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_session");
  });
});
