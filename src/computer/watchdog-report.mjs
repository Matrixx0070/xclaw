/**
 * Pure reporting layer for the computer-server watchdog — the twin of
 * `channels/health-report.mjs`, for the same reason and against the same bug.
 *
 *   projectComputerWatchdog()  — what `/gateway/info` is allowed to relay.
 *   summarizeComputerWatchdog() — what `xclaw doctor` should conclude from it.
 *
 * The watchdog lives in the GATEWAY process. `xclaw doctor` runs out of process,
 * where `watchdogStatus()` returns the module's untouched initial state:
 *
 *   { active: false, restartCount: 0, lastRestartAt: null, lastCheckAt: null,
 *     lastError: null, consecutiveFail: 0 }
 *
 * The doctor printed that object as a measurement:
 *
 *   [OK  ] computer.watchdog: active every 30000ms (in gateway)
 *   [OK  ] computer.watchdog: checks ok restarts=0 last=—
 *
 * Two rows under one key, and the second is fiction. `restarts=0 last=—` is not
 * an observation of a healthy watchdog, it is the CLI reading its own zeros: a
 * gateway watchdog crash-looping the computer server — 40 restarts, a live
 * `lastError`, `consecutiveFail` climbing — produced that byte-identical
 * "checks ok" row, because `/gateway/info` relayed only the boolean
 * `computerWatchdogActive` and the counters had no way to cross the process
 * boundary at all.
 *
 * So this module does what the channel fix did: relay the diagnosis rather than
 * a boolean, decide severity from whichever view is real, and never present
 * in-process defaults as a reading. The remaining trap is shared too — a
 * relayed `active: false` used to advise "start gateway", but a relayed value
 * only exists because a gateway ANSWERED. "Start gateway" is right in exactly
 * one case: the gateway is down.
 */

/** Watchdog fields `/gateway/info` may publish. An allow-list, not a spread. */
const PUBLIC_WATCHDOG_FIELDS = [
  "active",
  "restartCount",
  "lastRestartAt",
  "lastCheckAt",
  "lastError",
  "consecutiveFail",
];

/**
 * Project a `watchdogStatus()` result down to the fields `/gateway/info`
 * publishes. `active` is coerced; the rest pass through as null when absent so
 * a reader can tell "no value" from zero.
 */
export function projectComputerWatchdog(status) {
  if (!status || typeof status !== "object") return null;
  const out = {};
  for (const f of PUBLIC_WATCHDOG_FIELDS) out[f] = status[f] ?? null;
  out.active = Boolean(status.active);
  return out;
}

/**
 * Decide what `computer.watchdog` should say.
 *
 * @param local     `watchdogStatus()` from the caller's own process. In the CLI
 *                  this is always the module's initial state — the trap above.
 * @param liveOps   the `ops` block from a reachable gateway's `/gateway/info`,
 *                  or null when the gateway is down or too old to expose one.
 * @param gatewayUp whether the gateway answered at all. Defaults to "we got an
 *                  ops block, so it must be up"; the CLI passes the real
 *                  answer, which also covers a gateway that is up but relays no
 *                  ops block.
 * @param opts      { enabled, intervalMs, failThreshold }
 * @returns {{severity: "ok"|"warn"|"error", message: string, source: string}}
 */
export function summarizeComputerWatchdog(
  local,
  liveOps,
  gatewayUp = Boolean(liveOps),
  { enabled = true, intervalMs = 30000, failThreshold = 3 } = {}
) {
  if (!enabled) {
    return { severity: "ok", message: "disabled", source: "config" };
  }

  const inProcess = Boolean(local && local.active);
  const relayed = liveOps?.computerWatchdog;
  const view = inProcess ? local : relayed?.active ? relayed : null;

  if (!view) {
    // An older gateway relays only the boolean. Report it as active rather than
    // claiming it is stopped, but say plainly that the detail is unavailable.
    if (liveOps?.computerWatchdogActive === true) {
      return {
        severity: "ok",
        message: `active every ${intervalMs}ms (in gateway; no restart detail relayed)`,
        source: "gateway",
      };
    }
    if (gatewayUp) {
      const off = relayed?.active === false || liveOps?.computerWatchdogActive === false;
      if (off) {
        return {
          severity: "error",
          message:
            "watchdog enabled but NOT running inside a live gateway — a computer server that " +
            "dies will not be restarted (restart the gateway; check computer.watchdog.enabled)",
          source: "gateway",
        };
      }
      // Gateway up, but it told us nothing: the relay threw, or the build
      // predates it. Unknown is not healthy, and it is not "start the gateway".
      return {
        severity: "warn",
        message: "gateway is up but reported no computer watchdog state (build too old, or the relay failed)",
        source: "gateway",
      };
    }
    return { severity: "warn", message: "enabled but not running (start gateway)", source: "none" };
  }

  const source = inProcess ? "in-process" : "gateway";
  const suffix = inProcess ? "" : " (in gateway)";
  const restarts = Number(view.restartCount || 0);
  const fails = Number(view.consecutiveFail || 0);

  // Restarts that keep failing are the incident this watchdog exists to expose.
  if (fails >= failThreshold) {
    return {
      severity: "error",
      message:
        `watchdog cannot restart the computer server — ${fails} consecutive failures` +
        `${view.lastError ? `: ${view.lastError}` : ""}${suffix}`,
      source,
    };
  }
  if (view.lastError) {
    return {
      severity: "warn",
      message: `active every ${intervalMs}ms, last check failed: ${view.lastError} (restarts=${restarts})${suffix}`,
      source,
    };
  }
  return {
    severity: "ok",
    message:
      `active every ${intervalMs}ms restarts=${restarts} lastCheck=${view.lastCheckAt || "—"}` +
      `${view.lastRestartAt ? ` lastRestart=${view.lastRestartAt}` : ""}${suffix}`,
    source,
  };
}
