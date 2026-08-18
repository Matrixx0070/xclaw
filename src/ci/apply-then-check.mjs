import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function applyThenCheck(opts = {}) {
  const root = opts.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const script = opts.script || path.join(root, "scripts/apply-ship-patches.mjs");
  const run =
    opts.run ||
    ((args) =>
      spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" }));

  const apply = run([script]);
  if ((apply.status ?? apply.code ?? 0) !== 0) {
    return {
      ok: false,
      phase: "apply",
      code: apply.status ?? apply.code,
      stderr: apply.stderr,
    };
  }
  const check = run([script, "--check"]);
  const code = check.status ?? check.code ?? 0;
  return {
    ok: code === 0,
    phase: "check",
    code,
    stderr: check.stderr,
  };
}

export default { applyThenCheck };
