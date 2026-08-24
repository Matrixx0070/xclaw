/**
 * A5 — Resolve chrome-args.mjs from computer process and build argv.
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function candidates() {
  const roots = [];
  if (process.env.XCLAW_CHROME_ARGS_PATH) return [process.env.XCLAW_CHROME_ARGS_PATH];
  if (process.env.XCLAW_ROOT) roots.push(process.env.XCLAW_ROOT);
  roots.push(process.cwd());
  roots.push(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."));
  return roots.map((r) => path.join(r, "src/computer/chrome-args.mjs"));
}

let _mod = null;

export async function loadChromeArgsModule() {
  if (_mod) return _mod;
  for (const p of candidates()) {
    try {
      if (!fs.existsSync(p)) continue;
      _mod = await import(pathToFileURL(path.resolve(p)).href);
      return _mod;
    } catch (e) {
      console.error("[chrome-args-bridge]", p, e?.message || e);
    }
  }
  return null;
}

/**
 * Prefer shared builder; fall back to baseArgs if module missing.
 */
export async function resolveChromeArgs(opts, baseArgs) {
  const m = await loadChromeArgsModule();
  if (m?.buildChromeArgs) {
    try {
      return m.buildChromeArgs(opts);
    } catch (e) {
      console.error("[chrome-args-bridge] build failed:", e?.message || e);
    }
  }
  return Array.isArray(baseArgs) ? baseArgs : [];
}
