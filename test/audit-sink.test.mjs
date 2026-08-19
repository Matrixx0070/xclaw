import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCompactAudit } from "../src/cluster/compact-audit.mjs";
import { exportSiemBundle } from "../src/cluster/audit-siem.mjs";
import { deliverSiemBundle, lastSinkResult, getSinkFailTotal } from "../src/cluster/audit-sink.mjs";

describe("audit sink", () => {
  it("file sink writes bundle after export", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sk-"));
    const cfg = { paths: { configDir: dir }, cluster: { auditHmacSecret: "s", auditSink: "file" } };
    appendCompactAudit(cfg, { region: "us", fence: 1, compacted: true });
    const bundle = exportSiemBundle(cfg);
    const r = await deliverSiemBundle(cfg, bundle);
    assert.equal(r.ok, true);
    assert.equal(r.kind, "file");
    assert.ok(fs.existsSync(r.path));
    assert.equal(lastSinkResult().ok, true);
  });
  it("https prod fail-closed without client", async () => {
    const r = await deliverSiemBundle(
      { profile: "prod", cluster: { auditSink: "https", requireAuditSink: true } },
      { header: { to: 1 }, lines: [] }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "SINK_UNAVAILABLE");
    assert.equal(r.failClosed, true);
    assert.ok(getSinkFailTotal() >= 1);
  });
});
