import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land kill-switch wires", () => {
  it("script and patch exist", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/land-kill-switch-wires.mjs")));
    const patch = fs.readFileSync(path.join(root, "patches/land-kill-switch-wires.patch"), "utf8");
    assert.ok(patch.includes("stopAuthReadiness"));
    assert.ok(patch.includes("handleWsStopControl"));
    assert.ok(patch.includes("guardToolAgainstHardCircuit"));
    assert.ok(patch.includes("+    cfg,"));
  });
});
