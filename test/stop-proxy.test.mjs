import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSinglePortStopPath, tryHandleGatewayStop } from "../src/gateway/stop-proxy.mjs";
import { registerSession } from "../src/agent/session-control.mjs";

describe("single-port stop", () => {
  it("matches gateway and computer-proxy stop paths", () => {
    assert.equal(isSinglePortStopPath("/stop"), true);
    assert.equal(isSinglePortStopPath("/xclaw/stop"), true);
    assert.equal(isSinglePortStopPath("/computer/proxy/stop"), true);
    assert.equal(isSinglePortStopPath("/xclaw/computer/stop"), true);
    assert.equal(isSinglePortStopPath("/computer/proxy/health"), false);
  });

  it("handles POST locally", async () => {
    registerSession("sess_proxy_stop", { label: "t" });
    let status = 0;
    let body = "";
    const res = {
      writeHead(s) {
        status = s;
      },
      end(b) {
        body = String(b || "");
      },
    };
    const handled = await tryHandleGatewayStop(
      { method: "POST", url: "/computer/proxy/stop", body: {} },
      res,
      {},
      { pathname: "/computer/proxy/stop" }
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    const j = JSON.parse(body);
    assert.ok(j.ok);
    assert.ok(j.drain);
  });
});
