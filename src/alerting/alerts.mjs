/**
 * Automated alerting for XClaw (doctor failures, cron errors, security).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deliverToChannel } from "../cron/channel-deliver.mjs";
import { sendPagerDutyEvent, pagerDutyDedupKey } from "./pagerduty.mjs";

const lastSent = new Map();

/**
 * `lastSent` used to carry two different facts on one stamp: "a cooldown is
 * armed for this key" and "an incident is open under this key". They are not
 * the same fact, and conflating them broke the alerter in both directions when
 * delivery failed — which is exactly when an alerter matters.
 *
 * `markSent()` ran after ANY delivery attempt, so a trigger whose every target
 * errored still armed the full 30-minute cooldown. The incident was never
 * delivered and every retry inside that window was skipped `cooldown`: one
 * Telegram blip at the moment a doctor check failed lost the alert silently for
 * half an hour. And the same phantom stamp satisfied the `not_open` gate below
 * — the gate whose whole purpose is that "resolving a key with no recorded send
 * would page RESOLVED for a problem nobody heard about". A failed trigger
 * followed by a recovery paged RESOLVED for an incident that was never raised.
 *
 * So the delivered fact gets its own map. `lastSent` stays the cooldown stamp;
 * `lastDelivered` is written only when a target actually accepted the message,
 * and it alone decides whether an incident is open.
 */
const lastDelivered = new Map();

/**
 * Alert state (cooldowns + the delivery history) belongs to the config dir that
 * owns the alerting settings, not to whoever's home dir the process happens to
 * run under. Resolving it from `os.homedir()` alone meant it was the ONE piece
 * of xclaw state that did not follow a relocated `paths.configDir`: two
 * instances on one host shared a single cooldown map, so instance B's alert was
 * silently suppressed by instance A's — the same silent-alert-loss class the
 * self-deploy watcher hit — and the test suite wrote into the operator's real
 * `~/.xclaw/alert-state.json`, corrupting the forensic record it is kept for.
 *
 * Honouring `paths.configDir` closed only half of that. With NO config the
 * fallback still landed in the live home dir, and every remaining leak reaches
 * this module through src/ indirection a text rule cannot see —
 * `getSharedAlerter(cfgRef || {})` (health-watchdog), `job._cfg || {}`
 * (scheduler), `cfg || {}` (eval/doctor cron). The operator's file was 100
 * fixture entries deep on 2026-08-28 with zero real deliveries in it, because
 * `saveState` keeps only the last 100: each fixture write EVICTS a real record,
 * and `markSent` stamps the shared cooldown map, which can suppress a genuine
 * page for a full `cooldownMs`.
 *
 * `loadConfig()` stamps `paths.configDir` unconditionally (config/load.mjs:187),
 * so a cfg without one is never a real caller. Such an alerter keeps its state
 * in memory and reports `statePath: null` rather than guessing at the home dir.
 * Same shape and same reasoning as `appendCronEvent`'s `no_config` guard.
 */
function defaultStatePath(cfg) {
  const dir = cfg?.paths?.configDir;
  return dir ? path.join(dir, "alert-state.json") : null;
}

function emptyState() {
  return { lastSent: {}, lastDelivered: {}, history: [] };
}

function loadState(filePath) {
  if (!filePath) return emptyState();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return emptyState();
  }
  const state = { ...emptyState(), ...raw };
  // A file written before lastDelivered existed carries opens in lastSent. Left
  // empty, every incident already open at upgrade time would answer `not_open`
  // and never close — and a PagerDuty incident that never closes swallows the
  // NEXT genuine outage, which is the worst direction to fail in. The old
  // semantics said those stamps were opens, so honour that for what is already
  // on disk; only new stamps get the stricter meaning.
  if (!raw.lastDelivered && raw.lastSent) state.lastDelivered = { ...raw.lastSent };
  return state;
}

function saveState(filePath, state) {
  state.history = (state.history || []).slice(-100);
  if (!filePath) return; // no config to own it: in-memory only
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[xclaw:alert] state save", err.message);
  }
}

/**
 * "telegram(no_telegram_token),pagerduty(http_502)" — which target refused and
 * why. Deduped: ten identical targets failing the same way is one fact.
 */
