import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  registerSession,
  killSession,
  listActiveSessions,
  killAll,
  unregisterSession,
} from "../src/agent/session-control.mjs";

describe("session-control", () => {
  it("register and kill aborts signal", () => {
    const { sessionId, signal } = registerSession("t1", { label: "test" });
    assert.equal(signal.aborted, false);
    const r = killSession(sessionId);
    assert.equal(r.ok, true);
    assert.equal(signal.aborted, true);
    unregisterSession(sessionId);
  });

  it("listActiveSessions shows entries", () => {
    const { sessionId } = registerSession("t2");
    const list = listActiveSessions();
    assert.ok(list.some((s) => s.sessionId === sessionId));
    killSession(sessionId);
    unregisterSession(sessionId);
  });

  it("killAll aborts every session", async () => {
    const a = registerSession("ka");
    const b = registerSession("kb");
    const r = await killAll({ stopComputer: false });
    assert.equal(r.ok, true);
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, true);
    unregisterSession("ka");
    unregisterSession("kb");
  });
});
