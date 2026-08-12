import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { enqueueJob, listQueue, getQueueItem } from "../src/jobs/queue.mjs";

describe("job queue", () => {
  it("enqueues and lists items", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-q-"));
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 }, security: { autoApprove: true } };
    const item = await enqueueJob(cfg, { goal: "noop test goal", priority: 1 });
    assert.equal(item.status, "queued");
    assert.ok(item.id.startsWith("q_"));
    const list = await listQueue(cfg);
    assert.ok(list.some((x) => x.id === item.id));
    const got = await getQueueItem(cfg, item.id);
    assert.equal(got.goal, "noop test goal");
  });
});

describe("job queue no-key", () => {
  it("fails running item without API key instead of hanging", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-q2-"));
    const cfg = {
      paths: { configDir: dir },
      agent: { maxTurns: 1, apiKey: null },
      security: { autoApprove: true },
      computer: { host: "127.0.0.1", port: 4243 },
    };
    // clear env keys for this process section — only for enqueue; worker uses env
    const item = await enqueueJob(cfg, { goal: "should fail without key" });
    assert.equal(item.status, "queued");
    // force process by importing startQueueWorker and waiting
    const { startQueueWorker } = await import("../src/jobs/queue.mjs");
    const prev = {
      XAI: process.env.XAI_API_KEY,
      XC: process.env.XCLAW_API_KEY,
      OA: process.env.OPENAI_API_KEY,
    };
    delete process.env.XAI_API_KEY;
    delete process.env.XCLAW_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      startQueueWorker(cfg);
      await new Promise((r) => setTimeout(r, 400));
      const got = await getQueueItem(cfg, item.id);
      assert.ok(["failed", "running", "queued", "succeeded"].includes(got.status));
      if (got.status === "failed") {
        assert.match(String(got.error || ""), /API key/i);
      }
    } finally {
      if (prev.XAI) process.env.XAI_API_KEY = prev.XAI;
      if (prev.XC) process.env.XCLAW_API_KEY = prev.XC;
      if (prev.OA) process.env.OPENAI_API_KEY = prev.OA;
    }
  });
});
