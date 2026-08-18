import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stampJobToolHash } from "../src/jobs/stamp-tool-hash.mjs";
import { buildToolHashChain } from "../src/agent/tool-hash-chain.mjs";
import { recordJob } from "../src/jobs/history.mjs";

describe("stampJobToolHash", () => {
  it("fills tip from toolTrace before recordJob", () => {
    const toolTrace = [{ name: "bash", args: { command: "ls" }, result: "ok" }];
    const job = stampJobToolHash({ id: "j1", toolTrace });
    const expected = buildToolHashChain(toolTrace);
    assert.equal(job.toolHashTip, expected.tip);
    assert.equal(job.toolHashVersion, expected.version);
  });

  it("keeps an existing tip", () => {
    const job = stampJobToolHash({
      toolHashTip: "abc",
      toolHashVersion: 1,
      toolTrace: [{ name: "x" }],
    });
    assert.equal(job.toolHashTip, "abc");
  });
});

describe("recordJob mutates job tip", () => {
  it("writes tip back onto the job object", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-rj-"));
    const job = {
      id: "j2",
      goal: "g",
      status: "succeeded",
      pass: true,
      toolTrace: [{ name: "bash", args: { command: "pwd" }, result: "/" }],
    };
    await recordJob({ paths: { configDir: dir } }, job);
    assert.ok(job.toolHashTip);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
