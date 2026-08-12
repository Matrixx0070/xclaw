/**
 * PagerDuty Events API v2 — trigger / acknowledge / resolve.
 * https://developer.pagerduty.com/docs/ZG9jOjExMDI5NTgx-send-an-alert-event
 */
const PD_ENQUEUE = "https://events.pagerduty.com/v2/enqueue";

/**
 * @param {object} opts
 * @param {string} opts.routingKey - Events API integration key
 * @param {'trigger'|'acknowledge'|'resolve'} [opts.eventAction]
 * @param {string} [opts.dedupKey]
 * @param {string} [opts.summary]
 * @param {string} [opts.source]
 * @param {'info'|'warning'|'error'|'critical'} [opts.severity]
 * @param {object} [opts.customDetails]
 * @param {string} [opts.component]
 * @param {string} [opts.group]
 * @param {string} [opts.class]
 */
export async function sendPagerDutyEvent(opts = {}) {
  const routingKey =
    opts.routingKey ||
    process.env.PAGERDUTY_ROUTING_KEY ||
    process.env.PD_ROUTING_KEY;
  if (!routingKey) {
    return { ok: false, reason: "no_routing_key" };
  }

  const eventAction = opts.eventAction || "trigger";
  const payload = {
    summary: String(opts.summary || "XClaw alert").slice(0, 1024),
    source: opts.source || "xclaw",
    severity: mapSeverity(opts.severity || "error"),
    timestamp: opts.timestamp || new Date().toISOString(),
    component: opts.component || "xclaw",
    group: opts.group || "xclaw",
    class: opts.class || "xclaw.alert",
    custom_details: opts.customDetails || {},
  };

  const body = {
    routing_key: routingKey,
    event_action: eventAction,
    dedup_key: opts.dedupKey || undefined,
    payload: eventAction === "resolve" || eventAction === "acknowledge"
      ? undefined
      : payload,
    client: "XClaw",
    client_url: opts.clientUrl || undefined,
  };

  // acknowledge/resolve still need dedup_key; payload optional
  if (eventAction !== "trigger") {
    delete body.payload;
  }

  try {
    const r = await fetch(PD_ENQUEUE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        reason: data.message || data.error || `http_${r.status}`,
        status: r.status,
        data,
      };
    }
    return {
      ok: true,
      status: data.status || "success",
      dedupKey: data.dedup_key || opts.dedupKey,
      message: data.message,
      data,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function mapSeverity(s) {
  const v = String(s || "error").toLowerCase();
  if (v === "critical") return "critical";
  if (v === "error") return "error";
  if (v === "warn" || v === "warning") return "warning";
  if (v === "info") return "info";
  return "error";
}

export function pagerDutyDedupKey(key) {
  // PD dedup keys max 255 chars
  return String(key || "xclaw").slice(0, 255);
}
