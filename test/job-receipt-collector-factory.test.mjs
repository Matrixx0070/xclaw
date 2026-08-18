import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("job receipt collector factory", () => {
  it("patch uses createReceiptCollector", () => {
    const p = fs.readFileSync(path.join(root, "patches/job-receipt-collector.patch"), "utf8");
    assert.ok(p.includes("createReceiptCollector"));
    assert.ok(p.includes("copyCollectorOntoJob"));
  });
});
