import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeGossip, acceptAgainstWatermark, readWatermark } from "../src/cluster/gossip-watermark.mjs";

describe("gossip watermark", () => {
  it("takes max across regions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-gw-"));
    const cfg = { paths: { configDir: dir } };
    mergeGossip(cfg, { generation: 3, region: "us" });
    mergeGossip(cfg, { generation: 5, region: "eu" });
    mergeGossip(cfg, { generation: 2, region: "us" });
    const w = readWatermark(cfg);
    assert.equal(w.watermark, 5);
    const stale = acceptAgainstWatermark(cfg, 4);
    assert.equal(stale.ok, false);
    const ok = acceptAgainstWatermark(cfg, 5);
    assert.equal(ok.ok, true);
  });
});
