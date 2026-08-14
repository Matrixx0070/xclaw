import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSharedAlerter, resetSharedAlerter } from "../src/alerting/alerts.mjs";

// Regression for the frozen target-less shared alerter (3.102.1 singleton
// class): a bare-{} early caller must not permanently disable alert delivery
// for later callers whose config has targets.
describe("shared alerter upgrade", () => {
  it("upgrades a target-less shared instance when a config with targets arrives", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-alerts-"));
    const statePath = path.join(dir, "alert-state.json");

    // simulate the health-watchdog/scheduler bare-cfg first call
    resetSharedAlerter({ alerting: { statePath } });
    assert.equal(getSharedAlerter({}).status().targets.length, 0);

    // an early alert is honestly skipped
    const skipped = await getSharedAlerter({}).send({ title: "t", severity: "error" });
    assert.equal(skipped.skipped, "no_targets");

    // a later caller (cron job with a loaded config) upgrades the singleton
    const cfg = {
      alerting: { statePath, targets: [{ channel: "telegram", to: "1" }] },
    };
    const upgraded = getSharedAlerter(cfg);
    assert.equal(upgraded.status().targets.length, 1);

    // and a subsequent bare-{} caller never downgrades it back
    assert.equal(getSharedAlerter({}).status().targets.length, 1);

    resetSharedAlerter({ alerting: { statePath } });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
