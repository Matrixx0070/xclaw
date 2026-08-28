/**
 * Robust computer readiness: health probe + start + wait with retries.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computerBaseUrl,
  isComputerRunning,
  startComputer,
  waitForHealthy,
} from "./manager.mjs";
import { resolveComputerEngine } from "./engine.mjs";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

/**
 * Ensure computer HTTP server is healthy. Starts it if needed.
 * @param {object} cfg
 * @param {{ root?: string, attempts?: number, log?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, started: boolean, url: string, remote?: boolean, error?: string }>}
 */
export async function ensureComputer(cfg, opts = {}) {
  const root = opts.root || DEFAULT_ROOT;
  const attempts = opts.attempts ?? 3;
  const log = opts.log !== false;
  // The health probes derive their own address with computerBaseUrl; deriving it
  // a second time here let this copy drift, and it dropped the remoteUrl branch.
  // A remote deployment was therefore probed correctly but reported — and tried
  // to heal — as if the computer were local.
  const url = computerBaseUrl(cfg);
  const engine = resolveComputerEngine(cfg);
  if (log) {
    console.error(`[xclaw] ensureComputer engine=${engine} target=${url}`);
  }

  // computer.remoteUrl is this codebase's "not our process" predicate (see
  // reuseEnabled in agent/computer-client.mjs). Starting a local server cannot
  // make a remote endpoint healthy: it leaves a stray process behind while every
  // probe still goes to the remote.
  if (cfg.computer?.remoteUrl) {
    if (await isComputerRunning(cfg)) {
      return { ok: true, started: false, url, engine, remote: true };
    }
    const error = `Remote computer not healthy at ${url} — not starting a local server (computer.remoteUrl is set)`;
    if (log) console.error(`[xclaw] ${error}`);
    return { ok: false, started: false, url, engine, remote: true, error };
  }

  for (let i = 0; i < attempts; i++) {
    if (await isComputerRunning(cfg)) {
      return { ok: true, started: false, url, engine };
    }
    if (log) {
      console.error(
        `[xclaw] computer not healthy at ${url} (attempt ${i + 1}/${attempts}) — starting ${engine}…`
      );
    }
    try {
      await startComputer({ root });
      if (await waitForHealthy(cfg, { timeoutMs: 25_000 })) {
        return { ok: true, started: true, url, engine };
      }
    } catch (err) {
      if (log) console.error(`[xclaw] computer start failed: ${err.message}`);
      if (i === attempts - 1) {
        return { ok: false, started: false, url, engine, error: err.message };
      }
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  // Giving up used to be the one outcome that printed nothing: the attempt lines
  // are identical whether the server came up or never did.
  const error = `Computer not healthy at ${url} after ${attempts} attempts`;
  if (log) console.error(`[xclaw] ${error}`);
  return { ok: false, started: false, url, engine, error };
}
