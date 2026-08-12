/**
 * Durable suggestion feedback — ~/.xclaw/suggestion-feedback.json
 *
 * Tracks shown/tapped by (source, kind) and optional userId.
 * Used to bias chip scores (simple empirical CTR / Bayesian-smoothed).
 */
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import {
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../utils/durable-write.mjs";

const VERSION = 1;
const MAX_EVENTS = 500;

function baseDir(cfg) {
  return cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
}

export function suggestionFeedbackPath(cfg) {
  return path.join(baseDir(cfg), "suggestion-feedback.json");
}

function emptyStore() {
  return {
    version: VERSION,
    updatedAt: null,
    /** global aggregates by "source|kind" */
    keys: {},
    /** per userId */
    users: {},
    /** ring of recent events for dedup / debugging */
    events: [],
  };
}

function keyOf(source, kind) {
  return `${String(source || "unknown")}|${String(kind || "followup")}`;
}

function emptyBucket() {
  return { shown: 0, tapped: 0, dismissed: 0 };
}

/**
 * @param {object} [cfg]
 */
export async function loadSuggestionFeedback(cfg) {
  const fp = suggestionFeedbackPath(cfg);
  try {
    const raw = JSON.parse(await fsp.readFile(fp, "utf8"));
    if (!raw || typeof raw !== "object") return emptyStore();
    return {
      version: raw.version || VERSION,
      updatedAt: raw.updatedAt || null,
      keys: raw.keys && typeof raw.keys === "object" ? raw.keys : {},
      users: raw.users && typeof raw.users === "object" ? raw.users : {},
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  } catch {
    return emptyStore();
  }
}

/**
 * @param {object} [cfg]
 * @param {object} data
 */
export async function saveSuggestionFeedback(cfg, data) {
  const fp = suggestionFeedbackPath(cfg);
  data.updatedAt = new Date().toISOString();
  data.version = VERSION;
  if (durableWritesEnabled(cfg)) {
    await durableAtomicWriteJson(fp, data, { mode: 0o600 });
  } else {
    await fsp.mkdir(path.dirname(fp), { recursive: true, mode: 0o700 });
    await fsp.writeFile(fp, JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
    });
  }
  return fp;
}

/**
 * Record shown | tapped | dismissed.
 * @param {object} [cfg]
 * @param {object} ev
 * @param {string} ev.event
 * @param {string} [ev.source]
 * @param {string} [ev.kind]
 * @param {string} [ev.prompt]
 * @param {string} [ev.suggestionId]
 * @param {string} [ev.userId]
 * @param {string|number} [ev.chatId]
 */
export async function recordDurableSuggestionFeedback(cfg, ev = {}) {
  const event = String(ev.event || "");
  if (!["shown", "tapped", "dismissed"].includes(event)) return null;

  const data = await loadSuggestionFeedback(cfg);
  const k = keyOf(ev.source, ev.kind);

  const bump = (bucket) => {
    const b = bucket[k] || emptyBucket();
    if (event === "shown") b.shown += 1;
    else if (event === "tapped") b.tapped += 1;
    else if (event === "dismissed") b.dismissed += 1;
    bucket[k] = b;
  };

  bump(data.keys);
  if (ev.userId) {
    const uid = String(ev.userId);
    if (!data.users[uid]) data.users[uid] = {};
    bump(data.users[uid]);
  }

  data.events.push({
    event,
    source: ev.source || null,
    kind: ev.kind || null,
    prompt: String(ev.prompt || "").slice(0, 120),
    suggestionId: ev.suggestionId || null,
    userId: ev.userId ? String(ev.userId) : null,
    chatId: ev.chatId != null ? String(ev.chatId) : null,
    at: Date.now(),
  });
  while (data.events.length > MAX_EVENTS) data.events.shift();

  await saveSuggestionFeedback(cfg, data);
  return data;
}

/**
 * Bayesian-smoothed tap rate for a (source, kind).
 * Prior: alpha taps, beta shows (weak prior toward 0.15 CTR).
 *
 * @returns {number} bias multiplier roughly in [0.5, 1.6]
 */
export function scoreBiasFromStats(shown, tapped, opts = {}) {
  const priorCtr = Number(opts.priorCtr) >= 0 ? Number(opts.priorCtr) : 0.15;
  const priorStrength = Number(opts.priorStrength) >= 0 ? Number(opts.priorStrength) : 8;
  const alpha = priorCtr * priorStrength;
  const beta = (1 - priorCtr) * priorStrength;
  const s = Math.max(0, Number(shown) || 0);
  const t = Math.max(0, Number(tapped) || 0);
  const ctr = (t + alpha) / (s + alpha + beta);
  // Map CTR ~0.05..0.40 → bias ~0.7..1.4
  const bias = 0.7 + Math.min(0.7, Math.max(0, (ctr - 0.05) * 2));
  return bias;
}

/**
 * Build lookup of bias multipliers for ranking.
 * @param {object} store
 * @param {string} [userId]
 * @returns {Map<string, number>} key "source|kind" → bias
 */
export function buildScoreBiasMap(store, userId, opts = {}) {
  const map = new Map();
  const global = store?.keys || {};
  const user = (userId && store?.users?.[String(userId)]) || {};

  const keys = new Set([...Object.keys(global), ...Object.keys(user)]);
  for (const k of keys) {
    const g = global[k] || emptyBucket();
    const u = user[k] || emptyBucket();
    // Prefer user stats when enough samples
    const useUser = (u.shown || 0) >= (opts.userMinShown ?? 3);
    const shown = useUser ? u.shown : g.shown + u.shown;
    const tapped = useUser ? u.tapped : g.tapped + u.tapped;
    map.set(k, scoreBiasFromStats(shown, tapped, opts));
  }
  return map;
}

/**
 * Apply bias to a candidate score.
 */
export function applySuggestionBias(score, source, kind, biasMap) {
  const k = keyOf(source, kind);
  const bias = biasMap?.get(k);
  if (bias == null || !Number.isFinite(bias)) return score;
  return score * bias;
}

/**
 * Recent prompts from durable events (dedup).
 */
export function recentPromptsFromStore(store, limit = 30) {
  const ev = store?.events || [];
  return ev
    .filter((e) => e.event === "tapped" || e.event === "shown")
    .slice(-limit)
    .map((e) => e.prompt)
    .filter(Boolean);
}

/**
 * Aggregate stats for doctor / metrics.
 */
export function suggestionFeedbackStats(store) {
  let shown = 0;
  let tapped = 0;
  let dismissed = 0;
  for (const b of Object.values(store?.keys || {})) {
    shown += b.shown || 0;
    tapped += b.tapped || 0;
    dismissed += b.dismissed || 0;
  }
  return {
    shown,
    tapped,
    dismissed,
    tapRate: shown ? tapped / shown : 0,
    keys: Object.keys(store?.keys || {}).length,
    users: Object.keys(store?.users || {}).length,
    events: (store?.events || []).length,
    updatedAt: store?.updatedAt || null,
  };
}

export default {
  suggestionFeedbackPath,
  loadSuggestionFeedback,
  saveSuggestionFeedback,
  recordDurableSuggestionFeedback,
  scoreBiasFromStats,
  buildScoreBiasMap,
  applySuggestionBias,
  recentPromptsFromStore,
  suggestionFeedbackStats,
};
