/**
 * /extraction — engine composition report.
 *
 * Historical purpose: track extraction progress out of the vendored CDP
 * bundle. Unification is COMPLETE (ADR 0005, 2026-08-24): every capability
 * runs from maintained native modules; the endpoint stays (frozen surface)
 * and now reports the unified state.
 */

import { listNativeTools } from "./native-tools.mjs";

/**
 * @returns {Promise<object>}
 */
export async function getExtractionStatus() {
  const native = listNativeTools();
  return {
    ok: true,
    complete: true,
    engine: "native",
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
      "Engine unification complete — the vendored CDP bundle was retired 2026-08-24. Archived artifact: GitHub release computer-bundle.",
  };
}

export async function printExtractionStatus() {
  const s = await getExtractionStatus();
  console.log(JSON.stringify(s, null, 2));
  return s;
}

export default { getExtractionStatus, printExtractionStatus };
