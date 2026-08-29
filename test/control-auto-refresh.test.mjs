import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshGate, REFRESH_LABEL } from "../ui/control/auto-refresh.mjs";

// The module is imported under node — the browser wiring must be inert here
// (no document), or this import itself would have thrown.

test("control auto-refresh gate", async (t) => {
  const clocked = (start = 0) => {
    let t0 = start;
    return { tick: (ms) => (t0 += ms), gate: createRefreshGate({ minGapMs: 5000, now: () => t0 }) };
  };

  await t.test("a hidden window never fires, for any trigger", () => {
    const { gate } = clocked();
    for (const trigger of ["nav", "manual", "focus", "interval"]) {
      assert.equal(gate.shouldFire(trigger, { hidden: true }), false, trigger);
    }
  });

  await t.test("the first interval tick fires — a fresh gate holds nothing back", () => {
    const { gate } = clocked(1000);
    assert.equal(gate.shouldFire("interval"), true);
  });

  await t.test("interval and focus respect the gap; nav and manual do not", () => {
    const { gate, tick } = clocked(1000);
    assert.equal(gate.shouldFire("interval"), true);
    tick(1000); // 1s later — inside the 5s gap
    assert.equal(gate.shouldFire("interval"), false);
    assert.equal(gate.shouldFire("focus"), false);
    // A human switching views or pressing Refresh is always honored.
    assert.equal(gate.shouldFire("nav"), true);
    assert.equal(gate.shouldFire("manual"), true);
  });

  await t.test("a nav fire re-arms the gap — the focus event riding the same click collapses", () => {
    const { gate, tick } = clocked(1000);
    assert.equal(gate.shouldFire("nav"), true);
    tick(10); // focus lands ~same instant as the nav
    assert.equal(gate.shouldFire("focus"), false);
    tick(5000);
    assert.equal(gate.shouldFire("focus"), true);
  });

  await t.test("after the gap passes, the interval fires again", () => {
    const { gate, tick } = clocked(1000);
    assert.equal(gate.shouldFire("interval"), true);
    tick(5001);
    assert.equal(gate.shouldFire("interval"), true);
  });

  await t.test("default state is visible — omitting state fires", () => {
    const { gate } = clocked();
    assert.equal(gate.shouldFire("nav"), true);
  });

  await t.test("the wiring re-fires buttons by the exact label the pages use", () => {
    assert.equal(REFRESH_LABEL, "Refresh");
  });
});
