import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCompactAudit } from "../src/cluster/compact-audit.mjs";
import {
  exportSiemBundle,
  verifySiemHeader,
  readCursor,
  getAuditExportTotal,
} from "../src/cluster/audit-siem.mjs";

describe("siem bundle", () => {
  it("incremental cursor and tampered header fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-siem-"));
    const cfg = { paths: { configDir: dir }, cluster: { auditHmacSecret: "s" } };
    appendCompactAudit(cfg, { region: "us", fence: 1, compacted: true });
    appendCompactAudit(cfg, { region: "us", fence: 2, compacted: true });
    const b1 = exportSiemBundle(cfg, { maxLines: 1 });
    assert.equal(b1.count, 1);
    assert.equal(readCursor(cfg).offset, 1);
    assert.equal(verifySiemHeader(b1.header, cfg).ok, true);
    const bad = { ...b1.header, count: 99 };
    assert.equal(verifySiemHeader(bad, cfg).ok, false);
    const b2 = exportSiemBundle(cfg, { maxLines: 10 });
    assert.equal(b2.count, 1);
    assert.ok(getAuditExportTotal() >= 2);
  });
});
