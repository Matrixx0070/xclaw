import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  vaultSetApp,
  vaultGetApp,
  vaultListUsers,
  vaultListApps,
  vaultDeleteApp,
  vaultResolveToken,
} from "../src/connected/vault.mjs";

describe("P6 vault", () => {
  it("isolates tokens per user", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-vault-"));
    const cfg = { paths: { configDir: dir } };
    await vaultSetApp(cfg, "alice", "github", { accessToken: "a-tok" });
    await vaultSetApp(cfg, "bob", "github", { accessToken: "b-tok" });
    assert.equal((await vaultGetApp(cfg, "alice", "github")).accessToken, "a-tok");
    assert.equal((await vaultGetApp(cfg, "bob", "github")).accessToken, "b-tok");
    const users = await vaultListUsers(cfg);
    assert.ok(users.includes("alice") && users.includes("bob"));
    const apps = await vaultListApps(cfg, "alice");
    assert.equal(apps[0].hasToken, true);
    await vaultDeleteApp(cfg, "alice", "github");
    assert.equal(await vaultGetApp(cfg, "alice", "github"), null);
  });
});
