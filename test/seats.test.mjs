import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  resolveSeat,
  checkSeatBudget,
  recordSeatUsage,
  listSeatsStatus,
  seatsEnabled,
  resetSeatDay,
} from "../src/seats/manager.mjs";

describe("seats", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-seats-"));
    cfg = {
      paths: { configDir: dir },
      seats: {
        enabled: true,
        defaultDailyUsd: 1,
        defaultDailyTokens: 1000,
        softPct: 0.5,
        hardPct: 1,
        byPeer: {
          "telegram:1": { dailyUsd: 0.01, dailyTokens: 100, label: "alice" },
        },
      },
    };
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("seatsEnabled", () => {
    assert.equal(seatsEnabled(cfg), true);
    assert.equal(seatsEnabled({}), false);
  });

  it("resolveSeat byPeer", () => {
    const s = resolveSeat(cfg, { channel: "telegram", id: "1" });
    assert.equal(s.label, "alice");
    assert.equal(s.dailyUsd, 0.01);
  });

  it("hard deny when over cap", async () => {
    await resetSeatDay(cfg);
    await recordSeatUsage(cfg, { channel: "telegram", id: "1" }, { usd: 0.02, tokens: 10 });
    const c = await checkSeatBudget(cfg, { channel: "telegram", id: "1" });
    assert.equal(c.ok, false);
    assert.equal(c.hard, true);
  });

  it("soft warn below hard", async () => {
    await resetSeatDay(cfg);
    // soft 50% of 0.01 = 0.005
    await recordSeatUsage(cfg, { channel: "telegram", id: "1" }, { usd: 0.006, tokens: 1 });
    const c = await checkSeatBudget(cfg, { channel: "telegram", id: "1" });
    assert.equal(c.ok, true);
    assert.equal(c.soft, true);
  });

  it("list status", async () => {
    const st = await listSeatsStatus(cfg);
    assert.equal(st.enabled, true);
    assert.ok(st.seats.length >= 1);
  });
});
