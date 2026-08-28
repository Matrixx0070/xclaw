import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAlerter, resetSharedAlerter } from "../src/alerting/alerts.mjs";

// Every alerter that SENDS must own its state file. `send()` persists on every
// path — including the `no_targets` skip these tests assert — so an alerter
// built without `paths.configDir` writes the operator's real
// ~/.xclaw/alert-state.json. That happened: this file put two entries
// (live-e2e:live.commit_gate, enforcement:a.bundle_navigate_hook) into the live
// box's alert history, which is the record used to diagnose real outages.
// Pinned by test/alerter-test-isolation.test.mjs.
async function isolatedCfg(alerting = {}) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-alert-b4-"));
  return { paths: { configDir }, alerting: { enabled: true, cooldownMs: 0, ...alerting } };
}

describe("B4 alerter polish", () => {
  it("exposes alertLiveE2eFailure and alertEnforcementFailure", async () => {
    resetSharedAlerter(await isolatedCfg({ targets: [] }));
    const a = createAlerter(await isolatedCfg({ targets: [], minSeverity: "error" }));
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

  it("inherits liveE2e.cron.delivery as target", async () => {
    const a = createAlerter({
      ...(await isolatedCfg()),
      liveE2e: { cron: { delivery: { channel: "telegram", to: "1" } } },
    });
    const st = a.status();
    assert.ok(st.targets.some((t) => t.channel === "telegram" && t.to === "1"));
  });
});
