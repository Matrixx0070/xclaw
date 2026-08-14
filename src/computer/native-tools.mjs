/**
 * Native computer tool pack — Strategy C2 via modules/registry.mjs.
 */

import {
  MAINTAINED_TOOLS,
  listMaintainedTools,
  executeMaintainedTool,
  runBash,
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  BrowserTabTool,
  BrowserNetworkDetailsTool,
} from "./modules/registry.mjs";

export const NATIVE_TOOLS = MAINTAINED_TOOLS;

export function listNativeTools() {
  return listMaintainedTools().map((t) => ({
    ...t,
    source: "native-clean",
  }));
}

export async function executeNativeTool(name, args = {}, ctx = {}) {
  return executeMaintainedTool(name, args, ctx);
}

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

export { runBash, BashTool, FileReadTool, FileWriteTool, FileEditTool, BrowserTabTool, BrowserNetworkDetailsTool };

export default {
  listNativeTools,
  executeNativeTool,
  nativeToolsAsOpenAI,
  NATIVE_TOOLS,
};
