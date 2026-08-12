/**
 * XClaw Horizon 3 — Human-like motor cortex (Fitts-law v2 + empirical cadence).
 *
 * Provides:
 *  - Gaussian / log-normal delays (reaction, inter-key, post-action)
 *  - Cubic Bezier mouse paths with overshoot + micro-jitter
 *  - Human typing cadence (wpm variance, occasional pauses, typos-ready)
 *  - Scroll momentum profiles
 *
 * Used by BrowserService action wrappers and future CDP Input.dispatch* paths.
 * Env:
 *   XCLAW_BROWSER_HUMANIZE=0|false  → disable (instant)
 *   XCLAW_BROWSER_HUMANIZE_SPEED=0.5..2.0  → global time scale (default 1)
 */

const ENABLED =
  process.env.XCLAW_BROWSER_HUMANIZE !== "0" &&
  process.env.XCLAW_BROWSER_HUMANIZE !== "false";

const SPEED = Math.max(
  0.25,
  Math.min(3, Number(process.env.XCLAW_BROWSER_HUMANIZE_SPEED) || 1)
);

/** Box-Muller Gaussian sample */
function gauss(mean = 0, std = 1) {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return (
    mean +
    std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  );
}

/** Clamp positive delay */
function clampMs(ms, min = 8, max = 8000) {
  return Math.max(min, Math.min(max, Math.round(ms * SPEED)));
}

/**
 * Reaction / think delay before an action (click, type start, scroll).
 * Typical human 180–450 ms, skewed.
 */
export function reactionDelay() {
  if (!ENABLED) return 0;
  // log-normal-ish via exp of gauss
  const ms = Math.exp(gauss(5.5, 0.35)); // ~240 median
  return clampMs(ms, 80, 1200);
}

/**
 * Inter-key delay for typing. Mean ~75 ms (~800 cpm / 160 wpm peak),
 * with long-tail pauses after punctuation / spaces.
 */
export function keyDelay(char = "a") {
  if (!ENABLED) return 0;
  let base = 55 + gauss(0, 18);
  if (char === " " || char === "\n") base += 40 + Math.random() * 80;
  if (/[.,!?;:]/.test(char)) base += 60 + Math.random() * 120;
  if (Math.random() < 0.04) base += 180 + Math.random() * 400; // micro-pause
  return clampMs(base, 25, 900);
}

/** Post-click / post-action settle */
export function settleDelay() {
  if (!ENABLED) return 0;
  return clampMs(90 + gauss(40, 35), 40, 600);
}

/** Wait helper */
export function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cubic Bezier point.
 * P0 = start, P3 = end, P1/P2 control.
 */
function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Generate a human-like mouse path from (x0,y0) → (x1,y1).
 * Returns array of {x,y,delayMs} steps.
 *
 * Features:
 *  - Random control points with slight overshoot
 *  - Variable step count based on distance
 *  - Per-step micro-jitter
 *  - Ease-in-out timing (more points near ends)
 */

/**
 * Fitts' law movement time (ms).
 * MT = a + b * log2(D/W + 1)
 * a ≈ 50–100ms reaction/motor init, b ≈ 100–150ms per bit.
 * @param {number} distancePx
 * @param {number} targetWidthPx
 */
export function fittsDuration(distancePx, targetWidthPx = 24, opts = {}) {
  const a = opts.a ?? 70;
  const b = opts.b ?? 120;
  const W = Math.max(4, Number(targetWidthPx) || 24);
  const D = Math.max(1, Number(distancePx) || 1);
  const id = Math.log2(D / W + 1); // index of difficulty
  let mt = a + b * id;
  // human variance
  if (ENABLED) mt += gauss(0, mt * 0.12);
  return clampMs(mt, 40, 2500);
}

/**
 * Reading / scan pause proportional to text length (ms).
 */
export function readingPause(text = "") {
  if (!ENABLED) return 0;
  const n = String(text || "").length;
  if (n < 8) return clampMs(40 + gauss(20, 15), 0, 200);
  // ~180–250 WPM reading → ~15–20 chars/sec with comprehension tax
  const base = (n / 18) * 1000;
  return clampMs(base * (0.7 + Math.random() * 0.6) + gauss(0, 80), 60, 8000);
}

/**
 * Index of difficulty helper (bits).
 */
export function fittsID(distancePx, targetWidthPx = 24) {
  const W = Math.max(4, Number(targetWidthPx) || 24);
  const D = Math.max(1, Number(distancePx) || 1);
  return Math.log2(D / W + 1);
}

