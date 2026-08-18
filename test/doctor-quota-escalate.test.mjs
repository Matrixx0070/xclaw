import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";
import { pushQuotaEscalateChecks } from "../src/cli/doctor-quota-escalate.mjs";

describe("doctor ops.quota_escalate", () => {
  it("errors when hardBlockRate exceeds max", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dq-"));
    writeAutonomySmokeArtifact(root, {
      status: 0,
      quotaEscalate: { jobs: 4, hardBlocks: 3, hardBlockRate: 0.75 },
    });
    const checks = [];
    pushQuotaEscalateChecks((id, status, message, extra) => checks.push({ id, status, extra }), root, {
      maxHardBlockRate: 0.25,
    });
    assert.equal(checks[0].id, "ops.quota_escalate");
    assert.equal(checks[0].status, "error");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
