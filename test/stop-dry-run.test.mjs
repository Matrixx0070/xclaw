import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleStopAll } from "../src/gateway/stop-route.mjs";
import { buildStopSignResult, stopSignMain } from "../src/cli/stop-sign.mjs";

describe("stop dry-run", () => {
  it("handleStopAll dryRun does not kill", async () => {
    const r = await handleStopAll(
      { headers: {}, body: { type: "stop", dryRun: true } },
      null,
      { cfg: {} }
    );
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.equal(r.killedSessions.length, 0);
    assert.equal(r.authMethod, "lab");
  });

  it("sign --dry-run stamps body.dryRun", () => {
    const r = buildStopSignResult(
      { gateway: { token: "t", stopHmacSecret: "s" } },
      { dryRun: true }
    );
    assert.ok(r.body.includes('"dryRun":true'));
    assert.ok(r.sig);
  });

  it("stopSignMain --dry-run reports authMethod", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const r = await stopSignMain(["--dry-run"], async () => ({
        gateway: { token: "tok" },
      }));
      assert.equal(r.dryRun, true);
      assert.equal(r.authMethod, "token");
    } finally {
      console.log = orig;
    }
  });
});
