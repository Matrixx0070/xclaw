import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("record tool tokens wire", () => {
  it("apply lands token + soft + canary needles", () => {
    const apply = path.join(root, "scripts/apply-n12b-loop-agent-core.mjs");
    const r = spawnSync(process.execPath, [apply], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const src = fs.readFileSync(path.join(root, "src/agent/loop.mjs"), "utf8");
    assert.match(src, /recordToolTokens/);
    assert.match(src, /stampCostBlock|costGov/);
    assert.match(src, /softCanaryRecover|runHallucinationCanary/);
  });
});