export function describeFailures(results = []) {
  const seen = new Set();
  for (const r of results || []) {
    if (!r || r.ok) continue;
    const ch = r.target?.channel || r.target?.type || "target";
    seen.add(r.reason ? `${ch}(${r.reason})` : ch);
  }
  return [...seen].join(",") || "no_result";
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

  // A delivery that FAILED must not buy the full quiet period. The cooldown
  // exists to stop an alert that landed from landing again every minute; it has
  // nothing to say about one that never landed at all. Retrying a hard-down
  // channel every minute is the most spam a failure can generate, and one
  // duplicate a minute during an outage beats a lost page.
  const retryCooldownMs = alertCfg.retryCooldownMs ?? Math.min(cooldownMs, 60 * 1000);

  const statePath = alertCfg.statePath || defaultStatePath(cfg);
  let state = loadState(statePath);
  const rank = { info: 0, warn: 1, warning: 1, error: 2, critical: 3 };

  /** Did the most recent attempt on this key actually reach a target? */
  function wasDelivered(key) {
    const attempt = state.lastSent[key] || lastSent.get(key) || 0;
    const delivered = state.lastDelivered[key] || lastDelivered.get(key) || 0;
    return delivered > 0 && delivered >= attempt;
  }

  /** Is an incident open under this key — i.e. was anyone actually told? */
  function isOpen(key) {
    return Boolean(state.lastDelivered[key] || lastDelivered.get(key));
  }

  function shouldSend(key, severity) {
    if (!enabled) return false;
    if ((rank[severity] ?? 2) < (rank[minSeverity] ?? 2)) return false;
    if (!targets.length) return false;
    const last = state.lastSent[key] || lastSent.get(key) || 0;
    const window = wasDelivered(key) ? cooldownMs : retryCooldownMs;
    if (Date.now() - last < window) return false;
    return true;
  }

  function markSent(key, delivered) {
    const now = Date.now();
    lastSent.set(key, now);
    state.lastSent[key] = now;
    if (delivered) {
      lastDelivered.set(key, now);
      state.lastDelivered[key] = now;
    }
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
    // A resolve closes the incident its trigger opened, so it must bypass BOTH
    // the severity floor and the cooldown. Neither bypass is optional: an outage
    // shorter than cooldownMs (30min by default — most of them) would be skipped
    // "cooldown" and the PagerDuty incident would stay open forever, and PD
    // dedups on dedup_key, so a stale open incident silently swallows the NEXT
    // genuine outage's page. That is a fail-open on paging, not a stale row.
    // The safe gate for the bypass is "did we actually open it": resolving a key
    // with no recorded send would page RESOLVED for a problem nobody heard about.
    // That gate has to read the DELIVERED stamp — an attempt whose every target
    // errored opened nothing, and gating on the attempt made this comment false.
    const resolving = alert.eventAction === "resolve";
    if (resolving && !isOpen(key)) {
      entry.skipped = "not_open";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }
    if (!resolving && (rank[severity] ?? 2) < (rank[minSeverity] ?? 2)) {
      entry.skipped = "below_min_severity";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }
    if (!resolving && !shouldSend(key, severity)) {
      entry.skipped = "cooldown";
      state.history.push(entry);
      saveState(statePath, state);
      return entry;
    }

    const text = [
      `XClaw [${resolving ? "RESOLVED" : severity.toUpperCase()}] ${alert.title || "alert"}`,
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
    if (resolving) {
      // Clear the open marker instead of re-arming it. markSent() here would
      // suppress the next GENUINE trigger for a full cooldown — recovering from
      // an outage would blind us to the one that follows it.
      delete state.lastSent[key];
      delete state.lastDelivered[key];
      lastSent.delete(key);
      lastDelivered.delete(key);
    } else {
      // Stamp the attempt either way — that is what paces retries — but stamp
      // the DELIVERED fact only when a target accepted it. See lastDelivered.
      markSent(key, entry.sent);
    }
    state.history.push(entry);
    saveState(statePath, state);
    console.log(
      `[xclaw:alert] ${entry.sent ? "sent" : "failed"} ${resolving ? "resolve " : ""}${key}` +
        // "failed doctor:x" alone sends whoever finds it in the log to read the
        // JSON state file to learn whether it was a missing token, a 5xx, or a
        // typo'd channel. The reasons are already in hand; print them.
        (entry.sent ? "" : ` (${describeFailures(entry.results)})`)
    );
    return entry;
  }

  /**
   * Close an incident this alerter opened. A primitive, not something each call
   * site hand-rolls: closing correctly means knowing the cooldown and severity
   * gates must be bypassed and that the open marker must be CLEARED rather than
   * re-armed. No caller should have to know that — and the two that tried
   * (channel watchdog, SLO monitor) both got it wrong.
   */
  async function resolve(alert = {}) {
    return send({ ...alert, eventAction: "resolve" });
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
      retryCooldownMs,
      minSeverity,
      targets,
      statePath,
      lastSent: { ...state.lastSent },
      // Which keys are actually OPEN, as opposed to merely attempted. Without
      // this the two facts are indistinguishable from outside the module.
      lastDelivered: { ...state.lastDelivered },
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
    resolve,
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
