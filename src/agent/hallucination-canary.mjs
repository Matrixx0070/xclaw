/**
 * Claim vs tool evidence canary — flag ungrounded assertions.
 */
export function extractClaims(text = "") {
  const lines = String(text)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.filter(
    (l) =>
      /^(I |We |The file |Created |Wrote |Deleted |Confirmed |Verified )/i.test(l) ||
      /successfully|completed|done\./i.test(l)
  );
}

export function evidenceFromTrace(toolTrace = []) {
  const names = new Set();
  for (const t of toolTrace || []) {
    if (t && (t.status === "ok" || t.ok === true)) names.add(String(t.name || t.tool || ""));
  }
  return names;
}

export function runHallucinationCanary({ text = "", toolTrace = [] } = {}) {
  const claims = extractClaims(text);
  const evidence = evidenceFromTrace(toolTrace);
  const ungrounded = [];
  for (const c of claims) {
    const needsTool = /wrote|created|deleted|file|ran|executed|browser/i.test(c);
    if (needsTool && evidence.size === 0) ungrounded.push(c);
  }
  return {
    ok: ungrounded.length === 0,
    claims: claims.length,
    ungrounded,
    evidenceTools: [...evidence],
  };
}

export default { runHallucinationCanary, extractClaims, evidenceFromTrace };
