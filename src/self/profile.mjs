/**
 * Self-modification profile (Mandate-2 slice A4).
 *
 * Detects missions targeting xclaw's own repository and applies a STRICTER
 * privilege overlay than normal missions — composition of existing guards,
 * no new enforcement layer:
 *   - risk-bounded autonomy tightened to tier ≤ low… except exec, which the
 *     verify floor requires; the edit surface is the real boundary
 *   - edit-surface allowlist enforced by a system-tier pre_tool_use hook
 *     (security-critical paths are never agent-editable)
 *   - mandatory verification floor (release-gate:quick by default)
 *   - merge+deploy autonomous per operator decision 2026-08-14, with
 *     cfg.self.requireMergeApproval as the opt-in brake
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Paths the agent may NEVER edit in a self mission (repo-relative prefixes).
 *
 * The list used to name only the *policy* — the modules that decide what is
 * allowed. That left the machinery enforcing the policy editable: a self
 * mission could rewrite the hook manager that ranks this guard's verdict, or
 * the loop that acts on it, and the NEXT self mission would run with no
 * boundary at all. It also left the verify floor editable, which matters more
 * than it looks: missions/engine.mjs force-sets autoMerge unless the operator
 * sets self.requireMergeApproval, so on a default host the floor is the only
 * thing between an autonomous edit and main.
 *
 * A hand-typed list cannot be its own guard, so this one is graded against
 * sets derived from the repository — see src/self/guard-surface.mjs.
 */
export const SELF_DENY_PATHS = [
  "src/security/",
  "src/self/",
  "src/hooks/manager.mjs", // ranks this guard's verdict against other hooks
  "src/agent/loop.mjs", // the only consumer that acts on a "deny"
  "src/missions/engine.mjs", // installs the guard and decides autoMerge
  "scripts/", // the verify floor's runners (subsumes gateway-supervisor.mjs)
  "package.json", // the script map `npm run` resolves the floor through
  "bin/",
  ".git/",
  ".github/workflows/",
];

/**
 * Normalize an operand to a repo-relative POSIX path for segment-anchored
 * matching. Strips a repoDir prefix, collapses `.`/`..`, forward-slashes, and
 * drops a leading `./` — so `src/./security/x`, `/repo/src/security/x` and
 * `./src/security/x` all reduce to `src/security/x`. Anchored substring match
 * (`includes(raw)`) is intentionally NOT used — that was the review finding.
 */
