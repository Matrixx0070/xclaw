/**
 * Long-run objective orchestrator — MISSION → PLAN → ACT → VERIFY → UPDATE
 * STATE → REPLAN → CONTINUE, across as many execution segments as needed.
 *
 * Design (first-principles audit, 2026-08-14):
 *  - The LLM decides WHAT needs to happen each segment; the RUNTIME ensures
 *    the mission survives execution boundaries (turn caps, context windows,
 *    compaction, restarts) and that actions stay governed by the existing
 *    approval/risk gate. (Kastra principle: policy decision point + runtime
 *    control, model reasoning separate.)
 *  - A segment is one runAgentLoop call bounded by agent.maxTurns. Hitting
 *    that cap is an EXECUTION CONSTRAINT — the orchestrator persists state
 *    and starts the next segment. It is never treated as mission completion.
 *  - Context boundaries are invisible by construction: each segment starts
 *    from a fresh context rebuilt from the durable objective state (the
 *    state IS the memory), not from raw transcript replay.
 *  - Completion is criteria-driven: the model derives explicit completion
 *    criteria up front; "done" without satisfied criteria gets bounded
 *    pushback (anti-drift), mirroring the on_stop veto pattern.
 *  - Escalation is classified, not conversational: segments end with a
 *    machine-parsed status — continue | done | needs_human | blocked.
 *    needs_human requires a concrete question; blocked gets one recovery
 *    segment before escalating. Everything else continues automatically.
 *  - Resource bounds (maxSegments / abort / stopRequested) PAUSE the mission
 *    with resumable state — they never silently end it.
 */

import {
  newObjective,
  saveObjective,
  loadObjective,
  mergeStateUpdate,
} from "./objective-store.mjs";
import { getSharedLedger } from "../ops/ledger.mjs";

export const STATE_FENCE = "xclaw-objective-state";

const DEFAULT_MAX_SEGMENTS = 40;
const CRITERIA_PUSHBACK_CAP = 2;
const MISSING_STATE_RETRY_CAP = 1;
const RECOVERY_CAP = 1;

