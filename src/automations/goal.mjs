/**
 * Goal-mode automations — pursue an open-ended objective across scheduled
 * ticks with persistent state and re-planning, instead of re-running a
 * fixed prompt. Each tick the agent sees the goal + its own prior plan and
 * progress, does one useful step, and emits an updated state block; the
 * automation disables itself when the goal is done or maxTicks is reached.
 */

export const GOAL_STATE_MARKER = "xclaw-goal-state";
export const DEFAULT_MAX_TICKS = 20;
const MAX_PLAN_CHARS = 4000;
const MAX_NOTE_CHARS = 600;
const MAX_PROGRESS_NOTES = 20;
const PROMPT_NOTES = 8;

/** Fresh state for a new goal automation. */
export function initialGoalState() {
  return { tick: 0, plan: "", progress: [], done: false };
}

/** Compose the per-tick prompt from the goal + persisted state. */
export function buildGoalPrompt(auto = {}) {
  const st = auto.state || initialGoalState();
  const notes = (st.progress || []).slice(-PROMPT_NOTES);
  const maxTicks = auto.maxTicks || DEFAULT_MAX_TICKS;
  return [
    `You are pursuing a long-running goal across scheduled sessions. This is tick ${
      (st.tick || 0) + 1
    } of at most ${maxTicks}.`,
    ``,
    `GOAL: ${auto.goal}`,
    ``,
    st.plan ? `CURRENT PLAN:\n${st.plan}` : `There is no plan yet — draft one first.`,
    ``,
    notes.length
      ? `PROGRESS SO FAR (most recent last):\n${notes.map((n) => `- ${n}`).join("\n")}`
      : `No progress recorded yet.`,
    ``,
    `Do the single most useful next step toward the goal now, using tools as needed.`,
    `Then end your reply with exactly one fenced block updating your state:`,
    "```json " + GOAL_STATE_MARKER,
    `{"plan": "<updated plan>", "progressNote": "<what you did/learned this tick>", "done": false}`,
    "```",
    `Set "done": true only when the goal is fully achieved.`,
  ].join("\n");
}

/**
 * Extract the goal-state block from a reply. Prefers the last fenced block
 * carrying the marker; falls back to the last fenced JSON object that has
 * the expected keys. Returns { ok, state? }.
 */
export function parseGoalState(text = "") {
  const s = String(text || "");
  const candidates = [];
  const fence = /```json([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(s)) !== null) {
    candidates.push({ info: m[1] || "", body: m[2] || "" });
  }
  const parse = (body) => {
    try {
      const obj = JSON.parse(body.trim());
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      if (!("plan" in obj || "progressNote" in obj || "done" in obj)) return null;
      return {
        plan: typeof obj.plan === "string" ? obj.plan : null,
        progressNote:
          typeof obj.progressNote === "string" ? obj.progressNote : null,
        done: obj.done === true,
      };
    } catch {
      return null;
    }
  };
  // Marker-tagged blocks first (last one wins), then untagged fallback.
  for (const list of [
    candidates.filter((c) => c.info.includes(GOAL_STATE_MARKER)),
    candidates,
  ]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const st = parse(list[i].body);
      if (st) return { ok: true, state: st };
    }
  }
  return { ok: false };
}

/**
 * Fold one tick's parsed state into the automation's persisted state.
 * @returns {{ state: object, finished: boolean, reason: string|null }}
 */
export function applyGoalTick(auto = {}, parsed = null) {
  const st = { ...initialGoalState(), ...(auto.state || {}) };
  st.progress = Array.isArray(st.progress) ? st.progress.slice() : [];
  st.tick += 1;
  if (parsed?.ok) {
    if (parsed.state.plan) st.plan = parsed.state.plan.slice(0, MAX_PLAN_CHARS);
    if (parsed.state.progressNote) {
      st.progress.push(parsed.state.progressNote.slice(0, MAX_NOTE_CHARS));
    }
    st.done = parsed.state.done === true;
  } else {
    st.progress.push("(tick produced no parsable state update)");
  }
  st.progress = st.progress.slice(-MAX_PROGRESS_NOTES);
  const maxTicks = auto.maxTicks || DEFAULT_MAX_TICKS;
  const exhausted = st.tick >= maxTicks;
  return {
    state: st,
    finished: st.done || exhausted,
    reason: st.done ? "done" : exhausted ? "max_ticks" : null,
  };
}

export default {
  GOAL_STATE_MARKER,
  DEFAULT_MAX_TICKS,
  initialGoalState,
  buildGoalPrompt,
  parseGoalState,
  applyGoalTick,
};
