import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";
import { rotateSmokeBaseline } from "../src/eval/autonomy-smoke-compare.mjs";
import { pushSmokeCompareChecks } from "../src/cli/doctor-smoke-compare.mjs";

describe("doctor ops.smoke_compare", () => {
  it("warns without current smoke", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dsc-"));
    const checks = [];
    pushSmokeCompareChecks((id, status, message, extra) => checks.push({ id, status, extra }), root);
    assert.equal(checks[0].id, "ops.smoke_compare");
    assert.equal(checks[0].extra.reason, "missing_current");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("errors on regression", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dsc2-"));
    writeAutonomySmokeArtifact(root, { status: 0 });
    rotateSmokeBaseline(root);
    writeAutonomySmokeArtifact(root, { status: 1 });
    const checks = [];
    pushSmokeCompareChecks((id, status, message, extra) => checks.push({ status, extra }), root);
    assert.equal(checks[0].status, "error");
    assert.equal(checks[0].extra.reason, "regressed");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
