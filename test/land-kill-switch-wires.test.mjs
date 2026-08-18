import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land kill-switch wires", () => {
  it("covers full kill-switch surface in script", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/land-kill-switch-wires.mjs")));
    const src = fs.readFileSync(path.join(root, "scripts/land-kill-switch-wires.mjs"), "utf8");
    assert.ok(src.includes("stopAuthReadiness"));
    assert.ok(src.includes("handleWsStopControl"));
    assert.ok(src.includes("guardToolAgainstHardCircuit"));
    assert.ok(src.includes("stopSignMain") || src.includes("x-xclaw-token"));
    assert.ok(src.includes("attachStopSummary") || src.includes("land-batch-apply-remaining"));
    assert.ok(src.includes("ws-stop-pass-auth-headers.patch"));
    assert.ok(src.includes("stop-sign-cli.patch"));
  });
});
