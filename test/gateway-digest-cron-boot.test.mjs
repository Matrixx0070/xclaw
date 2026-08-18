import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureApprovalDigestCronJob } from "../src/cron/approval-digest-job.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("gateway digest cron boot", () => {
  it("boot patch wires ensureApprovalDigestCronJob", () => {
    const src = fs.readFileSync(
      path.join(root, "patches/gateway-digest-cron-boot.patch"),
      "utf8"
    );
    assert.ok(src.includes("ensureApprovalDigestCronJob"));
    assert.ok(src.includes("approval digest cron"));
  });

  it("ensure helper returns a job", () => {
    const job = ensureApprovalDigestCronJob({
      cfg: { security: { digestEveryMs: 60_000 } },
      enabled: true,
    });
    assert.ok(job?.id);
    assert.equal(job.payload?.kind, "approval_digest");
  });
});
