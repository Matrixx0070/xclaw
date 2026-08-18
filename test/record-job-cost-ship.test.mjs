import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("record-job-cost-attribution ship patch", () => {
  it("is registered", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("record-job-cost-attribution.patch"));
    assert.ok(src.includes("stampJobCostEvent"));
  });

  it("patch stamps ledger events", () => {
    const p = fs.readFileSync(path.join(root, "patches/record-job-cost-attribution.patch"), "utf8");
    assert.ok(p.includes("stampJobCostEvent"));
    assert.ok(p.includes("result = {}"));
  });
});
