/**
 * Maintained tool registry — the single source of computer tools.
 * thin-server / native-tools resolve every tool here.
 */

import { BashTool, runBash } from "./bash-tool.mjs";
import {
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  fileRead,
  fileWrite,
  fileEdit,
} from "./file-tools.mjs";
import { BrowserTabTool, runBrowserTab } from "./browser-tab-tool.mjs";
import {
  BrowserNetworkDetailsTool,
  runBrowserNetworkDetails,
} from "./browser-network-details-tool.mjs";
import { ComputerActTool, runComputerAct } from "./computer-act-tool.mjs";

/** @typedef {{ name: string, description: any, inputSchema?: object, call: Function }} ComputerTool */

/** @type {ComputerTool[]} */
export const MAINTAINED_TOOLS = [
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  BrowserTabTool,
  BrowserNetworkDetailsTool,
  ComputerActTool,
];

export function listMaintainedTools() {
  return MAINTAINED_TOOLS.map((t) => ({
    name: t.name,
    description:
      typeof t.description === "function" ? t.description() : t.description,
    parameters: t.inputSchema || { type: "object", properties: {} },
    source: "maintained-module",
  }));
}

export async function executeMaintainedTool(name, args = {}, ctx = {}) {
  const n = String(name || "");
  const tool = MAINTAINED_TOOLS.find(
    (t) => t.name === n || t.name === `xclaw_${n}` || n === t.name.replace(/^xclaw_/, "")
  );
  if (!tool) {
    return { ok: false, error: `Unknown maintained tool: ${name}`, code: "UNKNOWN_TOOL" };
  }
  const out = await tool.call(args, ctx);
  return out?.data ?? out;
}

export function getTool(name) {
  return MAINTAINED_TOOLS.find((t) => t.name === name) || null;
}

export {
  BashTool,
  runBash,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  fileRead,
  fileWrite,
  fileEdit,
  BrowserTabTool,
  runBrowserTab,
  BrowserNetworkDetailsTool,
  runBrowserNetworkDetails,
  ComputerActTool,
  runComputerAct,
};

export default {
  MAINTAINED_TOOLS,
  listMaintainedTools,
  executeMaintainedTool,
  getTool,
};
