import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campaign, resign } from "../src/cluster/etcd-election.mjs";

function mockEtcd() {
  const store = new Map();
  return {
    async campaign(key, id) {
      store.set(key, id);
      return true;
    },
    async resign() {
      store.delete("/xclaw/coordinator");
    },
    async put(k, v) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

describe("etcd mock campaign", () => {
  it("campaigns and resigns", async () => {
    const etcd = mockEtcd();
    const r = await campaign({ etcd }, { owner: "gw-1" });
    assert.equal(r.ok, true);
    assert.equal(r.backend, "etcd");
    const d = await resign({ etcd }, { owner: "gw-1" });
    assert.equal(d.ok, true);
  });
});
