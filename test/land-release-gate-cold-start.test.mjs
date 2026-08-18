import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land release-gate ensure cold-start", () => {
  it("scripts/release-gate.mjs imports ensureColdStartReport", () => {
    const src = fs.readFileSync(path.join(root, "scripts/release-gate.mjs"), "utf8");
    assert.ok(src.includes("ensure-cold-start.mjs"));
    assert.ok(src.includes("ensureColdStartReport"));
    assert.ok(src.includes('step("ensure-cold-start")') || src.includes("ensure-cold-start"));
  });

  it("patch targets scripts/release-gate.mjs", () => {
    const p = fs.readFileSync(path.join(root, "patches/release-gate-ensure-cold-start.patch"), "utf8");
    assert.ok(p.includes("scripts/release-gate.mjs"));
    assert.ok(p.includes("ensureColdStartReport"));
  });
});
