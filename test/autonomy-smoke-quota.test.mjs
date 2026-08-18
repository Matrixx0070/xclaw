import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeQuotaEscalate } from "../src/eval/autonomy-smoke-quota.mjs";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";

describe("smoke quotaEscalate", () => {
  it("computes hardBlockRate", () => {
    const s = summarizeQuotaEscalate([
      { quotaEscalate: { hardBlocks: 1, softWarns: 2 } },
      { quotaEscalate: { hardBlocks: 0, softWarns: 0 } },
    ]);
    assert.equal(s.hardBlocks, 1);
    assert.equal(s.hardBlockRate, 0.5);
  });

  it("embeds quotaEscalate in last-smoke.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sq-"));
    const { payload } = writeAutonomySmokeArtifact(root, {
      status: 0,
      quotaEscalate: { jobs: 2, hardBlocks: 1, hardBlockRate: 0.5 },
    });
    assert.equal(payload.quotaEscalate.hardBlockRate, 0.5);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