export function mousePath(x0, y0, x1, y1, opts = {}) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 2 || !ENABLED) {
    return [{ x: x1, y: y1, delayMs: 0 }];
  }

  const steps = Math.max(
    8,
    Math.min(48, Math.round(dist / (opts.stepPx || 12)))
  );

  // Control points: offset perpendicular + forward bias + occasional overshoot
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const curve = (0.15 + Math.random() * 0.35) * dist * (Math.random() < 0.5 ? 1 : -1);
  const overshoot = Math.random() < 0.25 ? 0.08 + Math.random() * 0.12 : 0;

  const p0 = { x: x0, y: y0 };
  const p3 = {
    x: x1 + dx * overshoot,
    y: y1 + dy * overshoot,
  };
  const p1 = {
    x: x0 + dx * 0.25 + nx * curve * 0.6,
    y: y0 + dy * 0.25 + ny * curve * 0.6,
  };
  const p2 = {
    x: x0 + dx * 0.75 + nx * curve * 0.4,
    y: y0 + dy * 0.75 + ny * curve * 0.4,
  };

  // H3: Fitts-law total duration when targetWidth known; else distance heuristic
  const targetW = opts.targetWidth ?? opts.width ?? null;
  const totalMs = targetW
    ? fittsDuration(dist, targetW, opts.fitts || {})
    : clampMs(180 + dist * 0.35 + gauss(0, 30), 60, 2200);

  const path = [];
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    // ease-in-out sampling
    const u = i / steps;
    const t = u * u * (3 - 2 * u);
    const pt = bezier(t, p0, p1, p2, p3);
    // micro-jitter / tremor (decays near target)
    const tremor = opts.tremor != null ? Number(opts.tremor) : 1.8;
    const jitter = (1 - u) * tremor;
    pt.x += gauss(0, jitter);
    pt.y += gauss(0, jitter);

    const dt = (t - prevT) * totalMs;
    path.push({
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      delayMs: clampMs(dt + gauss(0, 4), 4, 120),
    });
    prevT = t;
  }

  // final exact target
  path.push({ x: x1, y: y1, delayMs: clampMs(12 + Math.random() * 20, 8, 40) });
  return path;
}

/**
 * Type a string with human cadence. Yields {char, delayMs} or use the async helper.
 */
export function typingPlan(text) {
  if (!ENABLED) {
    return [...text].map((c) => ({ char: c, delayMs: 0 }));
  }
  return [...text].map((c) => ({ char: c, delayMs: keyDelay(c) }));
}

/**
 * Async type helper — call dispatchKey for each char after delay.
 * @param {string} text
 * @param {(char: string) => Promise<void>} dispatchKey
 */
export async function humanType(text, dispatchKey) {
  await sleep(reactionDelay());
  for (const { char, delayMs } of typingPlan(text)) {
    await dispatchKey(char);
    await sleep(delayMs);
  }
  await sleep(settleDelay());
}

/**
 * Async mouse move + click with bezier path.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {(x:number,y:number,type:string) => Promise<void>} dispatchMouse
 *        type: "mouseMoved" | "mousePressed" | "mouseReleased"
 */
export async function humanClick(from, to, dispatchMouse, opts = {}) {
  await sleep(reactionDelay());
  // H3: optional pre-read pause when label provided
  if (opts.label) await sleep(readingPause(String(opts.label).slice(0, 120)));
  const path = mousePath(from.x, from.y, to.x, to.y, opts);
  for (const step of path) {
    await dispatchMouse(step.x, step.y, "mouseMoved");
    await sleep(step.delayMs);
  }
  // press / release with tiny hold
  await dispatchMouse(to.x, to.y, "mousePressed");
  await sleep(clampMs(45 + gauss(15, 12), 30, 120));
  await dispatchMouse(to.x, to.y, "mouseReleased");
  await sleep(settleDelay());
}

/**
 * Scroll profile: several wheel events with decaying delta (momentum).
 */
export function scrollPlan(totalDeltaY, opts = {}) {
  if (!ENABLED || Math.abs(totalDeltaY) < 5) {
    return [{ deltaY: totalDeltaY, delayMs: 0 }];
  }
  const steps = Math.max(3, Math.min(18, Math.round(Math.abs(totalDeltaY) / 40)));
  const plan = [];
  let remaining = totalDeltaY;
  for (let i = 0; i < steps; i++) {
    const frac = (steps - i) / ((steps * (steps + 1)) / 2); // triangular
    let d = remaining * (0.35 + Math.random() * 0.4);
    if (i === steps - 1) d = remaining;
    remaining -= d;
    plan.push({
      deltaY: Math.round(d),
      delayMs: clampMs(28 + gauss(12, 10) + i * 4, 12, 90),
    });
  }
  return plan;
}

export async function humanScroll(totalDeltaY, dispatchWheel) {
  await sleep(reactionDelay() * 0.6);
  for (const step of scrollPlan(totalDeltaY)) {
    if (step.deltaY !== 0) await dispatchWheel(step.deltaY);
    await sleep(step.delayMs);
  }
  await sleep(settleDelay() * 0.7);
}

export const humanize = {
  enabled: ENABLED,
  speed: SPEED,
  reactionDelay,
  keyDelay,
  settleDelay,
  sleep,
  mousePath,
  typingPlan,
  humanType,
  humanClick,
  scrollPlan,
  humanScroll,
  fittsDuration,
  fittsID,
  readingPause,
};

export default humanize;
