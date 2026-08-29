/**
 * `resolveSeat` resolves six numbers with bare `??` and no validation, and
 * `checkSeatBudget` multiplies them: `dailyUsd * hardPct`. A non-numeric value
 * anywhere in that product makes the cap NaN, and `projected > NaN` is false
 * for every spend forever — so a malformed seat budget does not fail closed,
 * it removes the seat cap entirely.
 *
 * The ordering shape sits alongside it: hard is tested BEFORE soft, so a soft
 * percentage at or above the hard one makes the warning band unreachable. That
 * needs no malformed config — an operator who tightens `hardPct` to 0.5 leaves
 * the default `softPct` of 0.8 above it, and the seat jumps from allowed to
 * denied with no warning first.
 *
 * Zero stays zero on both: `hardPct: 0` means deny everything and `softPct: 0`
 * means warn from the first cent. Both are the strictest value, not an absent
 * one, and `x || default` throws exactly those away.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSeat, checkSeatBudget } from "../src/seats/manager.mjs";

let dir;
const peer = { channel: "telegram", id: "1" };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-seatcap-"));
});
after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

function seatCfg(seats, { spentUsd = 0, tokens = 0 } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(dir, "seats-ledger.json"),
    JSON.stringify({
      day,
      seats: { "telegram:1": { day, spentUsd, tokens, jobs: 1, denies: 0, events: [] } },
    })
  );
  return { paths: { configDir: dir }, seats: { enabled: true, ...seats } };
}

const BUDGET = { defaultDailyUsd: 1, defaultDailyTokens: 1000 };

describe("a seat cap must stay a number, and the warning must stay reachable", () => {
  it("still denies when the seat budget is not a number", async () => {
    const cfg = seatCfg({ ...BUDGET, defaultDailyUsd: "five" }, { spentUsd: 100 });
    const r = await checkSeatBudget(cfg, peer);
    assert.equal(r.ok, false, "a $100 seat passed a malformed daily cap");
  });

  it("still denies when the hard percentage is not a number", async () => {
    const cfg = seatCfg({ ...BUDGET, hardPct: "one" }, { spentUsd: 100 });
    const r = await checkSeatBudget(cfg, peer);
    assert.equal(r.ok, false, "a $100 seat passed a malformed hard percentage");
  });

  it("still denies on tokens when the token budget is not a number", async () => {
    const cfg = seatCfg({ ...BUDGET, defaultDailyTokens: "lots" }, { tokens: 10_000_000 });
    const r = await checkSeatBudget(cfg, peer);
    assert.equal(r.ok, false, "10M tokens passed a malformed token cap");
  });

  it("leaves the warning band reachable when the hard cap is tightened", async () => {
    // hardPct 0.5 against the default softPct 0.8: without the invariant the
    // seat goes straight from allowed to denied with no warning first.
    const cfg = seatCfg({ ...BUDGET, hardPct: 0.5 }, { spentUsd: 0.45 });
    const r = await checkSeatBudget(cfg, peer);
    assert.equal(r.ok, true, "spend below the hard cap must not be denied");
    assert.equal(r.soft, true, "spend approaching a tightened hard cap must warn first");
  });

  it("honours a hard percentage of zero — deny everything", async () => {
    const seat = resolveSeat(seatCfg({ ...BUDGET, hardPct: 0 }), peer);
    assert.equal(seat.hardPct, 0, "the strictest hard percentage is a value, not an absent one");
    const r = await checkSeatBudget(seatCfg({ ...BUDGET, hardPct: 0 }, { spentUsd: 0.01 }), peer);
    assert.equal(r.ok, false, "a seat pinned to zero spend allowed $0.01");
  });

  it("honours a soft percentage of zero — warn from the first cent", async () => {
    const cfg = seatCfg({ ...BUDGET, softPct: 0, hardPct: 1 }, { spentUsd: 0.01 });
    const r = await checkSeatBudget(cfg, peer);
    assert.equal(r.ok, true);
    assert.equal(r.soft, true, "a seat pinned to warn from the first cent did not warn");
  });

  it("does not warn permanently on a negative soft percentage", async () => {
    const seat = resolveSeat(seatCfg({ ...BUDGET, softPct: -1 }), peer);
    assert.ok(seat.softPct >= 0, `soft percentage ${seat.softPct} is below zero spend`);
  });

  it("keeps a sane explicit pair untouched", () => {
    const seat = resolveSeat(seatCfg({ ...BUDGET, softPct: 0.5, hardPct: 1 }), peer);
    assert.equal(seat.softPct, 0.5);
    assert.equal(seat.hardPct, 1);
  });

  it("treats an explicit null override as unset, not as a zero budget", () => {
    // `??` skipped null as well as undefined; a JSON config that writes an
    // unset field as null must still fall through to the seat default rather
    // than resolving to a $0 budget that denies the peer outright.
    const cfg = seatCfg({ ...BUDGET, byPeer: { "telegram:1": { dailyUsd: null, hardPct: null } } });
    const seat = resolveSeat(cfg, peer);
    assert.equal(seat.dailyUsd, 1, "an explicit null budget collapsed to zero spend");
    assert.equal(seat.hardPct, 1);
  });

  it("keeps the unconfigured defaults", () => {
    const seat = resolveSeat({ seats: { enabled: true } }, peer);
    assert.deepEqual(
      { u: seat.dailyUsd, t: seat.dailyTokens, s: seat.softPct, h: seat.hardPct },
      { u: 2, t: 500_000, s: 0.8, h: 1.0 }
    );
  });
});
