import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";
import {
  resetHorizonPackMetrics,
  getHorizonPackPassTotal,
  incHorizonPackPass,
} from "../src/eval/horizon-pack-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon pack all", () => {
  it("apply-horizon-pack then --all offline is 11/11", async () => {
    const apply = path.join(root, "scripts/apply-horizon-pack.mjs");
    const ar = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);

    const { runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-pack-"));
    const r = await runHorizonSuiteOffline({ workspace, includeAll: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.results.filter((x) => x.ok).length, 11);

    resetHorizonPackMetrics();
    if (r.ok) incHorizonPackPass();
    assert.ok(getHorizonPackPassTotal() >= 1);

    const d = await doctorHorizon({});
    assert.equal(d.packComplete, true);
    assert.deepEqual(d.missing, []);
  });
});
