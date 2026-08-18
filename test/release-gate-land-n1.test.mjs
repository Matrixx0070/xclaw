import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-gate land-batch-n1/n2", () => {
  it("strict steps require n1 and n2 checks", () => {
    const src = fs.readFileSync(path.join(root, "scripts/release-gate.mjs"), "utf8");
    const patch = fs.existsSync(path.join(root, "patches/release-gate-land-n1-n2.patch"))
      ? fs.readFileSync(path.join(root, "patches/release-gate-land-n1-n2.patch"), "utf8")
      : "";
    const combined = src + patch;
    assert.ok(combined.includes("land-batch-n1-check"));
    assert.ok(combined.includes("land-batch-n2-check"));
    assert.ok(combined.includes("land-batch-n1.mjs"));
  });
});
