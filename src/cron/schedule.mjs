/**
 * Minimal schedule next-run computation (OpenClaw-inspired every/at/cron).
 */

export function computeNextRun(schedule, fromMs = Date.now()) {
  if (!schedule || !schedule.kind) return null;
  if (schedule.kind === "every") {
    const every = Math.max(1000, Number(schedule.everyMs) || 60_000);
    return fromMs + every;
  }
  if (schedule.kind === "at") {
    const t = Date.parse(schedule.at);
    if (!Number.isFinite(t)) return null;
    return t > fromMs ? t : null; // one-shot past → null
  }
  if (schedule.kind === "cron") {
    return nextCron(schedule.expr || "0 * * * *", fromMs);
  }
  return null;
}

/** Very small 5-field cron: min hour dom month dow (* and numbers only). */
function nextCron(expr, fromMs) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length < 5) return fromMs + 60_000;
  const [minP, hourP, , , ] = parts;
  let t = fromMs + 60_000; // start next minute
  t = Math.floor(t / 60_000) * 60_000;
  for (let i = 0; i < 24 * 60 + 5; i++) {
    const d = new Date(t);
    const min = d.getMinutes();
    const hour = d.getHours();
    if (matchField(minP, min) && matchField(hourP, hour)) return t;
    t += 60_000;
  }
  return fromMs + 60_000;
}

function matchField(pat, value) {
  if (pat === "*") return true;
  if (pat.startsWith("*/")) {
    const n = Number(pat.slice(2));
    return n > 0 && value % n === 0;
  }
  return Number(pat) === value;
}
