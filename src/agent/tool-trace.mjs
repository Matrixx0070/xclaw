import { stampToolEntryHash, GENESIS_HASH } from "./tool-hash-chain.mjs";

/**
 * Normalized toolTrace entries for grounded suggestions, metrics, audit.
 * Backward compatible: keeps legacy `result` string + `blocked` boolean.
 */

let seq = 0;

export function resetToolTraceSeq() {
  seq = 0;
}

function nextId() {
  seq += 1;
  return `tt_${seq}_${Math.random().toString(36).slice(2, 7)}`;
}

/** @param {string} name */
export function normalizeToolFamily(name) {
  const n = String(name || "").toLowerCase();
  if (/bash|shell|exec/.test(n)) return "shell";
  if (/file_write|write_file|edit_file/.test(n)) return "write";
  if (/file_read|read_file|list_dir|file_list/.test(n)) return "read";
  if (/search|web_/.test(n)) return "search";
  if (/browser/.test(n)) return "browser";
  if (/swarm|spawn|merge/.test(n)) return "swarm";
  return "other";
}

/**
 * @param {unknown} args
 * @param {string} name
 */
export function summarizeArgs(name, args = {}) {
  const a = args && typeof args === "object" ? args : {};
  if (a.command || a.cmd) return String(a.command || a.cmd).slice(0, 120);
  if (a.path || a.file_path || a.filePath) {
    return String(a.path || a.file_path || a.filePath).slice(0, 120);
  }
  if (a.url) return String(a.url).slice(0, 120);
  if (a.query) return `q=${String(a.query).slice(0, 80)}`;
  try {
    return JSON.stringify(a).slice(0, 120);
  } catch {
    return name;
  }
}

/**
 * Collect artifacts from args + result text.
 * SCAFFOLD: filename-regex guessing over prose — tools should declare their
 * artifacts structurally in results; remove when the ToolCall contract carries
 * an artifacts field end-to-end.
 * @param {string} name
 * @param {object} args
 * @param {string} resultText
 */
export function collectArtifacts(name, args = {}, resultText = "") {
  /** @type {Array<{type: string, ref: string, role?: string, preview?: string}>} */
  const arts = [];
  const a = args || {};
  const pathCand = a.path || a.file_path || a.filePath || a.dest || a.filename;
  if (pathCand) {
    arts.push({
      type: "file",
      ref: String(pathCand),
      role: /write|edit/i.test(name) ? "output" : "input",
    });
  }
  const cmd = a.command || a.cmd || a.script;
  if (cmd) {
    arts.push({ type: "command", ref: String(cmd).slice(0, 200), role: "input" });
  }
  if (a.url) {
    arts.push({ type: "url", ref: String(a.url), role: "input" });
  }

  const text = String(resultText || "");
  const pathHits =
    text.match(/(?:\/[\w./\-]+|\b[\w\-]+\/[\w./\-]+\.(?:mjs|js|ts|py|json|md|txt))/g) ||
    [];
  for (const p of pathHits.slice(0, 4)) {
    if (!arts.some((x) => x.ref === p)) {
      arts.push({ type: "file", ref: p, role: "touched" });
    }
  }
  return arts;
}


/**
 * Extract structured fields from computer/local tool result objects.
 * @param {object} result
 */
