/**
 * SLO monitor — alert on breach, resolve on recover (Phase P).
 */
import { computeSLOs } from "./slo.mjs";
import { createAlerter } from "../alerting/alerts.mjs";

const state = {
  lastBreaches: new Set(),
  timer: null,
};

/**
 * @param {object} cfg
 * @returns {{ ok, breaches, alerted, resolved }}
 */
export async function checkAndAlertSLOs(cfg) {
  const slo = await computeSLOs(cfg);
  const alerter = createAlerter(cfg);
  const current = new Set(slo.breaches || []);
  const alerted = [];
  const resolved = [];

  for (const b of current) {
    if (!state.lastBreaches.has(b)) {
      const r = await alerter.send({
        key: `slo:${b}`,
        severity: b.startsWith("computer_") ? "critical" : "error",
        title: `XClaw SLO breach: ${b}`,
        body: JSON.stringify(slo, null, 2).slice(0, 1500),
        source: "slo-monitor",
      });
      alerted.push({ breach: b, result: r });
    }
  }

  for (const b of state.lastBreaches) {
    if (!current.has(b)) {
      const r = await alerter.send({
        key: `slo:resolve:${b}`,
        severity: "info",
        title: `XClaw SLO recovered: ${b}`,
        body: `Previously: ${b}`,
        source: "slo-monitor",
      });
      resolved.push({ breach: b, result: r });
      // clear open breach cooldown key so re-breach can fire later
      try {
        /* resolve via send info */
      } catch {
        /* */
      }
    }
  }

  state.lastBreaches = current;
  return { ok: slo.ok, breaches: [...current], alerted, resolved, slo };
}

export function startSloMonitor(cfg) {
  const ms = cfg?.slo?.monitorIntervalMs || cfg?.alerting?.sloIntervalMs || 0;
  if (!ms || ms < 10_000) return null;
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    checkAndAlertSLOs(cfg).catch((e) =>
      console.warn("[xclaw:slo-monitor]", e.message)
    );
  }, ms);
  if (state.timer.unref) state.timer.unref();
  console.log(`[xclaw] SLO monitor every ${ms}ms`);
  return state.timer;
}

export function stopSloMonitor() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
