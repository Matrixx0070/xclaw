/**
 * Role-based multi-LLM routing — draft / act / verify.
 *
 * Config:
 *   router.roles: {
 *     draft:  "openai/gpt-4o-mini",      // cheap planning / first pass
 *     act:    "xai/grok-4.5",            // tool-using agent turns (default = primary)
 *     strong: "anthropic/claude-sonnet-5", // alias for verify
 *     verify: "anthropic/claude-opus-5"  // final check / critique
 *   }
 *   router.rolePolicy: {
 *     firstTurn: "draft" | "act",     // default act
 *     toolTurns: "act",
 *     lastTurnVerify: true,           // after final text, optional verify pass
 *     verifyOnNoTools: false
 *   }
 *
 * Env:
 *   XCLAW_ROLE_DRAFT=openai/gpt-4o-mini
 *   XCLAW_ROLE_ACT=xai/grok-4.5
 *   XCLAW_ROLE_VERIFY=anthropic/claude-sonnet-5
 */

import { createProviderForRef, createFailoverProvider } from "./failover-router.mjs";
import { parseModelRef } from "./registry.mjs";

export const ROLES = Object.freeze(["draft", "act", "verify", "strong"]);

/**
 * Resolve role → model ref from config/env.
 * @returns {Record<string, string|null>}
 */
export function resolveRoleMap(cfg = {}) {
  const roles = {
    ...(cfg.router?.roles || {}),
    ...(cfg.agent?.roles || {}),
  };
  const map = {
    draft:
      roles.draft ||
      process.env.XCLAW_ROLE_DRAFT ||
      null,
    act:
      roles.act ||
      roles.primary ||
      process.env.XCLAW_ROLE_ACT ||
      cfg.agent?.model ||
      process.env.XCLAW_MODEL ||
      null,
    verify:
      roles.verify ||
      roles.strong ||
      process.env.XCLAW_ROLE_VERIFY ||
      process.env.XCLAW_ROLE_STRONG ||
      null,
    strong:
      roles.strong ||
      roles.verify ||
      process.env.XCLAW_ROLE_STRONG ||
      null,
  };
  return map;
}

/**
 * Policy for which role runs when.
 */
export function resolveRolePolicy(cfg = {}) {
  const p = cfg.router?.rolePolicy || cfg.agent?.rolePolicy || {};
  return {
    firstTurn: p.firstTurn || "act",
    toolTurns: p.toolTurns || "act",
    /** Use draft on turn 1 when draft role is configured */
    preferDraftFirst: p.preferDraftFirst === true || p.firstTurn === "draft",
    /** After a tool-free assistant message that looks final, run verify */
    lastTurnVerify: p.lastTurnVerify !== false,
    verifyOnNoTools: p.verifyOnNoTools === true,
    /** Max turns to stay on draft before forcing act */
    draftMaxTurns: p.draftMaxTurns ?? 1,
  };
}

/**
 * Choose role for this agent turn.
 *
 * @param {object} ctx
 * @param {number} ctx.turn  0-based
 * @param {boolean} ctx.hasToolCalls  previous assistant had tools
 * @param {boolean} ctx.isFinalCandidate  no tools this turn, may be done
 * @param {string} [ctx.forceRole]
 * @param {object} cfg
 */
export function selectRole(ctx = {}, cfg = {}) {
  if (ctx.forceRole && ROLES.includes(ctx.forceRole)) return ctx.forceRole;
  const map = resolveRoleMap(cfg);
  const policy = resolveRolePolicy(cfg);
  const turn = ctx.turn ?? 0;

  if (ctx.phase === "verify" && map.verify) return "verify";
  if (ctx.phase === "draft" && map.draft) return "draft";

  // First turn(s): optional draft
  if (
    map.draft &&
    policy.preferDraftFirst &&
    turn < policy.draftMaxTurns &&
    !ctx.forceAct
  ) {
    return "draft";
  }

  // Default tool-using agent path
  if (map.act) return "act";
  if (map.draft) return "draft";
  return "act";
}

/**
 * Build providers for each configured role (with optional failover chain per role).
 */
