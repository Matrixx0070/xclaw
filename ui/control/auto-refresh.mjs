/**
 * Live refresh for the operator console.
 *
 * The console is served into a pm2-managed app window that stays open for
 * days, but every card fetched its data exactly once at page load: on
 * 2026-08-29 the Overview reported "Version 3.294.0" against a gateway
 * running 3.368.0, because the page had been open for 30 hours. A console
 * whose numbers are silently 30 hours old is worse than no console.
 *
 * The refresh WIRING already exists — every card has a "Refresh" button
 * bound to its loader, and the topbar button runs refreshAll(). This module
 * adds no second registry of loaders (two lists of one decision drift — see
 * ui-routes.mjs); it re-fires the buttons the user would press, for the one
 * view that is visible, when it matters: on view switch, on window focus,
 * and on a 30s tick while visible.
 *
 * The DECISION (fire or hold) lives in createRefreshGate so node can test
 * it; the DOM wiring below is guarded out under node.
 */

/**
 * @param {{ minGapMs?: number, now?: () => number }} [opts]
 *   minGapMs — floor between automatic fires, so a focus event landing on
 *   the same instant as a nav or an interval tick collapses into one fire.
 * @returns {{ shouldFire(trigger: "nav"|"manual"|"focus"|"interval", state?: { hidden?: boolean }) => boolean }}
 */
export function createRefreshGate({ minGapMs = 5000, now = Date.now } = {}) {
  let last = -Infinity;
  return {
    shouldFire(trigger, { hidden = false } = {}) {
      // A hidden window refreshes nothing — data nobody can see is not
      // worth a request, and the focus/visibility fire covers the return.
      if (hidden) return false;
      const t = now();
      // A human acted (switched views, pressed Refresh): always honor it.
      if (trigger === "nav" || trigger === "manual") {
        last = t;
        return true;
      }
      if (t - last < minGapMs) return false;
      last = t;
      return true;
    },
  };
}

/** Text of the buttons this module is allowed to re-fire. */
export const REFRESH_LABEL = "Refresh";

// ── browser wiring ──────────────────────────────────────────────────────────
if (typeof document !== "undefined" && typeof window !== "undefined") {
  const gate = createRefreshGate();
  const stampEl = () => document.getElementById("lastRefreshAt");

  const stamp = () => {
    const el = stampEl();
    if (el) el.textContent = `as of ${new Date().toLocaleTimeString()}`;
  };

  const fireActive = (trigger) => {
    if (!gate.shouldFire(trigger, { hidden: document.hidden })) return;
    // The topbar basics (gateway/status/cost/sessions) live in refreshAll,
    // outside any card button. On a manual press app.js already runs it.
    if (trigger !== "manual" && typeof window.refreshAll === "function") {
      window.refreshAll().catch(() => {});
    }
    const view = document.querySelector(".view.active");
    if (view) {
      for (const b of view.querySelectorAll("button")) {
        if (b.id !== "btnRefresh" && b.textContent.trim() === REFRESH_LABEL) b.click();
      }
    }
    stamp();
  };

  window.addEventListener("hashchange", () => fireActive("nav"));
  window.addEventListener("focus", () => fireActive("focus"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) fireActive("focus");
  });
  document.getElementById("btnRefresh")?.addEventListener("click", () => fireActive("manual"));
  setInterval(() => fireActive("interval"), 30_000);
  stamp(); // boot load just happened; say so
}
