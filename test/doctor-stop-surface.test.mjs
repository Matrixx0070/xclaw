import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachStopSummaryWithSurface } from "../src/cli/doctor-stop-summary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("doctor summary.stop.stopSurface", () => {
  it("stamps surface version", async () => {
    const report = { checks: [] };
    await attachStopSummaryWithSurface(report, root);
    assert.ok(report.summary.stop.stopSurface?.version);
    assert.equal(report.summary.stop.stopSurface.version.length, 16);
  });
});
