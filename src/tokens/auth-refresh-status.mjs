/**
 * Persist last OAuth/cost-preflight auth refresh result for doctor visibility.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function statusPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "auth-refresh-status.json");
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
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fs.rename(tmp, fp);
  return payload;
}

export async function loadAuthRefreshStatus(cfg) {
  try {
    return JSON.parse(await fs.readFile(statusPath(cfg), "utf8"));
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
    push(
      "ops.auth_refresh",
      "error",
      st.message ||
        `auth refresh failed for ${failed.map((f) => f.appId).join(",") || "apps"}`,
      {
        present: true,
        at: st.at,
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