export function extractStructuredResult(result) {
  if (!result || typeof result !== "object") return {};
  const meta = result.metadata || result.meta || {};
  const details = result.details || {};
  /** @type {Record<string, unknown>} */
  const out = {};

  const exit =
    result.exitCode ??
    result.exit_code ??
    meta.exitCode ??
    meta.exit_code ??
    details.exitCode ??
    details.exit_code;
  if (exit != null && exit !== "") {
    const n = Number(exit);
    if (Number.isFinite(n)) out.exitCode = n;
  }

  if (result.signal || meta.signal) out.signal = String(result.signal || meta.signal);
  if (result.stdout != null) out.stdout = String(result.stdout);
  if (result.stderr != null) out.stderr = String(result.stderr);
  if (meta.durationMs != null) out.durationMs = Number(meta.durationMs);
  if (result.path || meta.path) out.path = String(result.path || meta.path);
  if (result.bytesWritten != null || meta.bytesWritten != null) {
    out.bytesWritten = Number(result.bytesWritten ?? meta.bytesWritten);
  }
  if (result.isError) out.isError = true;

  // Parse exit from text content if not structured
  if (out.exitCode == null) {
    const texts = (result.content || [])
      .filter((c) => c && c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const m = texts.match(/\b(?:exit(?:\s+code)?|code)[=:\s]+(-?\d+)\b/i);
    if (m) out.exitCode = Number(m[1]);
  }
  return out;
}

/**
 * Parse exit code from shell result text (footer conventions).
 * @param {string} text
 * @returns {number|undefined}
 */
export function parseShellExitCode(text) {
  const s = String(text || "");
  // Prefer last occurrence (often a footer)
  const re = /\b(?:exit(?:\s+code)?|code)[=:\s]+(-?\d+)\b/gi;
  let last;
  let m;
  while ((m = re.exec(s)) !== null) last = Number(m[1]);
  if (last != null && Number.isFinite(last)) return last;
  // Process failed with code N
  m = s.match(/\bfailed with code\s+(-?\d+)\b/i);
  if (m) return Number(m[1]);
  return undefined;
}

/**
 * Parse node:test / jest / pytest style summaries.
 * @param {string} text
 */
export function parseTestSummary(text) {
  const s = String(text || "");
  const failed =
    s.match(/\b(\d+)\s+failed\b/i) ||
    s.match(/\bFAIL(?:ED)?\s+(\d+)\b/i);
  const passed =
    s.match(/\b(\d+)\s+passed\b/i) ||
    s.match(/\b(\d+)\s+passing\b/i);
  const tests =
    s.match(/\b(\d+)\s+tests?\b/i);
  if (!failed && !passed) return null;
  return {
    failed: failed ? Number(failed[1]) : 0,
    passed: passed ? Number(passed[1]) : undefined,
    tests: tests ? Number(tests[1]) : undefined,
  };
}

/** @param {object} opts */
export function parseShellOutcome(opts = {}) {
  const text = String(opts.resultText || "");
  const structured = opts.structured || {};
  let exitCode =
    structured.exitCode != null
      ? Number(structured.exitCode)
      : parseShellExitCode(text);

  const test = parseTestSummary(text);

  if (exitCode === 0) {
    const summary = test
      ? `${test.passed ?? "?"} passed${test.failed ? `, ${test.failed} failed` : ""}`
      : "exit 0";
    return {
      status: "ok",
      outcome: {
        kind: "success",
        exitCode: 0,
        summary: summary.slice(0, 160),
        confidence: test ? 0.95 : 1,
        test,
      },
    };
  }

  if (exitCode != null && exitCode !== 0) {
    if (test && test.failed > 0) {
      return {
        status: "fail",
        outcome: {
          kind: "test_fail",
          exitCode,
          summary: `${test.failed} failed` + (test.passed != null ? `, ${test.passed} passed` : ""),
          confidence: 0.92,
          test,
        },
      };
    }
    return {
      status: "fail",
      outcome: {
        kind: "command_fail",
        exitCode,
        summary: `exit ${exitCode}`,
        confidence: 0.95,
      },
    };
  }

  // No exit code — fall through heuristics
  if (test && test.failed > 0) {
    return {
      status: "fail",
      outcome: {
        kind: "test_fail",
        summary: `${test.failed} failed`,
        confidence: 0.8,
        test,
      },
    };
  }
  if (/permission denied|EACCES|EPERM/i.test(text)) {
    return {
      status: "fail",
      outcome: { kind: "permission", summary: "permission denied", confidence: 0.85 },
    };
  }
  if (/ENOENT|no such file|not found/i.test(text)) {
    return {
      status: "fail",
      outcome: { kind: "not_found", summary: "not found", confidence: 0.85 },
    };
  }
  if (/\berror\b|\bfailed\b/i.test(text.slice(0, 600))) {
    return {
      status: "fail",
      outcome: {
        kind: "command_fail",
        summary: text.slice(0, 120).replace(/\s+/g, " "),
        confidence: 0.55,
      },
    };
  }
  return {
    status: "ok",
    outcome: {
      kind: "success",
      summary: (opts.args && summarizeArgs("shell", opts.args)) || "ok",
      confidence: 0.6,
    },
  };
}

/** @param {object} opts */
export function parseWriteOutcome(opts = {}) {
  const text = String(opts.resultText || "");
  const structured = opts.structured || {};
  const args = opts.args || {};
  const pathRef =
    structured.path ||
    args.path ||
    args.file_path ||
    args.filePath ||
    args.dest;

  if (opts.thrown || structured.isError || /EACCES|EPERM|EROFS|permission denied/i.test(text)) {
    return {
      status: "fail",
      outcome: {
        kind: "permission",
        summary: pathRef ? `write denied: ${String(pathRef).slice(0, 80)}` : "write denied",
        confidence: 0.85,
      },
    };
  }
  if (/ENOENT|no such file/i.test(text)) {
    return {
      status: "fail",
      outcome: {
        kind: "not_found",
        summary: pathRef ? `path missing: ${String(pathRef).slice(0, 80)}` : "path missing",
        confidence: 0.85,
      },
    };
  }
  if (/\berror\b|\bfailed\b/i.test(text.slice(0, 400))) {
    return {
      status: "fail",
      outcome: {
        kind: "unknown",
        summary: text.slice(0, 120).replace(/\s+/g, " "),
        confidence: 0.6,
      },
    };
  }
  return {
    status: "ok",
    outcome: {
      kind: "success",
      summary: pathRef ? `wrote ${String(pathRef).slice(0, 100)}` : "write ok",
      confidence: pathRef ? 0.95 : 0.8,
    },
  };
}

/** @param {object} opts */
export function parseReadOutcome(opts = {}) {
  const text = String(opts.resultText || "");
  const args = opts.args || {};
  const pathRef = args.path || args.file_path || args.filePath;
  if (/ENOENT|no such file|not found/i.test(text)) {
    return {
      status: "fail",
      outcome: {
        kind: "not_found",
        summary: pathRef ? `missing ${String(pathRef).slice(0, 80)}` : "not found",
        confidence: 0.9,
      },
    };
  }
  if (opts.thrown || opts.structured?.isError) {
    return {
      status: "error",
      outcome: { kind: "unknown", summary: text.slice(0, 120), confidence: 0.7 },
      error: { message: text.slice(0, 500) },
    };
  }
  if (!text.trim()) {
    return {
      status: "ok",
      outcome: { kind: "empty", summary: "empty read", confidence: 0.8 },
    };
  }
  return {
    status: "ok",
    outcome: {
      kind: "success",
      summary: pathRef ? `read ${String(pathRef).slice(0, 100)}` : "read ok",
      confidence: 0.9,
    },
  };
}

/** @param {object} opts */
export function parseSearchOutcome(opts = {}) {
  const text = String(opts.resultText || "");
  if (opts.thrown || opts.structured?.isError) {
    return {
      status: "error",
      outcome: { kind: "unknown", summary: "search error", confidence: 0.7 },
      error: { message: text.slice(0, 500) },
    };
  }
  if (!text.trim() || /no results|0 results/i.test(text.slice(0, 200))) {
    return {
      status: "ok",
      outcome: { kind: "empty", summary: "no results", confidence: 0.75 },
    };
  }
  return {
    status: "ok",
    outcome: {
      kind: "success",
      summary: (opts.args?.query && `search: ${String(opts.args.query).slice(0, 80)}`) || "search ok",
      confidence: 0.8,
    },
  };
}

/** @param {object} opts */
export function parseSwarmOutcome(opts = {}) {
  const text = String(opts.resultText || "");
  const name = String(opts.name || "");
  if (/awaiting approval|merge pending|needs approval/i.test(text)) {
    return {
      status: "ok",
      outcome: {
        kind: "partial",
        summary: "swarm pending approval",
        confidence: 0.9,
      },
    };
  }
  if (/merge conflict|conflict/i.test(text)) {
    return {
      status: "fail",
      outcome: { kind: "conflict", summary: "merge conflict", confidence: 0.85 },
    };
  }
  if (opts.thrown || opts.structured?.isError || /\bfailed\b|\berror\b/i.test(text.slice(0, 400))) {
    return {
      status: "fail",
      outcome: {
        kind: "unknown",
        summary: text.slice(0, 120).replace(/\s+/g, " ") || "swarm failed",
        confidence: 0.65,
      },
    };
  }
  if (/rejected|deny/i.test(text) && /merge/i.test(name)) {
    return {
      status: "ok",
      outcome: { kind: "success", summary: "merge rejected", confidence: 0.85 },
    };
  }
  return {
    status: "ok",
    outcome: {
      kind: "success",
      summary: /merge/i.test(name) ? "merge ok" : "swarm ok",
      confidence: 0.75,
    },
  };
}

/** @param {object} opts */
export function parseGenericOutcome(opts = {}) {
  const text = String(opts.resultText || "");
  if (opts.thrown || opts.structured?.isError) {
    return {
      status: "error",
      outcome: {
        kind: "unknown",
        summary: text.slice(0, 120) || "error",
        confidence: 0.7,
      },
      error: { message: text.slice(0, 500), retryable: false },
    };
  }
  if (/ENOENT|not found/i.test(text)) {
    return {
      status: "fail",
      outcome: { kind: "not_found", summary: "not found", confidence: 0.8 },
    };
  }
  if (/permission denied|EACCES/i.test(text)) {
    return {
      status: "fail",
      outcome: { kind: "permission", summary: "permission denied", confidence: 0.85 },
    };
  }
  if (/\berror\b|\bfailed\b|\bexception\b/i.test(text.slice(0, 500))) {
    return {
      status: "fail",
      outcome: {
        kind: "unknown",
        summary: text.slice(0, 120).replace(/\s+/g, " "),
        confidence: 0.55,
      },
    };
  }
  return {
    status: "ok",
    outcome: {
      kind: "success",
      summary: summarizeArgs(opts.name || "tool", opts.args).slice(0, 120) || "ok",
      confidence: 0.7,
    },
  };
}

/**
 * Infer status + outcome from tool result payload / text.
 * Dispatches to family-specific parsers.
 * @param {object} opts
 */
export function inferOutcome(opts = {}) {
  const {
    name = "",
    result,
    resultText = "",
    blocked = false,
    policyDecision,
    thrown = false,
    timedOut = false,
    cancelled = false,
    args,
  } = opts;

  if (cancelled) {
    return {
      status: "cancelled",
      outcome: { kind: "unknown", summary: "cancelled", confidence: 1 },
    };
  }
  if (blocked || policyDecision === "deny" || policyDecision === "pending") {
    return {
      status: "blocked",
      outcome: {
        kind: "permission",
        summary:
          policyDecision === "pending"
            ? "awaiting approval"
            : "blocked by policy",
        confidence: 1,
      },
    };
  }
  if (timedOut) {
    return {
      status: "timeout",
      outcome: { kind: "unknown", summary: "timeout", confidence: 1 },
      error: { code: "ETIMEDOUT", message: "tool timeout", retryable: true },
    };
  }

  const structured = extractStructuredResult(result);
  const family = normalizeToolFamily(name);
  const ctx = {
    name,
    args: args || opts.args,
    resultText,
    result,
    structured,
    thrown: thrown || structured.isError,
  };

  if (family === "shell") return parseShellOutcome(ctx);
  if (family === "write") return parseWriteOutcome(ctx);
  if (family === "read") return parseReadOutcome(ctx);
  if (family === "search" || family === "browser") return parseSearchOutcome(ctx);
  if (family === "swarm") return parseSwarmOutcome(ctx);
  return parseGenericOutcome(ctx);
}

/**
 * Start a trace entry at tool start.
 */
export function beginToolTraceEntry({ name, args, toolCallId, turn }) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  return {
    id: nextId(),
    toolCallId: toolCallId || undefined,
    name: String(name || ""),
    nameNormalized: normalizeToolFamily(name),
    startedAt,
    _t0: t0,
    args: args && typeof args === "object" ? { ...args } : {},
    argsSummary: summarizeArgs(name, args),
    turn,
  };
}

