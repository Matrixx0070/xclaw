import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processInbound, normalizeInbound } from "../src/channels/runtime.mjs";
import { runWithRequestContext, getRequestUserId } from "../src/connected/request-context.mjs";
import { normalizeChannelUserId, linkIdentities, resolveVaultUserId } from "../src/connected/account-links.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("channel → vault userId path (CL integration)", () => {
  it("linked identities share vault key through replyWithAgent resolution", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cl-int-"));
    const cfg = { paths: { configDir: dir } };
    const linked = await linkIdentities(cfg, "telegram:100", "slack:U100");
    assert.equal(linked.ok, true);

    const vaultTg = await resolveVaultUserId(cfg, {
      channel: "telegram",
      userId: "100",
    });
    const vaultSlack = await resolveVaultUserId(cfg, {
      channel: "slack",
      userId: "U100",
    });
    assert.equal(vaultTg, vaultSlack);
    assert.equal(vaultTg, linked.accountId);
  });

  it("processInbound + ALS sees normalized identity", async () => {
    let seen = null;
    const inbound = normalizeInbound({
      channel: "discord",
      text: "ping",
      userId: "555",
      chatId: "chan",
    });
    const out = await processInbound(inbound, {
      replyWithAgent: async (opts) => {
        // replyWithAgent in production sets ALS; here we simulate consumer
        seen = normalizeChannelUserId({
          channel: opts.channel,
          userId: opts.userId,
        });
        return { text: "pong", turns: 1 };
      },
    });
    assert.equal(out.reply, "pong");
    assert.equal(seen, "discord:555");
  });
});
