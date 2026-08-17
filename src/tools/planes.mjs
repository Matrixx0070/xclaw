/**
 * T0 — Tool plane classification for XClaw Tool Router.
 *
 * Planes:
 *   computer  — remote/native computer process (bash, files, browser)
 *   local     — in-process Node tools (media, finance, host utils, …)
 *   search    — allowlisted network search only (no shell)
 *   mcp       — MCP / connected servers
 *   agent     — meta (spawn subagent, recall) handled by agent loop itself
 *
 * Concurrency:
 *   parallel-safe — may run concurrently with other parallel-safe tools
 *   serial        — must not interleave with other serial tools in the same batch
 */

/** @typedef {"computer"|"local"|"search"|"mcp"|"agent"|"unknown"} Plane */
/** @typedef {"parallel-safe"|"serial"} ConcurrencyClass */

/**
 * Canonical name → plane. Unknown names default via inferPlane().
 * @type {Record<string, Plane>}
 */
export const TOOL_PLANE = {
  // Computer (Strategy C modules / thin or bundle server)
  xclaw_bash: "computer",
  bash: "computer",
  shell: "computer",
  exec: "computer",
  xclaw_exec: "computer",
  run_terminal: "computer",
  xclaw_file_read: "computer",
  file_read: "computer",
  read_file: "computer",
  xclaw_file_write: "computer",
  file_write: "computer",
  write_file: "computer",
  xclaw_file_edit: "computer",
  file_edit: "computer",
  edit_file: "computer",
  xclaw_file_list: "computer",
  list_dir: "computer",
  xclaw_browser_tab: "computer",
  browser_tab: "computer",
  xclaw_browser_network_details: "computer",
  browser_network_details: "computer",

  // Local (src/tools/*)
  xclaw_image_search: "local",
  xclaw_image_generate: "local",
  xclaw_view_x_video: "local",
  view_x_video: "local",
  xclaw_ocr: "local",
  xclaw_document_convert: "local",
  xclaw_finance_quote: "local",
  xclaw_host_info: "local",
  xclaw_skill: "local",
  xclaw_web_fetch: "local",

  // Search plane (router target; may execute via local until worker exists)
  web_search: "search",
  xclaw_web_search: "search",

  // MCP / connected
  xclaw_mcp_search: "mcp",
  xclaw_mcp_call: "mcp",
  search_connected_tools: "mcp",
  call_connected_tool: "mcp",

  // Agent-loop meta (not dispatched via computer)
  xclaw_spawn_subagent: "agent",
  xclaw_recall: "agent",
  recall: "agent",
};

/**
 * Tools that may run concurrently with other parallel-safe tools.
 * @type {Set<string>}
 */
/** CUA actuation (click/type/screenshot) must stay serial — never add to PARALLEL_SAFE */
export const CUA_SERIAL_ACTUATION = new Set([
  "xclaw_browser_tab", // when action is click/type; native blocks these
  "browser_tab",
  "xclaw_computer_act",
  "computer_act",
]);

export const PARALLEL_SAFE = new Set([
  "xclaw_file_read",
  "file_read",
  "read_file",
  "xclaw_file_list",
  "list_dir",
  "xclaw_host_info",
  "xclaw_ocr",
  "xclaw_finance_quote",
  "xclaw_image_search",
  "web_search",
  "xclaw_web_search",
  "xclaw_web_fetch",
  "xclaw_recall",
  "recall",
  "xclaw_mcp_search",
  "search_connected_tools",
]);

/**
 * @param {string} name
 * @returns {Plane}
 */
export function inferPlane(name) {
  const n = String(name || "").toLowerCase();
  if (TOOL_PLANE[n]) return TOOL_PLANE[n];
  const stripped = n.replace(/^xclaw_/, "");
  if (TOOL_PLANE[stripped]) return TOOL_PLANE[stripped];
  if (/bash|shell|exec|terminal/.test(n)) return "computer";
  if (/file_|read_file|write_file|edit_file|list_dir/.test(n)) return "computer";
  if (/browser|cdp|screenshot|navigate/.test(n)) return "computer";
  if (/mcp|connected/.test(n)) return "mcp";
  if (/search|web_search/.test(n)) return "search";
  if (/spawn|subagent|recall|memory/.test(n)) return "agent";
  return "local";
}

/**
 * @param {string} name
 * @returns {Plane}
 */
export function getPlane(name) {
  const n = String(name || "").toLowerCase();
  return TOOL_PLANE[n] || inferPlane(n);
}

/**
 * @param {string} name
 * @returns {ConcurrencyClass}
 */
export function getConcurrencyClass(name) {
  const n = String(name || "").toLowerCase();
  if (PARALLEL_SAFE.has(n)) return "parallel-safe";
  if (PARALLEL_SAFE.has(n.replace(/^xclaw_/, ""))) return "parallel-safe";
  if (/_read$|^read_|list_|search|ocr|fetch|info|status|probe/.test(n)) {
    return "parallel-safe";
  }
  return "serial";
}

/**
 * @param {string} name
 * @returns {{ name: string, plane: Plane, concurrency: ConcurrencyClass }}
 */
export function classifyTool(name) {
  const n = String(name || "").trim();
  return {
    name: n,
    plane: getPlane(n),
    concurrency: getConcurrencyClass(n),
  };
}

/**
 * Partition tool calls into parallel-safe batch + serial queue (stable order).
 * @param {Array<{ name?: string, tool?: string, function?: { name?: string } }>} calls
 */
export function partitionByConcurrency(calls = []) {
  const parallel = [];
  const serial = [];
  for (const c of calls) {
    const name = c.name || c.tool || c.function?.name;
    if (getConcurrencyClass(name) === "parallel-safe") parallel.push(c);
    else serial.push(c);
  }
  return { parallel, serial };
}

/**
 * @typedef {object} ToolCallRequest
 * @property {string} callId
 * @property {string} sessionId
 * @property {string} name
 * @property {object} [args]
 * @property {object} [plan]
 * @property {number} [timeoutMs]
 * @property {AbortSignal} [signal]
 * @property {string} [workingDir]
 * @property {object} [cfg]
 */

/**
 * @typedef {object} ToolCallResult
 * @property {string} callId
 * @property {string} name
 * @property {Plane} plane
 * @property {boolean} ok
 * @property {any} [result]
 * @property {string} [error]
 * @property {number} [durationMs]
 * @property {boolean} [blocked]
 */


/** Tools that MUST run on the computer plane (never in-process local). */
export const COMPUTER_ONLY_TOOLS = new Set(
  Object.entries(TOOL_PLANE)
    .filter(([, plane]) => plane === "computer")
    .map(([name]) => name)
);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isComputerOnlyTool(name) {
  const n = String(name || "").toLowerCase();
  if (COMPUTER_ONLY_TOOLS.has(n)) return true;
  if (getPlane(n) === "computer") return true;
  return false;
}

export default {
  TOOL_PLANE,
  PARALLEL_SAFE,
  COMPUTER_ONLY_TOOLS,
  getPlane,
  getConcurrencyClass,
  classifyTool,
  partitionByConcurrency,
  inferPlane,
  isComputerOnlyTool,
};
