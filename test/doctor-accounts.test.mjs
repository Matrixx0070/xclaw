import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { linkIdentities } from "../src/connected/account-links.mjs";
import { vaultSetApp } from "../src/connected/vault.mjs";
import { runDoctor } from "../src/cli/doctor.mjs";

describe("doctor account checks", () => {
  it("reports linked accounts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-doc-acc-"));
    // Minimal config dir so doctor can load — monkey via env if needed
    // runDoctor loads real config; we exercise account modules directly here
    // and assert doctor includes accounts when configDir is the real one.
    // Unit: call the same APIs doctor uses.
    const cfg = { paths: { configDir: dir } };
    await linkIdentities(cfg, "telegram:1", "slack:U1");
    await vaultSetApp(cfg, "acc_placeholder", "github", { accessToken: "x" });

    const { listAccounts } = await import("../src/connected/account-links.mjs");
    const listed = await listAccounts(cfg);
    assert.ok(listed.accounts.length >= 1);
    assert.ok(Object.keys(listed.links).length >= 2);

    // Import doctor checks by running with isolated HOME
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    // write minimal config
    await fs.mkdir(path.join(dir, ".xclaw"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".xclaw", "xclaw.json"),
      JSON.stringify(
        {
          profile: "lab",
          paths: { configDir: path.join(dir, ".xclaw") },
          agent: { apiKey: "test-key" },
        },
        null,
        2
      )
    );
    // re-link under .xclaw config dir
    const cfg2 = { paths: { configDir: path.join(dir, ".xclaw") } };
    await linkIdentities(cfg2, "telegram:99", "discord:88");

    try {
      const report = await runDoctor({ json: true });
      const ids = report.checks.map((c) => c.id);
      assert.ok(ids.some((id) => id === "accounts" || id.startsWith("accounts.")), ids.join(","));
      const acc = report.checks.find((c) => c.id === "accounts");
      assert.ok(acc, "accounts check present");
      assert.match(acc.message, /account/i);
    } finally {
      process.env.HOME = prevHome;
    }
  });
});
