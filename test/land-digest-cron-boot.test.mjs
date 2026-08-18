import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApprovalDigestCron } from "../src/gateway/start-digest-cron.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land digest cron boot", () => {
  it("patch wires ensureApprovalDigestCronJob into gateway", () => {
    const src = fs.readFileSync(path.join(root, "patches/gateway-digest-cron-boot.patch"), "utf8");
    assert.ok(src.includes("approval-digest-job.mjs"));
    assert.ok(src.includes("ensureApprovalDigestCronJob"));
    assert.ok(src.includes("approval digest cron id="));
  });

  it("startApprovalDigestCron can be disabled", () => {
    const r = startApprovalDigestCron({ security: { digestCron: false } });
    assert.equal(r.skipped, true);
  });

  it("startApprovalDigestCron registers a job", () => {
    const r = startApprovalDigestCron({ security: {} });
    assert.equal(r.skipped, false);
    assert.ok(r.id);
  });
});
