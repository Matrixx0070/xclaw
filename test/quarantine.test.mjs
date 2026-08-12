
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  recordCaseOutcome,
  listQuarantined,
  isQuarantined,
} from "../src/eval/quarantine.mjs";

describe("quarantine", () => {
  it("quarantines after fails with prior pass", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-q-"));
    const cfg = { paths: { configDir: dir }, eval: { quarantineFailThreshold: 2 } };
    await recordCaseOutcome(cfg, "c1", true);
    await recordCaseOutcome(cfg, "c1", false);
    await recordCaseOutcome(cfg, "c1", false);
    assert.equal(await isQuarantined(cfg, "c1"), true);
    const list = await listQuarantined(cfg);
    assert.ok(list.some((x) => x.id === "c1"));
  });
  it("clears after consecutive greens", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-q2-"));
    const cfg = {
      paths: { configDir: dir },
      eval: { quarantineFailThreshold: 2, quarantineGreenRuns: 3 },
    };
    await recordCaseOutcome(cfg, "c2", true);
    await recordCaseOutcome(cfg, "c2", false);
    await recordCaseOutcome(cfg, "c2", false);
    assert.equal(await isQuarantined(cfg, "c2"), true);
    await recordCaseOutcome(cfg, "c2", true);
    await recordCaseOutcome(cfg, "c2", true);
    await recordCaseOutcome(cfg, "c2", true);
    assert.equal(await isQuarantined(cfg, "c2"), false);
  });
});
