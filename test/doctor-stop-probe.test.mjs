import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { probeStopRoute, pushStopProbeChecks } from "../src/cli/doctor-stop-probe.mjs";
import { tryHandleStopRoute } from "../src/gateway/routes/stop.mjs";

describe("doctor stop live probe", () => {
  it("detects 405 GET and 401/200 POST on local server", async () => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://local");
      const handled = await tryHandleStopRoute({
        p: url.pathname,
        method: req.method,
        req,
        res,
        cfg: { gateway: { token: "secret" } },
      });
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    const r = await probeStopRoute({ host: "127.0.0.1", port });
    assert.equal(r.methodNotAllowed, true);
    assert.equal(r.getStatus, 405);
    assert.equal(r.postStatus, 401);
    assert.equal(r.ok, true);
    server.close();
  });

  it("skips without port", async () => {
    const checks = [];
    await pushStopProbeChecks((id, status) => checks.push({ id, status }), {});
    assert.equal(checks[0].id, "gateway.stopProbe");
    assert.equal(checks[0].status, "warn");
  });
});
