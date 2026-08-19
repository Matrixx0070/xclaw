import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeCluster } from "../src/cluster/cluster-auth.mjs";
import { createHmac } from "node:crypto";

describe("cluster auth", () => {
  it("accepts token", () => {
    const cfg = { cluster: { token: "sekret" } };
    const req = { headers: { authorization: "Bearer sekret" } };
    const r = authorizeCluster(req, cfg, "{}");
    assert.equal(r.ok, true);
    assert.equal(r.authMethod, "token");
  });
  it("accepts hmac", () => {
    const secret = "hmac-secret";
    const body = '{"usd":1}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const cfg = { cluster: { hmacSecret: secret } };
    const req = { headers: { "x-xclaw-cluster-signature": sig } };
    const r = authorizeCluster(req, cfg, body);
    assert.equal(r.ok, true);
    assert.equal(r.authMethod, "hmac");
  });
  it("rejects in prod without creds", () => {
    const cfg = { profile: "prod", cluster: { requireAuth: true, token: "t" } };
    const r = authorizeCluster({ headers: {} }, cfg, "{}");
    assert.equal(r.ok, false);
  });
});
