import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  partitionDigestItems,
  buildRoutedApprovalDigest,
} from "../src/security/approval-digest-route.mjs";

describe("approval digest routing", () => {
  it("splits critical away from soft", () => {
    const { critical, soft } = partitionDigestItems([
      { id: "1", tool: "bash", risk: { tier: "critical" } },
      { id: "2", tool: "read", risk: { tier: "low" } },
    ]);
    assert.equal(critical.length, 1);
    assert.equal(soft.length, 1);
    assert.equal(critical[0].id, "1");
  });

  it("does not send critical items to soft channel payload", () => {
    const routed = buildRoutedApprovalDigest(
      {
        items: [
          { id: "c", tool: "rm", risk: "critical" },
          { id: "s", tool: "ls", risk: "low" },
        ],
      },
      {
        security: {
          digestTargets: [{ channel: "telegram" }],
          digestCriticalTargets: [{ channel: "pager" }],
        },
      }
    );
    assert.equal(routed.critical.items.length, 1);
    assert.equal(routed.soft.items.length, 1);
    assert.equal(routed.soft.items[0].id, "s");
    assert.equal(routed.critical.targets[0].channel, "pager");
    assert.equal(routed.soft.targets[0].channel, "telegram");
  });
});
