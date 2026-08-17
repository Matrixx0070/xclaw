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
