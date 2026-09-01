/**
 * Persist last OAuth/cost-preflight auth refresh result for doctor visibility.
 *
 * auth-refresh-status.json belongs to the config dir that owns the instance,
 * not to whoever's home dir the process happens to run under. Resolving it
 * from `os.homedir()` alone meant two instances on one host shared a single
 * status file, so instance B's doctor reported instance A's last refresh —
 * and the suite wrote into the operator's real `~/.xclaw/auth-refresh-status.json`.
 *
 * Production writers (`recordAuthRefreshStatus(cfg)` at cost-preflight-auth)
 * already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null` rather than guessing at the home dir.
 * Same shape as `lastDrainPath`. Honour existing `XCLAW_CONFIG_DIR`.
 * `recordAuthRefreshStatus` no-ops a null path (do not `mkdir(null)` /
 * `path.dirname(null)`). `loadAuthRefreshStatus` returns `null`.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function statusPath(cfg = {}) {
  const dir = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "auth-refresh-status.json") : null;
}

export async function recordAuthRefreshStatus(cfg, result = {}) {
  const payload = {
    at: new Date().toISOString(),
    ok: result.ok !== false,
    soft: Boolean(result.soft),
    skipped: Boolean(result.skipped),
    reason: result.reason || null,
    message: result.message || null,
    results: Array.isArray(result.results)
      ? result.results.map((r) => ({
          appId: r.appId,
          ok: r.ok,
          refreshed: Boolean(r.refreshed),
          source: r.source || null,
          error: r.error || null,
          code: r.code || null,
        }))
      : [],
  };
  const fp = statusPath(cfg);
  if (!fp) return payload;
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fs.rename(tmp, fp);
  return payload;
}

export async function loadAuthRefreshStatus(cfg) {
  const fp = statusPath(cfg);
  if (!fp) return null;
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

function isProdLike(cfg = {}) {
  const profile = String(cfg.profile || process.env.XCLAW_PROFILE || "").toLowerCase();
  return profile === "prod" || profile === "strict" || cfg.gateway?.requireAuth === true;
}

export async function pushAuthRefreshChecks(push, cfg = {}) {
  const st = await loadAuthRefreshStatus(cfg);
  const prod = isProdLike(cfg);
  if (!st) {
    push(
      "ops.auth_refresh",
      prod ? "error" : "warn",
      prod
        ? "prod/strict: no auth-refresh status (seat token may be stale)"
        : "no auth-refresh status yet (run a job / cost preflight first)",
      { present: false, prod }
    );
    return { present: false, prod };
  }

  const failed = (st.results || []).filter((r) => r.ok === false);
  const refreshed = (st.results || []).filter((r) => r.refreshed);
  if (st.ok === false || failed.length) {
    // `soft` is the writer's own verdict (cost-preflight-auth: `!anyOk &&
    // !hardFail`): the refresh failed, but the caller never required auth, so
    // it is not fatal. A host running on API keys has no OAuth token to
    // refresh and reports every app failed-but-soft on every preflight —
    // reading that as a hard error means doctor cries wolf forever. Prod still
    // escalates, matching the missing-status and skipped branches below.
    const codes = [...new Set(failed.map((f) => f.code).filter(Boolean))];
    push(
      "ops.auth_refresh",
      st.ok === false || !st.soft || prod ? "error" : "warn",
      st.message ||
        `auth refresh failed for ${failed.map((f) => f.appId).join(",") || "apps"}` +
          `${codes.length ? ` (${codes.join(",")})` : ""}` +
          `${st.soft ? " — auth not required, non-fatal" : ""}`,
      {
        present: true,
        at: st.at,
        soft: Boolean(st.soft),
        failed: failed.map((f) => f.appId),
        results: st.results,
      }
    );
  } else if (st.skipped) {
    const skipStatus = prod && st.reason !== "disabled" ? "error" : "ok";
    push(
      "ops.auth_refresh",
      skipStatus,
      `skipped (${st.reason || "disabled"})`,
      { present: true, at: st.at, skipped: true, prod }
    );
  } else {
    push(
      "ops.auth_refresh",
      "ok",
      refreshed.length
        ? `refreshed ${refreshed.map((r) => r.appId).join(",")}`
        : `tokens fresh (${(st.results || []).map((r) => r.appId).join(",") || "none"})`,
      {
        present: true,
        at: st.at,
        refreshed: refreshed.map((r) => r.appId),
        results: st.results,
      }
    );
  }
  return { present: true, status: st };
}

export default {
  recordAuthRefreshStatus,
  loadAuthRefreshStatus,
  pushAuthRefreshChecks,
  statusPath,
};
