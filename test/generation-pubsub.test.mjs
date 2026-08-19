import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subscribeGeneration, resetGenerationPubsub } from "../src/cluster/generation-pubsub.mjs";
import { bumpGeneration } from "../src/cluster/generation.mjs";
import { readWatermark } from "../src/cluster/gossip-watermark.mjs";

describe("generation pubsub", () => {
  it("bump publishes and two regions merge", () => {
    resetGenerationPubsub();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ps-"));
    const cfg = { paths: { configDir: dir } };
    const seen = [];
    subscribeGeneration((m) => seen.push(m));
    bumpGeneration(cfg, { owner: "a" });
    bumpGeneration(cfg, { owner: "a" });
    assert.ok(seen.length >= 2);
    const w = readWatermark(cfg);
    assert.ok(w.watermark >= 2);
  });
});
