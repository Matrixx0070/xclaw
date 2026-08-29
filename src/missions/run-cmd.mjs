/**
 * Child-process runner for mission phases.
 *
 * This lived inline in engine.mjs as two near-identical closures, `sh` and
 * `shArgs`, both carrying the same defect: the timeout could not fire.
 *
 * `spawn` without `detached` puts the child in the parent's process group, so
 * `child.kill("SIGKILL")` signals only the direct `bash` pid. For anything that
 * backgrounds work — `npm test`, a dev server, `cmd &` — that pid has already
 * exited, and `child.kill` on a dead pid is a silent no-op — Node swallows ESRCH
 * and returns false, so nothing throws and nothing logs. The promise keeps
 * waiting: it settles on `'close'`, which fires only after BOTH stdio streams
 * reach EOF, and the surviving grandchild is holding the write end of that
 * pipe. Measured on the shipped code: `sh("sleep 5 & echo hi", dir, 1000)`
 * resolved after 8004ms with a 1s timeout; with a grandchild that never exits
 * it never resolves at all.
 *
 * That matters because `sh` runs the verification commands. `npm test --silent`
 * is auto-detected for any node repo with a `test` script (engine.mjs:79), and
 * a mission has no outer timeout — `bailIfAborted` is checked at phase
 * boundaries only, and `sh` takes no abort signal, so a wedged verify holds its
 * `running` map entry until the process is restarted.
 *
 * The fix is the one bash-tool.mjs:26-42,213-220 already made for the same
 * reason: spawn into a new process group and signal the GROUP, so the kill
 * reaches the grandchildren that hold the pipe.
 */
import { spawn } from "node:child_process";
import { buildToolEnv } from "../security/env-policy.mjs";

/** Tail kept for shell output; a verify log can be megabytes. */
export const SH_MAX_OUTPUT = 20_000;

/**
 * SIGKILL the child's whole process group, falling back to the bare pid.
 *
 * The group only exists because of `detached: true` below; the fallback covers
 * a child that died between the timer firing and the signal.
 */
function killGroup(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/**
 * Run a command to completion, bounded by a timeout that can actually fire.
 *
 * @param {string} exe
 * @param {string[]} argv
 * @param {{cwd?: string, timeoutMs?: number, maxOutput?: number, cfg?: object}} opts
 *   maxOutput 0 keeps everything; otherwise only the last N chars are retained.
 *   cfg supplies the env policy; omitting it is the safe default, not the unsafe one.
 * @returns {Promise<{code: number, output: string}>}
 */
export function runProcess(exe, argv, opts = {}) {
  const { cwd, timeoutMs = 300_000, maxOutput = 0, cfg } = opts;
  // Every agent-driven shell in xclaw runs through buildToolEnv; mission
  // verification did not, so a verify command — chosen by the model via the
  // worktree's package.json, by the operator via cfg.self.verifyCommands, or by
  // any caller of POST /missions — ran with the gateway's entire process.env:
  // provider keys, the gateway token, everything the daemon was started with.
  // Applied here rather than at each call site so a future caller inherits it
  // without having to remember; with no cfg the policy is strip-secrets.
  const { env } = buildToolEnv(cfg || {});
  return new Promise((resolve) => {
    // detached: true → own process group, so the timeout below reaches
    // grandchildren. Without it the timeout is decorative.
    const child = spawn(exe, argv, { cwd, detached: true, env });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, timeoutMs);
    const add = (d) => {
      out += d;
      // Bound at accumulation, not at resolve: a command that prints for an
      // hour used to hold every byte in memory before the tail was taken.
      if (maxOutput > 0 && out.length > maxOutput) out = out.slice(-maxOutput);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const done = (code, extra = "") => {
      clearTimeout(timer);
      // A killed command resolved with partial output and code 1, which reads
      // exactly like a genuine test failure — the repair loop then works
      // against a truncated log with nothing saying it was cut off.
      const note = timedOut ? `\n[xclaw] command timed out after ${timeoutMs}ms and was killed\n` : "";
      resolve({ code, output: out + extra + note });
    };
    child.on("close", (code) => done(timedOut ? code || 1 : (code ?? 1)));
    child.on("error", (e) => {
      out = "";
      done(1, String(e.message));
    });
  });
}

/** Shell runner for detected/configured verification commands. */
export function sh(cmd, cwd, timeoutMs = 300_000, cfg = null) {
  return runProcess("bash", ["-c", cmd], { cwd, timeoutMs, maxOutput: SH_MAX_OUTPUT, cfg });
}

/** argv-style runner (no shell quoting hazards) for snapshot git plumbing. */
export function shArgs(cmd, args, cwd, timeoutMs = 30_000, cfg = null) {
  return runProcess(cmd, args, { cwd, timeoutMs, cfg });
}

export default { runProcess, sh, shArgs, SH_MAX_OUTPUT };
