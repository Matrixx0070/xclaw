import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("stop in main help list", () => {
  it("land-batch-n2 patch wires stop into Commands", () => {
    const p = fs.readFileSync(path.join(root, "patches/land-batch-n2.patch"), "utf8");
    assert.ok(p.includes('case "stop":'));
    assert.ok(p.includes("printStopHelp"));
    assert.ok(p.includes("stop [--sign]") || p.includes("Kill-switch help"));
    assert.ok(p.includes("stop-sign"));
  });
});
