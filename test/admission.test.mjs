import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  qedStaffing,
  offeredLoadErl,
  createAdmissionController,
} from "../src/utils/admission.mjs";

describe("admission / QED", () => {
  it("qedStaffing uses square-root safety", () => {
    assert.equal(qedStaffing(0), 1);
    assert.equal(qedStaffing(100, 0), 100);
    assert.equal(qedStaffing(100, 1), 110); // 100 + sqrt(100)
    assert.ok(qedStaffing(400, 1) >= 420);
  });

  it("offeredLoadErl is lambda * E[S]", () => {
    assert.equal(offeredLoadErl({ arrivalsPerSec: 2, meanServiceSec: 5 }), 10);
  });

  it("rejects when queue at maxDepth", () => {
    const adm = createAdmissionController({ maxDepth: 2, concurrency: 1 });
    assert.equal(adm.tryAdmit({ queued: 0 }).admit, true);
    assert.equal(adm.tryAdmit({ queued: 1 }).admit, true);
    const d = adm.tryAdmit({ queued: 2 });
    assert.equal(d.admit, false);
    assert.equal(d.reason, "full");
    assert.equal(adm.snapshot().metrics.rejectedFull, 1);
  });

  it("deterministic patience abandon", () => {
    const adm = createAdmissionController({ maxWaitMs: 1000 });
    const item = { createdAt: new Date(Date.now() - 5000).toISOString() };
    assert.equal(adm.shouldAbandon(item), true);
    assert.equal(adm.shouldAbandon({ createdAt: new Date().toISOString() }), false);
  });

  it("suggestConcurrency respects cap", () => {
    const adm = createAdmissionController({ maxConcurrencyCap: 8, concurrency: 2 });
    const s = adm.suggestConcurrency({
      arrivalsPerSec: 10,
      meanServiceSec: 20,
      beta: 1,
    });
    // a=200 → huge staffing, capped at 8
    assert.equal(s.suggested, 8);
    assert.ok(s.a >= 200);
  });
});
