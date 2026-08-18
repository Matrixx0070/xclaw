import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hardBlockRateCeiling,
  compareAutonomySmoke,
} from "../src/eval/autonomy-smoke-compare.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("hardBlockRate ceiling gate", () => {
  it("exceeds absolute threshold", () => {
    const r = hardBlockRateCeiling(
      { quotaEscalate: { hardBlockRate: 0.5 } },
      { maxHardBlockRate: 0.25 }
    );
    assert.equal(r.exceeded, true);
  });

  it("compare fails without previous when ceiling exceeded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hbr-"));
    const dir = path.join(root, "reports", "autonomy");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "last-smoke.json"),
      JSON.stringify({
        ok: true,
        quotaEscalate: { hardBlockRate: 0.9, jobs: 10, hardBlocks: 9 },
      })
    );
    const c = compareAutonomySmoke(root, { maxHardBlockRate: 0.25 });
    assert.equal(c.ok, false);
    assert.equal(c.reason, "hard_block_rate_ceiling");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
