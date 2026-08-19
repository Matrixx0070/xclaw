/**
 * Tool allowlist filter for agent runs (cfg.agent.allowTools).
 *
 * Scopes which tools a run advertises to the model AND which it will
 * dispatch — both sides enforced, so an excluded tool is invisible to the
 * model and blocked even if the model hallucinates its name.
 *
 * Patterns are exact names or trailing-* globs ("xclaw_file_*", "mcp__*").
 * An empty/absent list means no filtering (every assembled tool available).
 * The filter narrows availability only — it never bypasses the approval
 * gate, hooks, or sandbox for the tools it allows.
 */

/**
 * @param {string[]|null|undefined} allow
 * @returns {{ match(name: string): boolean, allowsPrefix(prefix: string): boolean, patterns: string[] } | null}
 */
export function compileToolFilter(allow) {
  if (!Array.isArray(allow)) return null;
  const patterns = allow.map((p) => String(p || "").trim()).filter(Boolean);
  if (!patterns.length) return null;
  const exact = new Set();
  const prefixes = [];
  let matchAll = false;
  for (const p of patterns) {
    if (p === "*") matchAll = true;
    else if (p.endsWith("*")) prefixes.push(p.slice(0, -1));
    else exact.add(p);
  }
  return {
    patterns,
    match(name) {
      const n = String(name || "");
      if (matchAll) return true;
      if (exact.has(n)) return true;
      return prefixes.some((pre) => n.startsWith(pre));
    },
    /**
     * Could ANY tool name starting with `prefix` pass this filter?
     * Used to skip whole planes up front (e.g. don't connect MCP servers
     * when no "mcp__…" name can ever match).
     */
    allowsPrefix(prefix) {
      const pre = String(prefix || "");
      if (matchAll) return true;
      for (const e of exact) if (e.startsWith(pre)) return true;
      return prefixes.some(
        (p) => p.startsWith(pre) || pre.startsWith(p)
      );
    },
  };
}

/**
 * Filter OpenAI-shaped tool defs ({type:"function",function:{name}}).
 * @param {object[]} tools
 * @param {{match(name:string):boolean}|null} filter
 */
export function filterToolDefs(tools, filter) {
  if (!filter) return tools;
  return tools.filter((t) => filter.match(t?.function?.name));
}

/**
 * Allowlist entries that name a tool which does not exist this run.
 *
 * These used to be dropped in silence, so an operator could allow
 * `xclaw_file_list` and believe the agent could list directories while the
 * model was never given the tool. Aliases are not a gap: `x` and `xclaw_x`
 * count as one capability, so listing both spellings reports nothing.
 *
 * @param {string[]} patterns allowlist patterns
 * @param {string[]} availableNames tool names present before filtering
 * @returns {string[]} literal patterns that matched no available capability
 */
export function missingAllowedTools(patterns = [], availableNames = []) {
  const capability = (n) => String(n).replace(/^xclaw_/, "");
  const available = new Set(availableNames.filter(Boolean));
  const haveCaps = new Set([...available].map(capability));
  return (patterns || []).filter(
    (pat) =>
      typeof pat === "string" &&
      pat &&
      !/[*?]/.test(pat) &&
      !available.has(pat) &&
      !haveCaps.has(capability(pat))
  );
}
