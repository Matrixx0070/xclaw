/**
 * R4 — Proactive heartbeat / scheduled owner jobs.
 *
 * Config:
 *   autonomy.heartbeat.enabled
 *   autonomy.heartbeat.everyMs
 *   autonomy.heartbeat.prompt
 *   autonomy.heartbeat.delivery: { channel, to }
 *   autonomy.quietHours: { startHour, endHour, tzOffsetMinutes }
 *   autonomy.maxUsdPerDay
 */
import {
  addJob,
  listJobs,
  start as startScheduler,
  status as schedulerStatus,
  on as onCron,
} from "./scheduler.mjs";
import { deliverToChannel } from "./channel-deliver.mjs";

let ensured = false;
let spendUsdToday = 0;
let spendDay = null;
let lastSkipReason = null;
let lastRunAt = null;
let lastError = null;

function todayKey(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Quiet hours: if startHour <= endHour → [start, end); else overnight wrap.
 * Hours in local-ish clock via tzOffsetMinutes from UTC.
 */
export function inQuietHours(cfg, now = Date.now()) {
  const q = cfg?.autonomy?.quietHours || cfg?.heartbeat?.quietHours;
  if (!q || q.enabled === false) return false;
  if (q.startHour == null || q.endHour == null) return false;
  const offset = Number(q.tzOffsetMinutes) || 0;
  const local = new Date(now + offset * 60_000);
  const h = local.getUTCHours();
  const start = Number(q.startHour);
  const end = Number(q.endHour);
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  // overnight e.g. 22 → 7
  return h >= start || h < end;
}

export function canSpend(cfg, addUsd = 0) {
  const max = cfg?.autonomy?.maxUsdPerDay ?? cfg?.heartbeat?.maxUsdPerDay;
  if (max == null || max === false) return { ok: true };
  const offset = Number(cfg?.autonomy?.quietHours?.tzOffsetMinutes) || 0;
  const day = todayKey(offset);
  if (spendDay !== day) {
    spendDay = day;
    spendUsdToday = 0;
  }
  if (spendUsdToday + addUsd > Number(max)) {
    return {
      ok: false,
      reason: `daily spend cap $${max} (used $${spendUsdToday.toFixed(4)})`,
    };
  }
  return { ok: true, remaining: Number(max) - spendUsdToday };
}

export function recordSpend(usd) {
  spendUsdToday += Number(usd) || 0;
}

/**
 * Ensure system heartbeat job exists and scheduler is running.
 */
export function ensureHeartbeat(cfg = {}) {
  const hb = cfg.autonomy?.heartbeat || cfg.heartbeat || {};
  const enabled = hb.enabled === true;
  if (!enabled) {
    return { ok: true, enabled: false, reason: "autonomy.heartbeat.enabled is not true" };
  }

  const everyMs = Math.max(60_000, Number(hb.everyMs) || 30 * 60_000);
  const name = hb.name || "xclaw-heartbeat";
  const existing = listJobs().find((j) => j.name === name);
  if (existing) {
    ensured = true;
    startScheduler();
    return { ok: true, enabled: true, jobId: existing.id, everyMs, existing: true };
  }

  const prompt =
    hb.prompt ||
    "Heartbeat: briefly check for urgent owner tasks. If nothing needs action, reply with exactly: HEARTBEAT_OK";

  const job = addJob({
    name,
    description: "R4 autonomy heartbeat",
    enabled: true,
    schedule: { kind: "every", everyMs },
    payload: { prompt, message: prompt },
    delivery: {
      // mode none: agent runs without auto-push; we deliver only on non-HEARTBEAT_OK / failure
      mode: "none",
      channel: hb.delivery?.channel || null,
      to: hb.delivery?.to || null,
    },
    handler: async (j) => {
      lastRunAt = new Date().toISOString();
      lastError = null;
      if (inQuietHours(cfg)) {
        lastSkipReason = "quiet_hours";
        j._lastSkip = lastSkipReason;
        return;
      }
      const spend = canSpend(cfg, 0);
      if (!spend.ok) {
        lastSkipReason = spend.reason;
        j._lastSkip = lastSkipReason;
        return;
      }
      lastSkipReason = null;

      const { announceCronJob } = await import("./announce.mjs");
      const ann = await announceCronJob(
        {
          ...j,
          payload: { prompt, message: prompt },
          delivery: j.delivery,
        },
        { cfg }
      );
      j._lastAnnounce = ann;

      const text = String(ann?.text || ann?.delivery?.text || "").trim();
      const silenceOk =
        hb.silenceOk !== false &&
        (/^HEARTBEAT_OK$/i.test(text) || text.length < 8);

      // Optional owner notify on non-trivial results or failures
      if (j.delivery?.channel && j.delivery?.to && !silenceOk) {
        try {
          const sent = await deliverToChannel(
            {
              mode: "announce",
              channel: j.delivery.channel,
              to: j.delivery.to,
              text: `⏱ Heartbeat\n${text.slice(0, 3500)}`,
            },
            cfg
          );
          j._lastDelivery = sent;
          if (!sent?.ok) lastError = sent?.reason || "delivery_failed";
        } catch (e) {
          lastError = e.message;
        }
      } else if (silenceOk) {
        j._lastDelivery = { ok: true, skipped: true, reason: "silence_ok" };
      }

      // Rough spend accounting if usage present
      const usd = Number(ann?.usage?.costUsd || ann?.costUsd || 0);
      if (usd) recordSpend(usd);
    },
  });

  // stash cfg for announce path
  job._cfg = cfg;
  ensured = true;
  startScheduler();

  // Notify on cron failure
  onCron("cron:after", async (payload) => {
    if (payload?.name !== name) return;
    if (payload.ok === false && payload.job?.delivery?.channel && payload.job?.delivery?.to) {
      lastError = payload.error || "heartbeat failed";
      try {
        await deliverToChannel(
          {
            mode: "announce",
            channel: payload.job.delivery.channel,
            to: payload.job.delivery.to,
            text: `⚠️ Heartbeat failed: ${lastError}`,
          },
          cfg
        );
      } catch {
        /* */
      }
    }
  });

  return { ok: true, enabled: true, jobId: job.id, everyMs, existing: false };
}

export function heartbeatStatus() {
  return {
    ensured,
    lastRunAt,
    lastSkipReason,
    lastError,
    spendUsdToday,
    spendDay,
    scheduler: schedulerStatus(),
  };
}
