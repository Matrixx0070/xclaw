import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campaign } from "../src/cluster/etcd-election.mjs";

describe("etcd election skeleton", () => {
  it("fails closed without client", async () => {
    const r = await campaign({}, { owner: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "ETCD_UNAVAILABLE");
  });
});
