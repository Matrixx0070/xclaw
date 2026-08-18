import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  refreshAuthBeforeCostPreflight,
  checkCostBudgetWithAuthRefresh,
} from "../src/tokens/cost-preflight-auth.mjs";

describe("cost preflight auth refresh", () => {
  it("skips when disabled", async () => {
    const r = await refreshAuthBeforeCostPreflight({
      cost: { refreshAuthBeforeBudget: false },
    });
    assert.equal(r.skipped, true);
  });

  it("calls ensureFresh for configured apps", async () => {
    const seen = [];
    const r = await refreshAuthBeforeCostPreflight(
      { cost: { refreshAppsBeforeBudget: ["xai"] } },
      {
        ensureFresh: async (_c, appId) => {
          seen.push(appId);
          return { ok: true, source: "refresh", refreshed: true };
        },
      }
    );
    assert.deepEqual(seen, ["xai"]);
    assert.equal(r.ok, true);
    assert.equal(r.results[0].refreshed, true);
  });

  it("requireAuth hard-fails when all apps fail", async () => {
    const r = await refreshAuthBeforeCostPreflight(
      {},
      {
        requireAuth: true,
        apps: ["xai"],
        ensureFresh: async () => ({ ok: false, error: "expired" }),
      }
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /re-login/i);
  });

  it("checkCostBudgetWithAuthRefresh attaches auth", async () => {
    const r = await checkCostBudgetWithAuthRefresh(
      {
        paths: { configDir: "/tmp/xclaw-cost-auth-test-missing" },
        cost: { dailyHardUsd: 100 },
      },
      {
        ensureFresh: async () => ({ ok: true, source: "store", refreshed: false }),
        apps: ["xai"],
      }
    );
    assert.ok(r.auth);
    assert.equal(r.auth.results[0].appId, "xai");
  });
});
