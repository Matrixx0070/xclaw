import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeStop } from "../src/gateway/stop-auth.mjs";
import { handleStopAll } from "../src/gateway/stop-route.mjs";

describe("POST /stop HMAC/token", () => {
  it("rejects missing token when configured", () => {
    const r = authorizeStop({ headers: {} }, { gateway: { token: "secret" } });
    assert.equal(r.ok, false);
    assert.equal(r.code, "STOP_UNAUTHORIZED");
  });

  it("accepts bearer token", () => {
    const r = authorizeStop(
      { headers: { authorization: "Bearer secret" } },
      { gateway: { token: "secret" } }
    );
    assert.equal(r.ok, true);
  });

  it("handleStopAll returns 401 without token", async () => {
    let status = 0;
    const res = {
      writeHead(s) {
        status = s;
      },
      end() {},
    };
    const r = await handleStopAll({ headers: {} }, res, { cfg: { gateway: { token: "s" } } });
    assert.equal(r.ok, false);
    assert.equal(status, 401);
  });
});
