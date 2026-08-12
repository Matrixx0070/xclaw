/**
 * R1 — Channel health watchdog.
 * Periodically inspects channel status(); restarts enabled channels whose
 * background loop has exited unexpectedly.
 */
let timer = null;
let tickRunning = false;
let managerRef = null;
let cfgRef = null;
let startedAt = null;
let lastTickAt = null;
let lastError = null;
const channelState = new Map(); // name → { restarts, lastError, lastOkAt, consecutiveFail }

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
    });
  }
  return channelState.get(name);
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

      if (!dead && alive) {
        state.consecutiveFail = 0;
        if (!state.lastOkAt) state.lastOkAt = new Date().toISOString();
        continue;
      }

      if (!dead) continue;

      // Restart path
      if (state.lastRestartAt && Date.now() - Date.parse(state.lastRestartAt) < minGap) {
        state.lastError = `${name}: restart backoff`;
        continue;
      }
      if (state.consecutiveFail >= maxFails) {
        state.lastError = `${name}: circuit open after ${state.consecutiveFail} fails`;
        lastError = state.lastError;
        console.warn(`[channels:watchdog] ${state.lastError}`);
        continue;
      }

      console.warn(`[channels:watchdog] ${name} dead — restarting…`);
      try {
        if (typeof managerRef.restart === "function") {
          await managerRef.restart(name);
        } else if (typeof managerRef.restartChannel === "function") {
          await managerRef.restartChannel(name);
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
