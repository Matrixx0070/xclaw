/**
 * Structured majority voting for swarm research (and similar) results.
 *
 * Agents are asked (via role prompt) to emit a JSON block; we parse
 * fields, tally votes, and produce a consensus object + minority report.
 */

import { receiptVoteWeight, hasReceipt } from "./swarm-receipt.mjs";

const JSON_BLOCK_RE =
  /```(?:json)?\s*([\s\S]*?)```|(\{[\s\S]*\})/i;

/**
 * Extract a JSON object from agent text (fenced block or first {...}).
 * @param {string} text
 * @returns {object|null}
 */
export function extractStructuredBallot(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(JSON_BLOCK_RE);
  const raw = (m && (m[1] || m[2])) || null;
  if (!raw) {
    // try last line object
    const lines = text.trim().split("\n").reverse();
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("{") && t.endsWith("}")) {
        try {
          const o = JSON.parse(t);
          if (o && typeof o === "object" && !Array.isArray(o)) return o;
        } catch {
          /* */
        }
      }
    }
    return null;
  }
  try {
    const o = JSON.parse(raw.trim());
    if (o && typeof o === "object" && !Array.isArray(o)) return o;
  } catch {
    /* try to find innermost object */
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const o = JSON.parse(raw.slice(start, end + 1));
        if (o && typeof o === "object" && !Array.isArray(o)) return o;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Normalize a field value for vote equality.
 */
export function normalizeVoteValue(v) {
  if (v == null) return null;
  if (typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s !== "" && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s)) {
      return Number(s);
    }
    return s;
  }
  if (Array.isArray(v)) {
    return JSON.stringify(v.map(normalizeVoteValue));
  }
  if (typeof v === "object") {
    return JSON.stringify(v, Object.keys(v).sort());
  }
  return String(v);
}

/**
 * Tie-break strategies when top counts are equal (or after weighted rank).
 * - none: leave winner null (strict)
 * - first: earliest ballot value among tied (stable by input order)
 * - last: latest ballot among tied
 * - lexical: lexicographically smallest normalized value
 * - lexical_desc: lexicographically largest
 * - confidence: highest sibling confidence field among tied ballots
 * - prefer: force winner to opts.preferValue if it is in the tied set
 * - random: deterministic hash pick (seeded) among tied — not secure random
 */
export const TIE_BREAK_STRATEGIES = [
  "none",
  "first",
  "last",
  "lexical",
  "lexical_desc",
  "confidence",
  "prefer",
  "random",
];

/**
 * @param {Array<{ value: unknown, index: number, weight?: number, confidence?: number, nodeId?: string }>} entries
 * @param {string} strategy
 * @param {object} [opts]
 */
export function breakTie(entries, strategy = "none", opts = {}) {
  if (!entries?.length) return { winner: null, method: "empty" };
  if (entries.length === 1) {
    return { winner: entries[0].value, method: "sole" };
  }
  const s = strategy || "none";

  if (s === "none") {
    return { winner: null, method: "none", tiedValues: entries.map((e) => e.value) };
  }

  if (s === "first") {
    const best = entries.reduce((a, b) => (a.index <= b.index ? a : b));
    return { winner: best.value, method: "first", index: best.index };
  }

  if (s === "last") {
    const best = entries.reduce((a, b) => (a.index >= b.index ? a : b));
    return { winner: best.value, method: "last", index: best.index };
  }

  if (s === "lexical" || s === "lexical_desc") {
    const sorted = [...entries].sort((a, b) => {
      const ka = JSON.stringify(normalizeVoteValue(a.value));
      const kb = JSON.stringify(normalizeVoteValue(b.value));
      return s === "lexical" ? (ka < kb ? -1 : ka > kb ? 1 : 0) : ka > kb ? -1 : ka < kb ? 1 : 0;
    });
    return { winner: sorted[0].value, method: s };
  }

  if (s === "confidence") {
    const withConf = entries.filter(
      (e) => typeof e.confidence === "number" && !Number.isNaN(e.confidence)
    );
    if (!withConf.length) {
      // fall back to first
      return breakTie(entries, "first", opts);
    }
    withConf.sort((a, b) => b.confidence - a.confidence || a.index - b.index);
    return {
      winner: withConf[0].value,
      method: "confidence",
      confidence: withConf[0].confidence,
    };
  }

  if (s === "prefer") {
    const pref = opts.preferValue;
    if (pref !== undefined) {
      const nk = JSON.stringify(normalizeVoteValue(pref));
      const hit = entries.find(
        (e) => JSON.stringify(normalizeVoteValue(e.value)) === nk
      );
      if (hit) return { winner: hit.value, method: "prefer" };
    }
    return breakTie(entries, opts.preferFallback || "first", opts);
  }

  if (s === "random") {
    // Deterministic pick from seed + values (stable across runs)
    const seed = String(opts.seed ?? "xclaw-vote");
    const keys = entries
      .map((e) => JSON.stringify(normalizeVoteValue(e.value)))
      .sort();
    let h = 0;
    const str = seed + "|" + keys.join("|");
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    const pick = entries[
      keys.indexOf(keys[h % keys.length])
        >= 0
        ? entries.findIndex(
            (e) =>
              JSON.stringify(normalizeVoteValue(e.value)) ===
              keys[h % keys.length]
          )
        : 0
    ];
    return { winner: pick?.value ?? entries[0].value, method: "random", seed };
  }

  return { winner: null, method: "unknown_strategy" };
}

