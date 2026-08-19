import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimOnBoot } from "../src/cluster/boot-claim.mjs";
import { readGeneration } from "../src/cluster/generation.mjs";

describe("boot claim", () => {
  it("claims when coordinator", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-boot-"));
    const cfg = { paths: { configDir: dir }, cluster: { role: "coordinator" } };
    const r = claimOnBoot(cfg);
    assert.equal(r.claimed, true);
    assert.ok(readGeneration(cfg).generation >= 1);
  });
});
