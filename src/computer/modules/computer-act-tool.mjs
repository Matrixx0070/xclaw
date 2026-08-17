/**
 * I2 stub — unified computer actuation entry (CUA).
 *
 * Native: always fails closed with CUA_ACT_REQUIRES_BUNDLE unless action is observe-only.
 * Bundle/CDP: future path will dispatch to Horizon motor + Input.dispatch*.
 *
 * Policy: tools → observe → act. Do not invent coordinates on native.
 */

/**
 * @param {object} input
 * @param {string} [input.action] click|type|key|scroll|screenshot|observe
 * @param {string} [input.tabId]
 * @param {string} [input.ref] element ref from observe
 * @param {number} [input.x]
 * @param {number} [input.y]
 * @param {string} [input.text]
 * @param {string} [input.key]
 */
export async function runComputerAct(input = {}) {
  const action = String(input.action || "click").toLowerCase();
  if (action === "observe") {
    return {
      ok: false,
      error:
        "Use xclaw_browser_tab with action=observe (structure). computer_act is for GUI actuation only.",
      code: "USE_BROWSER_OBSERVE",
      engine: process.env.XCLAW_COMPUTER_ENGINE || "native",
    };
  }

  const engine = process.env.XCLAW_COMPUTER_ENGINE || "native";
  const cdp = process.env.XCLAW_CDP_URL || process.env.CDP_URL || null;
  const canAct = engine === "bundle" || engine === "generated" || Boolean(cdp);

  if (!canAct) {
    return {
      ok: false,
      error:
        "GUI actuation (click/type/key/scroll/screenshot) requires CDP bundle or XCLAW_CDP_URL. Prefer tools/APIs, then xclaw_browser_tab action=observe.",
      code: "CUA_ACT_REQUIRES_BUNDLE",
      engine: engine === "thin" ? "native" : engine,
      cuaPolicy: "tools_first_then_observe_then_gui",
      hint: "XCLAW_COMPUTER_ENGINE=bundle or export XCLAW_CDP_URL=http://127.0.0.1:9222",
    };
  }

  // Bundle path not yet wired to Horizon motor in CLEAN modules (I2 complete = wire here).
  return {
    ok: false,
    error:
      "CDP/bundle actuation path not yet extracted to CLEAN modules. BrowserService remains bundle-only (BUNDLE_ONLY_REGIONS). See docs/COMPUTER_USE_BACKEND.md I2.",
    code: "CUA_ACT_NOT_EXTRACTED",
    engine,
    cdpAttach: Boolean(cdp),
    requested: {
      action,
      tabId: input.tabId || null,
      ref: input.ref || null,
      hasCoords: input.x != null && input.y != null,
    },
  };
}

export const ComputerActTool = {
  name: "xclaw_computer_act",
  description:
    "CUA GUI actuation (click/type/key/scroll/screenshot). Requires bundle or XCLAW_CDP_URL. Prefer connectors/tools and xclaw_browser_tab observe first. Native engine fails closed.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "click | type | key | scroll | screenshot",
      },
      tabId: { type: "string" },
      ref: { type: "string", description: "Element ref from observe" },
      x: { type: "number" },
      y: { type: "number" },
      text: { type: "string" },
      key: { type: "string" },
    },
  },
  isReadOnly: () => false,
  async call(input, _ctx = {}) {
    const data = await runComputerAct(input || {});
    return { data };
  },
};

export default ComputerActTool;