export async function createRoleProviders(cfg = {}, opts = {}) {
  const map = resolveRoleMap(cfg);
  const onEvent = opts.onEvent || (() => {});
  /** @type {Record<string, { provider: object, route: object, modelRef: string }>} */
  const byRole = {};

  for (const role of ["draft", "act", "verify"]) {
    const ref = map[role];
    if (!ref) continue;
    try {
      // Per-role: allow fallbackModels only for act (primary chain); roles are single-ref by default
      if (role === "act" && cfg.router?.enabled !== false) {
        const fo = await createFailoverProvider(cfg, {
          model: ref,
          onEvent,
          onRetry: opts.onRetry,
        });
        byRole[role] = {
          provider: fo.provider,
          route: fo.clients[0]?.route,
          modelRef: fo.primary,
          chain: fo.chain,
        };
      } else {
        const c = await createProviderForRef(cfg, ref, opts);
        byRole[role] = {
          provider: c.provider,
          route: c.route,
          modelRef: c.route.modelRef,
        };
      }
      onEvent({
        type: "router",
        phase: "role_ready",
        role,
        modelRef: byRole[role].modelRef,
      });
    } catch (err) {
      onEvent({
        type: "router",
        phase: "role_skip",
        role,
        modelRef: ref,
        reason: String(err.message || err),
      });
    }
  }

  // Ensure act exists: fall back to any role or full failover chain
  if (!byRole.act) {
    if (byRole.draft) byRole.act = byRole.draft;
    else if (byRole.verify) byRole.act = byRole.verify;
    else {
      try {
        const fo = await createFailoverProvider(cfg, {
          onEvent,
          onRetry: opts.onRetry,
        });
        byRole.act = {
          provider: fo.provider,
          route: fo.clients[0]?.route,
          modelRef: fo.primary,
          chain: fo.chain,
        };
      } catch (err) {
        onEvent({
          type: "router",
          phase: "role_act_unavailable",
          reason: String(err.message || err),
        });
      }
    }
  }

  if (!byRole.act) {
    throw new Error(
      "No act provider available (configure agent.model + API keys / OAuth)"
    );
  }

  // B3 economy entries — resolved up front so the per-turn pick stays sync.
  // Explicit cfg.router.economyRoles wins; router.autoEconomy derives the
  // cheapest capable candidate from declared metadata + measured stats.
  // verify NEVER auto-downshifts (correctness gates are not where you save
  // pennies) — only an explicit economyRoles.verify touches it.
  try {
    const economyRefs = { ...(cfg.router?.economyRoles || {}) };
    if (cfg.router?.autoEconomy === true) {
      const { getModelMeta } = await import("./registry.mjs");
      const { getModelStats } = await import("./model-stats.mjs");
      const stats = await getModelStats(cfg).catch(() => ({}));
      const candidates = [
        ...new Set(
          [
            ...Object.values(map).filter(Boolean),
            ...(cfg.agent?.fallbackModels || []),
          ].filter(Boolean)
        ),
      ];
      const minTier = cfg.router?.economyMinTier ?? 2;
      const scored = candidates
        .map((ref) => ({ ref, meta: getModelMeta(cfg, ref), s: stats[ref] }))
        .filter((c) => c.meta.tier >= minTier)
        .filter((c) => !c.s || c.s.runs < 5 || (c.s.successRate ?? 1) >= 0.8)
        .sort(
          (a, b) =>
            (a.meta.cost.in + a.meta.cost.out) - (b.meta.cost.in + b.meta.cost.out)
        );
      if (scored.length) {
        for (const role of ["act", "draft"]) {
          if (!economyRefs[role] && byRole[role]) economyRefs[role] = scored[0].ref;
        }
      }
    }
    for (const [role, ref] of Object.entries(economyRefs)) {
      if (!ref || !byRole[role] || byRole[role].modelRef === ref) continue;
      try {
        const c = await createProviderForRef(cfg, ref, opts);
        byRole[role].economy = {
          provider: c.provider,
          route: c.route,
          modelRef: c.route.modelRef,
        };
      } catch (err) {
        onEvent({
          type: "router",
          phase: "economy_skip",
          role,
          modelRef: ref,
          reason: String(err.message || err),
        });
      }
    }
  } catch {
    /* economy overlay is optional — routing must never break on it */
  }

  return { byRole, map, policy: resolveRolePolicy(cfg) };
}

/**
 * Facade: same chat API as createProvider, but picks role per call via opts.role or selectRole.
 */
