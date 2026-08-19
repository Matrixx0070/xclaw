/**
 * Claim–evidence scorer v2/v3
 * - Inline citations: [ev:ID] (tool:NAME)
 * - Structured block: ```json { "claims": [], "evidence_ids": [] } ```
 */

const CITATION_RE =
  /\[ev:([a-zA-Z0-9_-]+)\]|\(tool:([a-zA-Z0-9_.-]+)\)|evidence:([a-zA-Z0-9_-]+)/gi;

const CLAIM_RE =
  /\b(I (created|wrote|fixed|updated|deleted|ran|executed|read|changed)|file now contains|successfully (wrote|created|fixed)|LINES=\d+)\b/i;

const STRUCTURED_RE =
  /```json\s*([\s\S]*?)\s*```/i;

/**
 * Parse optional structured claims block from final text.
 */
export function parseStructuredClaims(text) {
  const raw = String(text || "");
  let payload = null;
  const m = raw.match(STRUCTURED_RE);
  if (m) {
    payload = m[1];
  } else {
    // Models often emit the claims object bare on the last line instead of in
    // a fenced block; accept that form too.
    const bare = raw.match(/\n*(\{\s*"claims"\s*:[\s\S]*?\})\s*$/i);
    if (bare) payload = bare[1];
  }
  if (!payload) return null;
  try {
    const j = JSON.parse(payload);
    if (!j || typeof j !== "object") return null;
    const claims = Array.isArray(j.claims) ? j.claims.map(String) : [];
    const evidence_ids = Array.isArray(j.evidence_ids)
      ? j.evidence_ids.map(String)
      : Array.isArray(j.evidenceIds)
        ? j.evidenceIds.map(String)
        : [];
    return { claims, evidence_ids, raw: j };
  } catch {
    return { error: "invalid_json", claims: [], evidence_ids: [] };
  }
}

export function extractClaimsAndCitations(text) {
  const raw = String(text || "");
  const structured = parseStructuredClaims(raw);
  const citations = [];
  let m;
  const re = new RegExp(CITATION_RE.source, "gi");
  while ((m = re.exec(raw))) {
    citations.push(m[1] || m[2] || m[3]);
  }
  if (structured?.evidence_ids?.length) {
    for (const id of structured.evidence_ids) citations.push(id);
  }
  const claims = [];
  if (structured?.claims?.length) {
    for (const c of structured.claims) claims.push(String(c).slice(0, 240));
  }
  for (const sentence of raw.split(/(?<=[.!?\n])\s+/)) {
    if (CLAIM_RE.test(sentence)) claims.push(sentence.trim().slice(0, 240));
  }
  const lines = raw.match(/\bLINES=\d+\b/g);
  if (lines) {
    for (const L of lines) {
      if (!claims.some((c) => c.includes(L))) claims.push(L);
    }
  }
  return { citations, claims, structured };
}


/** Paths mentioned in claim text */
export function extractClaimPaths(text) {
  const raw = String(text || "");
  const paths = new Set();
  // quoted paths, bare paths with extension, relative segments
  const re =
    /(?:^|[\s`"'(])((?:\.\/|[\w.-]+\/)*[\w.-]+\.(?:md|txt|json|js|mjs|ts|tsx|py|yml|yaml|toml|html|css|sh|log|csv))(?:$|[\s`"'"),:])/gi;
  let m;
  while ((m = re.exec(raw))) {
    paths.add(m[1].replace(/^\.\//, ""));
  }
  return [...paths];
}

/** Paths appearing in evidence summaries (tool args/results previews) */
export function extractEvidencePaths(evidence = []) {
  const paths = new Set();
  const re =
    /(?:^|[\s`"'(/=])((?:\.\/|[\w.-]+\/)*[\w.-]+\.(?:md|txt|json|js|mjs|ts|tsx|py|yml|yaml|toml|html|css|sh|log|csv))(?:$|[\s`"'"),:])/gi;
  for (const e of evidence) {
    const sum = String(e.summary || "");
    let m;
    const r = new RegExp(re.source, "gi");
    while ((m = r.exec(sum))) {
      paths.add(m[1].replace(/^\.\//, ""));
    }
  }
  return [...paths];
}

export function scoreClaimsAgainstEvidence(finalText, evidence = [], opts = {}) {
  const { citations, claims, structured } = extractClaimsAndCitations(finalText);
  const ids = new Set();
  const toolNames = new Set();
  for (const e of evidence) {
    if (e.id) ids.add(String(e.id));
    if (e.toolCallId) ids.add(String(e.toolCallId));
    const sum = String(e.summary || "");
    const tm = sum.match(/^([^\s→]+)/);
    if (tm) toolNames.add(tm[1].toLowerCase());
    if (e.source === "tool") toolNames.add("tool");
  }
  const hasToolEvidence = evidence.some((e) => e.source === "tool");

  const orphanCitations = citations.filter((c) => {
    const k = String(c);
    if (ids.has(k)) return false;
    if (toolNames.has(k.toLowerCase())) return false;
    return true;
  });

  const warnings = [];
  if (opts.requireStructured) {
    if (!structured) warnings.push("missing structured claims JSON block");
    else if (structured.error) warnings.push("structured claims JSON invalid");
    else if (!structured.claims?.length && opts.hard) {
      warnings.push("structured claims empty");
    }
  }

  if (claims.length && !hasToolEvidence && opts.hard) {
    warnings.push("claims without any tool evidence");
  }
  for (const c of claims) {
    if (/\bI (created|wrote|fixed)\b/i.test(c) && !hasToolEvidence) {
      warnings.push(`orphan claim: ${c.slice(0, 80)}`);
    }
  }

  // Path binding: claimed file paths should appear in some tool evidence
  const claimPaths = new Set();
  for (const c of claims) {
    for (const p of extractClaimPaths(c)) claimPaths.add(p);
  }
  for (const p of extractClaimPaths(finalText)) claimPaths.add(p);
  const evidencePaths = new Set(extractEvidencePaths(evidence));
  const unboundPaths = [...claimPaths].filter((p) => {
    if (evidencePaths.has(p)) return false;
    // basename match
    const base = p.split("/").pop();
    for (const ep of evidencePaths) {
      if (ep === p || ep.endsWith("/" + base) || ep.split("/").pop() === base) return false;
    }
    return true;
  });
  if (unboundPaths.length && (opts.hard || opts.pathBind)) {
    if (!hasToolEvidence) {
      warnings.push(`path claims without tools: ${unboundPaths.slice(0, 5).join(",")}`);
    } else {
      warnings.push(`path not in tool evidence: ${unboundPaths.slice(0, 5).join(",")}`);
    }
  }
  if (orphanCitations.length) {
    warnings.push(`unknown citations: ${orphanCitations.join(",")}`);
  }
  if (opts.hard && claims.length && !hasToolEvidence && citations.length === 0) {
    warnings.push("hard: claims present without citations or tools");
  }

  // structured evidence_ids must resolve when requireStructured
  if (opts.requireStructured && structured?.evidence_ids?.length && hasToolEvidence) {
    const unresolved = structured.evidence_ids.filter(
      (id) => !ids.has(id) && !toolNames.has(String(id).toLowerCase())
    );
    // soft: allow tool names as ids
    if (unresolved.length && opts.hard) {
      warnings.push(`structured evidence_ids unresolved: ${unresolved.join(",")}`);
    }
  }

  return {
    claims,
    citations,
    structured,
    orphanCitations,
    hasToolEvidence,
    claimPaths: [...claimPaths],
    evidencePaths: [...evidencePaths],
    unboundPaths,
    warnings,
    ok: warnings.length === 0,
  };
}
