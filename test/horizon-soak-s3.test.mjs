import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendSoakEvent } from "../src/eval/horizon-soak-siem.mjs";
import {
  soakS3Key,
  putSoakSiemBundle,
  resetSoakS3Metrics,
  getSoakS3IdempotentHit,
  getSoakS3RetryTotal,
  lastSoakS3Key,
} from "../src/eval/horizon-soak-s3.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

function memoryS3({ failFirst = 0 } = {}) {
  const store = new Map();
  let fails = failFirst;
  return {
    async headObject(key) {
      return store.has(key);
    },
    async putObject(key, body) {
      if (fails > 0) {
        fails -= 1;
        throw new Error("transient");
      }
      store.set(key, body);
      return { ok: true };
    },
    store,
  };
}

describe("horizon soak s3", () => {
  it("idempotent key is stable for same events", async () => {
    const ev = [{ at: "t", type: "resume", jobId: "j" }];
    const a = soakS3Key({ from: "a", to: "b", events: ev });
    const b = soakS3Key({ from: "a", to: "b", events: ev });
    assert.equal(a, b);
    assert.ok(a.startsWith("soak/"));
  });

  it("second put same range is hit; retries then succeeds", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s3-"));
    const cfg = { soak: { hmacSecret: "k" } };
    await appendSoakEvent({ type: "resume", jobId: "j1" }, { base, cfg });
    resetSoakS3Metrics();
    const s3 = memoryS3({ failFirst: 1 });
    const first = await putSoakSiemBundle({
      base,
      cfg,
      s3,
      owner: "exp-a",
      backoffMs: 1,
    });
    assert.equal(first.ok, true);
    assert.equal(first.hit, false);
    assert.ok(getSoakS3RetryTotal() >= 1);
    const second = await putSoakSiemBundle({
      base,
      cfg,
      s3,
      owner: "exp-b",
      backoffMs: 1,
    });
    assert.equal(second.ok, true);
    assert.equal(second.hit, true);
    assert.ok(getSoakS3IdempotentHit() >= 1);
    assert.ok(lastSoakS3Key());
  });

  it("doctor exposes s3 metrics", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.metricsS3);
    assert.equal(typeof d.s3SinkFail, "number");
  });
});
