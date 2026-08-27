/**
 * Gateway run-loop harness (spec §13.2) — single-instance lock (stale
 * reap, live-pid refuse, same-pid re-acquire), SIGUSR1 in-process
 * restart, SIGTERM stop with SQL drain before lock release, and the
 * second-signal fence. NOT adopted by the live gateway in this binary —
 * a test pins that startGateway does not import the harness.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireGatewayLock,
  drainProcessStores,
  runGatewayLoop,
} from "../src/gateway/run-loop.mjs";

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-runloop-"));
}

function until(fn, ms = 5000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() > deadline) return reject(new Error("until timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("gateway run-loop (spec §13.2)", () => {
  it("lock: acquire writes own pid; same-pid re-acquire wins; release removes", async () => {
    const stateDir = tmpStateDir();
    try {
      const lock = await acquireGatewayLock({ stateDir, port: 1234 });
      assert.equal(fs.readFileSync(lock.file, "utf8"), String(process.pid));
      assert.ok(lock.file.endsWith(path.join("tmp", "gateway-1234.lock")));
      const again = await acquireGatewayLock({ stateDir, port: 1234 });
      assert.equal(fs.readFileSync(again.file, "utf8"), String(process.pid));
      await again.release();
      assert.equal(fs.existsSync(again.file), false);
      await lock.release();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("lock: live foreign pid refuses with XCLAW_GATEWAY_LOCKED; dead pid is reaped", async () => {
    const stateDir = tmpStateDir();
    try {
      const dir = path.join(stateDir, "tmp");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "gateway-9.lock");
      fs.writeFileSync(file, String(process.ppid));
      await assert.rejects(
        () => acquireGatewayLock({ stateDir, port: 9 }),
        (err) => err.code === "XCLAW_GATEWAY_LOCKED" && err.message.includes(`pid ${process.ppid}`),
      );
      fs.writeFileSync(file, "999999999");
      const lock = await acquireGatewayLock({ stateDir, port: 9 });
      assert.equal(fs.readFileSync(file, "utf8"), String(process.pid));
      await lock.release();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("SIGUSR1 restarts in-process (start twice, same pid); SIGTERM then stops and releases the lock", async () => {
    const stateDir = tmpStateDir();
    const events = [];
    try {
      const loop = runGatewayLoop({
        start: async () => {
          events.push("start");
          return { fake: true };
        },
        stop: async ({ reason }) => {
          events.push(`stop:${reason}`);
        },
        stateDir,
        port: 42,
        drainMs: 500,
        ownsProcess: false,
      });
      loop.catch(() => {});
      await until(() => events.length === 1);
      const lockFile = path.join(stateDir, "tmp", "gateway-42.lock");
      assert.equal(fs.readFileSync(lockFile, "utf8"), String(process.pid));

      process.kill(process.pid, "SIGUSR1");
      await until(() => events.filter((e) => e === "start").length === 2);
      assert.deepEqual(events, ["start", "stop:gateway restarting", "start"]);

      process.kill(process.pid, "SIGTERM");
      await until(() => events.includes("stop:gateway stopping"));
      await until(() => !fs.existsSync(lockFile));
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("fence: a second signal during a slow stop is ignored (stop runs once)", async () => {
    const stateDir = tmpStateDir();
    let stopCalls = 0;
    let releaseStop;
    const gate = new Promise((resolve) => {
      releaseStop = resolve;
    });
    try {
      const loop = runGatewayLoop({
        start: async () => ({ fake: true }),
        stop: async () => {
          stopCalls += 1;
          await gate;
        },
        stateDir,
        port: 43,
        drainMs: 4000,
        ownsProcess: false,
      });
      loop.catch(() => {});
      const lockFile = path.join(stateDir, "tmp", "gateway-43.lock");
      await until(() => fs.existsSync(lockFile));

      process.kill(process.pid, "SIGTERM");
      await until(() => stopCalls === 1);
      process.kill(process.pid, "SIGTERM");
      process.kill(process.pid, "SIGINT");
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(stopCalls, 1);
      releaseStop();
      await until(() => !fs.existsSync(lockFile));
    } finally {
      releaseStop();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("drainProcessStores closes cron, control plane, and agent stores; stop precedes drain precedes release", () => {
    const src = fs.readFileSync(new URL("../src/gateway/run-loop.mjs", import.meta.url), "utf8");
    assert.match(src, /import\("\.\.\/cron\/scheduler\.mjs"\)/);
    assert.match(src, /cron\.stop\?\.\(\)/);
    assert.match(src, /import\("\.\.\/state\/control-plane\.mjs"\)/);
    assert.match(src, /plane\.stopControlPlane\?\.\(\)/);
    assert.match(src, /import\("\.\.\/state\/agent-store\.mjs"\)/);
    assert.match(src, /agents\.stopAgentStores\?\.\(\)/);
    const accepted = src.slice(src.indexOf("const runAccepted"), src.indexOf("const request"));
    const stopIdx = accepted.indexOf("await stop({");
    const drainIdx = accepted.indexOf("await drainProcessStores()");
    const releaseIdx = accepted.indexOf("await lock.release()");
    assert.ok(stopIdx > -1 && drainIdx > stopIdx && releaseIdx > drainIdx, "stop → drain → release order");
    assert.equal(typeof drainProcessStores, "function");
  });

  it("NOT adopted by the live gateway in this binary", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    assert.equal(gw.includes("run-loop.mjs"), false);
    assert.equal(gw.includes("runGatewayLoop"), false);
  });
});
