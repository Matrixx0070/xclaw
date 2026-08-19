import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCompactAudit, readLastAudit } from "../src/cluster/compact-audit.mjs";
import {
  verifyAuditEvent,
  verifyLastN,
  signAuditEvent,
  resetAuditHmacFail,
  getAuditHmacFailTotal,
} from "../src/cluster/compact-audit-hmac.mjs";

describe("audit hmac", () => {
  it("prod requires secret", () => {
    resetAuditHmacFail();
    const v = verifyAuditEvent(
      { at: "t", region: "us" },
      { profile: "prod", cluster: { requireAuditHmac: true } }
    );
    assert.equal(v.ok, false);
    assert.equal(v.code, "AUDIT_HMAC_REQUIRED");
  });
  it("tampered line fails verify", () => {
    resetAuditHmacFail();
    const cfg = { cluster: { auditHmacSecret: "s", auditHmacSecretPrevious: "old" } };
    const ev = signAuditEvent({ at: "t", region: "eu", fence: 1, compacted: true }, cfg);
    ev.fence = 99;
    const v = verifyAuditEvent(ev, cfg);
    assert.equal(v.ok, false);
    assert.ok(getAuditHmacFailTotal() >= 1);
  });
  it("append then verify last N", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ah-"));
    const cfg = { paths: { configDir: dir }, cluster: { auditHmacSecret: "s" } };
    appendCompactAudit(cfg, { region: "us", fence: 2, compacted: true });
    const last = readLastAudit(cfg);
    const v = verifyLastN([JSON.stringify(last)], cfg, 10);
    assert.equal(v.ok, true);
  });
});
