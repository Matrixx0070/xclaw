import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { vaultSetApp, vaultGetApp, vaultLoad } from "../src/connected/vault.mjs";
import { linkIdentities, migrateAccountVault } from "../src/connected/account-links.mjs";

describe("account linking L3 vault merge", () => {
  it("merges tokens into account vault on link", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-merge-"));
    const cfg = { paths: { configDir: dir } };

    await vaultSetApp(cfg, "slack:U1", "github", {
      accessToken: "slack-gh",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await vaultSetApp(cfg, "telegram:9", "github", {
      accessToken: "tg-gh-newer",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    await vaultSetApp(cfg, "telegram:9", "google", {
      accessToken: "tg-google",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const linked = await linkIdentities(cfg, "slack:U1", "telegram:9");
    assert.equal(linked.ok, true);
    assert.ok(linked.vaultMerge);
    assert.ok(linked.vaultMerge.apps.includes("github"));
    assert.ok(linked.vaultMerge.apps.includes("google"));

    const gh = await vaultGetApp(cfg, linked.accountId, "github");
    assert.equal(gh.accessToken, "tg-gh-newer"); // newer wins
    const google = await vaultGetApp(cfg, linked.accountId, "google");
    assert.equal(google.accessToken, "tg-google");

    // sources backed up
    assert.ok(linked.vaultMerge.backedUp.length >= 1);
  });

  it("migrateAccountVault is idempotent-ish", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mig-"));
    const cfg = { paths: { configDir: dir } };
    const linked = await linkIdentities(cfg, "discord:1", "email:a@b.c");
    const again = await migrateAccountVault(cfg, linked.accountId);
    assert.equal(again.accountId, linked.accountId);
  });
});
