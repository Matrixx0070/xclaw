/**
 * Single-instance gateway harness (spec §13.2).
 *
 * lock → title → arm signals → for (;;) start → wait → on signal fence →
 * drain/stop → SQL close → release lock → restart iteration or exit.
 *
 * NOT adopted by the live gateway in this binary — startGateway still owns
 * its own SIGINT/SIGTERM (spec §13.3 adoption removes those; that is a
 * separate live-surface slice). Signal matrix: SIGINT/SIGTERM stop,
 * SIGUSR1 in-process restart. Second signal during shutdown is ignored
 * (fence). Hard-exit watchdog fires at drainMs + 2s with exit code 1 so
 * the supervisor restarts cleanly.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DRAIN_MS = 15_000;
const HARD_EXIT_GRACE_MS = 2_000;

function lockPath(stateDir, port) {
  const dir = path.join(stateDir || path.join(os.homedir(), ".xclaw"), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `gateway-${port || "default"}.lock`);
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireGatewayLock({ stateDir, port } = {}) {
  const file = lockPath(stateDir, port);
  if (fs.existsSync(file)) {
    const prev = Number(fs.readFileSync(file, "utf8").trim());
    if (pidAlive(prev) && prev !== process.pid) {
      const err = new Error(`another xclaw gateway holds ${file} (pid ${prev})`);
      err.code = "XCLAW_GATEWAY_LOCKED";
      throw err;
    }
    try {
      fs.unlinkSync(file);
    } catch {
      /* stale */
    }
  }
  const fh = fs.openSync(file, "wx");
  fs.writeFileSync(fh, String(process.pid));
  return {
    file,
    async release() {
      try {
        fs.closeSync(fh);
      } catch {
        /* already closed */
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* already removed */
      }
    },
  };
}

/** SQL close order from §5.8e: cron, control plane, then per-agent stores. */
export async function drainProcessStores() {
  const jobs = [];
  try {
    const cron = await import("../cron/scheduler.mjs");
    jobs.push(Promise.resolve(cron.stop?.()));
  } catch {
    /* cron not loaded */
  }
  try {
    const plane = await import("../state/control-plane.mjs");
    jobs.push(Promise.resolve(plane.stopControlPlane?.()));
  } catch {
    /* plane not loaded */
  }
  try {
    const agents = await import("../state/agent-store.mjs");
    jobs.push(Promise.resolve(agents.stopAgentStores?.()));
  } catch {
    /* agent stores not loaded */
  }
  await Promise.allSettled(jobs);
}

export async function runGatewayLoop({
  start,
  stop,
  stateDir,
  port,
  drainMs = DRAIN_MS,
  ownsProcess = true,
}) {
  if (process.title === "xclaw" || process.title === "node") {
    process.title = "xclaw-gateway";
  }

  const lock = await acquireGatewayLock({ stateDir, port });
  let server = null;
  let shuttingDown = false;
  let restartResolver = null;
  let pendingStartup = null;

  const cleanupSignals = () => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGUSR1", onSigusr1);
  };

  const hardExit = (code) => {
    cleanupSignals();
    if (ownsProcess) process.exit(code);
  };

  const runAccepted = (action, signal) => {
    const isRestart = action === "restart";
    const budget = drainMs + HARD_EXIT_GRACE_MS;
    const hang = setTimeout(() => {
      console.error("[xclaw] shutdown timed out; exiting without full cleanup");
      hardExit(1);
    }, budget);
    hang.unref?.();

    void (async () => {
      try {
        await stop({
          reason: isRestart ? "gateway restarting" : "gateway stopping",
          server,
          signal,
        });
      } catch (err) {
        console.error("[xclaw] stop failed", err?.message || err);
      }
      try {
        await drainProcessStores();
      } catch {
        /* best-effort */
      }
      clearTimeout(hang);
      if (isRestart) {
        // Keep the single-instance lock across an in-process restart — the
        // spec sketch released it here, leaving the restarted gateway
        // unlocked (live-proven: lock file vanished after SIGUSR1).
        shuttingDown = false;
        server = null;
        restartResolver?.();
        return;
      }
      try {
        await lock.release();
      } catch {
        /* best-effort */
      }
      hardExit(0);
    })();
  };

  const request = (action, signal) => {
    if (shuttingDown) {
      console.log(`[xclaw] received ${signal} during shutdown; ignoring`);
      return;
    }
    shuttingDown = true;
    console.log(`[xclaw] received ${signal}; ${action === "restart" ? "restarting" : "stopping"}`);
    if (!server) {
      pendingStartup = { action, signal };
      return;
    }
    runAccepted(action, signal);
  };

  const onSigint = () => request("stop", "SIGINT");
  const onSigterm = () => request("stop", "SIGTERM");
  const onSigusr1 = () => request("restart", "SIGUSR1");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGUSR1", onSigusr1);

  try {
    for (;;) {
      server = await start();
      if (pendingStartup) {
        const queued = pendingStartup;
        pendingStartup = null;
        runAccepted(queued.action, queued.signal);
      }
      await new Promise((resolve) => {
        restartResolver = resolve;
      });
    }
  } finally {
    try {
      await lock.release();
    } catch {
      /* best-effort */
    }
    cleanupSignals();
  }
}
