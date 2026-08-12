/**
 * Context pressure meter — continuous 0..1 load signal for eviction tuning.
 */
import { messageChars } from "./eviction.mjs";

/**
 * @param {object[]} messages
 * @param {{ maxChars?: number, maxMessages?: number }} [budgets]
 */
export function measureContextPressure(messages, budgets = {}) {
  const maxChars = budgets.maxChars ?? 120_000;
  const maxMessages = budgets.maxMessages ?? 40;
  const list = Array.isArray(messages) ? messages : [];
  const chars = list.reduce((n, m) => n + messageChars(m), 0);
  const nonSystem = list.filter((m) => m?.role !== "system").length;
  const charP = Math.min(1, chars / Math.max(1, maxChars));
  const msgP = Math.min(1, nonSystem / Math.max(1, maxMessages));
  const pressure = Math.max(charP, msgP * 0.85 + charP * 0.15);
  let band = "low";
  if (pressure >= 0.85) band = "critical";
  else if (pressure >= 0.65) band = "high";
  else if (pressure >= 0.4) band = "medium";
  return {
    pressure: Math.round(pressure * 1000) / 1000,
    band,
    chars,
    maxChars,
    messages: nonSystem,
    maxMessages,
    charPressure: Math.round(charP * 1000) / 1000,
    messagePressure: Math.round(msgP * 1000) / 1000,
  };
}

/**
 * Suggest eviction aggressiveness from pressure.
 */
export function pressureToEvictionTweaks(pressureReport) {
  const p = pressureReport?.pressure ?? 0;
  if (p >= 0.85) {
    return { toolMaxChars: 800, protectRecent: 3, maxMessages: 24 };
  }
  if (p >= 0.65) {
    return { toolMaxChars: 1200, protectRecent: 4, maxMessages: 32 };
  }
  if (p >= 0.4) {
    return { toolMaxChars: 2000, protectRecent: 4, maxMessages: 40 };
  }
  return {};
}
