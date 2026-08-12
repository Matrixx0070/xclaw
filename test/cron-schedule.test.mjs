import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNextRun } from "../src/cron/schedule.mjs";

// All expectations use LOCAL time (the parser matches with getHours/getDay).
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function next(expr, fromMs) {
  return computeNextRun({ kind: "cron", expr }, fromMs);
}

describe("cron 5-field parser", () => {
  // 2026-01-07 is a Wednesday (local)
  const wed = local(2026, 1, 7, 10, 30);

  it("REGRESSION: '0 0 * * 1' fires only on Monday, not daily", () => {
    const n = next("0 0 * * 1", wed);
    const d = new Date(n);
    assert.equal(d.getDay(), 1, "must be Monday");
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
    assert.equal(n, local(2026, 1, 12), "next Monday midnight, not tomorrow");
  });

  it("dow 7 is a Sunday alias", () => {
    const n = next("0 0 * * 7", wed);
    assert.equal(new Date(n).getDay(), 0);
    assert.equal(n, local(2026, 1, 11));
  });

  it("day-of-month restriction", () => {
    const n = next("0 12 15 * *", wed);
    assert.equal(n, local(2026, 1, 15, 12, 0));
  });

  it("month restriction skips ahead", () => {
    const n = next("0 0 1 3 *", wed);
    assert.equal(n, local(2026, 3, 1));
  });

  it("dom+dow both restricted → OR semantics (Vixie rule)", () => {
    // From Wed Jan 7: dom=9 (Fri) vs dow=1 (Mon Jan 12) → earlier wins (Jan 9)
    const n = next("0 0 9 * 1", wed);
    assert.equal(n, local(2026, 1, 9));
    // And from Jan 9 onward the next hit is Monday Jan 12 (dow side)
    const n2 = next("0 0 9 * 1", local(2026, 1, 9, 0, 0));
    assert.equal(n2, local(2026, 1, 12));
  });

  it("ranges, lists, and steps", () => {
    assert.equal(next("0 9-17 * * *", local(2026, 1, 7, 18, 0)), local(2026, 1, 8, 9, 0));
    assert.equal(next("15,45 * * * *", local(2026, 1, 7, 10, 20)), local(2026, 1, 7, 10, 45));
    const n = next("*/15 * * * *", local(2026, 1, 7, 10, 31));
    assert.equal(n, local(2026, 1, 7, 10, 45));
    // range with step: every 2nd hour 8-16
    assert.equal(next("0 8-16/2 * * *", local(2026, 1, 7, 11, 0)), local(2026, 1, 7, 12, 0));
  });

  it("weekday range (mon-fri) skips the weekend", () => {
    // 2026-01-10 is a Saturday
    const n = next("0 9 * * 1-5", local(2026, 1, 10, 12, 0));
    assert.equal(n, local(2026, 1, 12, 9, 0));
  });

  it("minute/hour behavior preserved from the old parser", () => {
    const n = next("30 14 * * *", wed);
    assert.equal(n, local(2026, 1, 7, 14, 30));
  });

  it("garbage falls back to +60s (legacy behavior)", () => {
    assert.equal(next("not a cron", wed), wed + 60_000);
    assert.equal(next("99 99 * * *", wed), wed + 60_000);
  });

  it("unsatisfiable date (Feb 30) falls back instead of hanging", () => {
    assert.equal(next("0 0 30 2 *", wed), wed + 60_000);
  });
});
