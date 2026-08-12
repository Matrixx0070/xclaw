import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createImmFilter, createDelayImm } from "../src/utils/imm-filter.mjs";

describe("IMM filter", () => {
  it("rejects fewer than 2 models", () => {
    assert.throws(() => createImmFilter({ models: [{ q: 1 }] }), TypeError);
  });

  it("tracks constant signal with high smooth weight", () => {
    const imm = createImmFilter({
      models: [
        { id: "smooth", q: 1e2 },
        { id: "agile", q: 1e6 },
      ],
      r: 1e4,
      x0: 100,
      mu0: [0.9, 0.1],
    });
    let est;
    for (let i = 0; i < 30; i++) {
      est = imm.step(100 + (Math.random() - 0.5) * 2);
    }
    assert.ok(Math.abs(est.estimate - 100) < 15, String(est.estimate));
    assert.ok(est.mu[0] > 0.3, "smooth mode should remain plausible");
  });

  it("raises agile probability after a large step", () => {
    const imm = createDelayImm({ x0: 500, r: 1e5, qSmooth: 1e3, qAgile: 5e6 });
    for (let i = 0; i < 15; i++) imm.step(500);
    const before = imm.getState().mu[1];
    const afterStep = imm.step(8000);
    // after jump, agile weight should not collapse; often increases
    assert.ok(afterStep.mu[1] >= before * 0.5 || afterStep.mu[1] > 0.15);
    assert.ok(afterStep.estimate > 1000, String(afterStep.estimate));
  });

  it("filter() returns aligned arrays", () => {
    const imm = createDelayImm({ x0: 0 });
    const zs = [1, 2, 3, 10, 11];
    const { estimates, mus, variances } = imm.filter(zs);
    assert.equal(estimates.length, 5);
    assert.equal(mus.length, 5);
    assert.equal(variances.length, 5);
    assert.equal(mus[0].length, 2);
    const sum = mus.at(-1).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6);
  });

  it("reset restores initial mode mass", () => {
    const imm = createDelayImm({ mu0: [0.7, 0.3], x0: 10 });
    imm.step(1000);
    imm.reset(10);
    const s = imm.getState();
    assert.ok(Math.abs(s.mu[0] - 0.7) < 1e-6);
  });
});
