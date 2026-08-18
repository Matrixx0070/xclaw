import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack land-kill-switch-wires", () => {
  it("preflight --check is wired", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    const patch = fs.readFileSync(path.join(root, "patches/ship-pack-land-ks.patch"), "utf8");
    assert.ok(src.includes("land-kill-switch-wires.mjs") || patch.includes("land-kill-switch-wires.mjs"));
    assert.ok(patch.includes("--check"));
  });
});
