import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etcdReadiness } from "../src/cluster/etcd-readiness.mjs";

describe("etcd readiness timeout", () => {
  it("does not hang on stuck status", async () => {
    const hung = {
      status() {
        return new Promise(() => {});
      },
    };
    const t0 = Date.now();
    const r = await etcdReadiness(
      { cluster: { election: "etcd" }, etcd: hung },
      { timeoutMs: 50 }
    );
    const dt = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.ok(dt < 500, `took ${dt}ms`);
  });
});
