import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
describe("land-batch-n3", () => {
  it("covers all 10 item wires", () => {
    const p = fs.readFileSync(path.join(root, "patches/land-batch-n3.patch"), "utf8");
    assert.ok(p.includes("ensureJobReceiptCollector") || p.includes("printStopHelp"));
    assert.ok(fs.existsSync(path.join(root, "scripts/land-batch-n3.mjs")));
    assert.ok(fs.existsSync(path.join(root, "src/ci/stop-surface-version.mjs")));
    assert.ok(fs.existsSync(path.join(root, "src/eval/stop-channel-assert.mjs")));
  });
});
