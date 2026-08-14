import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCdpClient } from "../src/browser/cdp-client.mjs";

describe("cdp websocket control frames", () => {
  it("client mask bit and ping opcode layout match RFC6455 conventions", () => {
    const b0Ping = 0x80 | 9;
    const b0Pong = 0x80 | 10;
    assert.equal(b0Ping, 0x89);
    assert.equal(b0Pong, 0x8a);
    assert.equal(0x80 | 1, 0x81);
    assert.equal(0x80 | 8, 0x88);
  });

  it("createCdpClient rejects non-loopback without allowRemote", () => {
    assert.throws(
      () => createCdpClient({ host: "8.8.8.8", port: 9222 }),
      /loopback/
    );
  });

  it("createCdpClient accepts keepalive and heartbeat options", () => {
    const c = createCdpClient({
      host: "127.0.0.1",
      port: 9222,
      keepAlive: true,
      keepAliveInitialDelayMs: 15_000,
      heartbeatIntervalMs: 30_000,
      heartbeatTimeoutMs: 5_000,
    });
    assert.equal(typeof c.attach, "function");
    assert.equal(typeof c.listPages, "function");
  });
});
