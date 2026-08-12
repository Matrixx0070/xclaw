/**
 * Phase A4 — Humanized CDP motor
 *
 * Builds ordered CDP Input domain commands using humanize (Fitts paths,
 * key delays, reaction/settle). Execution happens in the computer process
 * via motor-bridge + tabClient.Input.dispatch*.
 */

import {
  mousePath,
  keyDelay,
  reactionDelay,
  settleDelay,
  readingPause,
  fittsDuration,
  humanize,
  sleep,
} from "./humanize.mjs";

/**
 * @typedef {{ method: string, params: object, delayMs?: number }} CdpStep
 */

/**
 * Humanized click at (x,y), optional from (fromX, fromY) and targetWidth for Fitts.
 * @returns {{ steps: CdpStep[], meta: object }}
 */
export function planClick(opts = {}) {
  const x = Number(opts.x);
  const y = Number(opts.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("motor.planClick requires numeric x,y");
  }
  const fromX = Number.isFinite(Number(opts.fromX)) ? Number(opts.fromX) : x - 40;
  const fromY = Number.isFinite(Number(opts.fromY)) ? Number(opts.fromY) : y - 30;
  const button = opts.button || "left";
  const clickCount = opts.clickCount || 1;
  const targetWidth = opts.targetWidth ?? opts.width ?? 24;

  const steps = [];
  const react = reactionDelay();
  if (react > 0) steps.push({ method: "_sleep", params: {}, delayMs: react });

  if (opts.label) {
    const rp = readingPause(String(opts.label));
    if (rp > 0) steps.push({ method: "_sleep", params: {}, delayMs: rp });
  }

  const path = mousePath(fromX, fromY, x, y, {
    targetWidth,
    tremor: opts.tremor,
  });

  for (const pt of path) {
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseMoved",
        x: pt.x,
        y: pt.y,
        button: "none",
      },
      delayMs: pt.delayMs || 0,
    });
  }

  // down / up (double-click = 2)
  for (let c = 1; c <= clickCount; c++) {
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mousePressed",
        x,
        y,
        button,
        clickCount: c,
      },
      delayMs: 20 + Math.round(Math.random() * 25),
    });
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseReleased",
        x,
        y,
        button,
        clickCount: c,
      },
      delayMs: 30 + Math.round(Math.random() * 40),
    });
  }

  const settle = settleDelay();
  if (settle > 0) steps.push({ method: "_sleep", params: {}, delayMs: settle });

  return {
    steps,
    meta: {
      kind: "click",
      x,
      y,
      fromX,
      fromY,
      targetWidth,
      fittsMs: fittsDuration(Math.hypot(x - fromX, y - fromY), targetWidth),
      humanize: humanize.enabled,
      stepCount: steps.length,
    },
  };
}

/**
 * Humanized typing into focused element (or after click).
 * @returns {{ steps: CdpStep[], meta: object }}
 */
export function planType(opts = {}) {
  const text = String(opts.text ?? "");
  const steps = [];
  const react = reactionDelay();
  if (react > 0) steps.push({ method: "_sleep", params: {}, delayMs: react });

  for (const ch of text) {
    const delay = keyDelay(ch);
    // keyDown / keyUp / char
    steps.push({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyDown",
        text: ch,
        unmodifiedText: ch,
        key: ch,
      },
      delayMs: Math.max(8, Math.floor(delay * 0.4)),
    });
    steps.push({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "char",
        text: ch,
        unmodifiedText: ch,
      },
      delayMs: Math.max(4, Math.floor(delay * 0.2)),
    });
    steps.push({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyUp",
        text: ch,
        unmodifiedText: ch,
        key: ch,
      },
      delayMs: Math.max(8, Math.floor(delay * 0.4)),
    });
  }

  const settle = settleDelay();
  if (settle > 0) steps.push({ method: "_sleep", params: {}, delayMs: settle });

  return {
    steps,
    meta: {
      kind: "type",
      length: text.length,
      humanize: humanize.enabled,
      stepCount: steps.length,
    },
  };
}

/**
 * Humanized scroll (wheel events).
 */
export function planScroll(opts = {}) {
  const x = Number(opts.x) || 0;
  const y = Number(opts.y) || 0;
  const deltaY = Number(opts.deltaY) || 300;
  const deltaX = Number(opts.deltaX) || 0;
  const steps = [];
  const react = reactionDelay();
  if (react > 0) steps.push({ method: "_sleep", params: {}, delayMs: react });

  // chunk scroll into several wheel ticks
  const chunks = Math.max(1, Math.min(12, Math.round(Math.abs(deltaY) / 80)));
  const tick = deltaY / chunks;
  for (let i = 0; i < chunks; i++) {
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseWheel",
        x,
        y,
        deltaX: deltaX / chunks,
        deltaY: tick,
      },
      delayMs: 40 + Math.round(Math.random() * 50),
    });
  }
  const settle = settleDelay();
  if (settle > 0) steps.push({ method: "_sleep", params: {}, delayMs: settle });
  return {
    steps,
    meta: { kind: "scroll", deltaY, chunks, humanize: humanize.enabled },
  };
}

/**
 * Plan motor op from a declarative object.
 * @param {{ op: 'click'|'type'|'scroll', ... }} motor
 */
export function planMotor(motor = {}) {
  const op = String(motor.op || motor.action || "").toLowerCase();
  if (op === "click") return planClick(motor);
  if (op === "type" || op === "typeText") return planType(motor);
  if (op === "scroll") return planScroll(motor);
  throw new Error(`motor: unknown op "${op}"`);
}

/**
 * Execute planned steps against a CDP tab client (chrome-remote-interface style).
 * @param {object} tabClient — must have Input.dispatchMouseEvent / dispatchKeyEvent or send()
 * @param {CdpStep[]} steps
 */
export async function executeSteps(tabClient, steps, opts = {}) {
  const sleepFn = opts.sleep || sleep;
  const log = opts.log || (() => {});
  let executed = 0;
  for (const step of steps) {
    if (step.method === "_sleep") {
      await sleepFn(step.delayMs || 0);
      executed++;
      continue;
    }
    try {
      if (typeof tabClient.send === "function") {
        await tabClient.send(step.method, step.params);
      } else {
        const [domain, method] = step.method.split(".");
        const target = tabClient[domain];
        if (target && typeof target[method] === "function") {
          await target[method](step.params);
        } else if (typeof tabClient[step.method] === "function") {
          await tabClient[step.method](step.params);
        } else {
          throw new Error(`no dispatcher for ${step.method}`);
        }
      }
    } catch (e) {
      log(`motor step failed ${step.method}: ${e?.message || e}`);
      throw e;
    }
    if (step.delayMs) await sleepFn(step.delayMs);
    executed++;
  }
  return { executed, total: steps.length };
}

/**
 * Plan + execute convenience.
 */
export async function runMotor(tabClient, motor, opts = {}) {
  const plan = planMotor(motor);
  const result = await executeSteps(tabClient, plan.steps, opts);
  return { ...result, meta: plan.meta };
}

export default {
  planClick,
  planType,
  planScroll,
  planMotor,
  executeSteps,
  runMotor,
};
