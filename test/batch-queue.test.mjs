
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { enqueueFromFile } from "../src/jobs/batch.mjs";
import { listQueue } from "../src/jobs/queue.mjs";

describe("batch enqueue", () => {
  it("enqueues from JSON array file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-batch-"));
    const file = path.join(dir, "jobs.json");
    await fs.writeFile(
      file,
      JSON.stringify([{ goal: "batch goal one", priority: 2 }, { goal: "batch goal two" }])
    );
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 }, security: { autoApprove: true } };
    const out = await enqueueFromFile(cfg, file);
    assert.equal(out.count, 2);
    assert.equal(out.errors.length, 0);
    const list = await listQueue(cfg);
    assert.ok(list.length >= 2);
  });
});

describe("xclaw queue batch: the file's semantics reach the owner", () => {
  const file = async (items) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-batch-own-"));
    const f = path.join(dir, "jobs.jsonl");
    await fs.writeFile(f, items.map((i) => JSON.stringify(i)).join("\n"));
    return { dir, f };
  };

  it("posts each item to the gateway instead of writing it where nobody looks", async () => {
    const { dir, f } = await file([{ goal: "one" }, { goal: "two" }]);
    const cfg = { paths: { configDir: dir }, gateway: { port: 18790, token: "t" } };
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 202, json: async () => ({ id: `srv_${calls.length}` }) };
    };
    const out = await enqueueFromFile(cfg, f, { fetchImpl });
    assert.equal(out.count, 2);
    assert.equal(calls.length, 2, "the owner was never told about these jobs");
    assert.ok(calls[0].url.endsWith("/queue"));
    assert.equal(out.enqueued[0].id, "srv_1");
    // Nothing was written by this process: the owner writes it.
    assert.equal((await listQueue(cfg)).length, 0);
  });

  it("carries harness, class and the grounding flags across", async () => {
    const { dir, f } = await file([
      {
        goal: "verified work",
        harness: true,
        class: "interactive",
        groundHard: true,
        claimsRequireEvidence: true,
        requireStructuredClaims: true,
        verify: [{ type: "command", cmd: "true", exitCode: 0 }],
      },
    ]);
    const cfg = { paths: { configDir: dir }, gateway: { port: 18790, token: "t" } };
    let sent = null;
    const fetchImpl = async (_url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, status: 202, json: async () => ({ id: "srv_1" }) };
    };
    await enqueueFromFile(cfg, f, { fetchImpl });
    assert.equal(sent.harness, true, "a verified batch job arrived unverified");
    assert.equal(sent.class, "interactive");
    assert.equal(sent.groundHard, true);
    assert.equal(sent.claimsRequireEvidence, true);
    assert.equal(sent.requireStructuredClaims, true);
    assert.equal(sent.verify.length, 1);
  });

  it("falls back to disk when no gateway answers, and says so once", async () => {
    const { dir, f } = await file([{ goal: "one", harness: true }, { goal: "two" }]);
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 } };
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const out = await enqueueFromFile(cfg, f, { fetchImpl });
    assert.equal(out.count, 2);
    assert.match(out.note || "", /no gateway/i);
    const list = await listQueue(cfg);
    assert.equal(list.length, 2);
    assert.equal(list.find((i) => i.goal === "one").harness, true);
  });

  it("still reports an item with no goal, and enqueues the rest", async () => {
    const { dir, f } = await file([{ notAGoal: 1 }, { prompt: "two" }]);
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 } };
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const out = await enqueueFromFile(cfg, f, { fetchImpl });
    assert.equal(out.count, 1);
    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0], /goal/i);
    assert.equal(out.enqueued[0].goal, "two", "`prompt` is a goal alias");
  });

  it("reports a refused item instead of aborting the batch", async () => {
    const { dir, f } = await file([{ goal: "one" }, { goal: "two" }]);
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 }, queue: { maxDepth: 1 } };
    // The buffer is filled on disk rather than by enqueueing the first item for
    // real. A successful enqueue kicks the worker, and 50ms later processNext
    // moves that record out of "queued" — freeing the very slot the refusal
    // depends on. This test used to enqueue one and expect the second to be
    // refused, which held only while the second item arrived inside that 50ms
    // window: under CPU load it did not (measured 5 failures in 25 runs, and
    // deterministically admitted with a 120ms gap). Seeding means no enqueue
    // succeeds, so nothing kicks the worker and the depth cannot move under
    // the assertion. Both items are refused, which is the stronger proof that
    // the batch reports a refusal instead of aborting on it: the loop reached
    // item two after item one threw.
    const qdir = path.join(dir, "job-queue");
    await fs.mkdir(qdir, { recursive: true });
    const at = new Date().toISOString();
    await fs.writeFile(
      path.join(qdir, "q_seed.json"),
      JSON.stringify({ id: "q_seed", goal: "seed", status: "queued", createdAt: at, enqueuedAt: at })
    );
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const out = await enqueueFromFile(cfg, f, { fetchImpl });
    assert.equal(out.count, 0);
    assert.equal(out.errors.length, 2, "the batch aborted on the refusal instead of reporting it");
    for (const e of out.errors) assert.match(e, /queue full|maxDepth/i);
  });
});
