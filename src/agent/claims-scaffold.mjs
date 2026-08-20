/**
 * The model is asked to append a ```json {"claims":…,"evidence_ids":…} ``` block
 * for internal grounding. It is scaffold, not an answer, so every user-facing
 * surface strips it. Kept in its own module because streaming clients (the TUI)
 * need the same rules as the agent loop without importing the whole loop.
 */

/** Strip a complete trailing claims block (fenced or bare) from finished text. */
export function stripClaimsBlock(text) {
  let s = String(text ?? "");
  // fenced ```json { "claims": … } ``` at the end
  s = s.replace(/\n*```(?:json)?\s*\{[\s\S]*?"claims"[\s\S]*?\}\s*```\s*$/i, "");
  // bare trailing {"claims":…,"evidence_ids":…} object (no fence)
  s = s.replace(/\n*\{\s*"claims"\s*:[\s\S]*?"evidence_ids"\s*:[\s\S]*?\}\s*$/i, "");
  return s.trimEnd();
}

const CLAIMS_HEAD = '{"claims"';

/**
 * Strip the scaffold from a *partially streamed* buffer. A finished block is
 * removed as usual; a half-arrived one is hidden as soon as its opening fence
 * plus first characters can only be a claims object, so the scaffold never
 * types itself out in front of the user. A fence that turns out to be a real
 * code block reappears on the next token.
 */
export function stripLiveScaffold(text) {
  const raw = String(text ?? "");
  const s = stripClaimsBlock(raw);
  const removed = s !== raw.trimEnd();
  const m = s.match(/\n*```(?:json)?[ \t]*\n?([\s\S]*)$/);
  if (!m) return s;
  const tail = m[1];
  if (tail.includes("```")) return s; // fence already closed — a real code block
  const seen = tail.replace(/\s+/g, "");
  // Nothing after the fence: either the object has not arrived yet (keep — it
  // may be a real code block) or the strip above just orphaned its opening fence.
  if (!seen) return removed ? s.slice(0, m.index).trimEnd() : s;
  if (seen.startsWith(CLAIMS_HEAD) || CLAIMS_HEAD.startsWith(seen)) {
    return s.slice(0, m.index).trimEnd();
  }
  return s;
}
