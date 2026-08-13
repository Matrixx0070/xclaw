import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import smoke for every extracted routes module: the tryHandle function
// exists and returns false for an unmatched path (live behavior is covered by
// the full suite + gateway boot smoke).
const MODULES = [
  ["security", "tryHandleSecurityRoute"],
  ["swarm", "tryHandleSwarmRoute"],
  ["cron", "tryHandleCronRoute"],
  ["jwks", "tryHandleJwksRoute"],
  ["alerts", "tryHandleAlertsRoute"],
  ["ops", "tryHandleOpsRoute"],
  ["eval-queue", "tryHandleEvalQueueRoute"],
  ["tokens", "tryHandleTokensRoute"],
  ["sessions", "tryHandleSessionsRoute"],
  ["subagents", "tryHandleSubagentsRoute"],
  ["mcp", "tryHandleMcpRoute"],
  ["media", "tryHandleMediaRoute"],
  ["providers", "tryHandleProvidersRoute"],
  ["channels", "tryHandleChannelsRoute"],
];

describe("gateway routes modules (split)", () => {
  for (const [mod, fn] of MODULES) {
    it(`routes/${mod}.mjs exports ${fn} and passes on unmatched paths`, async () => {
      const m = await import(`../src/gateway/routes/${mod}.mjs`);
      assert.equal(typeof m[fn], "function", `${fn} missing`);
      const handled = await m[fn]({
        p: "/definitely/not/a/route",
        method: "GET",
        req: { headers: {} },
        res: {},
        url: new URL("http://local/definitely/not/a/route"),
        cfg: {},
        json: () => {
          throw new Error("json() must not be called for unmatched path");
        },
        readBody: async () => ({}),
      });
      assert.equal(handled, false);
    });
  }
});
