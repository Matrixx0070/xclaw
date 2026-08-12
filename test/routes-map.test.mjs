
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listRoutes } from "../src/gateway/routes-map.mjs";

describe("routes map", () => {
  it("lists core ops routes", () => {
    const r = listRoutes();
    assert.ok(r.length >= 20);
    assert.ok(r.some((x) => x.path === "/health"));
    assert.ok(r.some((x) => x.path === "/queue"));
  });
});
