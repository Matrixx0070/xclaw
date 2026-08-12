/**
 * Evidence log: factual claims should cite tool results.
 */

export function createEvidenceLog() {
  const items = [];
  let seq = 0;

  function add(entry) {
    const id = entry.id || `ev_${++seq}`;
    const item = {
      id,
      toolCallId: entry.toolCallId || null,
      source: entry.source || "system",
      summary: String(entry.summary || "").slice(0, 2000),
      at: entry.at || Date.now(),
    };
    items.push(item);
    return item;
  }

  function fromToolTrace(toolTrace = []) {
    for (const t of toolTrace) {
      add({
        source: "tool",
        toolCallId: t.id || t.tool_call_id || null,
        summary: `${t.name || "tool"} → ${String(t.result || "").slice(0, 400)}`,
      });
    }
  }

  function snapshot() {
    return items.map((i) => ({ ...i }));
  }

  function toolCount() {
    return items.filter((i) => i.source === "tool").length;
  }

  return { add, fromToolTrace, snapshot, toolCount, get items() { return items; } };
}

/**
 * Flag ungrounded / invented claims.
 */
export function flagUngroundedClaims(finalText, evidence, opts = {}) {
  const text = String(finalText || "");
  if (!text.trim()) return [];
  const hard = Boolean(opts.hard);
  const list = evidence || [];
  const hasToolEvidence = list.some((e) => e.source === "tool");
  const hasAnyEvidence = list.length > 0;
  const warnings = [];

  const actionClaim =
    /\b(I (created|wrote|fixed|updated|deleted|ran|executed|read)|file now contains|successfully (wrote|created|fixed))\b/i.test(
      text
    );
  if (actionClaim && !hasToolEvidence) {
    warnings.push("Final text asserts tool actions without tool evidence");
  }

  if (
    !hasToolEvidence &&
    /\b(the file (says|contains|reads)|according to [a-z0-9_./-]+\.(md|txt|json|log))\b/i.test(text)
  ) {
    warnings.push("Final text cites file contents without tool evidence");
  }

  if (hard && !hasToolEvidence && /["'].{20,}["']/.test(text) && !/\b(NO_|MISSING_)/i.test(text)) {
    warnings.push("Hard mode: quoted content without tool evidence");
  }

  if (hard && actionClaim && !hasAnyEvidence) {
    warnings.push("Hard mode: empty evidence log with action claims");
  }

  return warnings;
}

export function groundingShouldFail(warnings, opts = {}) {
  if (!warnings?.length) return false;
  if (opts.hard) return true;
  return warnings.some((w) => /without tool evidence/i.test(w));
}
