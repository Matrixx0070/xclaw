/**
 * Automated alerting for XClaw (doctor failures, cron errors, security).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deliverToChannel } from "../cron/channel-deliver.mjs";
import { sendPagerDutyEvent, pagerDutyDedupKey } from "./pagerduty.mjs";

const lastSent = new Map();

function defaultStatePath() {
  return path.join(os.homedir(), ".xclaw", "alert-state.json");
}

function loadState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { lastSent: {}, history: [] };
  }
}

function saveState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    state.history = (state.history || []).slice(-100);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[xclaw:alert] state save", err.message);
  }
}

export function createAlerter(cfg = {}) {
  const alertCfg = cfg.alerting || cfg.alerts || {};
  const enabled = alertCfg.enabled !== false;
  const cooldownMs = alertCfg.cooldownMs ?? 30 * 60 * 1000;
  const minSeverity = alertCfg.minSeverity || "error";
  let targets = [];
  if (Array.isArray(alertCfg.targets)) targets = alertCfg.targets;
  else if (alertCfg.delivery) targets = [alertCfg.delivery];
  if (!targets.length && cfg.doctor?.cron?.delivery) {
    targets.push(cfg.doctor.cron.delivery);
  }
  if (cfg.liveE2e?.cron?.delivery) {
    const d = cfg.liveE2e.cron.delivery;
    const exists = targets.some(
      (t) => t.channel === d.channel && String(t.to) === String(d.to)
    );
    if (!exists) targets.push(d);
  }
  if (alertCfg.pagerduty?.routingKey || process.env.PAGERDUTY_ROUTING_KEY) {
    const hasPd = targets.some((t) => t.type === "pagerduty" || t.channel === "pagerduty");
    if (!hasPd) {
      targets.push({
        type: "pagerduty",
        channel: "pagerduty",
        routingKey:
          alertCfg.pagerduty?.routingKey || process.env.PAGERDUTY_ROUTING_KEY,
        severity: alertCfg.pagerduty?.severity,
      });
    }
  }

  const statePath = alertCfg.statePath || defaultStatePath();
  let state = loadState(statePath);
  const rank = { info: 0, warn: 1, warning: 1, error: 2, critical: 3 };

  function shouldSend(key, severity) {
    if (!enabled) return false;
    if ((rank[severity] ?? 2) < (rank[minSeverity] ?? 2)) return false;
    if (!targets.length) return false;
    const last = state.lastSent[key] || lastSent.get(key) || 0;
    if (Date.now() - last < cooldownMs) return false;
    return true;
  }

  function markSent(key) {
    const now = Date.now();
    lastSent.set(key, now);
    state.lastSent[key] = now;
    saveState(statePath, state);
  }

  async function send(alert = {}) {
    const severity = alert.severity || "error";
    const key = alert.key || `${severity}:${alert.title || "alert"}`;
    const entry = {
      at: new Date().toISOString(),
      key,
      severity,
      title: alert.title,
      body: alert.body,
      meta: alert.meta || {},
      sent: false,
      skipped: null,
      results: [],
    };

    if (!enabled) {
      entry.skipped = "disabled";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }
    if (!targets.length) {
      entry.skipped = "no_targets";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }
    if ((rank[severity] ?? 2) < (rank[minSeverity] ?? 2)) {
      entry.skipped = "below_min_severity";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }
    if (!shouldSend(key, severity)) {
      entry.skipped = "cooldown";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }

    const text = [
      `XClaw [${severity.toUpperCase()}] ${alert.title || "alert"}`,
      alert.body || "",
      alert.meta ? JSON.stringify(alert.meta) : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 3500);

    for (const t of targets) {
      try {
        if (t.type === "pagerduty" || t.channel === "pagerduty") {
          const r = await sendPagerDutyEvent({
            routingKey: t.routingKey || t.to || alertCfg.pagerduty?.routingKey,
            eventAction: alert.eventAction || "trigger",
            dedupKey: pagerDutyDedupKey(key),
            summary: alert.title || "XClaw alert",
            severity: t.severity || severity,
            source: "xclaw",
            component: alert.meta?.component || "xclaw",
            customDetails: {
              body: alert.body,
              key,
              ...(alert.meta || {}),
            },
            clientUrl: alertCfg.pagerduty?.clientUrl,
          });
          entry.results.push({ target: { type: "pagerduty" }, ...r });
        } else {
          const r = await deliverToChannel(
            { mode: "announce", channel: t.channel, to: t.to, text },
            cfg
          );
          entry.results.push({ target: t, ...r });
        }
      } catch (err) {
        entry.results.push({ target: t, ok: false, reason: err.message });
      }
    }

    entry.sent = entry.results.some((r) => r.ok);
    // Cooldown after any delivery attempt to avoid spam on repeated failures
    markSent(key);
    state.history.push(entry);
    saveState(statePath, state);
    console.log(`[xclaw:alert] ${entry.sent ? "sent" : "failed"} ${key}`);
    return entry;
  }

  async function alertDoctorFailure(report) {
    return send({
      key: `doctor:${(report.failed || []).sort().join(",") || "fail"}`,
      severity: "error",
      title: "Doctor check failed",
      body: `Failed: ${(report.failed || []).join(", ")}\nAt: ${report.checkedAt}`,
      meta: { failed: report.failed, warnings: report.warnings },
    });
  }

  async function alertCronJobError(job, error) {
    return send({
      key: `cron:${job?.name || job?.id || "job"}`,
      severity: "error",
      title: `Cron job failed: ${job?.name || job?.id}`,
      body: String(error || job?.lastError || "unknown"),
    });
  }

  async function alertSecurity(event) {
    return send({
      key: `security:${event?.reason || event?.phase || "event"}`,
      severity: event?.severity || "warn",
      title: `Security: ${event?.phase || event?.reason || "event"}`,
      body: event?.message || JSON.stringify(event || {}),
    });
  }

  function history(limit = 20) {
    return (state.history || []).slice(-limit).reverse();
  }

  function status() {
    return {
      enabled,
      cooldownMs,
      minSeverity,
      targets,
      statePath,
      lastSent: { ...state.lastSent },
      recent: history(5),
    };
  }

  async function alertLiveE2eFailure(report = {}) {
    const fails = report.fails ?? report.failedCount;
    const exitCode = report.exitCode ?? report.code;
    const failedIds = (report.results || [])
      .filter((r) => r.status === "fail")
      .map((r) => r.id)
      .slice(0, 20);
    return send({
      key: `live-e2e:${failedIds.sort().join(",") || exitCode || "fail"}`,
      severity: "error",
      title: "Live enforcement e2e failed",
      body: [
        `exit=${exitCode}`,
        fails != null ? `fails=${fails}` : null,
        failedIds.length ? `failed: ${failedIds.join(", ")}` : null,
        report.at ? `at=${report.at}` : null,
        report.logPath ? `log=${report.logPath}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      meta: { exitCode, fails, failedIds, root: report.root },
    });
  }

  async function alertEnforcementFailure(details = {}) {
    const ids = details.failedIds || details.failed || [];
    return send({
      key: `enforcement:${(Array.isArray(ids) ? ids : [ids]).join(",") || "a"}`,
      severity: "error",
      title: "Phase A enforcement doctor checks failed",
      body: [
        `Failed a.* / enforcement: ${(Array.isArray(ids) ? ids : [ids]).join(", ")}`,
        details.message || "",
        details.at || new Date().toISOString(),
      ]
        .filter(Boolean)
        .join("\n"),
      meta: details,
    });
  }

  return {
    send,
    alertDoctorFailure,
    alertLiveE2eFailure,
    alertEnforcementFailure,
    alertCronJobError,
    alertSecurity,
    history,
    status,
    shouldSend,
  };
}

let shared = null;
export function getSharedAlerter(cfg = {}) {
  if (!shared) {
    shared = createAlerter(cfg);
    return shared;
  }
  // First-caller-wins had the same failure class as the 3.102.1 approval-gate
  // singleton: a bare `{}` early caller (health-watchdog, scheduler) freezes a
  // target-less alerter for the whole process, and every later alert skips
  // "no_targets" even though the caller's loaded config HAS targets (observed
  // live: enforcement-cron alerts skipped hours after alerting.targets was
  // wired). Upgrade in place when a caller offers a config that resolves
  // targets and the frozen instance has none. Never downgrade.
  try {
    if (shared.status().targets.length === 0) {
      const candidate = createAlerter(cfg);
      if (candidate.status().targets.length > 0) shared = candidate;
    }
  } catch {
    /* keep existing */
  }
  return shared;
}
export function resetSharedAlerter(cfg = {}) {
  shared = createAlerter(cfg);
  return shared;
}