/**
 * Tally votes for one field across ballots.
 * @param {unknown[]} values
 * @param {object} [opts]
 * @param {number[]} [opts.weights] — parallel weights (default 1)
 * @param {number[]} [opts.confidences] — parallel confidence for tie-break
 * @param {string[]} [opts.nodeIds]
 * @param {string} [opts.tieBreak]
 * @param {unknown} [opts.preferValue]
 * @param {string|number} [opts.seed]
 * @returns {{ winner, count, total, tie, tiedBroken, tieBreakMethod, tally, minority }}
 */
export function tallyField(values, opts = {}) {
  /** @type {Map<string, { count: number, weight: number, sample: unknown, firstIndex: number, confidences: number[] }>} */
  const map = new Map();
  let total = 0;
  let totalWeight = 0;
  const weights = opts.weights || [];
  const confidences = opts.confidences || [];

  values.forEach((v, index) => {
    if (v == null) return;
    total++;
    const w = typeof weights[index] === "number" ? weights[index] : 1;
    totalWeight += w;
    const key = JSON.stringify(normalizeVoteValue(v));
    const cur = map.get(key) || {
      count: 0,
      weight: 0,
      sample: v,
      firstIndex: index,
      lastIndex: index,
      confidences: [],
    };
    cur.count++;
    cur.weight += w;
    cur.lastIndex = index;
    if (typeof confidences[index] === "number") {
      cur.confidences.push(confidences[index]);
    }
    map.set(key, cur);
  });

  if (total === 0) {
    return {
      winner: null,
      count: 0,
      total: 0,
      totalWeight: 0,
      tie: false,
      tiedBroken: false,
      tieBreakMethod: null,
      tally: {},
      minority: [],
    };
  }

  // Rank by weight then count then firstIndex
  const ranked = [...map.entries()].sort((a, b) => {
    if (b[1].weight !== a[1].weight) return b[1].weight - a[1].weight;
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return a[1].firstIndex - b[1].firstIndex;
  });

  const top = ranked[0];
  const topW = top[1].weight;
  const tied = ranked.filter(([, x]) => x.weight === topW && x.count === top[1].count);
  const isTie = tied.length > 1;

  const tally = {};
  for (const [, { count, sample, weight }] of ranked) {
    const label =
      typeof sample === "string" ? sample : JSON.stringify(sample);
    tally[label] = count;
    if (weight !== count) tally[label + "@w"] = weight;
  }

  let winner = top[1].sample;
  let tiedBroken = false;
  let tieBreakMethod = null;

  if (isTie) {
    const entries = tied.map(([, x]) => ({
      value: x.sample,
      index: x.firstIndex,
      weight: x.weight,
      confidence:
        x.confidences.length > 0
          ? x.confidences.reduce((a, b) => a + b, 0) / x.confidences.length
          : undefined,
    }));
    const br = breakTie(entries, opts.tieBreak || "none", opts);
    winner = br.winner;
    tiedBroken = br.winner != null && (opts.tieBreak || "none") !== "none";
    tieBreakMethod = br.method;
  }

  const minority = ranked
    .filter(([, x]) => {
      if (winner == null) return true;
      return (
        JSON.stringify(normalizeVoteValue(x.sample)) !==
        JSON.stringify(normalizeVoteValue(winner))
      );
    })
    .map(([, { count, sample, weight }]) => ({
      value: sample,
      count,
      weight,
    }));

  return {
    winner: isTie && (opts.tieBreak || "none") === "none" ? null : winner,
    count: top[1].count,
    weight: top[1].weight,
    total,
    totalWeight,
    tie: isTie,
    tiedBroken,
    tieBreakMethod,
    tally,
    minority,
  };
}

/**
 * Run structured majority vote across node results.
 *
 * @param {object[]} results — swarm node results with .text, .ok, .nodeId, .role
 * @param {object} [opts]
 * @param {string[]} [opts.fields] — fields to vote; default = union of ballot keys
 * @param {string[]} [opts.roles] — only these roles (default research)
 * @param {boolean} [opts.okOnly] — only ok results (default true)
 * @param {number} [opts.minBallots] — min ballots to declare consensus (default 2)
 * @param {number} [opts.minShare] — winner needs count/total >= minShare (default 0.5)
 */
