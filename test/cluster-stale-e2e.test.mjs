import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bumpGeneration, acceptGeneration } from "../src/cluster/generation.mjs";

describe("stale generation e2e", () => {
  it("reject stale after bump", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-stale-"));
    const cfg = { paths: { configDir: dir } };
    bumpGeneration(cfg, { owner: "a" });
    bumpGeneration(cfg, { owner: "a" });
    const stale = acceptGeneration(cfg, 1);
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "STALE_GENERATION");
  });
});
