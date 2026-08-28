import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  pickEnqueueRequest,
  enqueueJob,
  clearCompletedQueue,
  listQueue,
  queueStats,
  QUEUE_STATUSES,
  TERMINAL_QUEUE_STATUSES,
} from "../src/jobs/queue.mjs";
import { renderMetrics } from "../src/gateway/metrics.mjs";
import { createAdmissionController, getDefaultAdmission } from "../src/utils/admission.mjs";

const tmpCfg = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-abandon-"));
  return { paths: { configDir: dir }, queue: { concurrency: 1 }, profile: "dev" };
};
const writeItem = async (cfg, rec) => {
  const dir = path.join(cfg.paths.configDir, "job-queue");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${rec.id}.json`), JSON.stringify(rec));
};

describe("a per-item patience budget", () => {
  // A live probe sent POST /queue {"maxWaitMs":1500} and the record stored the
  // 300000 config default — which is correct: pickEnqueueRequest deliberately
  // withholds the admission ceiling from untrusted request bodies, exactly as
  // it withholds maxAttempts (queue-cli-owner.test.mjs:312), or a caller could
  // ask for 10**9 and never be abandoned. The field is not dead: an in-process
  // caller may still set it, and nothing pinned that half of the contract.
  it("is honoured when a trusted in-process caller sets one", async () => {
    const cfg = await tmpCfg();
    const rec = await enqueueJob(cfg, { goal: "g", maxWaitMs: 1500 });
    assert.equal(rec.maxWaitMs, 1500);
  });

  it("falls back to the config ceiling when the caller sets none", async () => {
    const cfg = await tmpCfg();
    const rec = await enqueueJob(cfg, pickEnqueueRequest({ goal: "g", maxWaitMs: 1500 }));
    assert.equal(rec.maxWaitMs, 300_000);
  });
});

describe("abandoned is a status the rest of the system knows about", () => {
  it("is one of the queue's statuses, and a terminal one", () => {
    assert.ok(QUEUE_STATUSES.includes("abandoned"));
    assert.ok(TERMINAL_QUEUE_STATUSES.includes("abandoned"));
    // running/queued are not terminal — clearing them would delete live work
    assert.ok(!TERMINAL_QUEUE_STATUSES.includes("running"));
    assert.ok(!TERMINAL_QUEUE_STATUSES.includes("queued"));
  });

  it("is reported by /metrics, which enumerated five statuses and not this one", async () => {
    // The one status that means the queue is over capacity was the one a
    // scraper could not see: /queue/stats counted it, xclaw_queue_jobs did not.
    const cfg = await tmpCfg();
    await writeItem(cfg, { id: "q_a", status: "abandoned", attempts: 0, createdAt: "2026-01-01T00:00:00Z" });
    const text = await renderMetrics(cfg);
    assert.match(text, /xclaw_queue_jobs\{status="abandoned"\} 1/);
  });

  it("is counted by /queue/stats for every status, present or not", async () => {
    const cfg = await tmpCfg();
    await writeItem(cfg, { id: "q_a", status: "abandoned", createdAt: "2026-01-01T00:00:00Z" });
    const st = await queueStats(cfg);
    assert.equal(st.abandoned, 1);
    for (const s of QUEUE_STATUSES) assert.equal(typeof st[s], "number", s);
  });

  it("reports every status the queue defines, not a private copy of the list", async () => {
    const src = await fs.readFile(new URL("../src/gateway/metrics.mjs", import.meta.url), "utf8");
    assert.match(src, /for \(const st of QUEUE_STATUSES\)/);
    assert.doesNotMatch(src, /for \(const st of \[/);
  });

  it("can be cleared — it used to be immortal", async () => {
    // clearCompletedQueue listed succeeded|failed|cancelled, so an abandoned
    // record could never be removed by any API. listQueue reads and parses
    // every file in the dir on every call, so each one is a permanent tax on
    // every enqueue, every processNext and every scrape.
    const cfg = await tmpCfg();
    await writeItem(cfg, { id: "q_a", status: "abandoned", createdAt: "2026-01-01T00:00:00Z" });
    await writeItem(cfg, { id: "q_s", status: "succeeded", createdAt: "2026-01-01T00:00:00Z" });
    const out = await clearCompletedQueue(cfg);
    assert.equal(out.removed, 2);
    assert.deepEqual(await listQueue(cfg), []);
  });

  it("does not clear work that is still live", async () => {
    const cfg = await tmpCfg();
    await writeItem(cfg, { id: "q_q", status: "queued", createdAt: "2026-01-01T00:00:00Z" });
    await writeItem(cfg, { id: "q_r", status: "running", createdAt: "2026-01-01T00:00:00Z" });
    assert.equal((await clearCompletedQueue(cfg)).removed, 0);
    assert.equal((await listQueue(cfg)).length, 2);
  });
});

describe("the admission controller's documented defaults actually apply", () => {
  // `Math.max(0, Number(cfg.maxDepth) ?? 100)` — Number(undefined) is NaN, not
  // undefined, so ?? never fires and both bounds were NaN. Every enforcement
  // site happens to call configure() with a real number first, which is why
  // this survived: the hole is behind its callers' guards.
  it("bounds the buffer at the documented 100 when the config names no depth", () => {
    const adm = createAdmissionController({});
    assert.equal(adm.snapshot().maxDepth, 100);
    assert.equal(adm.tryAdmit({ queued: 10_000, running: 0, paused: false }).admit, false);
  });

  it("abandons after the documented 300s when the config names no wait", () => {
    const adm = createAdmissionController({});
    assert.equal(adm.snapshot().maxWaitMs, 300_000);
    const old = new Date(Date.now() - 864e6).toISOString();
    assert.equal(adm.shouldAbandon({ enqueuedAt: old }), true);
  });

  it("falls back to the default rather than NaN when the value is unusable", () => {
    const adm = createAdmissionController({ maxDepth: "wide", maxWaitMs: "later" });
    assert.equal(adm.snapshot().maxDepth, 100);
    assert.equal(adm.snapshot().maxWaitMs, 300_000);
  });

  it("keeps the bounds when the operator's config file holds a typo", () => {
    // getDefaultAdmission forwards cfg.queue.* into configure() unvalidated, so
    // "maxWaitMs": "5m" in xclaw.json reached Math.max(0, NaN). enqueueJob
    // re-configures with a guarded number immediately afterwards, so the bound
    // came back before it was enforced — but anything reading the controller
    // in between (below) saw no bound at all.
    const adm = createAdmissionController({ maxDepth: 5, maxWaitMs: 50 });
    adm.configure({ maxDepth: "lots", maxWaitMs: "5m" });
    assert.equal(adm.snapshot().maxDepth, 5);
    assert.equal(adm.snapshot().maxWaitMs, 50);
    assert.equal(adm.tryAdmit({ queued: 5, running: 0, paused: false }).admit, false);
  });

  it("exposes a real bound to a reader that never configures it", () => {
    // GET /queue/admission answers `q.maxDepth ?? adm.maxDepth`, so with the
    // live config — {"queue":{"concurrency":1}} — it read the controller's own
    // value and reported it verbatim. Observed on the running 3.326.0 gateway:
    //   "policy": { "maxDepth": null, "maxWaitMs": null }
    // NaN serialises to null, so the endpoint told the operator the queue had
    // no finite buffer and no patience budget at all.
    const adm = getDefaultAdmission({ queue: { concurrency: 1 } });
    assert.ok(Number.isFinite(adm.maxDepth), "maxDepth reads as NaN -> null over HTTP");
    assert.ok(Number.isFinite(adm.maxWaitMs), "maxWaitMs reads as NaN -> null over HTTP");
  });

  it("still applies a real value through configure", () => {
    const adm = createAdmissionController({});
    adm.configure({ maxDepth: 3, maxWaitMs: 7 });
    assert.equal(adm.snapshot().maxDepth, 3);
    assert.equal(adm.snapshot().maxWaitMs, 7);
  });

  it("still honours a real configured value", () => {
    const adm = createAdmissionController({ maxDepth: 2, maxWaitMs: 5 });
    assert.equal(adm.snapshot().maxDepth, 2);
    assert.equal(adm.snapshot().maxWaitMs, 5);
    assert.equal(adm.tryAdmit({ queued: 2, running: 0, paused: false }).admit, false);
  });
});
