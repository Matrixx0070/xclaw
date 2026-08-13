/**
 * Command-type hooks — out-of-process hook execution (Claude-Code-class).
 *
 * Config (cfg.hooks.commands[]):
 *   { event, command, args?, matcher?, tier?, timeoutMs?, name? }
 *
 * Protocol:
 *   stdin   — the (tier-filtered) hook context as JSON + trailing newline
 *   stdout  — optional JSON object; it becomes the hook's return value
 *             ({decision, reason, message?, <mutable fields>}), so the same
 *             tier rules apply as for in-process hooks
 *   exit 0  — success (stdout JSON honored)
 *   exit 2  — BLOCK: treated as {decision:"deny", abort, block, reason} with
 *             stderr (or stdout) as the reason — the loop applies whichever
 *             field its category honors
 *   other   — hook failure (recorded, never crashes the run)
 *
 * Running out-of-process is the real isolation story: the hook script has no
 * access to gateway memory regardless of tier — tier only shapes what it is
 * TOLD (stdin) and what it may CHANGE (returned fields).
 */
import { spawn } from "node:child_process";

export function createCommandHookFn(spec = {}) {
  const timeoutMs = Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : 10_000;
  return function commandHook(context) {
    return new Promise((resolve, reject) => {
      const child = spec.args
        ? spawn(spec.command, spec.args.map(String), { stdio: ["pipe", "pipe", "pipe"] })
        : spawn("bash", ["-c", spec.command], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish(reject, new Error(`command hook timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      // A hook that exits before stdin lands (e.g. `exit 2` one-liners under
      // load) emits an async EPIPE on stdin — that's fine, the exit code is
      // the verdict; swallow it so it can't reject with the wrong error.
      child.stdin.on("error", () => {});
      child.on("error", (e) => finish(reject, e));
      child.on("close", (code) => {
        const trimmed = out.trim();
        if (code === 2) {
          const msg = (err.trim() || trimmed || "blocked by command hook").slice(0, 500);
          // exit-2 is the universal block signal; expose every block-shaped
          // field so each category picks the one it honors
          finish(resolve, { decision: "deny", abort: msg, block: msg, reason: msg });
          return;
        }
        if (code !== 0) {
          finish(reject, new Error(`command hook exited ${code}: ${(err || out).trim().slice(0, 300)}`));
          return;
        }
        if (trimmed.startsWith("{")) {
          try {
            finish(resolve, JSON.parse(trimmed));
            return;
          } catch {
            /* non-JSON stdout — fall through as observation */
          }
        }
        finish(resolve, undefined);
      });
      try {
        child.stdin.write(JSON.stringify(context ?? {}) + "\n");
        child.stdin.end();
      } catch {
        /* child may have exited instantly */
      }
    });
  };
}

/** Register cfg.hooks.commands entries on a manager (operator-declared tier). */
export function registerCommandHooks(manager, cfg = {}) {
  const specs = cfg.hooks?.commands || [];
  const ids = [];
  for (const spec of specs) {
    if (!spec?.event || !spec?.command) continue;
    try {
      ids.push(
        manager.registerHook(spec.event, createCommandHookFn(spec), {
          name: spec.name || `cmd:${String(spec.command).slice(0, 40)}`,
          tier: spec.tier || "user",
          matcher: spec.matcher || null,
          source: "command",
        })
      );
    } catch (err) {
      // invalid entries are logged through the manager, never fatal
      manager._log?.({
        event: "command_hook_invalid",
        command: String(spec.command || "").slice(0, 60),
        error: String(err?.message || err),
      });
    }
  }
  return ids;
}
