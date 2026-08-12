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

export function isPidAlive(pid) {
  if (!isValidPid(pid)) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err?.code !== "EPERM") return false;
  }
  if (isZombieProcess(pid)) return false;
  return true;
}

export function isPidDefinitelyDead(pid) {
  if (!isValidPid(pid)) return true;
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err?.code === "ESRCH";
  }
  return isZombieProcess(pid);
}
