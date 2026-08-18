import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-gate land-batch3-check", () => {
  it("patch or source includes the step", () => {
    const src = fs.readFileSync(path.join(root, "scripts/release-gate.mjs"), "utf8");
    const patch = fs.readFileSync(path.join(root, "patches/release-gate-land-batch3.patch"), "utf8");
    assert.ok(src.includes("land-batch3-check") || patch.includes("land-batch3-check"));
  });
});
