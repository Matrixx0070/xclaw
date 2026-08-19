import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { claimOnBoot, claimOnBootAsync } from "../src/cluster/boot-claim.mjs";

describe("etcd prod fail-closed", () => {
  it("sync boot failClosed in prod etcd mode", () => {
    const cfg = {
      profile: "prod",
      cluster: { role: "coordinator", election: "etcd" },
    };
    const r = claimOnBoot(cfg);
    assert.equal(r.claimed, false);
    assert.equal(r.failClosed, true);
  });
  it("async campaign fails closed without client", async () => {
    const cfg = {
      profile: "prod",
      cluster: { role: "coordinator", election: "etcd" },
    };
    const r = await claimOnBootAsync(cfg);
    assert.equal(r.claimed, false);
    assert.ok(r.failClosed || r.code === "ETCD_UNAVAILABLE");
  });
});
