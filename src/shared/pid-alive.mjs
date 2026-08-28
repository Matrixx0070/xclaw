/**
 * Adapted from OpenClaw (MIT) — src/shared/pid-alive.ts
 */
import fsSync from "node:fs";
import os from "node:os";

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

/**
 * May a pid recorded elsewhere be interpreted here at all?
 *
 * The two functions above answer "is this pid alive" by asking *this* machine's
 * process table, which is only an answer for a pid this machine minted. When a
 * pid arrives from a file that another host may have written — a bind-mounted
 * or restored `~/.xclaw`, an NFS home — the same call silently becomes a
 * question about an unrelated local process, and it is wrong in both
 * directions: a live remote owner reads as gone (so its lock gets stolen), and
 * a coincidental local pid reads as the owner still holding (so nothing ever
 * reclaims it).
 *
 * So liveness must be gated on provenance. A record with no host predates the
 * field and cannot be proven remote, so it stays local and keeps its existing
 * behaviour. Hostname case is not a difference — `os.hostname()` casing varies
 * by platform, and a false "remote" verdict would discard a pid we can in fact
 * test.
 *
 * @param {unknown} recordedHost host stamped into the record, if any
 * @param {string} [self] this machine's hostname
 * @returns {boolean} true when the pid alongside it is ours to judge
 */
export function isSameHost(recordedHost, self = os.hostname()) {
  const there = typeof recordedHost === "string" ? recordedHost.trim().toLowerCase() : "";
  if (!there) return true;
  const here = typeof self === "string" ? self.trim().toLowerCase() : "";
  return there === here;
}
