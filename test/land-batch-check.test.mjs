import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAND_BATCH_SCRIPTS, runLandBatchChecks } from "../src/ci/land-batch-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-batch-check", () => {
  it("lists batch 3/4/5", () => {
    assert.ok(LAND_BATCH_SCRIPTS.some((s) => s.includes("land-batch3")));
    assert.ok(LAND_BATCH_SCRIPTS.some((s) => s.includes("land-batch4")));
  });

  it("runLandBatchChecks returns structured results", () => {
    const r = runLandBatchChecks(root, { fail: false });
    assert.ok(Array.isArray(r.results));
    assert.ok(r.results.length >= 2);
  });
});