/** Parse the LAST fenced state block from segment text (last-wins, tolerant). */
export function parseStateBlock(text = "") {
  const re = new RegExp("```" + STATE_FENCE + "\\s*\\n([\\s\\S]*?)```", "g");
  let m;
  let last = null;
  while ((m = re.exec(String(text))) !== null) last = m[1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Strip state blocks from user-facing text. */
export function stripStateBlocks(text = "") {
  return String(text)
    .replace(new RegExp("```" + STATE_FENCE + "[\\s\\S]*?```", "g"), "")
    .trim();
}

const STATE_CONTRACT = `
## Mission runtime contract (read carefully)
You are executing ONE segment of a long-running autonomous mission inside the
XClaw runtime. The runtime persists mission state and starts the next segment
automatically — segment boundaries are invisible to the user.

Rules:
- The per-segment turn budget is an execution constraint, NOT mission
  completion. NEVER stop to ask the user whether to continue, which approach
  to take, or whether to proceed — decide, record the decision, and proceed.
- Use the mission state below instead of re-discovering: do NOT re-inspect
  files/dirs already listed as inspected unless verifying a specific claim.
- If an action fails: record it in failures with your diagnosis, attempt
  reasonable recovery, and continue toward the objective.
- Ask the user ONLY via status "needs_human", ONLY for decisions that cannot
  be inferred from the objective, constraints, project context, or policy
  (destructive/production/credential actions are governed by the approval
  gate separately — do not ask conversationally for those).

End EVERY reply with exactly one fenced block:

\`\`\`${STATE_FENCE}
{
  "status": "continue" | "done" | "needs_human" | "blocked",
  "interpretation": "one-line current interpretation of the objective",
  "criteria": [{"id":"c1","text":"...","done":false,"evidence":"..."}],
  "plan": ["..."],
  "currentSubtask": "...",
  "remaining": ["..."],
  "progress": ["work completed THIS segment, compact"],
  "findings": ["important discoveries THIS segment"],
  "decisions": ["decisions made THIS segment"],
  "openQuestions": ["..."],
  "inspected": {"files":["..."],"dirs":["..."],"components":["..."]},
  "failures": [{"what":"...","error":"...","recovery":"..."}],
  "humanQuestion": "REQUIRED when status=needs_human — one concrete question",
  "blockedReason": "REQUIRED when status=blocked"
}
\`\`\`
Only include fields with new content (status is always required). Use
status "done" ONLY when the completion criteria are satisfied (or provably
unachievable — say so in findings).`;

function fmtList(items = [], { max = 30, bullet = "- " } = {}) {
  const arr = items.slice(-max);
  return arr.length ? arr.map((x) => bullet + x).join("\n") : "(none yet)";
}

function fmtCriteria(criteria = []) {
  if (!criteria.length) return "(derive them in your first state block)";
  return criteria
    .map((c) => `- [${c.done ? "x" : " "}] ${c.id ? c.id + ": " : ""}${c.text}`)
    .join("\n");
}

/** Build the continuation prompt for a segment from durable state ONLY. */
export function buildSegmentPrompt(obj, { firstSegment = false, directive = null, reconcile = false } = {}) {
  const parts = [];
  parts.push(`# Mission (objective given by the user — verbatim, authoritative)`);
  parts.push(obj.objective);
  parts.push("");
  if (firstSegment) {
    parts.push(
      "This is the FIRST segment. Derive an interpretation, explicit completion criteria, and a plan in your state block — then begin executing immediately (do not wait for approval of the plan)."
    );
  } else {
    parts.push(`# Mission state (durable — your memory across segments)`);
    if (obj.interpretation) parts.push(`Interpretation: ${obj.interpretation}`);
    parts.push(`\n## Completion criteria\n${fmtCriteria(obj.criteria)}`);
    parts.push(`\n## Plan\n${fmtList(obj.plan, { max: 40 })}`);
    if (obj.currentSubtask) parts.push(`\n## Current subtask\n${obj.currentSubtask}`);
    parts.push(`\n## Remaining work\n${fmtList(obj.remaining, { max: 40 })}`);
    parts.push(`\n## Progress so far\n${fmtList(obj.progress, { max: 40 })}`);
    parts.push(`\n## Key findings\n${fmtList(obj.findings, { max: 40 })}`);
    if (obj.decisions.length) {
      parts.push(`\n## Decisions already made (do not re-litigate)\n${fmtList(obj.decisions, { max: 20 })}`);
    }
    if (obj.constraints.length) parts.push(`\n## Constraints\n${fmtList(obj.constraints, { max: 15 })}`);
    if (obj.openQuestions.length) parts.push(`\n## Open questions\n${fmtList(obj.openQuestions, { max: 15 })}`);
    if (obj.failures.length) {
      parts.push(
        `\n## Failed attempts (avoid repeating)\n` +
          obj.failures
            .slice(-8)
            .map((f) => `- ${f.what}${f.error ? ` — ${f.error}` : ""}${f.recovery ? ` (recovery: ${f.recovery})` : ""}`)
            .join("\n")
      );
    }
    const files = obj.inspected.files;
    if (files.length) {
      parts.push(
        `\n## Already inspected (${files.length} files — do NOT re-read unless verifying a claim)\n` +
          fmtList(files, { max: 80 })
      );
    }
  }
  if (reconcile) {
    parts.push(
      "\n# Runtime notice\nThe runtime restarted since the last segment. Before continuing, quickly reconcile the state above with reality (spot-check the most load-bearing claims), then continue."
    );
  }
  if (directive) parts.push(`\n# Runtime directive for THIS segment\n${directive}`);
  parts.push(STATE_CONTRACT);
  return parts.join("\n");
}

const SEGMENT_RESCUE_PROMPT =
  "Segment turn budget exhausted — no more tool calls in this segment (the runtime continues the mission in the next segment automatically). " +
  `Emit ONLY the ${STATE_FENCE} fenced state block now: status "continue", with this segment's progress/findings/inspected recorded so the next segment resumes exactly where you left off.`;

function ledgerEvent(cfg, obj, phase, data = {}) {
  try {
    getSharedLedger(cfg).append({
      kind: "phase",
      ids: { sessionId: obj.sessionKey || undefined, jobId: obj.id },
      actor: "objective",
      data: { phase, objectiveId: obj.id, ...data },
    });
  } catch {
    /* ledger best-effort */
  }
}

/**
 * Run (or resume) an objective to completion / escalation / pause.
 *
 * @param {object} cfg
 * @param {object} opts
 * @param {string} [opts.objective]  new mission text (mutually exclusive w/ resume)
 * @param {string} [opts.resumeId]   objective id to resume
 * @param {string} [opts.answer]     owner's answer when resuming awaiting_human
 * @param {Function} opts.runSegment async ({prompt, rescuePrompt, sessionId}) => loop result
 *                                   (channel wiring provides one closing over its
 *                                   provider/gate/workingDir plumbing)
 * @param {Function} [opts.notify]   async (text, {kind}) => void — user-facing updates
 * @param {Function} [opts.onEvent]
 * @param {AbortSignal} [opts.signal]
 */
export async function runObjective(cfg, opts = {}) {
  const {
    runSegment,
    notify = async () => {},
    signal = null,
  } = opts;
  if (typeof runSegment !== "function") throw new Error("runSegment required");
  // Every lifecycle event also reaches the WS hub (B5 pattern) so Control
  // surfaces see missions live regardless of which channel runs them.
  const onEvent = (e) => {
    try {
      globalThis.__xclawWsBroadcast?.("objective", e);
    } catch {
      /* hub optional */
    }
    try {
      opts.onEvent?.(e);
    } catch {
      /* observer errors never break the mission */
    }
  };

  let obj;
  let reconcile = false;
  let pendingAnswer = null;
  if (opts.resumeId) {
    obj = await loadObjective(cfg, opts.resumeId);
    if (!obj) throw new Error(`objective not found: ${opts.resumeId}`);
    reconcile = obj.status === "interrupted";
    if (obj.status === "awaiting_human" && opts.answer) {
      pendingAnswer = String(opts.answer);
      obj.decisions = [...obj.decisions, `Owner answered: ${pendingAnswer.slice(0, 300)}`];
      obj.humanQuestion = null;
    }
    obj.status = "running";
    obj.stopRequested = false;
  } else {
    obj = newObjective({
      objective: opts.objective,
      sessionKey: opts.sessionKey || null,
      channel: opts.channel || null,
      chatId: opts.chatId || null,
      workingDir: opts.workingDir || null,
    });
    if (opts.seed) mergeStateUpdate(obj, opts.seed);
    ledgerEvent(cfg, obj, "objective_started", { objective: obj.objective.slice(0, 200) });
  }
  await saveObjective(cfg, obj);
  onEvent({ type: "objective", phase: "start", id: obj.id, resumed: Boolean(opts.resumeId) });

  const maxSegments = Number(cfg.objectives?.maxSegments) || DEFAULT_MAX_SEGMENTS;
  const progressEvery = Number(cfg.objectives?.progressEverySegments) || 5;
  let pushbacks = 0;
  let missingStateRetries = 0;
  let recoveries = 0;
  let directive = pendingAnswer
    ? `The owner answered your question: "${pendingAnswer.slice(0, 500)}". Incorporate it and continue.`
    : null;

  while (true) {
    // ── runtime control between segments ─────────────────────────────────
    if (signal?.aborted) {
      obj.status = "interrupted";
      await saveObjective(cfg, obj);
      return { status: obj.status, id: obj.id, objective: obj };
    }
    const fresh = await loadObjective(cfg, obj.id);
    if (obj.stopRequested || fresh?.stopRequested) {
      obj.status = "stopped";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_stopped", {});
      await notify(`🛑 Mission ${obj.id} stopped at your request. State is preserved — /objective resume to continue.`, { kind: "stopped" });
      return { status: obj.status, id: obj.id, objective: obj };
    }
    if (obj.totals.segments >= maxSegments) {
      obj.status = "paused_budget";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_paused", { reason: "maxSegments", segments: obj.totals.segments });
      await notify(
        `⏸ Mission ${obj.id} paused: segment budget reached (${obj.totals.segments}/${maxSegments}). ` +
          `Progress is saved (${obj.criteria.filter((c) => c.done).length}/${obj.criteria.length} criteria done). /objective resume to continue.`,
        { kind: "paused" }
      );
      return { status: obj.status, id: obj.id, objective: obj };
    }

    // ── run one segment ──────────────────────────────────────────────────
    const n = obj.totals.segments + 1;
    const firstSegment = n === 1 && !opts.resumeId;
    const prompt = buildSegmentPrompt(obj, { firstSegment, directive, reconcile });
    directive = null;
    reconcile = false;
    onEvent({ type: "objective", phase: "segment_start", id: obj.id, segment: n });

    let seg;
    try {
      seg = await runSegment({
        prompt,
        rescuePrompt: SEGMENT_RESCUE_PROMPT,
        sessionId: `objective-${obj.id}`,
        objectiveId: obj.id,
        segment: n,
      });
    } catch (e) {
      // segment-level crash: record, retry once via recovery, else pause
      obj.failures.push({
        at: new Date().toISOString(),
        what: `segment ${n} crashed`,
        error: String(e?.message || e).slice(0, 300),
        recovery: recoveries < RECOVERY_CAP ? "retrying segment" : "paused for operator",
      });
      if (recoveries < RECOVERY_CAP) {
        recoveries += 1;
        await saveObjective(cfg, obj);
        continue;
      }
      obj.status = "interrupted";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_interrupted", { error: String(e?.message || e).slice(0, 200) });
      await notify(`⚠️ Mission ${obj.id} hit a runtime error twice and paused. /objective resume to retry.`, { kind: "error" });
      return { status: obj.status, id: obj.id, objective: obj };
    }

    // A /objective stop lands on DISK while the segment runs — our in-memory
    // copy would clobber it on the next save (the automations lost-update
    // class). Re-sync the flag before any post-segment save.
    try {
      const onDisk = await loadObjective(cfg, obj.id);
      if (onDisk?.stopRequested) obj.stopRequested = true;
    } catch {
      /* best-effort */
    }

    const text = String(seg?.text || "");
    const update = parseStateBlock(text);
    obj.totals.segments = n;
    obj.totals.turns += Number(seg?.turns) || 0;
    obj.totals.toolCalls += Array.isArray(seg?.toolTrace) ? seg.toolTrace.length : 0;
    obj.segments.push({
      n,
      turns: Number(seg?.turns) || 0,
      toolCalls: Array.isArray(seg?.toolTrace) ? seg.toolTrace.length : 0,
      stopReason: seg?.stopReason || null,
      status: update?.status || null,
      at: new Date().toISOString(),
    });
    obj.segments = obj.segments.slice(-200);

    if (update) {
      mergeStateUpdate(obj, update);
      missingStateRetries = 0;
    } else {
      // No parseable state: one reminder segment, then fail toward the user
      // with whatever the model said (never loop blind).
      if (missingStateRetries < MISSING_STATE_RETRY_CAP && seg?.stopReason !== "aborted") {
        missingStateRetries += 1;
        directive =
          `Your previous segment did not end with a parseable ${STATE_FENCE} block. ` +
          `Re-emit the full state block now (status continue/done/needs_human/blocked) and continue.`;
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "segment_missing_state", { segment: n });
        continue;
      }
      obj.status = "awaiting_human";
      obj.humanQuestion = "The mission runtime lost the model's structured state twice. Review and /objective resume.";
      await saveObjective(cfg, obj);
      await notify(
        `⚠️ Mission ${obj.id}: could not parse mission state from the model. Last output:\n\n${stripStateBlocks(text).slice(0, 1500)}\n\n/objective resume to continue.`,
        { kind: "escalated" }
      );
      return { status: obj.status, id: obj.id, objective: obj };
    }

    const status = String(update.status || "continue").toLowerCase();
    ledgerEvent(cfg, obj, "objective_segment", {
      segment: n,
      status,
      stopReason: seg?.stopReason || null,
      toolCalls: obj.segments.at(-1).toolCalls,
      criteriaDone: obj.criteria.filter((c) => c.done).length,
      criteriaTotal: obj.criteria.length,
    });
    onEvent({
      type: "objective",
      phase: "segment_end",
      id: obj.id,
      segment: n,
      status,
      stopReason: seg?.stopReason || null,
    });

    // ── classify ─────────────────────────────────────────────────────────
    if (status === "needs_human") {
      const q = String(update.humanQuestion || "").trim();
      if (q) {
        obj.status = "awaiting_human";
        obj.humanQuestion = q.slice(0, 1000);
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "objective_escalated", { question: obj.humanQuestion.slice(0, 200) });
        await notify(`❓ Mission ${obj.id} needs your input:\n\n${obj.humanQuestion}\n\n(Reply in this chat to answer and continue.)`, { kind: "escalated" });
        return { status: obj.status, id: obj.id, objective: obj };
      }
      // needs_human without a concrete question is not an escalation
      directive =
        "You set status needs_human without a concrete humanQuestion. Either ask ONE specific question the user must answer, or decide yourself and continue.";
      await saveObjective(cfg, obj);
      continue;
    }

    if (status === "blocked") {
      if (recoveries < RECOVERY_CAP) {
        recoveries += 1;
        directive =
          `You reported blocked: "${String(update.blockedReason || "").slice(0, 300)}". ` +
          "Diagnose the blocker with tools, attempt a reasonable recovery or an alternate approach, and continue. Escalate with needs_human + a concrete question ONLY if recovery is truly impossible.";
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "objective_recovery", { reason: String(update.blockedReason || "").slice(0, 200) });
        continue;
      }
      obj.status = "awaiting_human";
      obj.humanQuestion = `Blocked after recovery attempt: ${String(update.blockedReason || "unknown").slice(0, 500)}`;
      await saveObjective(cfg, obj);
      await notify(`⚠️ Mission ${obj.id} blocked: ${obj.humanQuestion}\n\n(Reply to unblock, or /objective stop.)`, { kind: "escalated" });
      return { status: obj.status, id: obj.id, objective: obj };
    }

    if (status === "done") {
      const open = obj.criteria.filter((c) => !c.done);
      if (open.length && pushbacks < CRITERIA_PUSHBACK_CAP) {
        // anti-drift: done without satisfied criteria gets bounded pushback
        pushbacks += 1;
        directive =
          `You reported done, but these completion criteria are NOT satisfied:\n` +
          open.map((c) => `- ${c.text}`).join("\n") +
          `\nEither complete them, or mark a criterion done with concrete evidence, or explain in findings why it is unachievable and adjust the criteria honestly. Then continue (or done again if truly complete).`;
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "objective_pushback", { openCriteria: open.length });
        continue;
      }
      obj.status = "done";
      obj.finalAnswer = stripStateBlocks(text).slice(0, 12000) || "(mission complete)";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_done", {
        segments: obj.totals.segments,
        toolCalls: obj.totals.toolCalls,
        criteriaDone: obj.criteria.filter((c) => c.done).length,
        criteriaTotal: obj.criteria.length,
      });
      onEvent({ type: "objective", phase: "done", id: obj.id });
      await notify(
        `✅ Mission complete (${obj.totals.segments} segments, ${obj.totals.toolCalls} tool calls).\n\n${obj.finalAnswer}`,
        { kind: "done" }
      );
      return { status: obj.status, id: obj.id, objective: obj };
    }

    // continue (default)
    await saveObjective(cfg, obj);
    if (progressEvery > 0 && n % progressEvery === 0) {
      const done = obj.criteria.filter((c) => c.done).length;
      await notify(
        `⏳ Mission ${obj.id}: segment ${n}, ${obj.totals.toolCalls} tool calls, criteria ${done}/${obj.criteria.length}. Current: ${obj.currentSubtask || "working"}`,
        { kind: "progress" }
      );
    }
  }
}

export default { runObjective, buildSegmentPrompt, parseStateBlock, stripStateBlocks, STATE_FENCE };
