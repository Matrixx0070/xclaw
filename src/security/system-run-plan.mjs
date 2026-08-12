/**
 * Frozen execution plan for approval binding.
 *
 * Inspired by OpenClaw systemRunPlan: pin argv/cwd/executable identity
 * before the human (or auto) decision, then re-validate after approval
 * to close classic TOCTOU windows.
 *
 * Design goals:
 * - Fail-closed when critical pins cannot be established for exec tools
 * - Stable fingerprint so the pending record is against an immutable plan
 * - Optional content-hash for mutable file operands
 * - Pure functions — no process-global state
 *
 * This is the control-plane binding surface. Capability execution still
 * lives on the computer plane; the gateway only decides.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLAN_VERSION = 1;

/** Tools that receive full plan binding (argv + exe + cwd pins). */
const EXEC_TOOLS = new Set([
  "xclaw_bash",
  "bash",
  "shell",
  "exec",
  "xclaw_exec",
  "run_terminal",
]);

/**
 * @param {string} value
 * @returns {string|null}
 */
function tryRealpath(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(value)
      : fs.realpathSync(value);
  } catch {
    return null;
  }
}

/**
 * @param {string} filePath
 * @returns {string|null} sha256 hex or null if unreadable
 */
function tryContentHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Normalize argv from common tool arg shapes.
 * @param {object} args
 * @returns {string[]}
 */
export function extractArgv(args = {}) {
  if (Array.isArray(args.argv) && args.argv.every((x) => typeof x === "string")) {
    return args.argv.map(String);
  }
  const cmd =
    args.command ?? args.cmd ?? args.script ?? args.input ?? args.line ?? "";
  if (typeof cmd !== "string") return [];
  // Conservative split — preserve quoted segments is out of scope for v1;
  // the full command string is also stored for display.
  return cmd.trim() ? cmd.trim().split(/\s+/) : [];
}

/**
 * Build a frozen plan from a tool invocation.
 *
 * @param {object} opts
 * @param {string} opts.tool
 * @param {object} [opts.args]
 * @param {string} [opts.root] workspace / computer root
 * @param {boolean} [opts.hashFileOperands=false]
 * @returns {{
 *   ok: boolean,
 *   plan?: object,
 *   reason?: string,
 *   message?: string,
 * }}
 */
export function buildSystemRunPlan({
  tool,
  args = {},
  root = process.cwd(),
  hashFileOperands = false,
} = {}) {
  const name = String(tool || "").trim();
  if (!name) {
    return { ok: false, reason: "missing_tool", message: "tool name required" };
  }

  const isExec = EXEC_TOOLS.has(name.toLowerCase());
  const argv = extractArgv(args);
  const commandStr =
    typeof args.command === "string"
      ? args.command
      : typeof args.cmd === "string"
        ? args.cmd
        : argv.join(" ");

  const cwdRaw = args.cwd || args.workingDir || args.workdir || root;
  const cwdResolved = path.resolve(String(cwdRaw || root));
  const cwdReal = tryRealpath(cwdResolved) || cwdResolved;

  /** @type {object} */
  const pins = {
    cwd: cwdReal,
    cwdResolved,
  };

  let exe = null;
  let exeReal = null;

  if (isExec && argv.length > 0) {
    const bin = argv[0];
    // Absolute or relative-to-cwd binary
    const candidate = path.isAbsolute(bin)
      ? bin
      : path.resolve(cwdReal, bin);
    exe = candidate;
    exeReal = tryRealpath(candidate);
    // Also try PATH-less common locations is intentionally omitted —
    // fail closed if we cannot pin when security.requirePinnedExe is set.
    pins.exe = exeReal || exe;
    pins.exeResolved = exe;
  }

  /** @type {Array<{path: string, hash: string|null}>} */
  const fileOperands = [];
  if (hashFileOperands) {
    const pathKeys = ["path", "file", "filepath", "filename", "target", "src", "dest"];
    for (const k of pathKeys) {
      if (typeof args[k] === "string" && args[k]) {
        const abs = path.isAbsolute(args[k])
          ? path.resolve(args[k])
          : path.resolve(cwdReal, args[k]);
        const real = tryRealpath(abs) || abs;
        fileOperands.push({
          key: k,
          path: real,
          hash: tryContentHash(real),
        });
      }
    }
  }

  const plan = {
    version: PLAN_VERSION,
    tool: name,
    isExec,
    command: commandStr,
    argv: Object.freeze([...argv]),
    cwd: cwdReal,
    exe: exeReal || exe,
    pins,
    fileOperands: Object.freeze(fileOperands),
    createdAt: new Date().toISOString(),
    // Bound at construction time — do not recompute later for the fingerprint
    fingerprint: null,
  };

  plan.fingerprint = planFingerprint(plan);

  // Fail-closed policy for exec tools when binary cannot be resolved and
  // caller demanded a pin. Soft by default so existing flows keep working.
  if (isExec && args.requirePinnedExe === true && !exeReal) {
    return {
      ok: false,
      reason: "exe_unboundable",
      message: `Cannot realpath executable for ${name}; refused (requirePinnedExe).`,
      plan,
    };
  }

  return { ok: true, plan };
}

