import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bumpGeneration } from "../src/cluster/generation.mjs";
import { readWatermark } from "../src/cluster/gossip-watermark.mjs";
import { resetGenerationPubsub } from "../src/cluster/generation-pubsub.mjs";

describe("signed bump merge", () => {
  it("bump merges watermark", () => {
    resetGenerationPubsub();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sb-"));
    const cfg = { paths: { configDir: dir }, cluster: { gossipHmacSecret: "s" } };
    bumpGeneration(cfg, { owner: "a" });
    const w = readWatermark(cfg);
    assert.ok(w.watermark >= 1);
  });
});
