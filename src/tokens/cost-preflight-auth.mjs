/**
 * Refresh OAuth / seat-linked tokens before cost preflight.
 * Avoids false BUDGET_EXCEEDED or provider failures when the seat token is stale.
 * Always persists status for doctor ops.auth_refresh.
 */

const DEFAULT_APPS = ["xai", "grok"];

async function persistAuthStatus(cfg, result) {
  try {
    const { recordAuthRefreshStatus } = await import("./auth-refresh-status.mjs");
    await recordAuthRefreshStatus(cfg, result);
  } catch {
    /* non-fatal */
  }
}

export async function refreshAuthBeforeCostPreflight(cfg = {}, opts = {}) {
  let out;
  try {
    if (cfg?.cost?.refreshAuthBeforeBudget === false) {
      out = { ok: true, skipped: true, reason: "disabled", results: [] };
      return out;
    }
    if (process.env.XCLAW_SKIP_AUTH_BEFORE_COST === "1") {
      out = { ok: true, skipped: true, reason: "env_skip", results: [] };
      return out;
    }

    const apps = Array.isArray(opts.apps)
      ? opts.apps
      : Array.isArray(cfg?.cost?.refreshAppsBeforeBudget)
        ? cfg.cost.refreshAppsBeforeBudget
        : DEFAULT_APPS;

    const ensureFresh =
      opts.ensureFresh ||
      (async (c, appId, o) => {
        const { ensureFreshToken } = await import("../connected/token-refresh.mjs");
        return ensureFreshToken(c, appId, o);
      });

    const results = [];
    for (const appId of apps) {
      if (!appId) continue;
      try {
        const r = await ensureFresh(cfg, appId, {
          force: opts.force === true,
          skewMs: opts.skewMs,
          preferStore: opts.preferStore,
        });
        const ok = r?.ok !== false && !r?.error;
        results.push({
          appId,
          ok,
          refreshed: Boolean(r?.refreshed || r?.source === "refresh"),
          source: r?.source || null,
          error: r?.error || r?.message || null,
          code: r?.code || null,
        });
      } catch (err) {
        results.push({
          appId,
          ok: false,
          refreshed: false,
          error: err?.message || String(err),
        });
      }
    }

    const anyOk = results.length === 0 || results.some((r) => r.ok);
    const hardFail = opts.requireAuth === true && results.length > 0 && results.every((r) => !r.ok);

    out = {
      ok: !hardFail,
      soft: !anyOk && !hardFail,
      results,
      message: hardFail
        ? "auth refresh failed before cost preflight — re-login required"
        : undefined,
    };
    return out;
  } catch (err) {
    out = {
      ok: false,
      soft: false,
      results: [],
      reason: "exception",
      message: err?.message || String(err),
    };
    return out;
  } finally {
    if (out) await persistAuthStatus(cfg, out);
  }
}

export async function checkCostBudgetWithAuthRefresh(cfg, opts = {}) {
  const auth = await refreshAuthBeforeCostPreflight(cfg, opts);
  if (auth.ok === false && opts.requireAuth) {
    return {
      ok: false,
      hard: true,
      code: "AUTH_REFRESH_REQUIRED",
      message: auth.message || "auth refresh required before cost preflight",
      auth,
    };
  }
  const { checkCostBudget } = await import("./cost-governor.mjs");
  const budget = await checkCostBudget(cfg, opts);
  return { ...budget, auth };
}

export default {
  refreshAuthBeforeCostPreflight,
  checkCostBudgetWithAuthRefresh,
};
