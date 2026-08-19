import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireCursorLease, releaseCursorLease } from "../src/cluster/audit-cursor-lease.mjs";
import { exportAndPutS3 } from "../src/cluster/audit-s3-export.mjs";
import { appendCompactAudit } from "../src/cluster/compact-audit.mjs";

describe("audit cursor lease", () => {
  it("second exporter skips while leased", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-acl-"));
    const cfg = { paths: { configDir: dir }, cluster: { auditHmacSecret: "s" } };
    const a = acquireCursorLease(cfg, { owner: "gw-a" });
    assert.equal(a.ok, true);
    appendCompactAudit(cfg, { region: "us", fence: 1, compacted: true });
    const r = await exportAndPutS3(cfg, async () => {}, { owner: "gw-b" });
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    releaseCursorLease(cfg, { owner: "gw-a" });
  });
});
