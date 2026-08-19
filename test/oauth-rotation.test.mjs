import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordRefreshUse, clearRefreshRegistry } from "../src/seats/oauth-rotation.mjs";

describe("seat oauth refresh rotation", () => {
  it("detects reuse", () => {
    clearRefreshRegistry();
    assert.equal(recordRefreshUse("tok-a").ok, true);
    assert.equal(recordRefreshUse("tok-a").reused, true);
  });
  it("rotation retires old token fingerprint", () => {
    clearRefreshRegistry();
    assert.equal(recordRefreshUse("tok-b").ok, true);
    assert.equal(recordRefreshUse("tok-c", { rotatedFrom: "tok-b" }).ok, true);
  });
});
