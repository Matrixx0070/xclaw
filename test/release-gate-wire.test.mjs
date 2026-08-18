import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-gate --strict wire", () => {
  it("script imports evaluateReleaseGateStrict", () => {
    const src = fs.readFileSync(path.join(root, "scripts/release-gate.mjs"), "utf8");
    assert.ok(src.includes("evaluateReleaseGateStrict"));
    assert.ok(src.includes("flake-cold-start"));
    assert.ok(src.includes("readSoakFlakeCounts"));
  });
});
