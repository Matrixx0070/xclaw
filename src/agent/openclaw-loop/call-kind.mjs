/**
 * Adapted from OpenClaw (MIT) — src/agents/tool-loop-call-kind.ts
 */
function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** OpenClaw poll tools + XClaw equivalents */
export function isKnownPollToolCall(toolName, params) {
  if (toolName === "command_status") return true;
  if (toolName === "process" && isPlainObject(params)) {
    const action = params.action;
    return action === "poll" || action === "log";
  }
  // XClaw: repeated browser status-style tools
  if (toolName === "xclaw_browser_tab" && isPlainObject(params)) {
    return params.action === "status" || params.action === "poll";
  }
  return false;
}
