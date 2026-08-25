/**
 * W3 (30-day plan) — the learning WRITE path.
 *
 * The read side has existed since S7/v3.150.0 (recallMemory feeds "lessons
 * from past missions" into the first segment prompt; preferences inject into
 * the loop context). This module closes the loop: after a mission ends, ONE
 * tool-free model call reflects over the mission record and writes up to
 * three typed "lesson" events to durable memory — so an 8-hour mission stops
 * repeating its own mistakes (the audit's W3 line).
 *
 * Contract:
 *  - Best-effort, never throws to the caller; a mission never fails on it.
 *  - Gated: cfg.memory.reflection !== false and cfg.memory.enabled !== false.
 *  - One chat call per finished mission (objectives only, not chat turns).
 *  - Lessons are labeled with provenance (objectiveId, verdict) and are
 *    advisory on read-back — same trust posture as every durable record.
 */
import { appendMemory } from "./durable.mjs";

function buildReflectionPrompt(obj) {
  const criteria = (obj.criteria || [])
    .map((c) => `- [${c.done ? "x" : " "}] ${String(c.text || "").slice(0, 160)}`)
    .join("\n");
  return [
    "You are writing durable lessons for future autonomous missions in this workspace.",
    "Reflect on the finished mission below. Output STRICT JSON only:",
    '{"lessons":[{"kind":"worked"|"failed"|"avoid","lesson":"..."}]}',
    "Rules: at most 3 lessons; each lesson one sentence under 200 characters,",
    "concrete and reusable (name the tactic, tool, or pitfall — not platitudes).",
    "If the mission teaches nothing transferable, output {\"lessons\":[]}.",
    "",
    `Objective: ${String(obj.objective || "").slice(0, 500)}`,
    `Final verdict: ${obj.verdict || obj.status || "done"}`,
    `Segments: ${obj.totals?.segments ?? "?"} · tool calls: ${obj.totals?.toolCalls ?? "?"}`,
    criteria ? `Criteria:\n${criteria}` : "",
    obj.lastDirective ? `Last corrective directive: ${String(obj.lastDirective).slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tolerant JSON extraction: strips code fences, finds the first object. */
export function parseLessons(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.lessons) ? parsed.lessons : [];
  return list
    .filter((l) => l && typeof l.lesson === "string" && l.lesson.trim())
    .slice(0, 3)
    .map((l) => ({
      kind: ["worked", "failed", "avoid"].includes(l.kind) ? l.kind : "worked",
      lesson: l.lesson.trim().slice(0, 200),
    }));
}

/**
 * @param {object} cfg
 * @param {object} obj finished objective record
 * @param {{provider?: {chat: Function}}} [deps] test seam / reuse a live provider
 * @returns {Promise<{written: number}|null>} null when gated off or nothing to do
 */
export async function reflectOnMission(cfg, obj, deps = {}) {
  if (!obj || cfg?.memory?.enabled === false || cfg?.memory?.reflection === false)
    return null;
  const workspace = obj.workingDir || process.cwd();
  try {
    let provider = deps.provider;
    if (!provider) {
      const { createProvider } = await import("../agent/provider.mjs");
      provider = await createProvider(cfg);
    }
    const res = await provider.chat({
      messages: [{ role: "user", content: buildReflectionPrompt(obj) }],
    });
    const text =
      typeof res?.message?.content === "string" ? res.message.content : "";
    const lessons = parseLessons(text);
    let written = 0;
    for (const l of lessons) {
      await appendMemory(cfg, workspace, {
        type: "lesson",
        kind: l.kind,
        summary: l.lesson,
        goal: String(obj.objective || "").slice(0, 300),
        verdict: obj.verdict || obj.status || "done",
        objectiveId: obj.id || null,
      });
      written += 1;
    }
    return { written };
  } catch {
    // reflection is best-effort — a mission never fails because of it
    return null;
  }
}

export default { reflectOnMission, parseLessons };
