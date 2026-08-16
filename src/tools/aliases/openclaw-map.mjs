/**
 * Wave A — OpenClaw-oriented tool names → XClaw tools.
 * Used when adapting WildClawBench prompts / skills to this harness.
 */
export const OPENCLAW_TO_XCLAW = {
  exec: "xclaw_bash",
  bash: "xclaw_bash",
  shell: "xclaw_bash",
  terminal: "xclaw_bash",
  run_terminal: "xclaw_bash",
  read: "xclaw_file_read",
  read_file: "xclaw_file_read",
  write: "xclaw_file_write",
  write_file: "xclaw_file_write",
  edit: "xclaw_file_edit",
  edit_file: "xclaw_file_edit",
  list: "xclaw_file_list",
  ls: "xclaw_file_list",
  browser: "xclaw_browser_tab",
  browser_tab: "xclaw_browser_tab",
  web_search: "xclaw_web_search",
  search: "xclaw_web_search",
  web_fetch: "xclaw_web_fetch",
  fetch: "xclaw_web_fetch",
  http_get: "xclaw_web_fetch",
  inbox: "xclaw_mail_inbox",
  gmail_inbox: "xclaw_mail_inbox",
  send_email: "xclaw_mail_send",
  read_email: "xclaw_mail_read",
  slack_list: "xclaw_chat_list",
};


/**
 * Rewrite prompt text for XClaw workspace + tools.
 * @param {string} prompt
 */
export function adaptWildClawPrompt(prompt) {
  let p = String(prompt || "");
  p = p.replaceAll("/tmp_workspace/", "./");
  p = p.replaceAll("/tmp_workspace", ".");
  p = p.replace(
    /OpenClaw/gi,
    "XClaw"
  );
  p +=
    "\n\n---\nXClaw harness notes:\n" +
    "- Workspace is the current working directory. Prefer relative paths under results/.\n" +
    "- Tools: xclaw_bash, xclaw_file_*, xclaw_web_*, xclaw_browser_tab, xclaw_mail_inbox, xclaw_mail_read, xclaw_mail_send, xclaw_chat_list.\n" +
    "- Do not ask the user to perform steps you can do with tools.\n" +
    "- When finished, ensure required output files exist under results/ when the task asks for saved files.\n";
  return p;
}

export default { OPENCLAW_TO_XCLAW, adaptWildClawPrompt };
