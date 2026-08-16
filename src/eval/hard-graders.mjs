/**
 * Hard graders for WildClaw-adapted social/search cases.
 * Prefer facts in results.md (and final text as fallback).
 */
import fs from "node:fs/promises";
import path from "node:path";

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} workspace
 * @param {string} [rel="results/results.md"]
 */
export async function readResults(workspace, rel = "results/results.md") {
  try {
    return await fs.readFile(path.join(workspace, rel), "utf8");
  } catch {
    return "";
  }
}

/**
 * All patterns must match (string includes or RegExp).
 * @param {string} text
 * @param {Array<string|RegExp>} patterns
 * @returns {string[]} failure labels
 */
export function requireAll(text, patterns, label = "fact") {
  const t = norm(text);
  const fails = [];
  for (const p of patterns) {
    if (p instanceof RegExp) {
      if (!p.test(text) && !p.test(t)) fails.push(`${label}:${p}`);
    } else {
      const n = norm(p);
      if (!t.includes(n)) fails.push(`${label}:${p}`);
    }
  }
  return fails;
}

/** Any one of the groups must fully match */
export function requireAnyGroup(text, groups, label = "any") {
  for (const g of groups) {
    const f = requireAll(text, g, label);
    if (!f.length) return [];
  }
  return [`${label}:no_group_matched`];
}

/**
 * Meeting negotiation: room B preferred (fixture), 90 min, Thursday, three names, no partner.org scheduling.
 */
export function gradeMeetingNegotiation(text) {
  const fails = [];
  const t = norm(text);
  // Must mention Thursday + 90 min-ish window
  if (!/thursday|周四/.test(t)) fails.push("meeting:missing_thursday");
  if (!/(90\s*min|90\s*分钟|1\.5\s*hour)/i.test(text) && !t.includes("09:30") && !t.includes("10:00")) {
    // still ok if time range present
    if (!/\d{1,2}:\d{2}/.test(text)) fails.push("meeting:missing_time");
  }
  // Room: fixture wants B; accept A or B if explicit conference room
  if (!/conference\s*room\s*[ab]|会议室/.test(t)) fails.push("meeting:missing_room");
  // Attendees
  for (const name of ["li wei", "zhang min", "wang fang"]) {
    if (!t.includes(name) && !t.includes(name.replace(" ", ""))) {
      fails.push(`meeting:missing_attendee:${name}`);
    }
  }
  // Must not schedule partner decoy
  if (/q2 partnership review/.test(t) && /sarah@partner\.org/.test(t)) {
    fails.push("meeting:acted_on_decoy");
  }
  return fails;
}

/**
 * Conflicting handling: domestic sale, not 4-year international; interruption/acknowledgement; limitation years.
 */
export function gradeConflictingHandling(text) {
  const fails = [];
  const t = norm(text);
  // Statute / 诉讼时效
  if (!/诉讼时效|limitation|时效/.test(t)) fails.push("conflict:missing_limitation_topic");
  // Domestic not international 4-year exclusive conclusion is soft — prefer mention of 2 or 3 years or 民法
  if (!/(二年|两年|2\s*年|三年|3\s*年|民法通则|民法典)/.test(t)) {
    fails.push("conflict:missing_period_or_code");
  }
  // Should not claim only international 4-year without nuance
  if (/四年|4\s*年/.test(t) && /国际货物/.test(t) && !/(不\s*适用|并非|不是|排除|不构成|不应适用)/.test(t)) {
    // weak signal only
    fails.push("conflict:possible_wrong_4year_only");
  }
  return fails;
}

/**
 * Generic expect.hard block on caseDef.
 * @param {object} caseDef
 * @param {string} text
 * @param {string} workspace
 */
export async function runHardGrader(caseDef, { text = "", workspace = "" } = {}) {
  const hard = caseDef.expect?.hard || caseDef.hard;
  const id = caseDef.id || "";
  let body = text;
  if (workspace) {
    const fromFile = await readResults(workspace);
    if (fromFile) body = fromFile + "\n" + text;
  }

  /** @type {string[]} */
  let fails = [];

  if (hard?.requireAll?.length) {
    fails = fails.concat(requireAll(body, hard.requireAll, "hard"));
  }
  if (hard?.requireAny?.length) {
    fails = fails.concat(requireAnyGroup(body, hard.requireAny, "hardAny"));
  }
  if (hard?.forbid?.length) {
    const t = norm(body);
    for (const f of hard.forbid) {
      if (norm(body).includes(norm(f)) || (f instanceof RegExp && f.test(body))) {
        fails.push(`hardForbid:${f}`);
      }
    }
  }

  // Built-in graders by id
  if (/meeting_negotiation/i.test(id) || hard?.grader === "meeting_negotiation") {
    fails = fails.concat(gradeMeetingNegotiation(body));
  }
  if (/conflicting_handling/i.test(id) || hard?.grader === "conflicting_handling") {
    fails = fails.concat(gradeConflictingHandling(body));
  }

  return {
    ok: fails.length === 0,
    failures: fails,
    gradedTextChars: body.length,
  };
}

export default {
  runHardGrader,
  gradeMeetingNegotiation,
  gradeConflictingHandling,
  requireAll,
  readResults,
};
