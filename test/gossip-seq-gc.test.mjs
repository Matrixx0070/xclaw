import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactSeqLedger, readSeqLedger, ownerCount } from "../src/cluster/gossip-seq.mjs";

describe("seq ledger GC", () => {
  it("drops stale keeps hot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-gc-"));
    const cfg = { paths: { configDir: dir }, cluster: { seqGcMax: 2, seqHotMs: 60_000 } };
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 86_400_000 * 2).toISOString();
    const ledger = {
      owners: {
        hot: { seq: 9, at: now },
        stale1: { seq: 1, at: old },
        stale2: { seq: 2, at: old },
        stale3: { seq: 3, at: old },
        stale4: { seq: 4, at: old },
      },
    };
    fs.writeFileSync(path.join(dir, "gossip-seq.json"), JSON.stringify(ledger));
    const r = compactSeqLedger(cfg);
    assert.equal(r.compacted, true);
    const after = readSeqLedger(cfg);
    assert.ok(after.owners.hot);
    assert.ok(ownerCount(after) <= 2);
    assert.ok(fs.existsSync(path.join(dir, "gossip-seq.json.bak")));
  });
});
