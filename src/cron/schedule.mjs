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

/**
 * Parse one cron field into a Set of allowed values, or null for "*" (any).
 * Supports: "*", "a", "a,b,c", "a-b", "*\/n", "a-b/n" and mixed lists.
 * Returns undefined when the pattern is invalid.
 */
function parseField(pat, lo, hi, { isDow = false } = {}) {
  if (pat === "*") return null;
  const out = new Set();
  for (const part of String(pat).split(",")) {
    if (!part) return undefined;
    let range = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      range = part.slice(0, slash);
      step = Number(part.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) return undefined;
    }
    let start;
    let end;
    if (range === "*") {
      start = lo;
      end = hi;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return undefined;
      start = a;
      end = b;
    } else {
      start = Number(range);
      if (!Number.isInteger(start)) return undefined;
      // bare value with a step ("a/n") behaves like "a-hi/n" per Vixie cron
      end = slash >= 0 ? hi : start;
    }
    if (start < lo || end > hi || start > end) return undefined;
    for (let v = start; v <= end; v += step) {
      out.add(isDow && v === 7 ? 0 : v);
    }
  }
  return out;
}

const fieldMatches = (set, value) => set === null || set.has(value);

/**
 * Standard cron day rule: when BOTH dom and dow are restricted, the job runs
 * when EITHER matches; otherwise the restricted one (or neither) applies.
 */
function dayMatches(domSet, dowSet, d) {
  const domOk = fieldMatches(domSet, d.getDate());
  const dowOk = fieldMatches(dowSet, d.getDay());
  if (domSet !== null && dowSet !== null) return domOk || dowOk;
  return domOk && dowOk;
}

/** Full 5-field cron: min hour dom month dow (*, lists, ranges, steps; dom/dow OR rule). */
function nextCron(expr, fromMs) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length < 5) return fromMs + 60_000;
  const [minP, hourP, domP, monP, dowP] = parts;
  const minSet = parseField(minP, 0, 59);
  const hourSet = parseField(hourP, 0, 23);
  const domSet = parseField(domP, 1, 31);
  const monSet = parseField(monP, 1, 12);
  const dowSet = parseField(dowP, 0, 7, { isDow: true });
  if ([minSet, hourSet, domSet, monSet, dowSet].some((s) => s === undefined)) {
    return fromMs + 60_000; // unparseable → legacy fallback (retry in a minute)
  }

  let t = Math.floor((fromMs + 60_000) / 60_000) * 60_000; // start next minute
  // Day/hour skips keep this bounded: ≤ ~1500 iterations covers > 4 years.
  for (let guard = 0; guard < 5000; guard++) {
    const d = new Date(t);
    if (!fieldMatches(monSet, d.getMonth() + 1) || !dayMatches(domSet, dowSet, d)) {
      const nd = new Date(d);
      nd.setHours(24, 0, 0, 0); // next local midnight
      t = nd.getTime();
      continue;
    }
    if (!fieldMatches(hourSet, d.getHours())) {
      const nd = new Date(d);
      nd.setHours(d.getHours() + 1, 0, 0, 0);
      t = nd.getTime();
      continue;
    }
    if (!fieldMatches(minSet, d.getMinutes())) {
      t += 60_000;
      continue;
    }
    return t;
  }
  return fromMs + 60_000; // unsatisfiable within ~4y (e.g. "0 0 30 2 *")
}
