/**
 * /extraction — engine composition report.
 *
 * Historical purpose: track extraction progress out of the vendored CDP
 * bundle. Unification is COMPLETE, but in the direction ADR 0006 set
 * (2026-08-24, reversing ADR 0005): the bundle `xclaw-server.mjs` is the one
 * computer server and the native module tree is the maintained source it
 * bridges to. The endpoint stays (frozen surface) and reports that state —
 * it previously reported ADR 0005's retired-bundle shape, which is the
 * opposite of what ships.
 */

import { listNativeTools } from "./native-tools.mjs";
import { resolveComputerEngine } from "./engine.mjs";

/**
 * @returns {Promise<object>}
 */
export async function getExtractionStatus() {
  const native = listNativeTools();
  return {
    ok: true,
    complete: true,
    engine: resolveComputerEngine(),
    cleanNativeTools: native.map((t) => t.name),
    browser: {
      runtime: "managed headless Chrome (chrome-session.mjs) + CDP tab layer (modules/browser-cdp.mjs)",
      capabilities: [
        "render navigate",
        "jsCode",
        "screenshot (viewport/desktop/mobile/both, full PNG to disk)",
        "console capture",
        "multi-request network capture",
        "click/type via CDP motor",
      ],
    },
    note:
      "Engine unification complete (ADR 0006, 2026-08-24) — the bundle xclaw-server.mjs is the single computer server, carrying the retired thin server's functions via the A6 merge patch; these native modules are its maintained source.",
  };
}

export async function printExtractionStatus() {
  const s = await getExtractionStatus();
  console.log(JSON.stringify(s, null, 2));
  return s;
}

export default { getExtractionStatus, printExtractionStatus };
