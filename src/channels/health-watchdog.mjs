/**
 * R1 — Channel health watchdog.
 * Periodically inspects channel status(); restarts enabled channels whose
 * background loop has exited unexpectedly.
 *
 * R2 (2026-08-14) — outage ALERTING. The 3.92.1 provider outage taught
 * "resolving ≠ working"; the channel-side twin is "loop alive ≠ reachable":
 * a polling loop can retry a dead network for hours while the watchdog sees
 * a healthy process and the operator hears nothing. Channels now report
 * poll-level liveness (lastPollOkAt / consecutivePollFails) and the watchdog
 * raises a real alert (shared alerter → doctor-cron delivery / PagerDuty)
 * when polls have been failing past a threshold, plus when the restart
 * circuit opens (it used to give up SILENTLY).
 */
let timer = null;
let tickRunning = false;
let managerRef = null;
let cfgRef = null;
let alerterRef = null;
let onEventRef = null;
let startedAt = null;
let lastTickAt = null;
let lastError = null;
const channelState = new Map(); // name → { restarts, lastError, lastOkAt, consecutiveFail, outageSince }

/**
 * @param {object} cfg
 * @param {ReturnType<createChannelManager>} manager
 * @param {{ intervalMs?: number, enabled?: boolean }} [opts]
 */
export function startChannelHealthWatchdog(cfg, manager, opts = {}) {
  stopChannelHealthWatchdog();
  const enabled =
    opts.enabled ??
    cfg.channels?.healthWatchdog?.enabled ??
    cfg.channels?.watchdog?.enabled ??
    true;
  if (!enabled) return { ok: false, reason: "disabled" };

  managerRef = manager;
  cfgRef = cfg;
  alerterRef = opts.alerter || null; // test seam; defaults to the shared alerter
  onEventRef = opts.onEvent || null; // gateway wires WS broadcast here
  startedAt = new Date().toISOString();
  lastError = null;

  const intervalMs = Math.max(
    10_000,
    Number(
      opts.intervalMs ??
        cfg.channels?.healthWatchdog?.intervalMs ??
        cfg.channels?.watchdog?.intervalMs ??
        45_000
    ) || 45_000
  );

  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (timer.unref) timer.unref();

  console.log(`[xclaw] channel health watchdog every ${intervalMs}ms`);
  return { ok: true, intervalMs };
}

export function stopChannelHealthWatchdog() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  managerRef = null;
}

function getState(name) {
  if (!channelState.has(name)) {
    channelState.set(name, {
      restarts: 0,
      lastError: null,
      lastOkAt: null,
      consecutiveFail: 0,
      lastRestartAt: null,
      outageSince: null,
      circuitAlerted: false,
    });
  }
  return channelState.get(name);
}

async function getAlerter() {
  if (alerterRef) return alerterRef;
  try {
    const { getSharedAlerter } = await import("../alerting/alerts.mjs");
    return getSharedAlerter(cfgRef || {});
  } catch {
    return null;
  }
}

async function raiseAlert(key, title, body, meta = {}) {
  try {
    const a = await getAlerter();
    await a?.send({ key, severity: "error", title, body, meta });
  } catch (e) {
    console.warn("[channels:watchdog] alert send failed:", e?.message || e);
  }
  try {
    onEventRef?.({ type: "channel", phase: "alert", key, title, meta });
  } catch {
    /* */
  }
}

/**
 * Close the incident raiseAlert() opened, under the SAME key — PagerDuty dedups
 * on it, so an incident left open from a blip days ago swallows the next real
 * outage's page. Explicitly branch on `typeof a.resolve`: `a?.resolve?.(…)`
 * would silently no-op against any alerter that predates the primitive, which
 * is exactly the fail-open this fixes.
 */
