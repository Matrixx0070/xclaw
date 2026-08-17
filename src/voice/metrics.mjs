/**
 * Voice latency / quality metrics (in-process ring).
 * Surfaces TTFA, VAD, barge-in kill, STT, route modes for doctor + CLI.
 */

const MAX = 100;
/** @type {object[]} */
const events = [];
const counters = {
  wakeHits: 0,
  utterances: 0,
  bargeIns: 0,
  vadEndpoints: 0,
  streamReplies: 0,
  casualReplies: 0,
  agentReplies: 0,
  commandHits: 0,
};

function push(ev) {
  events.push({ ...ev, at: Date.now() });
  if (events.length > MAX) events.shift();
}

export function recordVoiceMetric(type, data = {}) {
  switch (type) {
    case "wake":
      counters.wakeHits += 1;
      break;
    case "utterance":
      counters.utterances += 1;
      break;
    case "barge_in":
      counters.bargeIns += 1;
      break;
    case "vad":
      counters.vadEndpoints += 1;
      break;
    case "reply_stream":
      counters.streamReplies += 1;
      break;
    case "reply_casual":
      counters.casualReplies += 1;
      break;
    case "reply_agent":
      counters.agentReplies += 1;
      break;
    case "command":
      counters.commandHits += 1;
      break;
    default:
      break;
  }
  push({ type, ...data });
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function collectMs(key) {
  return events
    .map((e) => e[key])
    .filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}

/**
 * Snapshot for doctor / CLI.
 */
export function voiceMetricsSnapshot() {
  const ttfa = collectMs("firstAudioMs");
  const vadDur = collectMs("durationMs");
  const kill = collectMs("killPathMs");
  const speech = collectMs("speechMs");

  return {
    counters: { ...counters },
    samples: events.length,
    latency: {
      ttfaMs: {
        p50: percentile(ttfa, 50),
        p95: percentile(ttfa, 95),
        n: ttfa.length,
      },
      vadDurationMs: {
        p50: percentile(vadDur, 50),
        p95: percentile(vadDur, 95),
        n: vadDur.length,
      },
      vadSpeechMs: {
        p50: percentile(speech, 50),
        n: speech.length,
      },
      bargeInKillMs: {
        p50: percentile(kill, 50),
        p95: percentile(kill, 95),
        n: kill.length,
      },
    },
    recent: events.slice(-10),
  };
}

export function resetVoiceMetrics() {
  events.length = 0;
  for (const k of Object.keys(counters)) counters[k] = 0;
}

export default {
  recordVoiceMetric,
  voiceMetricsSnapshot,
  resetVoiceMetrics,
};

/**
 * Build histogram buckets for a list of ms values.
 * @param {number[]} values
 * @param {{ bucketMs?: number, maxMs?: number }} [opts]
 */
export function histogram(values, opts = {}) {
  const bucketMs = opts.bucketMs || 100;
  const maxMs = opts.maxMs || 2000;
  const buckets = [];
  for (let lo = 0; lo < maxMs; lo += bucketMs) {
    buckets.push({ lo, hi: lo + bucketMs, count: 0 });
  }
  let overflow = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v) || v < 0) continue;
    if (v >= maxMs) {
      overflow += 1;
      continue;
    }
    const i = Math.floor(v / bucketMs);
    buckets[i].count += 1;
  }
  return { buckets, overflow, bucketMs, maxMs };
}

/**
 * ASCII bar chart from histogram.
 */
export function renderAsciiChart(hist, { width = 40, title = "" } = {}) {
  const lines = [];
  if (title) lines.push(title);
  const max = Math.max(1, ...hist.buckets.map((b) => b.count), hist.overflow);
  for (const b of hist.buckets) {
    if (b.count === 0) continue; // skip empty buckets for readability
    const barLen = Math.round((b.count / max) * width);
    const bar = "█".repeat(barLen) || "▏";
    const label = `${String(b.lo).padStart(4)}-${String(b.hi).padEnd(4)}ms`;
    lines.push(`${label} | ${bar} ${b.count}`);
  }
  if (hist.overflow) {
    const barLen = Math.round((hist.overflow / max) * width);
    lines.push(
      `${String(hist.maxMs).padStart(4)}+     | ${"█".repeat(barLen)} ${hist.overflow}`
    );
  }
  if (lines.length <= (title ? 1 : 0)) {
    lines.push("(no samples yet — run voice listen)");
  }
  return lines.join("\n");
}

