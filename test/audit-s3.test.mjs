import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCompactAudit } from "../src/cluster/compact-audit.mjs";
import { readCursor } from "../src/cluster/audit-siem.mjs";
import { s3Key, getS3RetryTotal } from "../src/cluster/audit-s3.mjs";
import { exportAndPutS3 } from "../src/cluster/audit-s3-export.mjs";

describe("audit s3 retry", () => {
  it("fail once then succeed; key shape", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-s3-"));
    const cfg = {
      paths: { configDir: dir },
      cluster: { auditHmacSecret: "s", auditAccount: "acme", s3Retries: 3 },
    };
    appendCompactAudit(cfg, { region: "us", fence: 1, compacted: true });
    let n = 0;
    const put = async ({ key }) => {
      n += 1;
      if (n === 1) throw new Error("boom");
      assert.match(key, /^audit\/acme\/\d+\.json$/);
    };
    const r = await exportAndPutS3(cfg, put);
    assert.equal(r.ok, true);
    assert.equal(r.retries, 1);
    assert.ok(getS3RetryTotal() >= 1);
    assert.equal(s3Key({ account: "acme", to: 1 }), "audit/acme/1.json");
  });
  it("does not advance cursor if all puts fail", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-s3f-"));
    const cfg = { paths: { configDir: dir }, cluster: { auditHmacSecret: "s", s3Retries: 2 } };
    appendCompactAudit(cfg, { region: "eu", fence: 2, compacted: true });
    const put = async () => {
      throw new Error("down");
    };
    const r = await exportAndPutS3(cfg, put);
    assert.equal(r.ok, false);
    assert.equal(readCursor(cfg).offset, 0);
  });
});
