/**
 * Vendor-shipment analog gaps: env template, channel recovery, OS sandbox
 * doc, SPDX inventory. Pins THIS product's names — not OpenClaw/Electron
 * literals (no Tavily, no BRAVE_SEARCH_API_KEY, no WeChat/Feishu as
 * supported channels, no electron-builder rebuild).
 *
 * Does not invert default-path durability and does not mint persistRun.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readRepo(rel) {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("vendor shipment analog docs", () => {
  it(".env.example lists keys this repo reads and rejects OpenClaw names", () => {
    const env = readRepo("../.env.example");
    assert.match(env, /XAI_API_KEY=/);
    assert.match(env, /XCLAW_GATEWAY_TOKEN=/);
    assert.match(env, /XCLAW_PROFILE=/);
    assert.match(env, /XCLAW_OS_SANDBOX=/);
    assert.match(env, /BRAVE_API_KEY=/);
    assert.match(env, /TELEGRAM_BOT_TOKEN=/);
    assert.match(env, /SLACK_BOT_TOKEN=/);
    assert.match(env, /DISCORD_BOT_TOKEN=/);
    assert.match(env, /EMAIL_IMAP_HOST=/);
    assert.match(env, /XCLAW_SQLITE_VEC/);
    assert.equal(/^\s*BRAVE_SEARCH_API_KEY=/m.test(env), false);
    assert.equal(/^\s*TAVILY_API_KEY=/m.test(env), false);
    assert.match(env, /no TAVILY_API_KEY/);
    assert.match(env, /no BRAVE_SEARCH_API_KEY/);
    assert.match(env, /no electron-builder rebuild/);
  });

  it("LICENSE is MIT and ci.yml already gates with npm/node --test", () => {
    const license = readRepo("../LICENSE");
    assert.match(license, /MIT License/);
    assert.match(license, /Copyright \(c\) 2026 XClaw authors/);
    const ci = readRepo("../.github/workflows/ci.yml");
    assert.match(ci, /node scripts\/ci-gate\.mjs/);
    assert.match(ci, /node-version: \["22\.22", "24\.15"\]/);
    assert.equal(ci.includes("pnpm"), false);
    assert.equal(/electron/i.test(ci), false);
  });

  it("CHANNEL_RECOVERY covers real channels + sqlite WAL, not WeChat/Feishu", () => {
    const doc = readRepo("../docs/CHANNEL_RECOVERY.md");
    assert.match(doc, /telegram/i);
    assert.match(doc, /slack/i);
    assert.match(doc, /discord/i);
    assert.match(doc, /email/i);
    assert.match(doc, /control\.sqlite/);
    assert.match(doc, /main\.sqlite/);
    assert.match(doc, /agent\.sqlite/);
    assert.match(doc, /sessions\.json/);
    assert.match(doc, /-wal/);
    assert.match(doc, /telegram-writer\.lock/);
    assert.match(doc, /There is no WeChat QR login and no Feishu connector/);
  });

  it("OS_SANDBOX documents bwrap, not Docker/Wasm skill isolation", () => {
    const doc = readRepo("../docs/OS_SANDBOX.md");
    assert.match(doc, /XCLAW_OS_SANDBOX/);
    assert.match(doc, /bubblewrap/);
    assert.match(doc, /apt install bubblewrap/);
    assert.match(doc, /netnsDegraded/);
    assert.match(doc, /Not Docker/);
    assert.match(doc, /Not Wasm/);
  });

  it("THIRD_PARTY.md inventories optional MIT deps and unshipped sqlite-vec", () => {
    const inv = readRepo("../THIRD_PARTY.md");
    assert.match(inv, /opusscript/);
    assert.match(inv, /werift/);
    assert.match(inv, /SPDX/);
    assert.match(inv, /not shipped/);
    assert.match(inv, /sqlite-vec/);
    assert.match(inv, /has no `electron`/);
  });
});
