/**
 * Denial taint — a human "no" binds the EFFECT, not the tool call.
 *
 * Live defect (2026-08-29, TUI transcript + in-process probe): an operator
 * denied a risky xclaw_bash write of tmp-live/deny-probe.txt; the model
 * pivoted to xclaw_file_write of the same path, which tiers "low"
 * (in-workspace write), and under autoApproveMaxTier "low" — the live
 * setting — the denied effect would auto-run seconds after the human said
 * no. needsApproval grades every call statelessly, and a deny resolves to
 * nothing but a message, so nothing connected the two calls.
 *
 * The mechanism mirrors the trust window in reverse: an operator deny
 * records the denied effect (the call's resolved path candidates + its
 * tier) in an in-gate, TTL-bounded store; a later call whose own candidates
 * intersect a live taint is escalated and re-asked — only a human can
 * reverse a human deny. Escalation only ever raises a tier, and the
 * appended reason names why ("matches effect denied Ns ago"), because an
 * operator shown a second prompt seconds after a deny must be told it is
 * the same effect coming back, or the prompt teaches nothing.
 *
 * In-memory only — a gateway restart clears taints, the same deliberate
 * failure mode as the trust window it mirrors. Honest limits: matching is
 * by resolved path, so a denial with no extractable path (pure egress)
 * records an empty taint and protects nothing, and a pivot that reaches the
 * same file through a different workingDir resolves a different absolute
 * path and will not match.
 */
import path from "node:path";
import os from "node:os";
import { extractPaths, commandText, tierRank, RISK_TIERS } from "./risk.mjs";

/** 15 minutes: a pivot lands seconds after a deny; a day-old deny is stale. */
export const DEFAULT_TAINT_TTL_MS = 900_000;
export const DEFAULT_TAINT_MAX = 50;

/**
 * Resolve every path-shaped operand of a call to an absolute path.
 *
 * Two sources, both owned by risk.mjs so this cannot drift into a private
 * re-implementation: extractPaths over the args (PATH_ARG_KEYS), and the
 * command text for exec-family tools — where the denied path usually lives
 * (`echo x > tmp-live/f.txt` carries no path arg at all). Shell operators
 * are broken to spaces first so a glued redirect target (`>file`) becomes
 * its own token. Version-number tokens (3.369.0) and URLs are skipped —
 * they are path-shaped to the regex but not to the filesystem.
 *
 * @param {object} args tool args
 * @param {string} workingDir the same resolution authorize feeds assessRisk
 * @returns {string[]} absolute, deduplicated candidates
 */
