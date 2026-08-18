/**
 * Explicit tool policy matrix for prod autonomy.
 * risk: safe | write | exec | network
 */
export const TOOL_RISK = {
  xclaw_file_read: "safe",
  file_read: "safe",
  read_file: "safe",
  xclaw_file_list: "safe",
  list_dir: "safe",
  xclaw_file_write: "write",
  file_write: "write",
  write_file: "write",
  xclaw_bash: "exec",
  bash: "exec",
  shell: "exec",
  xclaw_browser_tab: "network",
  glob: "safe",
  grep: "safe",
  web_fetch: "network",
  web_search: "network",
  browser_tab: "network",
  browser: "network",
};

/**
 * Default allow decisions by profile.
 */
export function matrixDecision(toolName, profile = "prod") {
  const risk = TOOL_RISK[toolName] || TOOL_RISK[String(toolName).toLowerCase()] || "exec";
  if (profile === "lab") return { auto: true, risk };
  if (profile === "dev") {
    return { auto: risk === "safe" || risk === "write", risk };
  }
  // prod
  return {
    auto: risk === "safe",
    risk,
    requireApproval: risk !== "safe",
  };
}

export function buildProdSecurityOverlay() {
  return {
    autoApprove: false,
    approvalPolicy: "risky",
    safeAuto: Object.entries(TOOL_RISK)
      .filter(([, r]) => r === "safe")
      .map(([k]) => k),
    requireApproval: Object.entries(TOOL_RISK)
      .filter(([, r]) => r !== "safe")
      .map(([k]) => k),
  };
}
