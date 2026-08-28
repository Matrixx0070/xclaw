/**
 * Adapted from OpenClaw (MIT) — src/shared/pid-alive.ts
 */
import fsSync from "node:fs";

function isValidPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function isZombieProcess(pid) {
  if (process.platform !== "linux") return false;
  try {
    const status = fsSync.readFileSync(`/proc/${pid}/status`, "utf8");
    const stateMatch = status.match(/^State:\s+(\S)/m);
    return stateMatch?.[1] === "Z";
  } catch {
    return false;
  }
}

/**
 * Liveness of a pid without signalling it.
 *
 * `kill(pid, 0)` throwing does NOT mean the process is gone. EPERM means it
 * exists but belongs to another user — alive, and the one case a bare
 * `catch { return false }` gets backwards. Callers that guard a lock read a
 * false "dead" as permission to steal it, so this must fail CLOSED: only
 * ESRCH proves absence. A zombie is the opposite case — `kill` succeeds on a
 * process that has already exited and is only awaiting reaping — so it is
 * checked separately rather than trusted from the signal alone.
 *
 * @param {number} pid
 * @param {(pid: number, sig: number) => void} [kill] injectable for tests
 * @returns {boolean}
 */
export function isPidAlive(pid, kill = process.kill.bind(process)) {
  if (!isValidPid(pid)) return false;
  try {
    kill(pid, 0);
  } catch (err) {
    if (err?.code !== "EPERM") return false;
  }
  if (isZombieProcess(pid)) return false;
  return true;
}

/**
 * Strict inverse of {@link isPidAlive}: true only when the pid is provably
 * gone. An unknown error (EPERM included) answers false, so a caller asking
 * "may I reclaim this?" never gets a yes it has not earned.
 *
 * @param {number} pid
 * @param {(pid: number, sig: number) => void} [kill] injectable for tests
 * @returns {boolean}
 */
export function isPidDefinitelyDead(pid, kill = process.kill.bind(process)) {
  if (!isValidPid(pid)) return true;
  try {
    kill(pid, 0);
  } catch (err) {
    return err?.code === "ESRCH";
  }
  return isZombieProcess(pid);
}
