/**
 * Proactive token refresh scheduler (P5).
 * Periodically calls ensureFreshToken for apps with refresh tokens.
 */
import { listConnectedApps, getAppToken as loadTok } from "./token-store.mjs";
import { ensureFreshToken, needsRefresh } from "./token-refresh.mjs";

/**
 * @param {object} cfg
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]
 * @param {(info: object) => void} [opts.onEvent]
 */
export function startRefreshScheduler(cfg, opts = {}) {
  const intervalMs = Math.max(
    60_000,
    Number(opts.intervalMs || process.env.XCLAW_TOKEN_REFRESH_INTERVAL_MS) || 15 * 60_000
  );
  let stopped = false;
  let timer = null;
  const onEvent = opts.onEvent || ((e) => {
    if (e.type === "refresh") {
      console.log(
        `[token-refresh] ${e.appId}: ${e.ok ? "ok" : e.error} refreshed=${e.refreshed || false}`
      );
    }
  });

  async function tick() {
    if (stopped) return;
    let apps = [];
    try {
      apps = await listConnectedApps(cfg);
    } catch (e) {
      onEvent({ type: "error", error: e.message });
      return;
    }
    for (const app of apps) {
      if (stopped) break;
      if (!app.hasToken || app.invalidatedAt) continue;
      if (!app.hasRefreshToken) continue;
      try {
        const rec = await loadTok(cfg, app.id);
        if (!needsRefresh(rec, { skewMs: 10 * 60_000 })) {
          onEvent({ type: "skip", appId: app.id, reason: "fresh" });
          continue;
        }
        const out = await ensureFreshToken(cfg, app.id, {});
        onEvent({
          type: "refresh",
          appId: app.id,
          ok: out.ok,
          refreshed: out.refreshed,
          error: out.error,
          expiresAt: out.expiresAt,
        });
      } catch (e) {
        onEvent({ type: "refresh", appId: app.id, ok: false, error: e.message });
      }
    }
  }

  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  // initial delayed tick
  setTimeout(tick, 5_000).unref?.();

  return {
    intervalMs,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    tick,
  };
}
