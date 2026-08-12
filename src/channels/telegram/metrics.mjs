/**
 * Telegram channel Prometheus counters (P1).
 * Low-cardinality labels only.
 */

/** @type {Map<string, number>} */
const counters = new Map();

function key(name, labels = {}) {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

export function tgIncr(name, labels = {}, by = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) || 0) + by);
}

export function recordTelegramUpdate(kind = "message") {
  tgIncr("xclaw_telegram_updates_total", { kind });
}

export function recordTelegramEdit(result = "ok") {
  tgIncr("xclaw_telegram_edits_total", { result });
}

export function recordTelegramDeny(reason = "policy") {
  tgIncr("xclaw_telegram_denies_total", { reason });
}

export function recordTelegramError(phase = "unknown") {
  tgIncr("xclaw_telegram_errors_total", { phase });
}

export function recordTelegramCallback(action = "unknown") {
  tgIncr("xclaw_telegram_callbacks_total", { action });
}

export function recordTelegramStreamDelta() {
  tgIncr("xclaw_telegram_stream_deltas_total", {});
}

export function recordTelegramStructuredOut(type = "unknown") {
  tgIncr("xclaw_telegram_structured_out_total", { type: String(type).slice(0, 32) });
}

export function renderTelegramMetrics() {
  const lines = [];
  const groups = new Map(); // metric -> [{labels, value}]
  for (const [k, v] of counters) {
    const m = k.match(/^([^{]+)(?:\{(.*)\})?$/);
    if (!m) continue;
    const name = m[1];
    const labelStr = m[2] || "";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ labelStr, v });
  }
  const help = {
    xclaw_telegram_updates_total: "Telegram updates handled",
    xclaw_telegram_edits_total: "Telegram message edits",
    xclaw_telegram_denies_total: "Telegram access denials",
    xclaw_telegram_errors_total: "Telegram channel errors",
    xclaw_telegram_callbacks_total: "Telegram inline callback actions",
    xclaw_telegram_stream_deltas_total: "Telegram progressive text deltas applied",
    xclaw_telegram_structured_out_total: "Telegram structured outbound messages",
  };
  for (const [name, rows] of groups) {
    lines.push(`# HELP ${name} ${help[name] || name}`);
    lines.push(`# TYPE ${name} counter`);
    for (const r of rows) {
      lines.push(
        r.labelStr ? `${name}{${r.labelStr}} ${r.v}` : `${name} ${r.v}`
      );
    }
  }
  return lines.join("\n");
}

export function resetTelegramMetrics() {
  counters.clear();
}

export default {
  tgIncr,
  recordTelegramUpdate,
  recordTelegramEdit,
  recordTelegramDeny,
  recordTelegramError,
  recordTelegramCallback,
  recordTelegramStreamDelta,
  recordTelegramStructuredOut,
  renderTelegramMetrics,
  resetTelegramMetrics,
};
