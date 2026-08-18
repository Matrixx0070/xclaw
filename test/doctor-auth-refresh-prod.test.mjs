import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pushAuthRefreshChecks } from "../src/tokens/auth-refresh-status.mjs";

describe("doctor ops.auth_refresh prod", () => {
  it("errors when missing status in prod", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ar-"));
    const checks = [];
    await pushAuthRefreshChecks(
      (id, status, message) => checks.push({ id, status, message }),
      { profile: "prod", paths: { configDir: dir } }
    );
    assert.equal(checks[0].status, "error");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("warns when missing status in lab", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ar2-"));
    const checks = [];
    await pushAuthRefreshChecks(
      (id, status) => checks.push(status),
      { profile: "lab", paths: { configDir: dir } }
    );
    assert.equal(checks[0], "warn");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
