import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createComputerClient,
  clearComputerSessionPool,
  computerClientCacheStats,
  pruneExpiredSessionPool,
} from "../src/agent/computer-client.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function health() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4243/health", (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

describe("computer session reuse", () => {
  before(async () => {
    process.env.XCLAW_COMPUTER_ENGINE = "bundle";
    process.env.XCLAW_COMPUTER_REUSE_SESSION = "1";
    await fs.mkdir(path.join(root, "tmp-live"), { recursive: true });
    if (!(await health())) {
      spawn(process.execPath, [path.join(root, "src/computer/xclaw-server.mjs")], {
        cwd: root,
        detached: true,
        stdio: "ignore",
      }).unref();
      for (let i = 0; i < 30; i++) {
        if (await health()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    clearComputerSessionPool();
  });

  it("reuses session id for same workingDir", async () => {
    const cfg = {
      computer: { host: "127.0.0.1", port: 4243, engine: "bundle", reuseSession: true },
    };
    const c = createComputerClient(cfg);
    const wd = path.join(root, "tmp-live");
    const a = await c.createSession(wd);
    const b = await c.createSession(wd);
    assert.equal(a, b);
    await c.destroySession(a);
    const c2 = await c.createSession(wd);
    assert.equal(c2, a); // still pooled after soft destroy
  });

  it("TTL prune removes stale pool entries", async () => {
    clearComputerSessionPool();
    process.env.XCLAW_COMPUTER_REUSE_SESSION = "1";
    const cfg = {
      computer: { host: "127.0.0.1", port: 4243, engine: "bundle", reuseSession: true },
    };
    const c = createComputerClient(cfg);
    const wd = path.join(root, "tmp-live");
    const sid = await c.createSession(wd);
    assert.ok(sid);
    // Force expire
    const r = pruneExpiredSessionPool({ ttlMs: 0 });
    assert.ok(r.expired >= 1);
    assert.equal(computerClientCacheStats().sessions, 0);
  });

  it("caches tools/list per session", async () => {
    clearComputerSessionPool();
    const cfg = {
      computer: { host: "127.0.0.1", port: 4243, engine: "bundle", reuseSession: true },
    };
    const c = createComputerClient(cfg);
    const wd = path.join(root, "tmp-live");
    const sid = await c.createSession(wd);
    const t1 = await c.listTools(sid);
    const t2 = await c.listTools(sid);
    assert.ok(Array.isArray(t1) && t1.length >= 1);
    assert.equal(t1.length, t2.length);
    const stats = computerClientCacheStats();
    assert.ok(stats.toolsLists >= 1);
    assert.ok(stats.sessions >= 1);
  });
});

describe("session reuse always probes liveness", () => {
  it("does not return a pooled sessionId from tools cache alone", async () => {
    const src = await fs.readFile(
      new URL("../src/agent/computer-client.mjs", import.meta.url),
      "utf8"
    );
    assert.match(src, /Always probe/);
    assert.doesNotMatch(
      src,
      /if \(cached\?\.tools\) \{[\s\S]{0,80}return hit\.sessionId/
    );
  });
});
