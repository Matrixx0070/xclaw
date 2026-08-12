import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAlerter, resetSharedAlerter } from "../src/alerting/alerts.mjs";

describe("B4 alerter polish", () => {
  it("exposes alertLiveE2eFailure and alertEnforcementFailure", async () => {
    resetSharedAlerter({
      alerting: { enabled: true, targets: [], cooldownMs: 0 },
    });
    const a = createAlerter({
      alerting: { enabled: true, targets: [], minSeverity: "error", cooldownMs: 0 },
    });
    assert.equal(typeof a.alertLiveE2eFailure, "function");
    assert.equal(typeof a.alertEnforcementFailure, "function");
    const live = await a.alertLiveE2eFailure({
      exitCode: 2,
      fails: 1,
      results: [{ id: "live.commit_gate", status: "fail" }],
    });
    assert.equal(live.skipped, "no_targets");
    const enf = await a.alertEnforcementFailure({
      failedIds: ["a.bundle_navigate_hook"],
      message: "missing marker",
    });
    assert.equal(enf.skipped, "no_targets");
  });

  it("inherits liveE2e.cron.delivery as target", () => {
    const a = createAlerter({
      alerting: { enabled: true, cooldownMs: 0 },
      liveE2e: { cron: { delivery: { channel: "telegram", to: "1" } } },
    });
    const st = a.status();
    assert.ok(st.targets.some((t) => t.channel === "telegram" && t.to === "1"));
  });
});
