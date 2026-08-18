import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveMidRunCheckpoint, loadCheckpoint } from "../src/jobs/checkpoint.mjs";

describe("checkpoint quotaEscalate", () => {
  it("persists quota escalate on mid-run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cpq-"));
    const cfg = { paths: { configDir: dir } };
    await saveMidRunCheckpoint(cfg, {
      id: "job_cpq",
      goal: "g",
      workspace: dir,
      turns: 2,
      quotaEscalate: { softWarns: 1, hardBlocks: 0, escalatedFromSoft: 0, lastCode: "SOFT" },
    });
    const cp = await loadCheckpoint(cfg, "job_cpq");
    assert.equal(cp.quotaEscalate.softWarns, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