/**
 * Sparkline from recent values.
 */
export function sparkline(values, { width = 24 } = {}) {
  const blocks = "▁▂▃▄▅▆▇█";
  if (!values.length) return "─".repeat(Math.min(width, 8));
  const slice = values.slice(-width);
  const max = Math.max(...slice, 1);
  return slice
    .map((v) => blocks[Math.min(blocks.length - 1, Math.floor((v / max) * (blocks.length - 1)))])
    .join("");
}

/**
 * Full text report with charts for CLI.
 */
export function voiceMetricsReport() {
  const snap = voiceMetricsSnapshot();
  const ttfaVals = snap.recent
    .map((e) => e.firstAudioMs)
    .filter((n) => typeof n === "number");
  // also from all events via re-collect — recent only for spark; use internal via snapshot latency
  const allTtfa = [];
  const allVad = [];
  const allKill = [];
  for (const e of snap.recent) {
    if (typeof e.firstAudioMs === "number") allTtfa.push(e.firstAudioMs);
    if (typeof e.durationMs === "number") allVad.push(e.durationMs);
    if (typeof e.killPathMs === "number") allKill.push(e.killPathMs);
  }
  // Prefer full ring — export helper
  const full = _allValues();
  const lines = [];
  lines.push("══ XClaw voice latency ══");
  lines.push(
    `wakes=${snap.counters.wakeHits} utterances=${snap.counters.utterances} barge-ins=${snap.counters.bargeIns}`
  );
  lines.push(
    `replies: stream=${snap.counters.streamReplies} agent=${snap.counters.agentReplies} casual=${snap.counters.casualReplies} cmd=${snap.counters.commandHits}`
  );
  lines.push("");
  lines.push(
    `TTFA  p50=${snap.latency.ttfaMs.p50 ?? "n/a"}  p95=${snap.latency.ttfaMs.p95 ?? "n/a"}  n=${snap.latency.ttfaMs.n}  ${sparkline(full.ttfa)}`
  );
  lines.push(
    renderAsciiChart(histogram(full.ttfa, { bucketMs: 100, maxMs: 1500 }), {
      title: "Time-to-first-audio (ms)",
      width: 36,
    })
  );
  lines.push("");
  lines.push(
    `VAD duration  p50=${snap.latency.vadDurationMs.p50 ?? "n/a"}  n=${snap.latency.vadDurationMs.n}  ${sparkline(full.vad)}`
  );
  lines.push(
    renderAsciiChart(histogram(full.vad, { bucketMs: 200, maxMs: 4000 }), {
      title: "VAD capture duration (ms)",
      width: 36,
    })
  );
  lines.push("");
  lines.push(
    `Barge-in kill  p50=${snap.latency.bargeInKillMs.p50 ?? "n/a"}  n=${snap.latency.bargeInKillMs.n}  ${sparkline(full.kill)}`
  );
  lines.push(
    renderAsciiChart(histogram(full.kill, { bucketMs: 5, maxMs: 50 }), {
      title: "Barge-in kill path (ms)",
      width: 36,
    })
  );
  return lines.join("\n");
}

function _allValues() {
  const ttfa = [];
  const vad = [];
  const kill = [];
  for (const e of events) {
    if (typeof e.firstAudioMs === "number") ttfa.push(e.firstAudioMs);
    if (typeof e.durationMs === "number") vad.push(e.durationMs);
    if (typeof e.killPathMs === "number") kill.push(e.killPathMs);
  }
  return { ttfa, vad, kill };
}
