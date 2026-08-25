import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLoopCostBudget } from "../src/tokens/loop-cost-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("loop cost auth wire", () => {
  it("checkLoopCostBudget returns budget + auth", async () => {
    const r = await checkLoopCostBudget(
      {
        paths: { configDir: "/tmp/xclaw-loop-cost-missing" },
        cost: { dailyHardUsd: 50 },
      },
      {
        apps: ["xai"],
        ensureFresh: async () => ({ ok: true, source: "store", refreshed: false }),
      }
    );
    assert.ok(r.ok !== undefined);
    assert.ok(r.auth);
    assert.equal(r.auth.results[0].appId, "xai");
  });

  // This used to assert that patches/loop-cost-auth-refresh.patch mentions
  // checkLoopCostBudget — a past migration's input, not the shipped code, so it
  // held whether or not the loop still called the check. What the loop DOES
  // with a refusal (rejects before ensureComputer/createSession, never reaching
  // the model) is covered behaviourally in test/loop-budget-enforcement.test.mjs.
  it("loop-cost-check module exists", () => {
    assert.ok(fs.existsSync(path.join(root, "src/tokens/loop-cost-check.mjs")));
  });
});
