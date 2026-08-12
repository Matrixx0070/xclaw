import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runWithRequestContext, getRequestUserId } from "../src/connected/request-context.mjs";
import { vaultSetApp } from "../src/connected/vault.mjs";
import { resolveToken } from "../src/connected/catalog.mjs";

describe("vault userId via request context", () => {
  it("getRequestUserId reads ALS", async () => {
    await runWithRequestContext({ userId: "u42" }, async () => {
      assert.equal(getRequestUserId(), "u42");
    });
  });

  it("resolveToken uses vault for channel user", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-uid-"));
    const cfg = { paths: { configDir: dir } };
    await vaultSetApp(cfg, "slack_U1", "github", { accessToken: "vault-tok" });
    const tok = await runWithRequestContext({ userId: "slack_U1" }, async () => {
      return resolveToken(cfg, "github");
    });
    assert.equal(tok?.accessToken, "vault-tok");
    assert.equal(tok?.source, "vault");
  });
});
