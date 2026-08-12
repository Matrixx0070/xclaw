
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkReadiness } from "../src/gateway/readiness.mjs";

describe("readiness", () => {
  it("returns structured body", async () => {
    const r = await checkReadiness({
      computer: { host: "127.0.0.1", port: 4243 },
      readiness: { requireComputer: false, maxQueued: 100 },
      paths: { configDir: "/tmp/xclaw-ready-missing" },
      queue: { concurrency: 1 },
    });
    assert.equal(typeof r.ready, "boolean");
    assert.ok(r.body.checks);
    assert.ok([200, 503].includes(r.status));
  });
});
