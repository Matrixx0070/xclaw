/**
 * Same class as queue cancel overwritten by a long-running writer:
 * requestDeploy (gateway, on self-mission merge) replaces
 * ~/.xclaw/self-deploy.json while runDeployOnce is inside unbounded
 * restartGateway / healthOk. The in-memory intent's terminal write must
 * not wipe the newer pending deploy, and must not git reset --hard a
 * merge that landed while we were polling.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "os";
import http from "node:http";
import {
  requestDeploy,
  readIntent,
  runDeployOnce,
  settleAfterDeploy,
} from "../src/self/deploy.mjs";

describe("settleAfterDeploy", () => {
  const held = () => ({
    missionId: "msn_a",
    mergeCommit: "aaa111",
    state: "restarting",
  });

  it("does not resurrect a missing file", () => {
    assert.equal(settleAfterDeploy(held(), null), null);
  });

  it("does not overwrite a different mission", () => {
    assert.equal(
      settleAfterDeploy(held(), { missionId: "msn_b", mergeCommit: "bbb222", state: "pending" }),
      null
    );
  });

  it("does not overwrite a different mergeCommit on the same mission", () => {
    assert.equal(
      settleAfterDeploy(held(), { missionId: "msn_a", mergeCommit: "ccc333", state: "pending" }),
      null
    );
  });

  it("returns held when identity matches", () => {
    const h = held();
    assert.equal(settleAfterDeploy(h, { missionId: "msn_a", mergeCommit: "aaa111", state: "restarting" }), h);
  });

  it("compares mergeCommit only when both sides have one", () => {
    const h = { missionId: "msn_a", state: "restarting" };
    assert.equal(settleAfterDeploy(h, { missionId: "msn_a", mergeCommit: "aaa111", state: "pending" }), h);
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterDeploy(null, { missionId: "msn_a" }), null);
  });
});

describe("runDeployOnce does not overwrite a newer pending deploy", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-deploy-settle-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("leaves a concurrent requestDeploy pending after a healthy poll", async () => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready: true }));
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const cfg = {
      paths: { configDir: dir },
      gateway: { host: "127.0.0.1", port },
      self: {
        restartCmd: "true",
        health: { retries: 2, delayMs: 80 },
        repoDir: dir,
      },
    };
    await requestDeploy(cfg, { missionId: "msn_old", repoDir: dir, mergeCommit: "aaa111" });
    const swap = setTimeout(() => {
      requestDeploy(cfg, { missionId: "msn_new", repoDir: dir, mergeCommit: "bbb222" }).catch(() => {});
    }, 30);
    const out = await runDeployOnce(cfg);
    clearTimeout(swap);
    srv.close();
    assert.ok(out);
    const onDisk = await readIntent(cfg);
    assert.equal(onDisk.missionId, "msn_new");
    assert.equal(onDisk.state, "pending");
    assert.equal(onDisk.mergeCommit, "bbb222");
  });

  it("does not git-reset / write rolled_back over a newer pending after a failed poll", async () => {
    const cfg = {
      paths: { configDir: dir },
      gateway: { host: "127.0.0.1", port: 65511 },
      self: {
        restartCmd: "true",
        health: { retries: 1, delayMs: 80 },
        repoDir: dir,
      },
    };
    await requestDeploy(cfg, {
      missionId: "msn_fail_old",
      repoDir: dir,
      mergeCommit: "ddd444",
      prevKnownGood: "eee555",
    });
    const swap = setTimeout(() => {
      requestDeploy(cfg, { missionId: "msn_fail_new", repoDir: dir, mergeCommit: "fff666" }).catch(() => {});
    }, 30);
    const out = await runDeployOnce(cfg);
    clearTimeout(swap);
    assert.ok(out);
    const onDisk = await readIntent(cfg);
    assert.equal(onDisk.missionId, "msn_fail_new");
    assert.equal(onDisk.state, "pending");
    assert.ok(!["healthy", "rolled_back", "failed"].includes(onDisk.state));
  });

  it("is wired before the terminal write and before git reset --hard", async () => {
    const src = await fs.readFile(new URL("../src/self/deploy.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function runDeployOnce"));
    const firstHealth = body.indexOf("const health = await healthOk");
    const firstSettle = body.indexOf("settleAfterDeploy(intent, await readIntent(cfg))", firstHealth);
    const reset = body.indexOf('reset", "--hard"');
    const settleBeforeReset = body.lastIndexOf("settleAfterDeploy(intent, await readIntent(cfg))", reset);
    assert.ok(firstSettle > firstHealth, "re-read after healthOk");
    assert.ok(firstSettle < reset, "first settle is before git reset --hard");
    assert.ok(settleBeforeReset > firstSettle, "second settle immediately before git reset --hard");
    assert.ok(settleBeforeReset < reset, "pre-reset settle is before the reset argv");
    const superseded = body.slice(body.indexOf("if (!settled)"), body.indexOf("if (health.ok)"));
    assert.doesNotMatch(superseded, /await markKnownGood/);
  });
});
