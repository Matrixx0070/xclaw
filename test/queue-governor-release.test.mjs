/**
 * The cost-governor halt must RELEASE when the governor does.
 *
 * kick() used to write the governor's verdict into worker.paused — the same
 * flag pauseQueue()/resumeQueue() own — so a hard-cap halt latched the queue
 * worker permanently. Nothing on either documented recovery path clears it:
 * the midnight rollover and the control UI's Resume both reset the governor
 * ledger only, and kick() returns at `if (worker.paused) return` forever.
 * Measured before the fix, against the real modules:
 *
 *   over cap     governor{hard:true  paused:true }  queueStatus.paused=true
 *   after resume governor{hard:false paused:false}  queueStatus.paused=true
 *   next day     governor{hard:false paused:false}  queueStatus.paused=true
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  startQueueWorker,
  queueStatus,
  queueSettled,
  pauseQueue,
  resumeQueue,
  enqueueJob,
  getQueueItem,
} from "../src/jobs/queue.mjs";
import { renderMetrics } from "../src/gateway/metrics.mjs";

// The dispatch tests below prove work is REFUSED or RELEASED by watching a real
// item move, and processNext's first act after the gate is to read an API key.
// With none present it fails the item immediately — a terminal state reached
// without a single network call, which is exactly the observable we want.
// node --test gives one process per file, so this affects nothing else.
for (const k of ["XCLAW_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];

const TODAY = new Date().toISOString().slice(0, 10);
const OVER_CAP = { day: TODAY, spentUsd: 99, jobs: 3, paused: true, events: [] };
const HEALTHY = { day: TODAY, spentUsd: 0, jobs: 0, paused: false, events: [] };
const YESTERDAY_OVER_CAP = { day: "2020-01-01", spentUsd: 99, jobs: 9, paused: true, events: [] };

/** kick() reads the governor detached; queueSettled() is when it has landed. */
const settle = () => queueSettled();

async function bed(ledger) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-queue-gov-"));
  const cfg = {
    paths: { configDir: dir },
    cost: { dailySoftUsd: 5, dailyHardUsd: 10, pauseQueueOnHard: true },
    queue: { concurrency: 1 },
  };
  const write = async (l) =>
    fs.writeFile(path.join(dir, "cost-governor.json"), JSON.stringify(l));
  await write(ledger);
  return {
    cfg,
    write,
    async kick() {
      startQueueWorker(cfg);
      await settle();
      return queueStatus(cfg);
    },
    async cleanup() {
      resumeQueue(cfg);
      await settle();
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* a chained kick may have recreated the queue dir; harmless */
      }
    },
  };
}

describe("queue: cost-governor halt releases", () => {
  it("stops the worker while the governor is over the hard cap", async () => {
    const b = await bed(OVER_CAP);
    const st = await b.kick();
    assert.equal(st.governorHalt, true, "governor halt must be visible");
    assert.equal(st.blocked, true, "a halted queue must report itself blocked");
    await b.cleanup();
  });

  it("releases as soon as the governor is resumed", async () => {
    const b = await bed(OVER_CAP);
    assert.equal((await b.kick()).blocked, true);
    // exactly what the control UI's Resume button does: clear the ledger flag
    await b.write(HEALTHY);
    const st = await b.kick();
    assert.equal(st.governorHalt, false, "halt must lift with the governor");
    assert.equal(st.blocked, false, "the queue must run again after a resume");
    await b.cleanup();
  });

  it("releases at the day rollover, as the halt alert promises", async () => {
    const b = await bed(OVER_CAP);
    assert.equal((await b.kick()).blocked, true);
    await b.write(YESTERDAY_OVER_CAP); // checkCostBudget resets a stale day
    const st = await b.kick();
    assert.equal(st.governorHalt, false);
    assert.equal(st.blocked, false, "'until tomorrow' must actually arrive");
    await b.cleanup();
  });

  it("does not disguise a budget halt as an operator pause", async () => {
    const b = await bed(OVER_CAP);
    const st = await b.kick();
    assert.equal(st.paused, false, "nobody pressed pause; the budget did this");
    assert.equal(st.governorHalt, true);
    await b.cleanup();
  });

  it("keeps an operator pause latched while the governor is healthy", async () => {
    const b = await bed(HEALTHY);
    await b.kick();
    pauseQueue();
    const st = await b.kick();
    assert.equal(st.paused, true, "an operator pause must not be auto-cleared");
    assert.equal(st.governorHalt, false);
    assert.equal(st.blocked, true);
    await b.cleanup();
  });

  it("will not let a queue resume override a live budget halt", async () => {
    const b = await bed(OVER_CAP);
    await b.kick();
    resumeQueue(b.cfg);
    await settle();
    const st = queueStatus(b.cfg);
    assert.equal(st.paused, false, "resumeQueue clears the operator flag");
    assert.equal(st.governorHalt, true, "but not the budget");
    assert.equal(st.blocked, true);
    await b.cleanup();
  });
});

