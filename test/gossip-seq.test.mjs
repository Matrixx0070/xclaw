import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nextSeq, acceptSeq, readSeqLedger } from "../src/cluster/gossip-seq.mjs";

describe("gossip seq ledger", () => {
  it("accepts increasing seq and rejects <= last", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-seq-"));
    const cfg = { paths: { configDir: dir } };
    assert.equal(nextSeq(cfg, "a"), 1);
    const a1 = acceptSeq(cfg, { owner: "a", seq: 1 });
    assert.equal(a1.ok, true);
    const a1b = acceptSeq(cfg, { owner: "a", seq: 1 });
    assert.equal(a1b.ok, false);
    assert.equal(a1b.reason, "seq");
    const a2 = acceptSeq(cfg, { owner: "a", seq: 2 });
    assert.equal(a2.ok, true);
    assert.equal(readSeqLedger(cfg).owners.a.seq, 2);
  });
});
