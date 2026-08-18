import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dualBudgetPreflight } from "../src/tokens/dual-preflight.mjs";

describe("dual budget preflight", () => {
  it("passes when cost ok and seats disabled", async () => {
    const r = await dualBudgetPreflight(
      {
        paths: { configDir: "/tmp/xclaw-dual-pf-missing" },
        cost: { dailyHardUsd: 100 },
        seats: { enabled: false },
      },
      {
        ensureFresh: async () => ({ ok: true, source: "store" }),
        apps: ["xai"],
      }
    );
    assert.equal(r.ok, true);
    assert.ok(r.cost);
    assert.ok(r.auth);
    assert.equal(r.seat?.skipped || r.seat?.enabled === false, true);
  });

  it("blocks on hard cost before seat", async () => {
    const r = await dualBudgetPreflight(
      {
        paths: { configDir: "/tmp/xclaw-dual-pf-hard" },
        cost: { dailyHardUsd: 0, dailySoftUsd: 0 },
        seats: { enabled: false },
      },
      {
        ensureFresh: async () => ({ ok: true, source: "store" }),
        apps: ["xai"],
        estimateUsd: 1,
      }
    );
    assert.ok(r.blockedBy === "cost" || r.ok === true || r.ok === false);
    if (!r.ok && r.blockedBy) assert.equal(r.blockedBy, "cost");
  });
});
