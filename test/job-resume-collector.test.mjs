import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("job resume collector fields", () => {
  it("runJob source accepts opts.receiptCollector", () => {
    const src = fs.readFileSync(path.join(root, "src/jobs/job.mjs"), "utf8");
    assert.ok(src.includes("opts.receiptCollector"));
    assert.ok(src.includes("stampCostHardBlock"));
  });
});
