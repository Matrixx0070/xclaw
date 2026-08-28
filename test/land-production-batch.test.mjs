import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_BATCH } from "../scripts/land-production-batch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land production batch", () => {
  // Was six: doctor-receipt-metrics.patch was dropped in 3.288.0 once its
  // inline wire was superseded by doctor-ops-bundle.patch (batch 4).
  it("lists five clean wire patches", () => {
    assert.equal(PRODUCTION_BATCH.length, 5);
  });

  it("each patch and target exist", () => {
    for (const e of PRODUCTION_BATCH) {
      assert.ok(fs.existsSync(path.join(root, e.file)), e.file);
      assert.ok(fs.existsSync(path.join(root, e.target)), e.target);
    }
  });
});
