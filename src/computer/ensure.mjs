/**
 * Robust computer readiness: health probe + start + wait with retries.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isComputerRunning,
  startComputer,
  waitForHealthy,
} from "./manager.mjs";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

/**
 * Ensure computer HTTP server is healthy. Starts it if needed.
 * @param {object} cfg
 * @param {{ root?: string, attempts?: number, log?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, started: boolean, url: string, error?: string }>}
 */
export async function ensureComputer(cfg, opts = {}) {
  const root = opts.root || DEFAULT_ROOT;
  const attempts = opts.attempts ?? 3;
  const log = opts.log !== false;
  let host = cfg.computer?.host || "127.0.0.1";
  if (host === "0.0.0.0" || host === "::" || host === "[::]") host = "127.0.0.1";
  const port = cfg.computer?.port || 4243;
  const url = `http://${host}:${port}`;

  for (let i = 0; i < attempts; i++) {
    if (await isComputerRunning(cfg)) {
      return { ok: true, started: false, url };
    }
    if (log) {
      console.error(
        `[xclaw] computer not healthy at ${url} (attempt ${i + 1}/${attempts}) — starting…`
      );
    }
    try {
      await startComputer({ root });
      if (await waitForHealthy(cfg, { timeoutMs: 25_000 })) {
        return { ok: true, started: true, url };
      }
    } catch (err) {
      if (log) console.error(`[xclaw] computer start failed: ${err.message}`);
      if (i === attempts - 1) {
        return { ok: false, started: false, url, error: err.message };
      }
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return {
    ok: false,
    started: false,
    url,
    error: `Computer not healthy at ${url} after ${attempts} attempts`,
  };
}
