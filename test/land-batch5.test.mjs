import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BATCH5 } from "../scripts/land-batch5.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-batch5", () => {
  it("includes authorize + collector + loop", () => {
    assert.equal(BATCH5.length, 3);
    assert.ok(BATCH5.some((e) => e.file.includes("authorize-quota-job")));
    assert.ok(BATCH5.some((e) => e.file.includes("job-receipt-collector")));
  });

  it("each patch exists", () => {
    for (const e of BATCH5) {
      assert.ok(fs.existsSync(path.join(root, e.file)), e.file);
    }
  });
});
