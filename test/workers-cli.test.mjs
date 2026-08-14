import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// config writes go to $HOME/.xclaw — isolate
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-workers-cli-"));
const savedHome = process.env.HOME;

let wcli;

before(async () => {
  process.env.HOME = tmpHome;
  wcli = await import("../src/missions/workers-cli.mjs");
});

after(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function readUserConfig() {
  return JSON.parse(fs.readFileSync(path.join(tmpHome, ".xclaw", "xclaw.json"), "utf8"));
}

describe("workers CLI core", () => {
  it("add validates name + url policy and persists to the user config", async () => {
    const cfg = { missions: {} };
    const bad = await wcli.addWorkerEntry(cfg, { name: "x y", url: "https://a" });
    assert.equal(bad.ok, false);
    const badUrl = await wcli.addWorkerEntry(cfg, { name: "w1", url: "http://10.0.0.2:1" });
    assert.equal(badUrl.ok, false);
    const ok = await wcli.addWorkerEntry(cfg, { name: "w1", url: "https://box:18790", token: "T" });
    assert.equal(ok.ok, true);
    assert.equal(ok.workers[0].hasToken, true);
    assert.equal("token" in ok.workers[0], false, "listing stays redacted");
    const persisted = readUserConfig();
    assert.equal(persisted.missions.workers[0].token, "T", "raw token persisted in 0600 config");
  });

  it("add replaces same-name entries; remove deletes and persists", async () => {
    const cfg = { missions: { workers: [{ name: "w1", url: "https://old" }] } };
    await wcli.addWorkerEntry(cfg, { name: "w1", url: "https://new" });
    assert.equal(cfg.missions.workers.length, 1);
    assert.equal(cfg.missions.workers[0].url, "https://new");
    const r = await wcli.removeWorkerEntry(cfg, "w1");
    assert.equal(r.removed, true);
    assert.deepEqual(readUserConfig().missions.workers, []);
  });

  it("ensureGatewayToken generates once, then returns the stored one", async () => {
    const cfg = { gateway: { port: 18790 } };
    const first = await wcli.ensureGatewayToken(cfg);
    assert.equal(first.generated, true);
    assert.match(first.token, /^xclaw_[\w-]{20,}$/);
    const second = await wcli.ensureGatewayToken(cfg);
    assert.equal(second.generated, false);
    assert.equal(second.token, first.token);
    assert.equal(readUserConfig().gateway.token, first.token);
  });

  it("buildJoinCommand emits the exact coordinator command; flags insecure public http", async () => {
    const cfg = { gateway: { host: "127.0.0.1", port: 18790, token: "TOK" } };
    const local = await wcli.buildJoinCommand(cfg, { name: "wk" });
    assert.equal(local.command, "xclaw workers add wk http://127.0.0.1:18790 --token TOK");
    assert.equal(local.note, null);
    const pub = await wcli.buildJoinCommand(cfg, { name: "wk", publicUrl: "http://10.1.2.3:18790" });
    assert.match(pub.command, /--allow-insecure$/);
    assert.match(pub.note, /TLS/);
    const tls = await wcli.buildJoinCommand(cfg, { name: "wk", publicUrl: "https://worker.example.com" });
    assert.equal(tls.command, "xclaw workers add wk https://worker.example.com --token TOK");
  });
});
