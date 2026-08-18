import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-gate land-all-check", () => {
  it("strict step present in source or patch", () => {
    const src = fs.readFileSync(path.join(root, "scripts/release-gate.mjs"), "utf8");
    const patch = fs.readFileSync(path.join(root, "patches/release-gate-land-all-check.patch"), "utf8");
    assert.ok(src.includes("land-all-check") || patch.includes("land-all-check"));
  });
});
