import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etcdReadiness } from "../src/cluster/etcd-readiness.mjs";

describe("etcd readiness", () => {
  it("skips when election off", async () => {
    const r = await etcdReadiness({});
    assert.equal(r.skipped, true);
    assert.equal(r.ok, true);
  });
  it("fails without client when enabled", async () => {
    const r = await etcdReadiness({ cluster: { election: "etcd" } });
    assert.equal(r.ok, false);
    assert.equal(r.code, "ETCD_UNAVAILABLE");
  });
  it("ok with status mock", async () => {
    const r = await etcdReadiness({
      cluster: { election: "etcd" },
      etcd: {
        async status() {
          return { version: "3.5" };
        },
      },
    });
    assert.equal(r.ok, true);
  });
});
