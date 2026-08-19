/**
 * POST live soak report when ok=false. Injectable fetch. No secrets in body.
 */
const state = { live_notify_total: 0, last: null };

export function incLiveNotify(n = 1) {
  state.live_notify_total += n;
  return state.live_notify_total;
}
export function getLiveNotifyTotal() {
  return state.live_notify_total;
}
export function resetLiveNotifyMetrics() {
  state.live_notify_total = 0;
  state.last = null;
}
export function lastLiveNotify() {
  return state.last;
}
export function renderLiveNotifyMetrics() {
  return `xclaw_horizon_live_notify_total ${state.live_notify_total}\n`;
}

export function liveNotifyWebhook(opts = {}) {
  return (opts.webhook || process.env.XCLAW_LIVE_REPORT_WEBHOOK || "").trim();
}

export function liveNotifyBody(report = {}) {
  return {
    ok: report.ok !== false,
    ids: report.ids || [],
    usedUsd: Number(report.usedUsd ?? 0),
    turns: Number(report.turns ?? 0),
    at: report.at || new Date().toISOString(),
  };
}

export async function notifyLiveReport(report = {}, opts = {}) {
  const url = liveNotifyWebhook(opts);
  if (!url) {
    state.last = { skipped: true, reason: "no_webhook" };
    return { ok: true, skipped: true, reason: "no_webhook" };
  }
  if (report.ok !== false) {
    state.last = { skipped: true, reason: "ok_true" };
    return { ok: true, skipped: true, reason: "ok_true" };
  }
  const fetchFn = opts.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return { ok: false, code: "NO_FETCH" };
  }
  const body = liveNotifyBody(report);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    incLiveNotify();
    state.last = { ok: true, status: res?.status ?? 200 };
    return { ok: true, status: res?.status ?? 200, body };
  } catch (e) {
    state.last = { ok: false, error: String(e.message || e) };
    return { ok: false, code: "NOTIFY_FAIL", error: String(e.message || e) };
  }
}

export default { notifyLiveReport, liveNotifyBody, renderLiveNotifyMetrics };
