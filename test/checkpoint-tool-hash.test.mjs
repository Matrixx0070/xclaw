import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveMidRunCheckpoint, loadCheckpoint } from "../src/jobs/checkpoint.mjs";

describe("checkpoint toolHashTip", () => {
  it("mid-run checkpoint includes toolHashTip from toolTrace", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cp-"));
    const cfg = { paths: { configDir: dir } };
    const id = "job_mid_hash";
    await saveMidRunCheckpoint(cfg, {
      id,
      goal: "g",
      workspace: dir,
      turns: 3,
      toolTrace: [
        { name: "bash", args: { command: "echo 1" }, result: "1" },
        { name: "bash", args: { command: "echo 2" }, result: "2" },
      ],
    });
    const cp = await loadCheckpoint(cfg, id);
    assert.ok(cp.toolHashTip, "toolHashTip present");
    assert.equal(typeof cp.toolHashTip, "string");
    assert.ok(cp.toolHashTip.length >= 16);
    assert.equal(cp.midRun, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("empty toolTrace still yields a tip", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cp2-"));
    const cfg = { paths: { configDir: dir } };
    const id = "job_empty";
    await saveMidRunCheckpoint(cfg, {
      id,
      goal: "g",
      workspace: dir,
      turns: 1,
      toolTrace: [],
    });
    const cp = await loadCheckpoint(cfg, id);
    assert.ok(cp.toolHashTip);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
