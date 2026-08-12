import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  normalizeChannelUserId,
  linkIdentities,
  unlinkIdentity,
  listAccounts,
  resolveVaultUserId,
  resolveAccountId,
} from "../src/connected/account-links.mjs";

describe("account links L1", () => {
  it("normalizeChannelUserId compounds channel + id", () => {
    assert.equal(
      normalizeChannelUserId({ channel: "telegram", userId: 123 }),
      "telegram:123"
    );
    assert.equal(
      normalizeChannelUserId({ channel: "slack", userId: "U01ABC" }),
      "slack:U01ABC"
    );
    assert.equal(
      normalizeChannelUserId({ channel: "email", userId: "A@B.C" }),
      "email:a@b.c"
    );
    assert.equal(
      normalizeChannelUserId({ userId: "slack:U01" }),
      "slack:U01"
    );
    assert.equal(normalizeChannelUserId({}), "default");
  });

  it("linkIdentities shares one account", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-acc-"));
    const cfg = { paths: { configDir: dir } };
    const out = await linkIdentities(cfg, "slack:U01", "telegram:99");
    assert.equal(out.ok, true);
    assert.ok(out.accountId.startsWith("acc_"));
    assert.equal(await resolveAccountId(cfg, "slack:U01"), out.accountId);
    assert.equal(await resolveAccountId(cfg, "telegram:99"), out.accountId);
    assert.equal(
      await resolveVaultUserId(cfg, { channel: "slack", userId: "U01" }),
      out.accountId
    );
    const listed = await listAccounts(cfg);
    assert.equal(listed.accounts.length, 1);
    assert.equal(listed.accounts[0].identities.length, 2);
  });

  it("unlink removes identity", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-acc-"));
    const cfg = { paths: { configDir: dir } };
    await linkIdentities(cfg, "discord:1", "telegram:2");
    await unlinkIdentity(cfg, "discord:1");
    assert.equal(await resolveAccountId(cfg, "discord:1"), null);
    assert.ok(await resolveAccountId(cfg, "telegram:2"));
  });

  it("conflict when both linked to different accounts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-acc-"));
    const cfg = { paths: { configDir: dir } };
    await linkIdentities(cfg, "slack:A", "telegram:A");
    await linkIdentities(cfg, "slack:B", "telegram:B");
    const bad = await linkIdentities(cfg, "slack:A", "slack:B");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "conflict");
  });
});
