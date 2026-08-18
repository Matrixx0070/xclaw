import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runApprovalDigestJob } from "../src/cron/approval-digest-job.mjs";

describe("digestOnlyIfPending cron", () => {
  it("stays quiet when nothing is pending", async () => {
    const deliveries = [];
    const result = await runApprovalDigestJob({
      cfg: {
        security: {
          digestTargets: [{ channel: "telegram" }],
          digestCriticalTargets: [{ channel: "pager" }],
        },
      },
      deliver: async () => {
        deliveries.push(1);
      },
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, "empty");
    assert.equal(deliveries.length, 0);
  });

  it("onlyIfPending false allows empty digest path", async () => {
    const result = await runApprovalDigestJob({
      onlyIfPending: false,
      cfg: { security: { digestOnlyIfPending: false, digestTargets: [{ channel: "x" }] } },
      deliver: async () => {},
    });
    assert.ok(result.digest);
    assert.equal(result.digest.pending, 0);
  });
});