export function createRoleAwareProvider(roleBundle, cfg = {}, opts = {}) {
  const { byRole, policy } = roleBundle;
  const onEvent = opts.onEvent || (() => {});
  let turnCounter = 0;
  let lastRole = "act";

  // B3 governor mode cache — pick() is sync, the governor file is not. The
  // cache refreshes in the background at most every 60s (test seam:
  // opts._governorMode forces a mode). Missing/erroring governor = "normal".
  const hasEconomy = Object.values(byRole).some((e) => e?.economy);
  let cachedMode = opts._governorMode || opts._initialMode || "normal";
  let lastModeCheck = 0;
  let inEconomy = false;
  function refreshMode() {
    if (opts._governorMode) return;
    const now = Date.now();
    if (now - lastModeCheck < (cfg.router?.economyRefreshMs ?? 60_000)) return;
    lastModeCheck = now;
    import("../tokens/cost-governor.mjs")
      .then((m) => m.governorMode(cfg))
      .then((g) => {
        cachedMode = g.mode;
      })
      .catch(() => {});
  }

  function pick(roleHint) {
    let role =
      roleHint && byRole[roleHint]
        ? roleHint
        : selectRole(
            {
              turn: turnCounter,
              forceRole: roleHint,
            },
            cfg
          );
    let entry = byRole[role] || byRole.act;
    if (!entry) {
      role = "act";
      entry = byRole.act;
    }
    if (!entry?.provider) {
      throw new Error(`role-router: no provider for role=${role}`);
    }
    // economy overlay: swap to the cheaper entry while the governor says so;
    // recovery is symmetric the moment the mode drops back to normal.
    if (hasEconomy) {
      refreshMode();
      const wantEconomy = cachedMode === "economy" && Boolean(entry.economy);
      if (wantEconomy) {
        if (!inEconomy) {
          inEconomy = true;
          onEvent({
            type: "router",
            phase: "economy_downshift",
            role,
            from: entry.modelRef,
            to: entry.economy.modelRef,
          });
        }
        lastRole = role;
        lastEntry = entry.economy;
        return { role, entry: entry.economy };
      }
      if (inEconomy && cachedMode !== "economy") {
        inEconomy = false;
        onEvent({
          type: "router",
          phase: "economy_recover",
          role,
          to: entry.modelRef,
        });
      }
    }
    lastRole = role;
    lastEntry = entry;
    return { role, entry };
  }

  let lastEntry = byRole.act;
  const facade = {
    get model() {
      return (lastEntry || byRole.act).provider.model;
    },
    get baseUrl() {
      return (lastEntry || byRole.act).provider.baseUrl;
    },
    get providerName() {
      return (lastEntry || byRole.act).route?.provider;
    },
    get modelRef() {
      return (lastEntry || byRole.act).modelRef;
    },
    get roles() {
      return Object.fromEntries(
        Object.entries(byRole).map(([k, v]) => [k, v.modelRef])
      );
    },
    policy,
    selectRoleForTurn(ctx) {
      return selectRole(ctx, cfg);
    },
    async chat(args = {}) {
      const roleHint = args.role || args.routerRole;
      const { role, entry } = pick(roleHint);
      onEvent({
        type: "router",
        phase: "role",
        role,
        modelRef: entry.modelRef,
        turn: turnCounter + 1,
      });
      const { role: _r, routerRole: _rr, ...chatArgs } = args;
      try {
        const result = await entry.provider.chat(chatArgs);
        turnCounter += 1;
        return result;
      } catch (err) {
        // If role-specific provider fails and act is different, try act once
        if (role !== "act" && byRole.act && byRole.act !== entry) {
          onEvent({
            type: "router",
            phase: "role_failover",
            from: role,
            to: "act",
            message: String(err.message || err),
          });
          const result = await byRole.act.provider.chat(chatArgs);
          turnCounter += 1;
          lastRole = "act";
          return result;
        }
        throw err;
      }
    },
    async chatStream(args = {}) {
      const roleHint = args.role || args.routerRole;
      const { role, entry } = pick(roleHint);
      onEvent({
        type: "router",
        phase: "role",
        role,
        modelRef: entry.modelRef,
        turn: turnCounter + 1,
        stream: true,
      });
      const { role: _r, routerRole: _rr, ...chatArgs } = args;
      const p = entry.provider;
      if (typeof p.chatStream === "function") {
        const result = await p.chatStream(chatArgs);
        turnCounter += 1;
        return result;
      }
      const result = await p.chat(chatArgs);
      turnCounter += 1;
      return result;
    },
    async verify(args = {}) {
      if (!byRole.verify) {
        return this.chat({ ...args, role: "act" });
      }
      return this.chat({ ...args, role: "verify" });
    },
  };

  return facade;
}

/**
 * One-shot setup for agent loop.
 */
export async function createRoleRouter(cfg = {}, opts = {}) {
  try {
    // B3: an economy configuration alone also engages the role router — the
    // downshift overlay lives here, and act-only setups are the common case.
    const economyConfigured =
      Boolean(Object.keys(cfg.router?.economyRoles || {}).length) ||
      cfg.router?.autoEconomy === true;
    const rolesEnabled =
      cfg.router?.rolesEnabled === true ||
      Boolean(cfg.router?.roles?.draft || cfg.router?.roles?.verify) ||
      Boolean(process.env.XCLAW_ROLE_DRAFT || process.env.XCLAW_ROLE_VERIFY) ||
      economyConfigured;

    if (!rolesEnabled && cfg.router?.rolesEnabled !== true) {
      const map = resolveRoleMap(cfg);
      if (!map.draft && !map.verify) {
        return { enabled: false, provider: null, roleBundle: null };
      }
    }

    const roleBundle = await createRoleProviders(cfg, opts);
    // Seed the governor mode NOW — pick() is sync and short runs would
    // otherwise finish before the background refresh ever lands.
    let initialMode = "normal";
    if (Object.values(roleBundle.byRole).some((e) => e?.economy)) {
      try {
        const { governorMode } = await import("../tokens/cost-governor.mjs");
        initialMode = (await governorMode(cfg)).mode;
      } catch {}
    }
    const provider = createRoleAwareProvider(roleBundle, cfg, {
      ...opts,
      _initialMode: initialMode,
    });
    opts.onEvent?.({
      type: "router",
      phase: "roles_ready",
      roles: provider.roles,
      policy: roleBundle.policy,
    });
    return { enabled: true, provider, roleBundle };
  } catch (err) {
    opts.onEvent?.({
      type: "router",
      phase: "roles_error",
      message: String(err.message || err),
    });
    return { enabled: false, provider: null, roleBundle: null };
  }
}

export default {
  ROLES,
  resolveRoleMap,
  resolveRolePolicy,
  selectRole,
  createRoleProviders,
  createRoleAwareProvider,
  createRoleRouter,
};
