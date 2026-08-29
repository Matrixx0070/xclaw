/**
 * The swarm ledger read `cfg.cost.dailyHardUsd` — the SAME key the cost
 * governor reads — but guarded it with `n > 0 ? n : 50`, which treats the
 * strictest possible setting as an absent one. Proven against the real
 * modules before the fix:
 *
 *   cost.dailyHardUsd = 0  ->  swarmLedger hard=$50   governor hard=$0
 *   cost.dailyHardUsd = -5 ->  swarmLedger hard=$50   governor hard=$-5
 *
 * One key, two readers, opposite meanings, resolving fail-OPEN: an operator
 * freezing spend got a $50 budget on the path `src/jobs/job.mjs` reserves
 * against. Honouring 0 makes `hard === 0` reachable for the first time, so
 * the pressure figure (duplicated verbatim in two reporters) had to stop
 * dividing by it and reading 0 = healthy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dailyHardUsd,
  ledgerPressure,
  reserveUsd,
} from "../src/tokens/swarm-ledger.mjs";
import { getCostLimits } from "../src/tokens/cost-governor.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-zcap-"));

describe("swarm ledger: a zero cap means zero, not 'unset'", () => {
  it("honours cost.dailyHardUsd = 0", () => {
    assert.equal(dailyHardUsd({ cost: { dailyHardUsd: 0 } }), 0);
  });

  it("honours tokens.dailyHardUsd = 0", () => {
    assert.equal(dailyHardUsd({ tokens: { dailyHardUsd: 0 } }), 0);
  });

  it("clamps a negative cap to 0 rather than widening it to the default", () => {
    assert.equal(dailyHardUsd({ cost: { dailyHardUsd: -5 } }), 0);
  });

  it("still falls back for a value that is not a number at all", () => {
    assert.equal(dailyHardUsd({ cost: { dailyHardUsd: "sixty" } }), 50);
  });

  it("still honours an ordinary positive cap", () => {
    assert.equal(dailyHardUsd({ cost: { dailyHardUsd: 60 } }), 60);
  });

  it("still defaults when no cap is configured", () => {
    assert.equal(dailyHardUsd({}), 50);
  });

  it("agrees with the cost governor about what 0 means on the shared key", () => {
    const cfg = { cost: { dailyHardUsd: 0 } };
    assert.equal(dailyHardUsd(cfg), getCostLimits(cfg).dailyHardUsd);
  });
});

describe("swarm ledger: a zero cap actually blocks", () => {
  it("denies any positive reserve", () => {
    const cfg = { paths: { configDir: tmp() }, cost: { dailyHardUsd: 0 } };
    const deny = reserveUsd(cfg, { swarmId: "s", childId: "c", usd: 0.01 });
    assert.equal(deny.ok, false);
    assert.equal(deny.code, "SWARM_LEDGER_HARD_CAP");
    assert.equal(deny.hardUsd, 0);
  });

  it("still admits a zero-cost reserve", () => {
    const cfg = { paths: { configDir: tmp() }, cost: { dailyHardUsd: 0 } };
    assert.equal(reserveUsd(cfg, { swarmId: "s", childId: "c", usd: 0 }).ok, true);
  });
});

describe("ledgerPressure: a zero cap is not a healthy cap", () => {
  it("reads fully consumed when the cap is 0 and anything was spent", () => {
    assert.equal(ledgerPressure(0.5, 0, 0), 1);
    assert.equal(ledgerPressure(0, 0.5, 0), 1);
  });

  it("reads idle when the cap is 0 and nothing was spent", () => {
    assert.equal(ledgerPressure(0, 0, 0), 0);
  });

  it("divides normally under a positive cap", () => {
    assert.equal(ledgerPressure(3, 1, 8), 0.5);
  });
});

describe("both pressure reporters ask the ledger", () => {
  const src = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("gateway stop-health asks ledgerPressure", () => {
    const s = src("../src/gateway/stop-health.mjs");
    assert.match(s, /ledgerPressure\(spent, reserved, hard\)/);
    assert.doesNotMatch(s, /hard > 0 \?/, "stop-health still computes pressure inline");
  });

  it("doctor's swarm-ledger row asks ledgerPressure", () => {
    const s = src("../src/cli/doctor-swarm-ledger.mjs");
    assert.match(s, /ledgerPressure\(spent, reserved, hard\)/);
    assert.doesNotMatch(s, /hard > 0 \?/, "doctor still computes pressure inline");
  });
});