describe("queue: halt stays observable in metrics", () => {
  it("reports the halted queue as paused and names the governor", async () => {
    const b = await bed(OVER_CAP);
    await b.kick();
    const text = await renderMetrics(b.cfg);
    assert.match(
      text,
      /^xclaw_queue_paused 1$/m,
      "a queue that will not run must still read paused=1"
    );
    assert.match(text, /^xclaw_queue_governor_halt 1$/m);
    await b.cleanup();
  });

  it("separates the two reasons a queue is stopped", async () => {
    const b = await bed(HEALTHY);
    await b.kick();
    pauseQueue();
    await b.kick();
    const text = await renderMetrics(b.cfg);
    assert.match(text, /^xclaw_queue_paused 1$/m);
    assert.match(text, /^xclaw_queue_governor_halt 0$/m, "the budget is fine");
    await b.cleanup();
  });
});

/**
 * Everything above reads queueStatus. Nothing above proves the gate.
 *
 * That gap was measured, not guessed: mutating the gate to
 * `if (worker.paused) return` (ignore the budget) or to
 * `if (worker.governorHalt) return` (ignore the operator) left the whole suite
 * GREEN — the one line that decides whether a job runs was covered by nothing.
 * These tests watch an actual queue item instead of a status field: it must sit
 * at `queued` while the gate is shut, and reach a terminal state once it opens.
 */
describe("queue: the gate refuses and releases actual work", () => {
  /** Poll until fn returns truthy, or give up. Never a fixed sleep. */
  async function waitFor(fn, ms) {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** The item has left `queued` — i.e. the worker picked it up at all. */
  const moved = (b, id, ms) =>
    waitFor(async () => {
      const it = await getQueueItem(b.cfg, id);
      return it && it.status !== "queued" ? it : null;
    }, ms);

  /**
   * The item has finished. Not the same question as `moved`: processNext writes
   * status "running" before it reads the API key, so a released job is briefly
   * neither queued nor terminal — polling for "not queued" caught that
   * in-flight state under load and read a null error off it (~25% of runs with
   * four spinners on four cores). The gate opening is `moved`; what the worker
   * then did is this.
   */
  const finished = (b, id, ms) =>
    waitFor(async () => {
      const it = await getQueueItem(b.cfg, id);
      return it && it.status !== "queued" && it.status !== "running" ? it : null;
    }, ms);

  // 400ms is 8x the worker's 50ms dispatch timer. This window can only produce
  // a false PASS under extreme load, never a false failure.
  const SHUT_MS = 400;
  const OPEN_MS = 5000;

  it("will not start a job while the governor is over the hard cap", async () => {
    const b = await bed(OVER_CAP);
    const rec = await enqueueJob(b.cfg, { goal: "must not run while over cap" });
    await settle();
    assert.equal(queueStatus(b.cfg).governorHalt, true, "precondition: halted");

    assert.equal(await moved(b, rec.id, SHUT_MS), null, "a halted queue ran a job");

    // and the same item goes the moment the budget does
    await b.write(HEALTHY);
    startQueueWorker(b.cfg);
    await settle();
    const done = await finished(b, rec.id, OPEN_MS);
    assert.ok(done, "a released queue must actually dispatch the waiting job");
    assert.equal(done.status, "failed");
    assert.match(String(done.error), /no API key/, "it really entered the worker");
    await b.cleanup();
  });

  it("will not start a job while an operator has the queue paused", async () => {
    const b = await bed(HEALTHY);
    await b.kick();
    pauseQueue();
    const rec = await enqueueJob(b.cfg, { goal: "must not run while paused" });
    await settle();
    assert.equal(queueStatus(b.cfg).paused, true, "precondition: operator pause");

    assert.equal(await moved(b, rec.id, SHUT_MS), null, "a paused queue ran a job");

    resumeQueue(b.cfg);
    await settle();
    const done = await finished(b, rec.id, OPEN_MS);
    assert.ok(done, "resume must actually dispatch the waiting job");
    assert.equal(done.status, "failed");
    assert.match(String(done.error), /no API key/);
    await b.cleanup();
  });
});
