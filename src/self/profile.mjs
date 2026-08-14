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

/** Paths the agent may NEVER edit in a self mission (repo-relative prefixes). */
export const SELF_DENY_PATHS = [
  "src/security/",
  "src/self/",
  "scripts/gateway-supervisor.mjs",
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
const PATH_ARG_KEYS = [
  "path", "file", "filepath", "file_path", "filePath", "filename", "fileName",
  "target", "dest", "destination", "to", "output", "outputPath", "out",
];
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
  const denyPaths = cfg.self?.denyPaths || SELF_DENY_PATHS;
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

/** Mandatory verification floor for self missions. */
export function selfVerifyCommands(cfg = {}) {
  const floor = cfg.self?.verifyCommands || ["npm run release-gate:quick"];
  return floor;
}
