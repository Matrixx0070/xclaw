import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendApprovalDigest } from "../src/security/approval-digest.mjs";
import { DEFAULT_DIGEST_EVERY_MS } from "../src/cron/approval-digest-job.mjs";

describe("approval digest cron", () => {
  it("default interval is 5 minutes", () => {
    assert.equal(DEFAULT_DIGEST_EVERY_MS, 300_000);
  });

  it("run uses routed sendApprovalDigest", async () => {
    const result = await sendApprovalDigest(
      {
        security: {
          digestOnlyIfPending: true,
          digestTargets: [{ channel: "telegram" }],
          digestCriticalTargets: [{ channel: "pager" }],
        },
      },
      { deliver: async () => {} }
    );
    assert.equal(result.sent, false);
    assert.ok(result.reason === "empty" || result.digest.pending === 0);
  });
});
