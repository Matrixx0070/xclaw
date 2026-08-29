/**
 * Recover the live-e2e report object from a child process's stdout.
 *
 * The producer emits one JSON object under --json, but it is not the only
 * thing that writes to that stream. src/config/load.mjs logs a banner the
 * first time it writes a config file, and src/computer/manager.mjs logs when
 * it starts, reuses or exits the computer process -- the last of those lands
 * asynchronously, i.e. it can arrive AFTER the report. The parent used to run
 * JSON.parse over the whole stream, so a single ambient line turned a
 * byte-identical green report into "unparseable" and woke the owner. Measured
 * on a fixture: `noise=0 -> ok=true reason=ok`, `noise=1 -> ok=false
 * reason=unparseable`, same report both times.
 *
 * Extracted rather than inlined for the same reason live-e2e-grade.mjs was:
 * wedged between a spawn and an alerter, this decision cannot be exercised
 * without a subprocess, and so was never tested.
 */

/** @returns {{report: object|null, parsed: boolean}} */
function tryParse(text) {
  try {
    const j = JSON.parse(text);
    // typeof null === "object" and typeof [] === "object". An array reads
    // .ok as undefined, which the grader must not mistake for a report.
    if (j && typeof j === "object" && !Array.isArray(j)) return { report: j, parsed: true };
  } catch {
    /* not a report */
  }
  return { report: null, parsed: false };
}

/** Whether the whole stream is valid JSON of any shape. */
function isJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Byte offsets of every top-level {...} run in `text`, string- and
 * escape-aware so a brace inside a JSON string value cannot unbalance it.
 *
 * @returns {Array<[number, number]>} half-open [start, end) spans, in order
 */
function balancedSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth === 0) continue; // stray closer in prose
      depth--;
      if (depth === 0) spans.push([start, i + 1]);
    }
  }
  return spans;
}

/**
 * The object at `start`, scanned with fresh string state.
 *
 * One scan over the whole stream carries its in-string flag across every
 * ambient line ahead of the report, so a single log line with an odd number
 * of unescaped quotes desyncs it and the report's braces are never counted.
 * Starting at the report itself cannot inherit that.
 *
 * @returns {object|null}
 */
function objectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return tryParse(text.slice(start, i + 1)).report;
    }
  }
  return null;
}

/**
 * Offsets of every `{` that opens a line. console.log(JSON.stringify(...))
 * writes exactly that shape, so the report is always one of these; ambient
 * lines are prose and rarely are.
 */
function lineAnchoredStarts(text) {
  const starts = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let j = i - 1;
    while (j >= 0 && (text[j] === " " || text[j] === "\t")) j--;
    if (j < 0 || text[j] === "\n") starts.push(i);
  }
  return starts;
}

/**
 * Whether a recovered object is the live-e2e report rather than some other
 * JSON that happened to share the stream. The producer builds it at
 * scripts/live-enforcement-e2e.mjs:283-291.
 */
function looksLikeReport(j) {
  return !!j && typeof j.ok === "boolean" && Array.isArray(j.results);
}

/**
 * The minimum an object must carry to be read as a verdict at all: the one
 * field the grader consults. Anything without it -- an ambient structured log
 * line from a dependency, a single `results` element recovered out of a
 * half-written report -- is not a report, and accepting it hands
 * gradeLiveE2e a `parsed: true`, which is the only thing standing between it
 * and inventing a pass for a run that produced no verdict.
 */
function carriesVerdict(j) {
  return !!j && typeof j === "object" && !Array.isArray(j) && typeof j.ok === "boolean";
}

/**
 * The best candidate: a report-shaped object if any, else the last object
 * that at least carries a verdict. Position alone was the old rule, and it
 * let any later object -- a debug dump from a dependency, or one element of
 * the report being written when the producer died -- become the verdict.
 */
function pickReport(candidates) {
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (looksLikeReport(candidates[i])) return { report: candidates[i], parsed: true };
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (carriesVerdict(candidates[i])) return { report: candidates[i], parsed: true };
  }
  return { report: null, parsed: false };
}

/**
 * @param {string} text raw stdout (or the contents of a --json-out file)
 * @returns {{report: object|null, parsed: boolean}}
 */
export function extractJsonReport(text) {
  if (typeof text !== "string" || !text) return { report: null, parsed: false };
  const whole = tryParse(text);
  if (whole.parsed && carriesVerdict(whole.report)) return whole;
  // Well-formed JSON that is not a report object (an array, null, a number)
  // is a producer that answered the wrong question, not a report buried in
  // noise. Salvaging an element out of it would invent a verdict, so stop
  // here; only unparseable output is worth scanning.
  if (isJson(text)) return { report: null, parsed: false };
  const anchored = lineAnchoredStarts(text)
    .map((i) => objectAt(text, i))
    .filter(Boolean);
  if (anchored.length) return pickReport(anchored);
  // Nothing began a line: the report shares a line with whatever preceded it.
  // One whole-stream scan is cheaper and still recovers that case.
  const spans = balancedSpans(text).map(([a, b]) => tryParse(text.slice(a, b)).report).filter(Boolean);
  return pickReport(spans);
}

export default { extractJsonReport };
