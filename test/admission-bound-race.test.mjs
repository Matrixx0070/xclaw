/**
 * The bound an admission decision enforces must be an input of that decision,
 * not a read of shared mutable state.
 *
 * enqueueJob configures the process-wide admission singleton, then awaits
 * countQueued (real fs I/O — guaranteed event-loop yields), then calls
 * tryAdmit. Inside that window any concurrent caller that also configures the
 * singleton — processNext does, with ITS cfg's resolved defaults — rewrites
 * maxDepth, and the decision enforces the other caller's bound. Measured
 * under 12 CPU spinners: a queue seeded to its maxDepth admitted anyway in
 * 4/20 runs, while instrumentation proved countQueued returned the correct
 * depth every time — the count was right, the bound had been widened mid-await.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createAdmissionController, getDefaultAdmission } from "../src/utils/admission.mjs";
import { enqueueJob } from "../src/jobs/queue.mjs";

describe("admission enforces the caller's bound, not the singleton's latest", () => {
  it("a per-decision maxDepth outranks the stored one", () => {
    const adm = createAdmissionController({ maxDepth: 100 });
    const refused = adm.tryAdmit({ queued: 1, maxDepth: 1 });
    assert.equal(refused.admit, false, "the decision used the stored bound instead of the caller's");
    assert.equal(refused.reason, "full");
    const admitted = adm.tryAdmit({ queued: 0, maxDepth: 1 });
    assert.equal(admitted.admit, true);
  });

  it("the stored bound still applies when the caller passes none", () => {
    const adm = createAdmissionController({ maxDepth: 2 });
    assert.equal(adm.tryAdmit({ queued: 2 }).admit, false);
    assert.equal(adm.tryAdmit({ queued: 1 }).admit, true);
  });

  it("enqueueJob refuses at its own cfg's maxDepth while a concurrent caller widens the singleton", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-bound-"));
    const qdir = path.join(dir, "job-queue");
    await fs.mkdir(qdir, { recursive: true });
    const at = new Date().toISOString();
    await fs.writeFile(
      path.join(qdir, "q_seed.json"),
      JSON.stringify({ id: "q_seed", goal: "seed", status: "queued", createdAt: at, enqueuedAt: at })
    );
    const cfg = { paths: { configDir: dir }, queue: { maxDepth: 1 } };
    // The hostile interleave, made deterministic: countQueued's fs I/O yields
    // the event loop at least once, and each setImmediate turn re-widens the
    // shared singleton — exactly what an in-flight processNext with another
    // cfg does. enqueueJob narrows the singleton once, before the await, so
    // without a per-decision bound the width ALWAYS wins by decision time.
    let hostile = true;
    (function widen() {
      if (!hostile) return;
      getDefaultAdmission({ queue: { maxDepth: 100 } });
      setImmediate(widen);
    })();
    try {
      await assert.rejects(
        () => enqueueJob(cfg, { goal: "one past the cap" }),
        (err) => {
          assert.equal(
            err.code,
            "QUEUE_FULL",
            "admission enforced a bound another caller configured mid-decision"
          );
          return true;
        }
      );
    } finally {
      hostile = false;
    }
  });
});