export function structuredMajorityVote(results = [], opts = {}) {
  const roles = new Set(
    (opts.roles || ["research"]).map((r) => String(r).toLowerCase())
  );
  const okOnly = opts.okOnly !== false;
  const minBallots = opts.minBallots ?? 2;
  const minShare = opts.minShare ?? 0.5;
  const tieBreak = opts.tieBreak || "none";
  const roleWeights = opts.roleWeights || {};

  const ballots = [];
  for (const r of results) {
    if (okOnly && !r.ok) continue;
    const role = String(r.role || "research").toLowerCase();
    if (roles.size && !roles.has(role)) continue;
    const obj = extractStructuredBallot(r.text || "");
    if (!obj) {
      ballots.push({
        nodeId: r.nodeId || r.id,
        role,
        ok: false,
        reason: "no_json",
        data: null,
        weight: 1,
      });
      continue;
    }
    const baseW =
      typeof r.voteWeight === "number"
        ? r.voteWeight
        : typeof roleWeights[role] === "number"
          ? roleWeights[role]
          : 1;
    const receiptW = opts.ignoreReceipts
      ? 1
      : receiptVoteWeight(r, {
          hard: opts.requireReceipts === true,
        });
    const w = baseW * receiptW;
    ballots.push({
      nodeId: r.nodeId || r.id,
      role,
      ok: true,
      data: obj,
      weight: w,
      confidence:
        typeof obj.confidence === "number"
          ? obj.confidence
          : typeof obj._confidence === "number"
            ? obj._confidence
            : undefined,
    });
  }

  const valid = ballots.filter((b) => b.ok && b.data);
  const fieldSet = new Set(opts.fields || []);
  if (!fieldSet.size) {
    for (const b of valid) {
      for (const k of Object.keys(b.data)) {
        if (k.startsWith("_")) continue;
        fieldSet.add(k);
      }
    }
  }

  const fields = {};
  const consensus = {};
  let agreed = 0;
  let tied = 0;
  let unresolved = 0;

  for (const field of fieldSet) {
    const values = valid.map((b) => b.data[field]);
    const weights = valid.map((b) => b.weight);
    const confidences = valid.map((b) => b.confidence);
    const t = tallyField(values, {
      weights,
      confidences,
      tieBreak,
      preferValue: opts.preferValues?.[field],
      seed: opts.seed || field,
      preferFallback: opts.preferFallback || "first",
    });
    const share = t.totalWeight
      ? (t.weight || t.count) / t.totalWeight
      : t.total
        ? t.count / t.total
        : 0;
    // Consensus: have a winner, enough ballots, share threshold.
    // Ties may still pass if tie-break produced a winner.
    const pass =
      t.total >= minBallots &&
      t.winner != null &&
      share >= minShare &&
      (!t.tie || t.tiedBroken || tieBreak !== "none");
    fields[field] = {
      ...t,
      share,
      consensus: pass,
    };
    if (pass) {
      consensus[field] = t.winner;
      agreed++;
      if (t.tie && t.tiedBroken) {
        /* counted as agreed via break */
      }
    } else if (t.tie && !t.tiedBroken) {
      tied++;
      unresolved++;
    } else {
      unresolved++;
    }
  }

  return {
    ok: valid.length >= minBallots && agreed > 0,
    ballotCount: ballots.length,
    validBallots: valid.length,
    parseFailures: ballots.filter((b) => !b.ok).length,
    minBallots,
    minShare,
    tieBreak,
    fields,
    consensus,
    stats: { agreed, tied, unresolved, fieldCount: fieldSet.size },
    ballots: ballots.map((b) => ({
      nodeId: b.nodeId,
      role: b.role,
      ok: b.ok,
      reason: b.reason || null,
      keys: b.data ? Object.keys(b.data) : [],
    })),
  };
}

/**
 * Markdown section for join summary.
 */
export function formatVoteReport(vote) {
  if (!vote) return "";
  const lines = [
    `## Structured majority vote`,
    `Valid ballots: ${vote.validBallots}/${vote.ballotCount} · parse failures: ${vote.parseFailures}`,
    `Agreed fields: ${vote.stats.agreed}/${vote.stats.fieldCount} · ties: ${vote.stats.tied}`,
    ``,
  ];
  if (Object.keys(vote.consensus).length) {
    lines.push(`### Consensus`);
    lines.push("```json");
    lines.push(JSON.stringify(vote.consensus, null, 2));
    lines.push("```");
    lines.push("");
  }
  for (const [field, t] of Object.entries(vote.fields || {})) {
    const status = t.consensus
      ? "CONSENSUS"
      : t.tie
        ? "TIE"
        : "NO_MAJORITY";
    const tb =
      t.tie && t.tieBreakMethod
        ? ` tieBreak=${t.tieBreakMethod}`
        : t.tie
          ? " (unbroken tie)"
          : "";
    lines.push(
      `- **${field}**: ${status} winner=${JSON.stringify(t.winner)} (${t.count}/${t.total}, share=${(t.share || 0).toFixed(2)})${tb}`
    );
    if (t.minority?.length) {
      lines.push(
        `  - minority: ${t.minority.map((m) => `${JSON.stringify(m.value)}×${m.count}`).join(", ")}`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Prompt fragment so research agents emit votable JSON */
export const STRUCTURED_BALLOT_PROMPT = `
Emit a final JSON ballot (fenced \`\`\`json block) with flat fields only, e.g.:
\`\`\`json
{ "answer": "...", "confidence": 0.0, "label": "yes|no|maybe", "risk": "low|med|high" }
\`\`\`
Use stable enum-like strings so majority vote can tally fields.
`.trim();