export function normalizeOperand(operand, repoDir = "") {
  let p = String(operand || "").trim();
  if (!p) return "";
  // resolve against repoDir when absolute-looking or repoDir-prefixed
  if (repoDir && (path.isAbsolute(p) || p.startsWith(repoDir))) {
    p = path.relative(repoDir, path.resolve(repoDir, p));
  } else {
    p = path.normalize(p);
  }
  p = p.replace(/\\/g, "/").replace(/^\.\//, "");
  return p;
}

/** Does a normalized path fall under any denied prefix (segment-anchored)? */
export function isDeniedPath(normPath, denyPaths = SELF_DENY_PATHS) {
  for (const deny of denyPaths) {
    const d = deny.replace(/\\/g, "/");
    if (d.endsWith("/")) {
      // directory prefix: exact dir or anything beneath it
      if (normPath === d.slice(0, -1) || normPath.startsWith(d)) return deny;
    } else if (normPath === d) {
      return deny; // exact file
    }
  }
  return null;
}

export async function detectSelfTarget(cfg, repoDir) {
  try {
    const configured = cfg.self?.repoDir;
    const target = await fs.realpath(path.resolve(repoDir));
    if (configured) {
      const conf = await fs.realpath(path.resolve(configured));
      return target === conf;
    }
    const pkg = JSON.parse(
      await fs.readFile(path.join(target, "package.json"), "utf8")
    );
    return pkg?.name === "xclaw";
  } catch {
    return false;
  }
}

/**
 * The edit-surface guard — a ~30-line system-tier pre_tool_use hook, not a
 * new enforcement layer. Denies write/edit tools and bash targeting denied
 * paths. The sandbox already pins the worktree; this narrows WITHIN it.
 */
// All arg keys the codebase's tools (and common MCP file tools) use to carry
// a path operand. Missing one is a guard bypass — keep this exhaustive.
// Single-sourced from the risk module (2026-08-14): risk.mjs had its own
// INCOMPLETE copy of this list, which re-created the exact 3.122 blind spot
// this list was written to close.
import { PATH_ARG_KEYS } from "../security/risk.mjs";
// Tool-name substrings that indicate a file MUTATION (beyond write/edit) —
// covers apply_patch, str_replace, create_or_update_file, push_files, etc.
const MUTATOR_NAME =
  /write|edit|append|delete|remove|move|rename|patch|str_replace|create|update|overwrite|fs_|put_file|save/i;
const EXEC_NAME = /bash|shell|exec|terminal|run_terminal|run_command|spawn|process/i;

export function editSurfaceGuard(denyPaths = SELF_DENY_PATHS, repoDir = "") {
  return function selfEditSurface(ctx) {
    const name = String(ctx.toolName || "");
    const args = ctx.args || {};
    const isWrite = MUTATOR_NAME.test(name);
    const isExec = EXEC_NAME.test(name);
    if (!isWrite && !isExec) return {};

    // Path-arg tools: normalize the operand and match on path segments.
    for (const k of PATH_ARG_KEYS) {
      if (typeof args[k] !== "string") continue;
      const hit = isDeniedPath(normalizeOperand(args[k], repoDir), denyPaths);
      if (hit) {
        return { decision: "deny", reason: `self-mission edit surface: ${hit} is not agent-editable` };
      }
    }

    // Exec: a shell command can reach any path with arbitrary quoting, so
    // extract candidate path-like tokens AND fall back to a normalized
    // substring check per deny prefix (defense in depth — a shell command is
    // opaque enough that we fail closed on any mention).
    if (isExec) {
      const cmd = String(args.command ?? args.cmd ?? args.script ?? args.input ?? "");
      // token scan: normalize each whitespace/=-separated token
      for (const tok of cmd.split(/[\s='";|&()><]+/)) {
        if (!tok) continue;
        const hit = isDeniedPath(normalizeOperand(tok, repoDir), denyPaths);
        if (hit) {
          return { decision: "deny", reason: `self-mission edit surface: ${hit} referenced by exec` };
        }
      }
      // whole-command normalized fallback (catches `.`-segment obfuscation
      // that survived tokenization)
      const flat = cmd.replace(/\\/g, "/").replace(/\/\.\//g, "/").replace(/\/+/g, "/");
      for (const deny of denyPaths) {
        if (flat.includes(deny)) {
          return { decision: "deny", reason: `self-mission edit surface: ${deny} referenced by exec` };
        }
      }
    }
    return {};
  };
}

/** Register the guard on a hook manager (system tier). */
export function registerEditSurfaceHook(manager, denyPaths = SELF_DENY_PATHS, repoDir = "") {
  manager.registerHook("pre_tool_use", editSurfaceGuard(denyPaths, repoDir), {
    tier: "system",
    name: "self-edit-surface",
  });
  return manager;
}

/** Apply the self overlay to a mission-scoped cfg. */
export function applySelfOverlay(mcfg, cfg = {}) {
  // Additive, not a replacement: `||` meant an operator who added one path to
  // harden the host silently dropped all six built-in denies and un-hardened
  // it instead. A knob for tightening must never be able to loosen.
  const extra = cfg.self?.denyPaths;
  const denyPaths = Array.isArray(extra) && extra.length
    ? [...new Set([...SELF_DENY_PATHS, ...extra])]
    : SELF_DENY_PATHS;
  return {
    ...mcfg,
    security: {
      ...(mcfg.security || {}),
      // stricter than normal missions: worktree writes stay auto (that's the
      // whole point) but the edit-surface hook + verify floor do the work
      autoApproveMaxTier: cfg.self?.autoApproveMaxTier || "risky",
      riskContext: { worktree: true, selfTarget: true },
    },
    self: { ...(cfg.self || {}), denyPaths },
  };
}

/** The verify command a self mission may never run without. */
export const SELF_VERIFY_FLOOR = ["npm run release-gate:quick"];

/**
 * Mandatory verification floor for self missions.
 *
 * Same defect the deny list carried until v3.361.0, in the same file, twenty
 * lines down: `||` made the floor a DEFAULT rather than a floor, so any
 * operator value replaced it. `verifyCommands: ["true"]` left a self mission
 * verifying nothing — and because engine.mjs forces `autoMerge` unless
 * `self.requireMergeApproval` is set, verify-green force-merges to main and
 * deploys. A mandatory floor an operator can delete is not mandatory.
 *
 * The Array.isArray guard is not defensive padding: a string spread into one
 * command per character, and an object threw inside engine.mjs's best-effort
 * catch AFTER `mission.profile = "self"` was set — self profile on, floor
 * never applied, nothing logged.
 */
export function selfVerifyCommands(cfg = {}) {
  const extra = cfg.self?.verifyCommands;
  return Array.isArray(extra) && extra.length
    ? [...new Set([...SELF_VERIFY_FLOOR, ...extra])]
    : SELF_VERIFY_FLOOR;
}
