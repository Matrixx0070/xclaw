import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bumpGeneration, acceptGeneration } from "../src/cluster/generation.mjs";

describe("cluster generation fence", () => {
  it("bumps and rejects stale", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-gen-"));
    const cfg = { paths: { configDir: dir } };
    const g1 = bumpGeneration(cfg, { owner: "a" });
    assert.ok(g1.generation >= 1);
    const g2 = bumpGeneration(cfg, { owner: "a" });
    assert.ok(g2.generation > g1.generation);
    const ok = acceptGeneration(cfg, g2.generation);
    assert.equal(ok.ok, true);
    const stale = acceptGeneration(cfg, g1.generation);
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "STALE_GENERATION");
  });
});
