import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acquireLease } from "../src/tokens/ledger-lease-redis.mjs";

describe("redis lease skeleton", () => {
  it("fails closed without redis client", async () => {
    const r = await acquireLease({}, { owner: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "LEASE_BACKEND_ERROR");
  });
});
