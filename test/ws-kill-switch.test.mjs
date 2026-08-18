/**
 * stop-all / killAll closes WebSocket clients via closeAllWebSockets.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  attachWebSocketHub,
  closeAllWebSockets,
  getActiveWsHub,
} from "../src/gateway/ws-hub.mjs";
import { killAll, registerSession, unregisterSession } from "../src/agent/session-control.mjs";

describe("WS kill-switch", () => {
  it("closeAllWebSockets is safe with no hub", () => {
    const r = closeAllWebSockets("test");
    assert.equal(r.ok, true);
  });

  it("attachWebSocketHub registers active hub; closeAll clears it", async () => {
    const server = net.createServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const hub = attachWebSocketHub(server, { path: "/ws/events" });
    assert.ok(getActiveWsHub());
    assert.equal(typeof hub.closeAll, "function");
    const r = closeAllWebSockets("test-shutdown");
    assert.equal(r.ok, true);
    assert.equal(getActiveWsHub(), null);
    server.close();
  });

  it("killAll reports ws close result", async () => {
    const { sessionId } = registerSession("ws-kill-test");
    const out = await killAll({ stopComputer: false, closeWs: true });
    assert.equal(out.ok, true);
    assert.ok(out.killedSessions.includes("ws-kill-test"));
    assert.ok(out.ws);
    assert.equal(out.ws.ok, true);
    unregisterSession(sessionId);
  });
});
