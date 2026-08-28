/**
 * Wording and target for doctor's "is the computer up?" row.
 *
 * Pure on purpose. The probe lives inside `runDoctor`, which loads the real
 * config and cannot be pointed at a fixture, so the branch that matters most —
 * what happens when the computer is not this machine — shipped untested.
 *
 * It shipped wrong, too: the probe derived `http://${host}:${port}` inline and
 * never consulted computer.remoteUrl, while the fallback probe went through
 * computerBaseUrl and did. The two branches of one if/else therefore asked two
 * different machines, and any stray process on the local port graded a dead
 * remote "up" — a health check that fails open on the substrate every computer
 * tool call uses.
 */
import { computerBaseUrl } from "../computer/manager.mjs";

/** The /health endpoint of the computer this config actually talks to. */
export function computerHealthTarget(cfg) {
  return `${computerBaseUrl(cfg)}/health`;
}

/**
 * @param {object} cfg
 * @param {boolean} healthy result of probing computerHealthTarget(cfg)
 * @param {string|number} [reason] what the probe reported, when it failed
 * @returns {{ status: "ok"|"warn", message: string }}
 */
export function computerHealthRow(cfg, healthy, reason) {
  const url = computerBaseUrl(cfg);
  if (healthy) return { status: "ok", message: `Computer ${url} up` };
  // A remedy is a claim about the product: starting a local gateway cannot make
  // someone else's machine healthy.
  const remedy = cfg.computer?.remoteUrl
    ? "check the remote computer (computer.remoteUrl)"
    : "start with: xclaw gateway";
  const why = reason ? ` (${reason})` : "";
  return { status: "warn", message: `Computer ${url} not reachable${why} — ${remedy}` };
}