/**
 * Stable fingerprint of a plan (excludes createdAt).
 * @param {object} plan
 * @returns {string}
 */
export function planFingerprint(plan) {
  const payload = {
    v: plan.version ?? PLAN_VERSION,
    tool: plan.tool,
    argv: plan.argv || [],
    cwd: plan.cwd,
    exe: plan.exe,
    files: (plan.fileOperands || []).map((f) => ({
      p: f.path,
      h: f.hash,
    })),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Re-validate pins after approval (TOCTOU mitigation).
 * Returns { ok, reason?, message?, drift? }.
 *
 * @param {object} plan
 * @returns {{ ok: boolean, reason?: string, message?: string, drift?: object }}
 */
export function revalidatePlan(plan) {
  if (!plan || plan.version !== PLAN_VERSION) {
    return { ok: false, reason: "invalid_plan", message: "plan missing or version mismatch" };
  }

  const drift = {};

  if (plan.cwd) {
    const now = tryRealpath(plan.pins?.cwdResolved || plan.cwd) || plan.cwd;
    if (now !== plan.cwd) {
      drift.cwd = { expected: plan.cwd, actual: now };
    }
  }

  if (plan.exe && plan.pins?.exeResolved) {
    const now = tryRealpath(plan.pins.exeResolved);
    if (now && plan.exe && now !== plan.exe) {
      drift.exe = { expected: plan.exe, actual: now };
    }
  }

  for (const f of plan.fileOperands || []) {
    if (!f.hash) continue;
    const nowHash = tryContentHash(f.path);
    if (nowHash && nowHash !== f.hash) {
      drift[`file:${f.key || f.path}`] = {
        expected: f.hash,
        actual: nowHash,
      };
    }
  }

  if (Object.keys(drift).length > 0) {
    return {
      ok: false,
      reason: "plan_drift",
      message: "Execution environment drifted after approval (TOCTOU).",
      drift,
    };
  }

  // Fingerprint must still match construction-time binding
  const current = planFingerprint(plan);
  if (plan.fingerprint && current !== plan.fingerprint) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      message: "Plan fingerprint no longer matches frozen plan.",
    };
  }

  return { ok: true };
}

/**
 * Whether a tool name is treated as an exec tool for plan binding.
 * @param {string} tool
 */
export function isExecTool(tool) {
  return EXEC_TOOLS.has(String(tool || "").toLowerCase());
}

export default {
  buildSystemRunPlan,
  planFingerprint,
  revalidatePlan,
  extractArgv,
  isExecTool,
  PLAN_VERSION,
};
