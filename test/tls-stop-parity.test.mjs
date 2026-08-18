import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tryHandleGatewayStop } from "../src/gateway/stop-proxy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("TLS single-port stop parity", () => {
  it("tls.mjs wires tryHandleGatewayStop before computer proxy", () => {
    const src = fs.readFileSync(path.join(root, "src/gateway/tls.mjs"), "utf8");
    assert.ok(src.includes("tryHandleGatewayStop"));
    assert.ok(src.includes("stop-proxy.mjs"));
  });

  it("non-POST returns 405 via same handler", async () => {
    let status = 0;
    const res = {
      writeHead(c) {
        status = c;
      },
      end() {},
    };
    const handled = await tryHandleGatewayStop(
      { method: "GET", url: "/stop" },
      res,
      { gateway: { token: "s" } },
      new URL("http://local/stop")
    );
    assert.equal(handled, true);
    assert.equal(status, 405);
  });
});
