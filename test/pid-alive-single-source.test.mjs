/**
 * One correct pid-liveness primitive, used everywhere (2026-08-28).
 *
 * `process.kill(pid, 0)` does not answer "is this process alive?" — it answers
 * "did signalling succeed?", and those differ in one direction that matters.
 * ESRCH means gone. EPERM means the process EXISTS but belongs to another uid:
 * alive, and unsignalable. A bare `catch { return false }` collapses the two
 * into "dead".
 *
 * For a lock that is a fail-OPEN. The holder is running; the reader concludes
 * it is not; the lock is reclaimed out from under it. For the Telegram writer
 * lock that means two processes calling `getUpdates` on one bot token —
 * Telegram hands each a partial, racing view, so messages duplicate or vanish.
 * That is precisely the thing the lock exists to prevent. For the gateway lock
 * it means two gateways on one port and one state directory.
 *
 * A correct primitive already existed — `src/shared/pid-alive.mjs`, which also
 * handles the opposite error (a zombie answers `kill` successfully while being
 * an exited process, so all bare copies report it alive and refuse to reclaim
 * until `staleMs`). It was used by the daemon and, in spirit, by the doctor —
 * but four lock sites and two supervision sites had each re-derived their own
 * wrong copy. The doctor read the Telegram lock with correct EPERM semantics
 * while acquisition used a wrong inline one: the reader would report "held by
 * live pid" as the writer stole it.
 *
 * This file pins the semantics, proves the steal is refused at both severe
 * lock sites, and pins at the source that no eighth copy appears.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isPidAlive, isPidDefinitelyDead } from "../src/shared/pid-alive.mjs";
import { acquireTelegramWriterLock } from "../src/channels/telegram/webhook.mjs";
import { acquireGatewayLock } from "../src/gateway/run-loop.mjs";

const throws = (code) => () => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

/** A pid that is certainly not running, so nothing real is ever signalled. */
const DEAD_PID = 0x7ffffff0;

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `xclaw-pidalive-${tag}-`));
}

describe("isPidAlive (canonical semantics)", () => {
  it("treats a successful signal as alive", () => {
    assert.equal(isPidAlive(DEAD_PID, () => {}), true);
  });

  it("treats ESRCH as dead — the only error that proves absence", () => {
    assert.equal(isPidAlive(DEAD_PID, throws("ESRCH")), false);
  });

  it("treats EPERM as ALIVE — another uid's running process", () => {
    // The whole defect in one assertion: a bare catch answers false here, and
    // every lock guarded by it then reclaims a lock whose owner is running.
    assert.equal(isPidAlive(DEAD_PID, throws("EPERM")), true);
  });

  it("treats an unknown error as dead rather than guessing alive", () => {
    assert.equal(isPidAlive(DEAD_PID, throws("EINVAL")), false);
  });

  it("rejects non-pids without signalling anything", () => {
    const never = () => assert.fail("must not signal on an invalid pid");
    for (const pid of [0, -1, 1.5, NaN, null, undefined, "123"]) {
      assert.equal(isPidAlive(pid, never), false, String(pid));
    }
  });

  it("answers true for this very process, with the real kill", () => {
    assert.equal(isPidAlive(process.pid), true);
  });
});

describe("isPidDefinitelyDead (strict inverse)", () => {
  it("is true only on ESRCH", () => {
    assert.equal(isPidDefinitelyDead(DEAD_PID, throws("ESRCH")), true);
  });

  it("is false on EPERM — an unsignalable process is not provably gone", () => {
    assert.equal(isPidDefinitelyDead(DEAD_PID, throws("EPERM")), false);
  });

  it("is false when the signal succeeds", () => {
    assert.equal(isPidDefinitelyDead(DEAD_PID, () => {}), false);
  });

  it("is true for a non-pid", () => {
    assert.equal(isPidDefinitelyDead(-1, () => {}), true);
  });
});

