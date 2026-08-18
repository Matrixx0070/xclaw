import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land kill-switch wires", () => {
  it("covers full kill-switch + n1 + n2 surface", () => {
    const src = fs.readFileSync(path.join(root, "scripts/land-kill-switch-wires.mjs"), "utf8");
    assert.ok(src.includes("stopAuthReadiness"));
    assert.ok(src.includes("dryRun"));
    assert.ok(src.includes("stop-fire-drill"));
    assert.ok(src.includes("land-batch-n1.patch"));
    assert.ok(src.includes("attachReceiptCollectorToJob"));
    assert.ok(src.includes("printStopHelp"));
    assert.ok(src.includes("openapi-stop-dryrun"));
    assert.ok(src.includes("land-batch-n2.patch"));
  });
});
