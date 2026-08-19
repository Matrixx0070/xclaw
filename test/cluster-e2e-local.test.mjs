import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleClusterReserve } from "../src/cluster/coordinator.mjs";
import { authorizeCluster } from "../src/cluster/cluster-auth.mjs";

describe("cluster e2e local", () => {
  it("follower path with auth then handleClusterReserve", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-e2e-"));
    const primaryCfg = {
      paths: { configDir: dir },
      tokens: { dailyHardUsd: 10 },
      cluster: { role: "coordinator", token: "tok" },
    };
    const body = { swarmId: "s", childId: "c", usd: 0.05 };
    const bodyText = JSON.stringify(body);
    const auth = authorizeCluster(
      { headers: { authorization: "Bearer tok" } },
      primaryCfg,
      bodyText
    );
    assert.equal(auth.ok, true);
    const r = await handleClusterReserve(primaryCfg, body);
    assert.equal(r.ok, true);
  });
});
