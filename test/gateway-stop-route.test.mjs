import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryHandleStopRoute } from "../src/gateway/routes/stop.mjs";
import { registerSession } from "../src/agent/session-control.mjs";

describe("gateway stop route", () => {
  it("ignores unrelated paths", async () => {
    const r = await tryHandleStopRoute({ p: "/health", method: "GET", req: {}, res: {} });
    assert.equal(r, false);
  });

  it("handles POST /stop", async () => {
    registerSession("sess_gw_stop", { label: "t" });
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
    const handled = await tryHandleStopRoute({
      p: "/stop",
      method: "POST",
      req: { method: "POST", body: {} },
      res,
      cfg: {},
    });
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(JSON.parse(body).ok, true);
  });
});
