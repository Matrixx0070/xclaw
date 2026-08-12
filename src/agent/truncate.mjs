/**
 * Tool result truncation for XClaw agent loop.
 * Keeps prompts smaller → fewer uncached tokens → better cache / lower cost.
 */

const DEFAULTS = {
  maxChars: 4000,
  headChars: 2800,
  tailChars: 800,
  maxLineLength: 500,
  notice: true,
};

export function truncateLine(line, maxLen = 500) {
  if (line.length <= maxLen) return line;
  const keep = Math.max(32, Math.floor(maxLen / 2) - 2);
  return line.slice(0, keep) + " … " + line.slice(-keep);
}

/**
 * Head/tail truncate with omission marker.
 */
export function truncateToolResult(text, opts = {}) {
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const headChars = opts.headChars ?? DEFAULTS.headChars;
  const tailChars = opts.tailChars ?? DEFAULTS.tailChars;
  const maxLineLength = opts.maxLineLength ?? DEFAULTS.maxLineLength;
  const notice = opts.notice !== false;

  const original = text == null ? "" : String(text);
  const originalChars = original.length;
  if (!original) {
    return { text: "", truncated: false, originalChars: 0, keptChars: 0 };
  }

  let work = original;
  if (maxLineLength > 0 && work.includes("\n")) {
    work = work
      .split("\n")
      .map((ln) => truncateLine(ln, maxLineLength))
      .join("\n");
  }

  if (work.length <= maxChars) {
    return {
      text: work,
      truncated: work.length !== originalChars,
      originalChars,
      keptChars: work.length,
    };
  }

  const head = Math.min(headChars, maxChars);
  const tailBudget = Math.max(0, maxChars - head);
  const marker = notice
    ? `\n\n…[truncated ${work.length - head - Math.min(tailChars, tailBudget)} of ${originalChars} chars; head ${head} + tail]…\n\n`
    : "\n…\n";
  const tail = Math.min(tailChars, Math.max(0, maxChars - head - marker.length));
  const textOut = work.slice(0, head) + marker + (tail > 0 ? work.slice(-tail) : "");

  return {
    text: textOut,
    truncated: true,
    originalChars,
    keptChars: textOut.length,
    omittedChars: Math.max(0, originalChars - textOut.length),
  };
}

export function truncationOptsFromConfig(cfg = {}, toolName = null) {
  const t = cfg.tokens?.truncate || cfg.agent?.truncate || {};
  const per = (t.perTool || {})[toolName] || (t.perTool || {})[normalizeTool(toolName)] || {};
  return {
    maxChars: per.maxChars ?? t.maxChars ?? cfg.tokens?.toolResultMaxChars ?? 4000,
    headChars: per.headChars ?? t.headChars ?? 2800,
    tailChars: per.tailChars ?? t.tailChars ?? 800,
    maxLineLength: per.maxLineLength ?? t.maxLineLength ?? 500,
    notice: t.notice !== false,
    enabled: t.enabled !== false,
    toolName: toolName || null,
  };
}

function normalizeTool(name) {
  if (!name) return "";
  const n = String(name).toLowerCase();
  if (n.includes("bash") || n.includes("shell")) return "bash";
  if (n.includes("browser")) return "browser";
  if (n.includes("read") || n.includes("file_read")) return "file_read";
  if (n.includes("write") || n.includes("file_write")) return "file_write";
  return n;
}
