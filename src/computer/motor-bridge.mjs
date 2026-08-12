/**
 * A4 — Load humanized motor from computer process and run against CDP client.
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function candidateMotorPaths() {
  const roots = [];
  if (process.env.XCLAW_ROOT) roots.push(process.env.XCLAW_ROOT);
  roots.push(process.cwd());
  roots.push(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."));
  const out = [];
  if (process.env.XCLAW_MOTOR_PATH) out.push(process.env.XCLAW_MOTOR_PATH);
  for (const root of roots) {
    out.push(path.join(root, "src/browser/motor.mjs"));
  }
  return out;
}

let _motor = null;
let _failed = false;

export async function loadMotor() {
  if (_motor) return _motor;
  if (_failed) return null;
  for (const p of candidateMotorPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      _motor = await import(pathToFileURL(path.resolve(p)).href);
      return _motor;
    } catch (e) {
      console.error("[xclaw-motor-bridge] load failed:", p, e?.message || e);
    }
  }
  _failed = true;
  return null;
}

/**
 * @param {object} tabClient CDP session
 * @param {object} motorSpec { op, x, y, text, ... }
 */
export async function runMotorOnClient(tabClient, motorSpec, opts = {}) {
  const m = await loadMotor();
  if (!m?.runMotor) {
    return {
      ok: false,
      code: "MOTOR_UNAVAILABLE",
      reason: "motor.mjs not found",
    };
  }
  // Optional fabric: caller should have run beforeInput already
  try {
    const result = await m.runMotor(tabClient, motorSpec, opts);
    return { ok: true, ...result };
  } catch (e) {
    return {
      ok: false,
      code: "MOTOR_FAILED",
      reason: e?.message || String(e),
    };
  }
}

export async function planMotorOnly(motorSpec) {
  const m = await loadMotor();
  if (!m?.planMotor) return null;
  return m.planMotor(motorSpec);
}
