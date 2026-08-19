import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proxyReserve, isCoordinator } from "../src/cluster/coordinator.mjs";

describe("coordinator proxy", () => {
  it("local coordinator reserves", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-coord-"));
    const cfg = { paths: { configDir: dir }, tokens: { dailyHardUsd: 10 } };
    assert.equal(isCoordinator(cfg), true);
    const r = await proxyReserve(cfg, { swarmId: "s", childId: "c", usd: 0.1 });
    assert.equal(r.ok, true);
  });
});