export function taintPathCandidates(args = {}, workingDir = "") {
  const out = new Set();
  const wd = workingDir || process.cwd();
  const home = os.homedir();
  const add = (raw) => {
    if (!raw || typeof raw !== "string") return;
    let s = raw.replace(/^["']+|["']+$/g, "");
    s = s.replace(/\$\{?HOME\}?/g, home);
    if (s === "~") s = home;
    else if (s.startsWith("~/")) s = home + s.slice(1);
    if (!s || s === "/" || s === ".") return;
    out.add(path.resolve(wd, s));
  };
  // cwd/workingDir are CONTEXT, not operands: the agent loop injects
  // `cwd: workingDir` into every exec tool's args before authorize, so
  // tainting them would taint the workspace root itself, and every later
  // exec call in the session would match — the approval-storm class reborn
  // (review probe: an unrelated read-only `cat` pended on the root).
  const { cwd: _cwd, workingDir: _workingDir, ...operands } = args || {};
  for (const p of extractPaths(operands)) add(p);
  const rawCmd = commandText(args);
  // Redirect and tee targets are write operands whatever their shape:
  // `> secrets`, `>.env`, `tee Makefile` carry no slash and no dotted
  // extension, so the shape-filtered token scan below cannot see them
  // (review probe: denying `echo x > secrets` recorded no useful taint and
  // the file_write pivot auto-ran). Quote-blind by design — a false
  // candidate only ever asks.
  for (const m of rawCmd.matchAll(/\d?>{1,2}\s*([^\s|;&<>]+)/g)) add(m[1]);
  for (const m of rawCmd.matchAll(/\btee\b\s+(?:-[a-zA-Z]+\s+)*([^\s|;&<>]+)/g)) add(m[1]);
  const cmd = rawCmd.replace(/[|;&<>]+/g, " ");
  for (const tok of cmd.split(/\s+/)) {
    const t = tok.replace(/^["']+|["']+$/g, "");
    if (!t || t.startsWith("-") || t.includes("://")) continue;
    if (/^v?\d[\d.]*$/i.test(t)) continue;
    if (t.includes("/") || /^[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(t)) add(t);
  }
  // The workspace root itself is context by construction — a taint on it
  // would match every call in the session.
  out.delete(path.resolve(wd));
  return [...out];
}

/**
 * TTL-bounded FIFO store of denied effects. ttlMs 0 is a deliberate
 * escape hatch (every taint expires immediately); junk falls back to the
 * default — `Number("abc")` is NaN, `??` passes NaN through, and a NaN TTL
 * would otherwise prune nothing forever (the class-52 fail-open shape).
 */
export function createDenialTaints(opts = {}) {
  const ttlMs =
    Number.isFinite(opts.ttlMs) && opts.ttlMs >= 0 ? opts.ttlMs : DEFAULT_TAINT_TTL_MS;
  const max = Number.isFinite(opts.max) && opts.max > 0 ? opts.max : DEFAULT_TAINT_MAX;
  const taints = [];

  function prune(nowMs) {
    const cutoff = nowMs - ttlMs;
    let i = taints.length;
    while (i--) if (taints[i].atMs <= cutoff) taints.splice(i, 1);
  }

  return {
    record({ tool, tier, paths, atMs } = {}) {
      const entry = {
        tool: String(tool || ""),
        // A deny of an unknown/unassessed tier still means "a human said
        // no" — record at least risky so the re-ask floor holds.
        tier: RISK_TIERS.includes(tier) && tierRank(tier) > tierRank("risky") ? tier : "risky",
        paths: Array.isArray(paths) ? paths.filter((p) => typeof p === "string" && p) : [],
        atMs: Number.isFinite(atMs) ? atMs : Date.now(),
      };
      taints.push(entry);
      while (taints.length > max) taints.shift();
      return { ...entry };
    },
    match(candidates, nowMs = Date.now()) {
      prune(nowMs);
      if (!Array.isArray(candidates) || !candidates.length) return null;
      const set = new Set(candidates);
      // Newest first: the reason names the most recent matching denial.
      for (let i = taints.length - 1; i >= 0; i--) {
        const hit = taints[i].paths.find((p) => set.has(p));
        if (hit) return { taint: { ...taints[i] }, path: hit };
      }
      return null;
    },
    list(nowMs = Date.now()) {
      prune(nowMs);
      return taints.map((t) => ({ ...t }));
    },
  };
}

/**
 * The decision: escalate a call's risk when it matches a live taint.
 *
 * Escalation only raises — a critical verdict is never pulled down to the
 * denied call's tier — and a match with no risk at all (assessRisk threw)
 * still yields a risky verdict rather than silence: fail closed.
 *
 * @returns {{risk: object|null, matched: {taint: object, path: string}|null}}
 */
export function applyDenialTaint(risk, candidates, taints, nowMs = Date.now()) {
  if (!taints) return { risk, matched: null };
  const matched = taints.match(candidates, nowMs);
  if (!matched) return { risk, matched: null };
  const agoSec = Math.max(0, Math.round((nowMs - matched.taint.atMs) / 1000));
  const reason = `denial-taint: matches effect denied ${agoSec}s ago (${matched.path})`;
  const base =
    risk && typeof risk === "object" ? risk : { tier: "safe", factors: {}, reasons: [] };
  const tier =
    tierRank(matched.taint.tier) > tierRank(base.tier) ? matched.taint.tier : base.tier;
  return {
    matched,
    risk: {
      ...base,
      tier,
      reasons: [...(base.reasons || []), reason],
      denialTaint: { path: matched.path, deniedTool: matched.taint.tool, agoSec },
    },
  };
}