/**
 * Finalize entry after tool execution (or block).
 * @returns {object} entry with legacy fields for compatibility
 */
export function finalizeToolTraceEntry(partial, opts = {}) {
  const {
    resultText = "",
    originalChars,
    keptChars,
    truncated = false,
    blocked = false,
    policy,
    result,
    thrown = false,
    timedOut = false,
    cancelled = false,
  } = opts;

  const text = String(resultText || "");
  const inferred = inferOutcome({
    name: partial.name,
    args: partial.args,
    result,
    resultText: text,
    blocked,
    policyDecision: policy?.decision,
    thrown,
    timedOut,
    cancelled,
  });

  const endedAt = new Date().toISOString();
  const durationMs =
    partial._t0 != null ? Math.max(0, Date.now() - partial._t0) : undefined;

  const artifacts = collectArtifacts(partial.name, partial.args, text);

  const entry = {
    id: partial.id,
    toolCallId: partial.toolCallId,
    name: partial.name,
    nameNormalized: partial.nameNormalized || normalizeToolFamily(partial.name),
    startedAt: partial.startedAt,
    endedAt,
    durationMs,
    args: partial.args,
    argsSummary: partial.argsSummary || summarizeArgs(partial.name, partial.args),
    status: inferred.status,
    outcome: inferred.outcome,
    artifacts,
    policy: policy || undefined,
    result: {
      text: text.slice(0, 2000),
      originalChars: originalChars ?? text.length,
      keptChars: keptChars ?? Math.min(2000, text.length),
      truncated: Boolean(truncated),
    },
    error: inferred.error,
    turn: partial.turn,

    // Legacy mirrors
    blocked:
      inferred.status === "blocked" ||
      inferred.status === "denied" ||
      blocked === true,
    originalChars: originalChars ?? text.length,
    keptChars: keptChars ?? Math.min(2000, text.length),
    truncated: Boolean(truncated),
  };

  // Legacy string field many callers expect
  Object.defineProperty(entry, "resultText", {
    value: entry.result.text,
    enumerable: false,
  });
  // Keep enumerable legacy `result` as string for old consumers that do t.result
  // while also exposing structured view under resultView when needed.
  const structuredResult = entry.result;
  entry.resultView = structuredResult;
  entry.result = structuredResult.text; // legacy string

  // Optional hash-chain stamp for receipt/replay (opts.prevHash or GENESIS)
  if (opts.hashChain !== false) {
    const prev = opts.prevHash || opts.chainTip || GENESIS_HASH;
    const stamped = stampToolEntryHash(entry, prev);
    return stamped.entry;
  }

  return entry;
}

/**
 * Helpers for consumers
 */
export function isBlockedEntry(e) {
  return (
    e?.status === "blocked" ||
    e?.status === "denied" ||
    e?.blocked === true
  );
}

export function isFailEntry(e) {
  return e?.status === "fail" || e?.status === "error" || e?.status === "timeout";
}

export function entryArtifacts(e) {
  return Array.isArray(e?.artifacts) ? e.artifacts : [];
}

export default {
  resetToolTraceSeq,
  normalizeToolFamily,
  summarizeArgs,
  collectArtifacts,
  extractStructuredResult,
  parseShellExitCode,
  parseTestSummary,
  parseShellOutcome,
  parseWriteOutcome,
  parseReadOutcome,
  parseSearchOutcome,
  parseSwarmOutcome,
  parseGenericOutcome,
  inferOutcome,
  beginToolTraceEntry,
  finalizeToolTraceEntry,
  isBlockedEntry,
  isFailEntry,
  entryArtifacts,
};
