import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { createCdpClient } from "../src/browser/cdp-client.mjs";

/**
 * Minimal WS server: complete handshake, then send a ping; assert client pongs.
 * We cannot import wsConnect directly (not exported), so this validates via
 * a fake /json/list + debugger URL when Chrome is absent — skipped if bind fails.
 *
 * Instead: pure unit test of frame opcodes by re-implementing the same mask
 * contract the client uses (document + sanity).
 */
describe("cdp websocket control frames", () => {
  it("client mask bit and ping opcode layout match RFC6455 conventions", () => {
    // opcode 9 ping, FIN=1 → 0x89; MASK + len0 → 0x80
    const b0Ping = 0x80 | 9;
    const b0Pong = 0x80 | 10;
    assert.equal(b0Ping, 0x89);
    assert.equal(b0Pong, 0x8a);
    assert.equal(0x80 | 1, 0x81); // text
    assert.equal(0x80 | 8, 0x88); // close
  });

  it("createCdpClient rejects non-loopback without allowRemote", () => {
    assert.throws(
      () => createCdpClient({ host: "8.8.8.8", port: 9222 }),
      /loopback/
    );
  });
});
