import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { casWriteShard } from "../src/cluster/compact-cas.mjs";
import { readLastAudit, countAuditLines } from "../src/cluster/compact-audit.mjs";

describe("compact audit", () => {
  it("successful CAS appends audit line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-au-"));
    const fp = path.join(dir, "gossip-seq.eu.json");
    const r = casWriteShard(fp, { owners: { a: { seq: 1 } } }, { fence: 3 });
    assert.equal(r.ok, true);
    const last = readLastAudit({ paths: { configDir: dir } });
    assert.ok(last);
    assert.equal(last.region, "eu");
    assert.equal(last.fence, 3);
    assert.equal(last.compacted, true);
    assert.ok(countAuditLines({ paths: { configDir: dir } }) >= 1);
  });
});
