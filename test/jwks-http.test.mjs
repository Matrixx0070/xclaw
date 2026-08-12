import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { ensureKeyStore } from "../src/auth/key-rotation.mjs";
import { createGatewayAuth } from "../src/gateway/auth.mjs";
import { exportJwks } from "../src/auth/jwks.mjs";
import {
  publishJwksInvalidation,
  handleInvalidationHttp,
} from "../src/auth/jwks-invalidation.mjs";

describe("JWKS HTTP surface", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jwks-http-"));
    return {
      paths: { configDir: dir },
      auth: {
        durableWrites: false,
        keys: { secret: "jwks-http-test-secret!", autoRotate: false },
        jwks: { distributedInvalidation: true },
      },
      gateway: { token: "test-token-xyz" },
    };
  }

  it("exportJwks returns public keys only", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const out = await exportJwks(cfg);
    assert.ok(out.jwks.keys.length >= 1);
    for (const k of out.jwks.keys) {
      assert.ok(k.kid);
      assert.equal(k.kty, "EC");
      assert.ok(!k.d, "must not leak private key");
    }
  });

  it("GET jwks paths are public in auth", () => {
    const auth = createGatewayAuth({ gateway: { token: "secret" } });
    assert.equal(auth.isProtectedPath("/xclaw/jwks.json"), false);
    assert.equal(auth.isProtectedPath("/.well-known/jwks.json"), false);
    assert.equal(auth.isProtectedPath("/jwks.json"), false);
    // invalidate should be protected under strict mode
    assert.equal(auth.isProtectedPath("/xclaw/jwks/invalidate"), true);
  });

  it("handleInvalidationHttp publishes epoch", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const r = await handleInvalidationHttp(cfg, "POST", { reason: "test_http" });
    assert.equal(r.status, 200);
    assert.ok(r.body.epoch >= 1);
    const g = await handleInvalidationHttp(cfg, "GET");
    assert.equal(g.status, 200);
    assert.ok(g.body.epoch >= 1);
  });

  it("routes-map lists JWKS endpoints", async () => {
    const { listRoutes } = await import("../src/gateway/routes-map.mjs");
    const routes = listRoutes();
    const paths = routes.map((r) => r.path);
    assert.ok(paths.includes("/xclaw/jwks.json"));
    assert.ok(paths.includes("/xclaw/jwks/invalidate"));
  });
});
