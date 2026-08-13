import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate config writes (getConfigPath resolves via os.homedir()/$HOME).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-chan-route-"));
const SAVED_HOME = process.env.HOME;
const SAVED_STATE = process.env.XCLAW_STATE_DIR;
process.env.HOME = TMP_HOME;
process.env.XCLAW_STATE_DIR = path.join(TMP_HOME, ".xclaw");

const { tryHandleChannelsRoute } = await import("../src/gateway/routes/channels.mjs");

after(() => {
  process.env.HOME = SAVED_HOME;
  if (SAVED_STATE === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = SAVED_STATE;
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

const cfgFile = path.join(TMP_HOME, ".xclaw", "xclaw.json");

function makeArgs({ p, method = "GET", body = {}, cfg = {}, channelManager } = {}) {
  const out = { status: null, body: null };
  return {
    args: {
      p,
      method,
      req: { headers: {} },
      res: {},
      url: new URL(`http://local${p}`),
      cfg: { paths: { configDir: process.env.XCLAW_STATE_DIR }, ...cfg },
      json: (_res, status, payload) => {
        out.status = status;
        out.body = payload;
      },
      readBody: async () => body,
      channelManager,
    },
    out,
  };
}

describe("gateway channels management routes", () => {
  it("GET /channels/manage returns the channels shape (no secret values)", async () => {
    const { args, out } = makeArgs({ p: "/channels/manage" });
    assert.equal(await tryHandleChannelsRoute(args), true);
    assert.equal(out.status, 200);
    assert.ok(Array.isArray(out.body.channels) && out.body.channels.length >= 5);
    const tg = out.body.channels.find((c) => c.id === "telegram");
    assert.ok(tg, "telegram channel present");
    for (const k of ["name", "enabled", "configured", "fields"]) assert.ok(k in tg, `channel.${k}`);
    const tokField = tg.fields.find((f) => f.key === "token");
    assert.ok(tokField.secret, "token marked secret");
    assert.equal(tokField.value, undefined, "secret value never returned");
  });

  it("POST field persists a secret and is reflected (as set, not value) in a GET", async () => {
    const set = makeArgs({
      p: "/channels/manage/field",
      method: "POST",
      body: { channel: "telegram", key: "token", value: "123456:SECRET_BOT_TOKEN" },
    });
    assert.equal(await tryHandleChannelsRoute(set.args), true);
    assert.equal(set.out.status, 200);
    assert.ok(!JSON.stringify(set.out.body).includes("SECRET_BOT_TOKEN"), "secret not echoed");

    const onDisk = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    assert.equal(onDisk.channels.telegram.token, "123456:SECRET_BOT_TOKEN", "persisted to config");

    const get = makeArgs({ p: "/channels/manage", cfg: { channels: onDisk.channels } });
    await tryHandleChannelsRoute(get.args);
    const tg = get.out.body.channels.find((c) => c.id === "telegram");
    const tok = tg.fields.find((f) => f.key === "token");
    assert.equal(tok.set, true, "token now set");
    assert.equal(tok.value, undefined, "still no secret value in inventory");
    assert.ok(!JSON.stringify(get.out.body).includes("SECRET_BOT_TOKEN"), "no secret in inventory");
  });

  it("POST enabled flips the channel and persists", async () => {
    const en = makeArgs({
      p: "/channels/manage/enabled",
      method: "POST",
      body: { channel: "discord", enabled: true },
    });
    assert.equal(await tryHandleChannelsRoute(en.args), true);
    assert.equal(en.out.status, 200);
    assert.equal(en.out.body.enabled, true);
    const onDisk = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    assert.equal(onDisk.channels.discord.enabled, true);
  });

  it("field validation: unknown channel/key → 400", async () => {
    const bad = makeArgs({
      p: "/channels/manage/field",
      method: "POST",
      body: { channel: "telegram", key: "not_a_field", value: "x" },
    });
    assert.equal(await tryHandleChannelsRoute(bad.args), true);
    assert.equal(bad.out.status, 400);
    assert.match(bad.out.body.error, /unknown field/);

    const badCh = makeArgs({
      p: "/channels/manage/enabled",
      method: "POST",
      body: { channel: "nope", enabled: true },
    });
    assert.equal(await tryHandleChannelsRoute(badCh.args), true);
    assert.equal(badCh.out.status, 400);
    assert.match(badCh.out.body.error, /unknown channel/);
  });

  it("restart uses a live channelManager when present, notes otherwise", async () => {
    let restarted = null;
    const live = makeArgs({
      p: "/channels/manage/restart",
      method: "POST",
      body: { channel: "telegram" },
      channelManager: { restartChannel: async (n) => { restarted = n; } },
    });
    assert.equal(await tryHandleChannelsRoute(live.args), true);
    assert.equal(live.out.body.restarted, true);
    assert.equal(restarted, "telegram");

    const none = makeArgs({
      p: "/channels/manage/restart",
      method: "POST",
      body: { channel: "telegram" },
    });
    assert.equal(await tryHandleChannelsRoute(none.args), true);
    assert.equal(none.out.body.ok, false);
    assert.match(none.out.body.note, /gateway reload/);
  });

  it("GET merges live channelManager status when available", async () => {
    const { args, out } = makeArgs({
      p: "/channels/manage",
      channelManager: { status: () => ({ telegram: { running: true, name: "telegram" } }) },
    });
    await tryHandleChannelsRoute(args);
    const tg = out.body.channels.find((c) => c.id === "telegram");
    assert.ok(tg.status && tg.status.running === true, "live status merged");
  });

  it("unmatched paths return false", async () => {
    const { args } = makeArgs({ p: "/channels/status" });
    assert.equal(await tryHandleChannelsRoute(args), false);
    const other = makeArgs({ p: "/definitely/not" });
    assert.equal(await tryHandleChannelsRoute(other.args), false);
  });
});
