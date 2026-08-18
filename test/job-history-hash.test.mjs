import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordJob } from "../src/jobs/history.mjs";
import { buildToolHashChain } from "../src/agent/tool-hash-chain.mjs";

describe("job history toolHashTip", () => {
  it("stamps chain tip on slim + index", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jh-"));
    const toolTrace = [{ name: "bash", args: { command: "echo 1" }, result: "1" }];
    const expected = buildToolHashChain(toolTrace);
    const { slim } = await recordJob(
      { paths: { configDir: dir } },
      { id: "job_1", goal: "g", status: "succeeded", pass: true, toolTrace }
    );
    assert.equal(slim.toolHashTip, expected.tip);
    assert.equal(slim.toolHashVersion, expected.version);
    const index = await fs.readFile(path.join(dir, "jobs", "index.jsonl"), "utf8");
    assert.ok(index.includes(expected.tip));
    await fs.rm(dir, { recursive: true, force: true });
  });
});
