import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { authorizeCluster } from "../src/cluster/cluster-auth.mjs";
import { handleClusterReserve, claimCoordinator } from "../src/cluster/coordinator.mjs";

describe("cluster hmac e2e", () => {
  it("signed reserve returns generation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hm-"));
    const secret = "hmac-e2e";
    const cfg = {
      paths: { configDir: dir },
      tokens: { dailyHardUsd: 10 },
      cluster: { role: "coordinator", hmacSecret: secret },
    };
    claimCoordinator(cfg, { owner: "primary" });
    const body = { swarmId: "s", childId: "c", usd: 0.02 };
    const bodyText = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(bodyText).digest("hex");
    const auth = authorizeCluster({ headers: { "x-xclaw-cluster-signature": sig } }, cfg, bodyText);
    assert.equal(auth.ok, true);
    assert.equal(auth.authMethod, "hmac");
    const r = await handleClusterReserve(cfg, body);
    assert.equal(r.ok, true);
    assert.ok(typeof r.generation === "number");
  });
});