async function resolveAlert(key, title, body, meta = {}) {
  try {
    const a = await getAlerter();
    const alert = { key, severity: "error", title, body, meta };
    if (typeof a?.resolve === "function") await a.resolve(alert);
    else await a?.send?.({ ...alert, eventAction: "resolve" });
  } catch (e) {
    console.warn("[channels:watchdog] alert resolve failed:", e?.message || e);
  }
  try {
    onEventRef?.({ type: "channel", phase: "resolved", key, title, meta });
  } catch {
    /* */
  }
}

/**
 * Poll-level outage detection. A channel is "in outage" when its loop is
 * nominally alive but polls keep failing: consecutivePollFails past the
 * threshold, or the last successful poll is older than outageAfterMs while
 * a poll error is newer than it.
 */
export function detectPollOutage(st, { pollFailThreshold = 8, outageAfterMs = 300_000, now = Date.now() } = {}) {
  if (!st || st.enabled === false) return false;
  const fails = Number(st.consecutivePollFails || 0);
  if (fails >= pollFailThreshold) return true;
  const okAt = st.lastPollOkAt ? Date.parse(st.lastPollOkAt) : null;
  const errAt = st.lastPollErrorAt ? Date.parse(st.lastPollErrorAt) : null;
  if (okAt && errAt && errAt > okAt && now - okAt > outageAfterMs) return true;
  return false;
}

