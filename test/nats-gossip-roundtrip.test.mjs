import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishNatsGossip, attachNatsSubscriber } from "../src/cluster/nats-gossip.mjs";
import { readWatermark } from "../src/cluster/gossip-watermark.mjs";

describe("nats mock bus roundtrip", () => {
  it("subscribe merges watermark", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-nrt-"));
    const handlers = [];
    const nats = {
      subscribe(_s, fn) {
        handlers.push(fn);
        return { handlers };
      },
      async publish(_s, body) {
        for (const fn of handlers) fn(body);
      },
    };
    const cfg = {
      paths: { configDir: dir },
      cluster: { gossipTransport: "nats", gossipHmacSecret: "s", account: "default" },
      nats,
    };
    const sub = attachNatsSubscriber(cfg);
    assert.equal(sub.ok, true);
    const r = await publishNatsGossip(cfg, {
      generation: 7,
      region: "eu",
      at: new Date().toISOString(),
    });
    assert.equal(r.ok, true);
    const w = readWatermark(cfg);
    assert.ok(w.watermark >= 7);
  });
});
