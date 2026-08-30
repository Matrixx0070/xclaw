/**
 * Gateway live-e2e cron is documented in docs/PROD_PRESET.md and mapped
 * by liveE2eCronOptionsFromConfig, but until this slice the in-process
 * scheduler was only armed by `xclaw live-e2e-schedule`. A stock gateway
 * never registered the job, so `"enabled": true` in xclaw.json was a no-op.
 *
 * Inverse of doctor/eval: those default on (`enabled !== false`). Live-e2e
 * spawns Chromium and can spend, so the gateway requires the boolean true.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs";
import { applyProfile } from "../src/config/profiles.mjs";
import {
  armLiveE2eCronJob,
  ensureLiveE2eCronJob,
  liveE2eCronShouldArm,
} from "../src/cron/live-e2e-job.mjs";
import { cancelJob, listJobs } from "../src/cron/scheduler.mjs";

function cancelLiveE2eJobs() {
  for (const j of listJobs()) {
    if (j.name === "live-e2e" || j.payload?.kind === "live-e2e") cancelJob(j.id);
  }
}

afterEach(cancelLiveE2eJobs);

describe("live-e2e gateway cron opt-in", { concurrency: false }, () => {
  it("stays off unless enabled is the boolean true", () => {
    for (const cfg of [
      {},
      { liveE2e: {} },
      { liveE2e: { cron: {} } },
      { liveE2e: { cron: { enabled: false } } },
      { liveE2e: { cron: { enabled: "true" } } },
      { liveE2e: { cron: { enabled: 1 } } },
      { liveE2e: { cron: { enabled: "yes" } } },
    ]) {
      assert.equal(liveE2eCronShouldArm(cfg), false, JSON.stringify(cfg));
    }
    assert.equal(liveE2eCronShouldArm({ liveE2e: { cron: { enabled: true } } }), true);
  });

  it("does not register a job when the opt-in is missing", () => {
    cancelLiveE2eJobs();
    const before = listJobs().length;
    assert.equal(armLiveE2eCronJob({}), null);
    assert.equal(armLiveE2eCronJob({ liveE2e: { cron: { enabled: false } } }), null);
    assert.equal(armLiveE2eCronJob({ liveE2e: { cron: { enabled: "true" } } }), null);
    assert.equal(listJobs().length, before);
  });

  it("registers an anchored nightly job when enabled === true", () => {
    const cfg = {
      liveE2e: { cron: { enabled: true, everyMs: 86_400_000, strict: true } },
    };
    const job = armLiveE2eCronJob(cfg);
    assert.ok(job?.id);
    assert.equal(job.name, "live-e2e");
    assert.equal(job.enabled, true);
    assert.equal(job.payload?.kind, "live-e2e");
    assert.equal(job.schedule?.kind, "every");
    assert.equal(job.schedule?.everyMs, 86_400_000);
    assert.equal(job.anchorKey, "cron.liveE2e");
    const listed = listJobs().filter((j) => j.payload?.kind === "live-e2e");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, job.id);
  });

  it("ensureLiveE2eCronJob stamps the restart-surviving anchor by default", () => {
    const job = ensureLiveE2eCronJob({ enabled: true, everyMs: 3_600_000 });
    assert.equal(job.anchorKey, "cron.liveE2e");
    assert.equal(job.schedule.everyMs, 3_600_000);
  });

  it("dev/lab/prod profiles do not silently opt the gateway in", () => {
    for (const profile of ["dev", "lab", "prod"]) {
      const cfg = applyProfile({
        profile,
        security: {},
        agent: {},
        gateway: {},
      });
      assert.equal(
        liveE2eCronShouldArm(cfg),
        false,
        `${profile} must not arm live-e2e`
      );
    }
  });

  it("doctor reports live-e2e cron as opt-in, not default-on", () => {
    const doc = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(doc, /probe: "liveE2e\.cron"/);
    assert.match(doc, /liveE2e\?\.cron\?\.enabled === true/);
    assert.match(doc, /opt-in off \(set liveE2e\.cron\.enabled: true to arm\)/);
    assert.doesNotMatch(doc, /liveE2e\?\.cron\?\.enabled !== false/);
  });

  it("gateway boot calls the opt-in helper, not the doctor/eval default-on gate", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    assert.match(gw, /import \{ armLiveE2eCronJob \} from "\.\.\/cron\/live-e2e-job\.mjs"/);
    assert.match(gw, /armLiveE2eCronJob\(cfg, \{ root \}\)/);
    // The spend-runaway: treating live-e2e like doctor (`!== false`) would
    // register the job on every stock gateway. The helper is the single
    // reader; the boot site must not re-implement a looser gate next to it.
    assert.doesNotMatch(gw, /liveE2e\?\.cron\?\.enabled\s*!==\s*false/);
    assert.doesNotMatch(gw, /ensureLiveE2eCronJob\(/);
  });
});
