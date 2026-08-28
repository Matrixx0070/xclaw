/**
 * Pure reporting layer for the channel health watchdog.
 *
 * Two separate jobs, both kept out of their callers so they can be tested
 * without a gateway and without `loadConfig()`:
 *
 *   projectChannelHealth()  — what `/gateway/info` is allowed to relay.
 *   summarizeChannelHealth() — what `xclaw doctor` should conclude from it.
 *
 * Why this module exists. `/gateway/info` grew an `ops` block precisely because
 * the doctor runs OUT of process and cannot see the gateway's watchdogs, so it
 * reported them as "not running (start gateway)" while the gateway was up. That
 * fix shipped three fields — computerWatchdogActive, evalCronRegistered and
 * channelWatchdogRunning — and wired only the first two into the doctor. The
 * third was written and never read, so on a live box with the gateway running
 * and `/gateway/info` reporting `channelWatchdogRunning: true`, doctor still
 * printed:
 *
 *   [OK  ] channels.health: channel watchdog idle (start gateway to enable)
 *
 * beside a correct `[OK  ] computer.watchdog: active every 30000ms (in gateway)`.
 *
 * The severity was the worse half. Because the CLI's own `running` is false,
 * the probe took its idle branch and never looked at `channels` at all — so a
 * channel sitting in a poll outage, or one whose restart circuit had latched
 * open, could not be reported by the CLI under any circumstances. The watchdog
 * pages the operator for both of those conditions (`channel-outage:<name>` and
 * `channel-circuit-open:<name>`), so "ok" here contradicted an alert the same
 * process had already sent.
 */

/** Channel-state fields the gateway may publish. Anything else stays private. */
const PUBLIC_CHANNEL_FIELDS = [
  "restarts",
  "consecutiveFail",
  "lastError",
  "lastOkAt",
  "lastRestartAt",
  "outageSince",
  "circuitAlerted",
];

/**
 * Project a `channelHealthStatus()` result down to the fields `/gateway/info`
 * publishes. An explicit allow-list, not a spread: `channelState` entries are
 * free to grow new fields, and a route must not start relaying them by
 * accident.
 */
export function projectChannelHealth(status) {
  if (!status || typeof status !== "object") return null;
  const channels = {};
  for (const [name, st] of Object.entries(status.channels || {})) {
    const out = {};
    for (const f of PUBLIC_CHANNEL_FIELDS) out[f] = st?.[f] ?? null;
    channels[name] = out;
  }
  return {
    running: Boolean(status.running),
    startedAt: status.startedAt ?? null,
    lastTickAt: status.lastTickAt ?? null,
    lastError: status.lastError ?? null,
    channels,
  };
}

/**
 * Decide what `channels.health` should say.
 *
 * @param local    `channelHealthStatus()` from the caller's own process. In the
 *                 CLI this is always `running: false` — the watchdog lives in
 *                 the gateway — which is exactly the trap this replaces.
 * @param liveOps  the `ops` block from a reachable gateway's `/gateway/info`,
 *                 or null when the gateway is down or too old to expose one.
 * @returns {{severity: "ok"|"warn"|"error", message: string, source: string}}
 */
export function summarizeChannelHealth(local, liveOps) {
  const inProcess = local && local.running;
  const relayed = liveOps?.channelWatchdog;
  const view = inProcess ? local : relayed?.running ? relayed : null;

  if (!view) {
    // An older gateway relays only the boolean. Report it as up rather than
    // claiming it is idle, but say plainly that the detail is unavailable.
    if (liveOps?.channelWatchdogRunning === true) {
      return {
        severity: "ok",
        message: "watchdog up (in gateway; no per-channel detail relayed)",
        source: "gateway",
      };
    }
    return {
      severity: "ok",
      message: "channel watchdog idle (start gateway to enable)",
      source: "none",
    };
  }

  const source = inProcess ? "in-process" : "gateway";
  const suffix = inProcess ? "" : " (in gateway)";
  const entries = Object.entries(view.channels || {});

  // The watchdog pages the operator on both of these. Doctor must not disagree.
  const open = entries.filter(([, s]) => s?.circuitAlerted);
  if (open.length) {
    const detail = open
      .map(([n, s]) => `${n} (${s.consecutiveFail ?? 0} failed restarts${s.lastError ? `: ${s.lastError}` : ""})`)
      .join(", ");
    return {
      severity: "error",
      message: `restart circuit OPEN — watchdog gave up on ${detail}. Manual intervention needed.${suffix}`,
      source,
    };
  }

  const down = entries.filter(([, s]) => s?.outageSince);
  if (down.length) {
    const detail = down.map(([n, s]) => `${n} (since ${s.outageSince})`).join(", ");
    return {
      severity: "warn",
      message: `channel outage — polls failing for ${detail}${suffix}`,
      source,
    };
  }

  if (view.lastError) {
    return { severity: "warn", message: `${view.lastError}${suffix}`, source };
  }

  const parts = entries.map(
    ([n, s]) => `${n}:restarts=${s?.restarts || 0}${s?.lastError ? ":err" : ""}`
  );
  return {
    severity: "ok",
    message: `watchdog up lastTick=${view.lastTickAt || "—"} ${parts.join(" ") || "(no channel state yet)"}${suffix}`,
    source,
  };
}
