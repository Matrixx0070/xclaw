import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { casWriteShard, resetCasReject, getCasRejectTotal } from "../src/cluster/compact-cas.mjs";

describe("compact CAS write", () => {
  it("stale fence leaves file unchanged", () => {
    resetCasReject();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cas-"));
    const fp = path.join(dir, "gossip-seq.us.json");
    const ok = casWriteShard(fp, { owners: { a: { seq: 1 } } }, { fence: 5 });
    assert.equal(ok.ok, true);
    const before = fs.readFileSync(fp, "utf8");
    const stale = casWriteShard(fp, { owners: { evicted: { seq: 99 } } }, { fence: 2 });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "CAS_REJECT");
    assert.equal(fs.readFileSync(fp, "utf8"), before);
    assert.ok(getCasRejectTotal() >= 1);
    const json = JSON.parse(before);
    assert.ok(!json.owners.evicted);
  });
});
