/**
 * Crash-loop guard + port readiness (spec §13.4 + §13.5).
 *
 * applyCrashLoopGuard is called before runGatewayLoop: every process
 * exit records a timestamp into gateway-crash-history.json; boots inside
 * a 15-minute window back off 0 / 30s / 5m and refuse outright at 10
 * failures (XCLAW_CRASH_LOOP) — matching a supervised service that keeps
 * failing on boot. After a successful start(), call clear() so
 * intentional SIGUSR1 restarts do not count as crashes — clear() also
 * disarms this boot's exit hook (the spec sketch kept recording after
 * clear, so even a graceful stop after a successful start wrote a
 * "crash"; fixed for §13.3 adoption).
 *
 * NOT adopted by the live gateway in this binary — companions to the
 * (also unadopted) §13.2 run-loop harness.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const WINDOW_MS = 15 * 60 * 1000;

export function applyCrashLoopGuard(stateDir) {
  // No configDir / explicit stateDir → skip the file (do not path.join(null)
  // which would write gateway-crash-history.json in cwd). Production threads
  // cfg so live still records under configDir. Dummy return keeps
  // startGatewaySupervised's `applyCrashLoopGuard(stateRoot)` call intact
  // (source pin) and start proceeding.
  if (!stateDir) {
    return { delayMs: 0, clear() {} };
  }
  const file = path.join(stateDir, "gateway-crash-history.json");
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* no history yet */
  }
  const now = Date.now();
  history = history.filter((t) => now - t < WINDOW_MS);
  const n = history.length;
  if (n >= 10) {
    const err = new Error(`crash loop: ${n} failures in 15m; refusing to start`);
    err.code = "XCLAW_CRASH_LOOP";
    throw err;
  }
  const delayMs = n >= 7 ? 300_000 : n >= 4 ? 30_000 : 0;
  let cleared = false;
  process.once("exit", () => {
    if (cleared) return;
    try {
      const next = history.concat(Date.now()).filter((t) => Date.now() - t < WINDOW_MS);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next));
    } catch {
      /* recording is best-effort at exit */
    }
  });
  return {
    delayMs,
    clear() {
      cleared = true;
      try {
        fs.unlinkSync(file);
      } catch {
        /* already gone */
      }
    },
  };
}

export function waitForPort(host, port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      const ok = await new Promise((resolve) => {
        const s = net.createConnection({ host, port }, () => {
          s.destroy();
          resolve(true);
        });
        s.setTimeout(200, () => {
          s.destroy();
          resolve(false);
        });
        s.once("error", () => resolve(false));
      });
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
}
