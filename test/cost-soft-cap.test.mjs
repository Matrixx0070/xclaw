/**
 * `dailyHardUsd` is resolved carefully in `limits()`: two candidate ceilings,
 * both filtered through `Number.isFinite`, stricter wins. `dailySoftUsd` sits
 * on the very next line with `??` and nothing else — no numeric validation and
 * no relationship to the hard cap it is supposed to sit BELOW.
 *
 * That matters more than a missed warning. The soft cap is the default for
 * `economyAtUsd`, which is the lower edge of the governor's economy band — the
 * band that reroutes to cheaper models to avoid reaching the hard cap at all.
 * `bandFor` tests halt first, so a soft cap at or above the hard cap does not
 * merely warn late: it makes the economy band UNREACHABLE, and spending goes
 * straight from normal to halt.
 *
 * The reachable case needs no malformed config. An operator who tightens
 * `autonomy.maxUsdPerDay` to $3 pulls the hard cap down to $3 while the
 * default soft cap stays at $5 — so tightening the budget is what removes the
 * cost-saving downshift.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getCostLimits,
  checkJobCostBudget,
  governorMode,
} from "../src/tokens/cost-governor.mjs";

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-softcap-"));
});
after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

function withSpend(spentUsd, cost = {}, extra = {}) {
  fs.writeFileSync(
    path.join(dir, "cost-governor.json"),
    JSON.stringify({
      day: new Date().toISOString().slice(0, 10),
      spentUsd,
      jobs: 1,
      paused: false,
      events: [],
    })
  );
  return { paths: { configDir: dir }, cost, ...extra };
}

describe("the soft cap must stay below the cap it warns about", () => {
  it("keeps an explicit soft cap that is genuinely below the hard cap", () => {
    const lim = getCostLimits({ cost: { dailySoftUsd: 20, dailyHardUsd: 60 } });
    assert.equal(lim.dailySoftUsd, 20);
    assert.equal(lim.dailyHardUsd, 60);
  });

  it("honours a soft cap of zero — economy from the first cent", () => {
    // Class 31: the strictest value is a value, not an absent one.
    assert.equal(getCostLimits({ cost: { dailySoftUsd: 0, dailyHardUsd: 60 } }).dailySoftUsd, 0);
  });

  it("pulls a soft cap back under a hard cap tightened by the autonomy level", () => {
    const lim = getCostLimits({ autonomy: { maxUsdPerDay: 3 }, cost: { dailySoftUsd: 5 } });
    assert.equal(lim.dailyHardUsd, 3);
    assert.ok(
      lim.dailySoftUsd < lim.dailyHardUsd,
      `soft $${lim.dailySoftUsd} must sit below hard $${lim.dailyHardUsd}`
    );
  });

  it("leaves the economy band reachable when autonomy tightens the budget", async () => {
    const cfg = withSpend(2, { dailySoftUsd: 5 }, { autonomy: { maxUsdPerDay: 3 } });
    const m = await governorMode(cfg);
    assert.equal(m.mode, "economy", "spend between the soft and hard caps must downshift, not halt");
  });

  it("falls back to a derived soft cap when the configured one is not a number", () => {
    const lim = getCostLimits({ cost: { dailySoftUsd: "five", dailyHardUsd: 60 } });
    assert.ok(Number.isFinite(lim.dailySoftUsd), `soft cap ${JSON.stringify(lim.dailySoftUsd)} is not finite`);
    assert.ok(lim.dailySoftUsd > 0 && lim.dailySoftUsd < 60);
  });

  it("does not run permanently in economy on a negative soft cap", () => {
    const lim = getCostLimits({ cost: { dailySoftUsd: -1, dailyHardUsd: 60 } });
    assert.ok(lim.dailySoftUsd >= 0, `soft cap ${lim.dailySoftUsd} is below zero spend`);
  });

  it("keeps the per-job cap enforceable when it is misconfigured", () => {
    // Same shape one line down: `g.perJobUsd ?? ...` with no validation, and
    // `projected > lim.perJobUsd` against NaN is false for every job forever.
    const r = checkJobCostBudget({ cost: { perJobUsd: "one" } }, 500);
    assert.equal(r.ok, false, "a $500 job passed a per-job cap");
  });
});
