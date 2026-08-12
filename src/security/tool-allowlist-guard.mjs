/**
 * Adapted from OpenClaw (MIT) — src/agents/tool-allowlist-guard.ts
 * https://github.com/openclaw/openclaw
 *
 * Explicit tool allowlist guard.
 */
function normalizeStringEntries(entries = []) {
  const out = [];
  for (const e of entries || []) {
    if (e == null) continue;
    const s = String(e).trim();
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

function normalizeToolName(name) {
  return String(name || "").trim().toLowerCase();
}

function normalizeToolList(names = []) {
  return normalizeStringEntries(names).map(normalizeToolName);
}

/**
 * Normalize explicit allowlist sources, dropping empty source entries.
 */
export function collectExplicitToolAllowlistSources(sources = []) {
  return sources.flatMap((source) => {
    const entries = normalizeStringEntries(source.allow);
    if (entries.length === 0) return [];
    return [
      {
        label: source.label,
        entries,
        ...(source.enforceWhenToolsDisabled === true
          ? { enforceWhenToolsDisabled: true }
          : {}),
      },
    ];
  });
}

/**
 * Build an actionable error when explicit allowlists remove every callable tool.
 */
export function buildEmptyExplicitToolAllowlistError(params = {}) {
  const toolsIntentionallyDisabled =
    params.disableTools === true || params.toolsAllowExplicitlyEmpty === true;
  const sources = toolsIntentionallyDisabled
    ? (params.sources || []).filter((s) => s.enforceWhenToolsDisabled === true)
    : params.sources || [];
  const callableToolNames = normalizeToolList(params.callableToolNames);
  if (sources.length === 0 || callableToolNames.length > 0) return null;

  const requested = sources
    .map((source) => `${source.label}: ${source.entries.map(normalizeToolName).join(", ")}`)
    .join("; ");
  const reason =
    params.disableTools === true
      ? "tools are disabled for this run"
      : params.toolsEnabled
        ? "no registered tools matched"
        : "the selected model does not support tools";
  return new Error(
    `No callable tools remain after resolving explicit tool allowlist (${requested}); ${reason}. Fix the allowlist or enable the plugin that registers the requested tool.`
  );
}

/**
 * Resolve intersection of allowlist sources against registered tool names.
 */
export function resolveAllowedToolNames(params = {}) {
  const registered = normalizeToolList(params.registeredTools || []);
  const sources = collectExplicitToolAllowlistSources(params.sources || []);
  if (sources.length === 0) return registered;

  const allowed = new Set();
  for (const source of sources) {
    for (const entry of source.entries) {
      const n = normalizeToolName(entry);
      if (n === "*") {
        for (const r of registered) allowed.add(r);
        continue;
      }
      if (registered.includes(n)) allowed.add(n);
    }
  }
  return [...allowed];
}

export function isToolNameAllowlisted(toolName, allowedList) {
  if (!allowedList || allowedList.length === 0) return true;
  const n = normalizeToolName(toolName);
  const set = new Set(allowedList.map(normalizeToolName));
  return set.has("*") || set.has(n);
}

export { normalizeToolName, normalizeToolList, normalizeStringEntries };