// These stamp `host: os.hostname()` because a pid is only interpretable on
// the machine that minted it — the cross-host rules are pinned separately
// in test/telegram-writer-lock-host.test.mjs.
describe("Telegram single-writer lock refuses to steal from an EPERM holder", () => {
  it("reports lock_held when the holder is alive-but-unsignalable", () => {
    const dir = tmpDir("tg");
    const lockPath = path.join(dir, "telegram-writer.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: DEAD_PID, at: new Date().toISOString(), host: os.hostname() }),
      "utf8"
    );

    const r = acquireTelegramWriterLock({ lockPath, isAlive: () => true });

    assert.equal(r.ok, false, "stealing this lock puts two pollers on one bot token");
    assert.equal(r.reason, "lock_held");
    assert.equal(r.holder.pid, DEAD_PID);
    // The holder's stamp must survive: a steal rewrites it to our own pid.
    const after = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.equal(after.pid, DEAD_PID, "lock file was overwritten — the lock WAS stolen");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("still reclaims a lock whose holder is genuinely gone", () => {
    const dir = tmpDir("tg-dead");
    const lockPath = path.join(dir, "telegram-writer.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: DEAD_PID, at: new Date().toISOString(), host: os.hostname() }),
      "utf8"
    );

    const r = acquireTelegramWriterLock({ lockPath, isAlive: () => false });

    assert.equal(r.ok, true, "failing closed on a dead holder would wedge every restart");
    assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
    r.release();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("still reclaims a lock whose stamp is stale, alive holder or not", () => {
    const dir = tmpDir("tg-stale");
    const lockPath = path.join(dir, "telegram-writer.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        at: new Date(Date.now() - 10 * 60_000).toISOString(),
        host: os.hostname(),
      }),
      "utf8"
    );

    const r = acquireTelegramWriterLock({ lockPath, isAlive: () => true, staleMs: 120_000 });

    assert.equal(r.ok, true, "a wedged holder that stopped touching the lock must be evictable");
    r.release();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("gateway singleton lock refuses to steal from an EPERM holder", () => {
  it("throws XCLAW_GATEWAY_LOCKED when the holder is alive-but-unsignalable", async () => {
    const stateDir = tmpDir("gw");
    fs.mkdirSync(path.join(stateDir, "tmp"), { recursive: true });
    const file = path.join(stateDir, "tmp", "gateway-19999.lock");
    fs.writeFileSync(file, String(DEAD_PID), "utf8");

    await assert.rejects(
      () => acquireGatewayLock({ stateDir, port: 19999, isAlive: () => true }),
      (e) => e?.code === "XCLAW_GATEWAY_LOCKED",
      "two gateways would bind one port and share one state directory"
    );
    assert.equal(fs.readFileSync(file, "utf8").trim(), String(DEAD_PID));
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("still reclaims the lock when the holder is genuinely gone", async () => {
    const stateDir = tmpDir("gw-dead");
    fs.mkdirSync(path.join(stateDir, "tmp"), { recursive: true });
    const file = path.join(stateDir, "tmp", "gateway-19998.lock");
    fs.writeFileSync(file, String(DEAD_PID), "utf8");

    const lock = await acquireGatewayLock({ stateDir, port: 19998, isAlive: () => false });

    assert.equal(fs.readFileSync(file, "utf8").trim(), String(process.pid));
    await lock?.release?.();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });
});

describe("no module re-derives pid liveness (source pin)", () => {
  // Behavioural tests can only reach the sites that have an injection seam,
  // and EPERM cannot be reproduced naturally under a single-uid deployment
  // (as root every process is signalable). So the general invariant — that
  // the wrong idiom does not come back anywhere — is pinned at the source,
  // the same way doctor-no-duplicate-probes.test.mjs pins a call graph it
  // cannot run.
  const ROOT = new URL("../", import.meta.url).pathname;
  const CANONICAL = "src/shared/pid-alive.mjs";
  // The vendored computer server is a tracked upstream bundle (see ADR 0006);
  // it is patched wholesale, never line-edited, so it is out of scope here.
  const VENDORED = "src/computer/xclaw-server.mjs";

  function sourceFiles(dir, out = []) {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) sourceFiles(rel, out);
      else if (ent.name.endsWith(".mjs")) out.push(rel);
    }
    return out;
  }

  const files = [...sourceFiles("src"), ...sourceFiles("bin")].filter(
    (f) => f !== CANONICAL && f !== VENDORED
  );

  it("scans a plausible number of files", () => {
    assert.ok(files.length > 100, `only found ${files.length} sources — the walk is broken`);
  });

  it("no module outside the canonical one probes liveness with kill(pid, 0)", () => {
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      // `kill(x, 0)` is the liveness idiom; real signals (SIGTERM, …) are fine.
      if (/\bprocess\.kill\(\s*[^,)]+,\s*0\s*\)/.test(src)) offenders.push(f);
    }
    assert.deepEqual(
      offenders,
      [],
      `these re-derive liveness instead of importing ${CANONICAL} — each one is a fresh chance to get EPERM backwards`
    );
  });

  it("no module defines its own isPidAlive/pidAlive helper", () => {
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (/\bfunction\s+(isPidAlive|pidAlive)\s*\(/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], `duplicate liveness helpers — import ${CANONICAL} instead`);
  });
});
