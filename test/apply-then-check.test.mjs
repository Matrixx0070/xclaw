import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyThenCheck } from "../src/ci/apply-then-check.mjs";

describe("applyThenCheck", () => {
  it("fails if apply fails", () => {
    const calls = [];
    const r = applyThenCheck({
      run: (args) => {
        calls.push(args.at(-1));
        return { status: 1, stderr: "boom" };
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.phase, "apply");
    assert.equal(calls.length, 1);
    assert.ok(String(calls[0]).endsWith("apply-ship-patches.mjs"));
  });

  it("fails if check fails after apply", () => {
    let n = 0;
    const r = applyThenCheck({
      script: "scripts/apply-ship-patches.mjs",
      run: (args) => {
        n += 1;
        return { status: args.includes("--check") ? 1 : 0 };
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.phase, "check");
    assert.equal(n, 2);
  });

  it("ok only when apply and check are 0", () => {
    const r = applyThenCheck({
      run: () => ({ status: 0 }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.phase, "check");
  });
});
