/**
 * Native computer tool pack — CLEAN modules preferred over bundle references.
 * Used when cfg.computer.nativeTools === true or as fallback inventory for extraction status.
 */

import { BashTool, runBash } from "./modules/bash-tool.mjs";
import {
  FileReadTool,
  FileWriteTool,
  FileEditTool,
} from "./modules/file-tools.mjs";
import { BrowserTabTool } from "./modules/browser-tab-tool.mjs";

export const NATIVE_TOOLS = [
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  BrowserTabTool,
];

export function listNativeTools() {
  return NATIVE_TOOLS.map((t) => ({
    name: t.name,
    description:
      typeof t.description === "function" ? t.description() : t.description,
    parameters: t.inputSchema,
    source: "native-clean",
  }));
}

/**
 * Execute by tool name.
 */
export async function executeNativeTool(name, args = {}, ctx = {}) {
  const tool = NATIVE_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { ok: false, error: `Unknown native tool: ${name}` };
  }
  const out = await tool.call(args, ctx);
  return out?.data ?? out;
}

/**
 * OpenAI function-tool shapes for agent loop (optional local path).
 */
export function nativeToolsAsOpenAI() {
  return NATIVE_TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description:
        typeof t.description === "function" ? t.description() : t.description,
      parameters: t.inputSchema,
    },
  }));
}

export { runBash, BashTool, FileReadTool, FileWriteTool, FileEditTool };

export default {
  listNativeTools,
  executeNativeTool,
  nativeToolsAsOpenAI,
  NATIVE_TOOLS,
};
