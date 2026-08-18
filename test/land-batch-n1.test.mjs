import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
describe("land-batch-n1", () => {
  it("script and mega-patch exist", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/land-batch-n1.mjs")));
    const p = fs.readFileSync(path.join(root, "patches/land-batch-n1.patch"), "utf8");
    assert.ok(p.includes("dryRun"));
    assert.ok(p.includes("stop-fire-drill"));
  });
});
