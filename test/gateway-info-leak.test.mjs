import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryHandleOpsRoute } from "../src/gateway/routes/ops.mjs";

// Regression (2026-08-13): /gateway/info returned `gateway: cfg.gateway`
// VERBATIM — including the operator token — on a route that is deliberately
// reachable without auth (UIs poll it for status chips). Any unauthenticated
// loopback caller got the key to every token-gated API. The route must only
// ever expose a sanitized subset.

describe("/gateway/info secret hygiene", () => {
  it("never includes the operator token (or any token-looking value)", async () => {
    const cfg = {
      gateway: {
        host: "127.0.0.1",
        port: 18790,
        token: "xclaw_SUPER_SECRET_OPERATOR_TOKEN",
        authStrict: true,
        tls: { cert: "", key: "", ca: "" },
      },
      computer: { host: "127.0.0.1", port: 4243 },
      agent: { model: "m", maxTurns: 5 },
      paths: { configFile: "/tmp/x.json" },
    };
    let body = null;
    const handled = await tryHandleOpsRoute({
      p: "/gateway/info",
      method: "GET",
      req: { headers: {} },
      res: {},
      url: new URL("http://local/gateway/info"),
      cfg,
      json: (_res, _code, payload) => {
        body = payload;
      },
      webchatEnabled: true,
      channelManager: { status: () => [] },
      XCLAW_VERSION: "0.0.0-test",
      XCLAW_PHASE: 0,
    });
    assert.equal(handled, true);
    assert.ok(body, "handler produced a body");
    const flat = JSON.stringify(body);
    assert.equal(
      flat.includes("SUPER_SECRET_OPERATOR_TOKEN"),
      false,
      "operator token leaked into /gateway/info"
    );
    assert.equal(body.gateway.token, undefined, "raw token field present");
    // The UI still needs to know whether a token is required:
    assert.equal(body.gateway.tokenSet, true);
    assert.equal(body.gateway.authStrict, true);
  });
});
