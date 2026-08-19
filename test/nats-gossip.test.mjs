import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { publishNatsGossip, natsEnabled } from "../src/cluster/nats-gossip.mjs";

describe("nats gossip skeleton", () => {
  it("fails closed in prod without client", async () => {
    const cfg = { profile: "prod", cluster: { gossipTransport: "nats", requireNats: true } };
    assert.equal(natsEnabled(cfg), true);
    const r = await publishNatsGossip(cfg, { generation: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NATS_UNAVAILABLE");
    assert.equal(r.failClosed, true);
  });
  it("publishes with mock", async () => {
    const seen = [];
    const cfg = {
      cluster: { gossipTransport: "nats", gossipHmacSecret: "s" },
      nats: {
        async publish(subj, body) {
          seen.push({ subj, body });
        },
      },
    };
    const r = await publishNatsGossip(cfg, { generation: 2, at: new Date().toISOString() });
    assert.equal(r.ok, true);
    assert.equal(seen.length, 1);
  });
});