async function tick() {
  if (tickRunning || !managerRef) return;
  tickRunning = true;
  lastTickAt = new Date().toISOString();
  try {
    const statuses = managerRef.status() || [];
    const minGap =
      cfgRef?.channels?.healthWatchdog?.minRestartIntervalMs ?? 60_000;
    const maxFails =
      cfgRef?.channels?.healthWatchdog?.maxConsecutiveFails ?? 8;

    for (const st of statuses) {
      const name = st.name || "unknown";
      const state = getState(name);

      if (!st.enabled) {
        state.lastError = null;
        continue;
      }

      // Channel modules may expose running / loopAlive / stopped
      const alive =
        st.running === true ||
        st.loopAlive === true ||
        (st.running !== false &&
          st.loopAlive !== false &&
          st.stopped !== true &&
          st.enabled);

      // If explicit dead signal
      const dead =
        st.running === false ||
        st.loopAlive === false ||
        st.dead === true ||
        Boolean(st.fatalError);

      if (st.lastError) state.lastError = st.lastError;
      if (st.messagesHandled != null && st.messagesHandled > 0) {
        state.lastOkAt = new Date().toISOString();
      }

      // Poll-level outage: alive process, unreachable service. Alert on the
      // transition in; log recovery on the transition out.
      const pollFailThreshold = cfgRef?.channels?.healthWatchdog?.pollFailThreshold ?? 8;
      const outageAfterMs = cfgRef?.channels?.healthWatchdog?.outageAfterMs ?? 300_000;
      const inOutage = detectPollOutage(st, { pollFailThreshold, outageAfterMs });
      if (inOutage && !state.outageSince) {
        state.outageSince = new Date().toISOString();
        console.warn(`[channels:watchdog] ${name} OUTAGE: polls failing (fails=${st.consecutivePollFails ?? "?"}, lastOk=${st.lastPollOkAt || "never"})`);
        await raiseAlert(
          `channel-outage:${name}`,
          `xclaw channel outage: ${name}`,
          `${name} polls are failing (consecutive=${st.consecutivePollFails ?? "?"}, last ok ${st.lastPollOkAt || "never"}, last error: ${st.lastError || "?"}). The process is alive but the service is unreachable.`,
          { channel: name, consecutivePollFails: st.consecutivePollFails ?? null, lastPollOkAt: st.lastPollOkAt || null }
        );
      } else if (!inOutage && state.outageSince) {
        const outageSince = state.outageSince;
        console.log(`[channels:watchdog] ${name} recovered (outage since ${outageSince})`);
        try {
          onEventRef?.({ type: "channel", phase: "recovered", channel: name, outageSince });
        } catch { /* */ }
        state.outageSince = null;
        await resolveAlert(
          `channel-outage:${name}`,
          `xclaw channel recovered: ${name}`,
          `${name} polls are succeeding again (outage since ${outageSince}).`,
          { channel: name, outageSince }
        );
      }

      if (!dead && alive) {
        state.consecutiveFail = 0;
        if (!state.lastOkAt) state.lastOkAt = new Date().toISOString();
        if (state.circuitAlerted) {
          state.circuitAlerted = false;
          await resolveAlert(
            `channel-circuit-open:${name}`,
            `xclaw channel back: ${name}`,
            `${name} is alive again; the watchdog's restart circuit is closed.`,
            { channel: name, restarts: state.restarts }
          );
        }
        continue;
      }

      if (!dead) continue;

      // A single-writer standby (another process owns the update stream)
      // reports running:false by design. Restarting cannot promote it, and
      // each restart's stop() used to fire a getUpdates that 409-killed the
      // real writer's poll in the owning process.
      if (st.standby === true) {
        state.lastError = null;
        continue;
      }

      // Restart path
      if (state.lastRestartAt && Date.now() - Date.parse(state.lastRestartAt) < minGap) {
        state.lastError = `${name}: restart backoff`;
        continue;
      }
      if (state.consecutiveFail >= maxFails) {
        state.lastError = `${name}: circuit open after ${state.consecutiveFail} fails`;
        lastError = state.lastError;
        console.warn(`[channels:watchdog] ${state.lastError}`);
        // giving up on restarts used to be SILENT — the operator must know
        state.circuitAlerted = true;
        await raiseAlert(
          `channel-circuit-open:${name}`,
          `xclaw channel dead: ${name}`,
          `${name} is down and the watchdog stopped retrying after ${state.consecutiveFail} failed restarts (last error: ${state.lastError}). Manual intervention needed.`,
          { channel: name, restartsAttempted: state.consecutiveFail }
        );
        continue;
      }

      console.warn(`[channels:watchdog] ${name} dead — restarting…`);
      try {
        let res = null;
        if (typeof managerRef.restart === "function") {
          res = await managerRef.restart(name);
        } else if (typeof managerRef.restartChannel === "function") {
          res = await managerRef.restartChannel(name);
        } else {
          // stopAll/startAll is heavy; try per-channel if exposed
          const ch = managerRef.get?.(name);
          if (ch?.stop && ch?.start) {
            await ch.stop().catch(() => {});
            await ch.start();
          } else {
            throw new Error("no restart hook on channel manager");
          }
        }
        // A start the channel refused is a failed restart, not a successful
        // one: counting it is what lets the circuit open and alert instead of
        // looping forever on a channel that will never come back by itself.
        if (res && res.ok === false) {
          throw new Error(`start declined: ${res.reason || "unknown"}`);
        }
        state.restarts += 1;
        state.lastRestartAt = new Date().toISOString();
        state.consecutiveFail = 0;
        state.lastError = null;
        console.log(`[channels:watchdog] ${name} restarted (#${state.restarts})`);
      } catch (err) {
        state.consecutiveFail += 1;
        state.lastError = err.message || String(err);
        lastError = `${name}: ${state.lastError}`;
        console.warn(`[channels:watchdog] ${name} restart failed:`, state.lastError);
      }
    }
  } catch (err) {
    lastError = err.message || String(err);
    console.warn("[channels:watchdog] tick error:", lastError);
  } finally {
    tickRunning = false;
  }
}

/** Test seam: run one watchdog inspection synchronously (no interval wait). */
export async function runWatchdogTickOnce() {
  return tick();
}

export function channelHealthStatus() {
  const channels = {};
  for (const [name, st] of channelState) {
    channels[name] = { ...st };
  }
  return {
    running: Boolean(timer),
    startedAt,
    lastTickAt,
    lastError,
    channels,
  };
}
