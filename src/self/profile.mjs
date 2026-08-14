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

/** Paths the agent may NEVER edit in a self mission (relative, prefix match). */
export const SELF_DENY_PATHS = [
  "src/security/",
  "src/self/",
  "scripts/gateway-supervisor.mjs",
  "bin/",
  ".git/",
  ".github/workflows/",
];

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
export function editSurfaceGuard(denyPaths = SELF_DENY_PATHS) {
  return function selfEditSurface(ctx) {
    const name = String(ctx.toolName || "");
    const args = ctx.args || {};
    const isWrite = /write|edit|append|delete|remove|move/i.test(name);
    const isExec = /bash|shell|exec/i.test(name);
    if (!isWrite && !isExec) return {};
    const texts = [];
    for (const k of ["path", "file", "filepath", "target", "dest"]) {
      if (typeof args[k] === "string") texts.push(args[k]);
    }
    if (isExec) texts.push(String(args.command ?? args.cmd ?? ""));
    for (const t of texts) {
      for (const deny of denyPaths) {
        if (t.includes(deny)) {
          return {
            decision: "deny",
            reason: `self-mission edit surface: ${deny} is not agent-editable`,
          };
        }
      }
    }
    return {};
  };
}

/** Register the guard on a hook manager (system tier). */
export function registerEditSurfaceHook(manager, denyPaths = SELF_DENY_PATHS) {
  manager.registerHook("pre_tool_use", editSurfaceGuard(denyPaths), {
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
