import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureKeyStore } from "../src/auth/key-rotation.mjs";
import {
  runRotationOnce,
  startKeyRotationScheduler,
  stopKeyRotationScheduler,
  getSchedulerStatus,
} from "../src/auth/key-rotation-scheduler.mjs";

describe("automated key rotation scheduler", () => {
  it("runRotationOnce does not rotate when not due", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sch-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "sched-test-secret!!",
          rotationStrategy: "ttl",
          maxAgeMs: 999999999,
          autoRotate: true,
        },
      },
    };
    await ensureKeyStore(cfg);
    const r = await runRotationOnce(cfg);
    assert.equal(r.rotated, false);
  });

  it("scheduler start/stop", () => {
    stopKeyRotationScheduler();
    const s = startKeyRotationScheduler(
      { auth: { keys: { autoRotate: false } } },
      { intervalMs: 60_000, runImmediately: false }
    );
    assert.equal(s.ok, true);
    assert.equal(getSchedulerStatus().running, true);
    stopKeyRotationScheduler();
    assert.equal(getSchedulerStatus().running, false);
  });
});
