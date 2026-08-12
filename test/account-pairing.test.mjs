import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createPairingCode,
  consumePairingCode,
  pairingStatus,
  resolveAccountId,
} from "../src/connected/account-links.mjs";
import { handleChannelCommand } from "../src/channels/commands.mjs";

describe("account linking L2 pairing", () => {
  it("create and consume pairs two identities", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-pair-"));
    const cfg = { paths: { configDir: dir } };
    const issued = await createPairingCode(cfg, {
      channel: "slack",
      userId: "U01AAA",
      ttlMs: 120_000,
    });
    assert.equal(issued.ok, true);
    assert.match(issued.code, /^XCLAW-[A-Z0-9]{4}$/);

    const consumed = await consumePairingCode(cfg, issued.code, {
      channel: "telegram",
      userId: "999001",
    });
    assert.equal(consumed.ok, true);
    assert.equal(
      await resolveAccountId(cfg, "slack:U01AAA"),
      await resolveAccountId(cfg, "telegram:999001")
    );

    // single-use
    const again = await consumePairingCode(cfg, issued.code, {
      channel: "discord",
      userId: "1",
    });
    assert.equal(again.ok, false);
  });

  it("/link command issues and redeems", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-pair-cmd-"));
    const cfg = { paths: { configDir: dir } };

    const a = await handleChannelCommand({
      text: "/link",
      cfg,
      channel: "slack",
      userId: "U02BBB",
      isDm: true,
    });
    assert.equal(a.handled, true);
    const m = a.reply.match(/XCLAW-[A-Z0-9]{4}/);
    assert.ok(m, a.reply);

    const b = await handleChannelCommand({
      text: `/link ${m[0]}`,
      cfg,
      channel: "telegram",
      userId: "888",
      isDm: true,
    });
    assert.equal(b.handled, true);
    assert.match(b.reply, /linked/i);

    const st = await handleChannelCommand({
      text: "/link status",
      cfg,
      channel: "telegram",
      userId: "888",
    });
    assert.match(st.reply, /acc_/);
  });

  it("expired code fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-pair-exp-"));
    const cfg = { paths: { configDir: dir } };
    const issued = await createPairingCode(cfg, {
      channel: "slack",
      userId: "U03",
      ttlMs: 50,
    });
    await new Promise((r) => setTimeout(r, 80));
    const out = await consumePairingCode(cfg, issued.code, {
      channel: "telegram",
      userId: "1",
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, "expired");
  });
});
