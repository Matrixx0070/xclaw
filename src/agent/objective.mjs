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
  ensureCounters,
  normalizeDeadline,
  normalizeBudget,
} from "./objective-store.mjs";
import { getSharedLedger } from "../ops/ledger.mjs";
import { estimateUsdFromUsage } from "../tokens/cost-governor.mjs";
import { rememberNote, recallMemory } from "../memory/recall.mjs";

export const STATE_FENCE = "xclaw-objective-state";

/**
 * W3a operator guardrails, checked BETWEEN segments (same granularity as the
 * segment budget). Returns a typed { reason, message, ... } when a limit is
 * hit, else null. Operator-set only — a model cannot extend its own limits;
 * /objective resume with a raised cap continues past a pause.
 */
export function checkObjectiveGuardrails(obj, now = Date.now()) {
  if (obj.deadline) {
    const dl = Date.parse(obj.deadline);
    if (Number.isFinite(dl) && now >= dl) {
      return { reason: "deadline", message: `deadline reached (${obj.deadline})`, deadline: obj.deadline };
    }
  }
  const b = obj.budget || {};
  const toolCalls = Number(obj.totals?.toolCalls) || 0;
  if (Number.isFinite(b.maxToolCalls) && toolCalls >= b.maxToolCalls) {
    return {
      reason: "maxToolCalls",
      message: `tool-call budget reached (${toolCalls}/${b.maxToolCalls})`,
      toolCalls,
      maxToolCalls: b.maxToolCalls,
    };
  }
  const costUsd = Number(obj.totals?.costUsd) || 0;
  if (Number.isFinite(b.maxUsd) && costUsd >= b.maxUsd) {
    return {
      reason: "maxUsd",
      message: `spend budget reached ($${costUsd.toFixed(4)}/$${b.maxUsd})`,
      costUsd,
      maxUsd: b.maxUsd,
    };
  }
  return null;
}

/** USD spent by one segment: real cost when the provider bills it, else an
 * estimate from token usage (same path as the loop's daily-governor feed). */
function segmentUsd(cfg, seg) {
  const u = seg?.usage;
  if (!u || typeof u !== "object") return 0;
  if (u.hasCost && Number.isFinite(u.costUsd)) return Number(u.costUsd) || 0;
  if (u.hasRealUsage) {
    try {
      const est = estimateUsdFromUsage(
        { prompt_tokens: u.promptTokens, completion_tokens: u.completionTokens },
        cfg,
        { modelRef: seg?.model }
      );
      return est > 0 ? est : 0;
    } catch {
      /* estimate optional */
    }
  }
  return 0;
}

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
  "assumptions": ["working assumptions you are proceeding on instead of stopping to ask"],
  "openQuestions": ["..."],
  "inspected": {"files":["..."],"dirs":["..."],"components":["..."]},
  "failures": [{"what":"...","error":"...","recovery":"..."}],
  "verify": [{"type":"file_contains","path":"...","text":"..."}],
  "humanQuestion": "REQUIRED when status=needs_human — one concrete question",
  "blockedReason": "REQUIRED when status=blocked"
}
\`\`\`
Only include fields with new content (status is always required). Use
status "done" ONLY when the completion criteria are satisfied (or provably
unachievable — say so in findings).
"verify" may propose deterministic completion checks (file_exists /
file_contains / file_equals / text_contains, or READ-ONLY "command" checks).
The runtime executes them mechanically at completion: they can REJECT a
done, but model-proposed checks alone never approve one.`;

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
export function buildSegmentPrompt(obj, { firstSegment = false, directive = null, reconcile = false, lessons = "" } = {}) {
  const parts = [];
  parts.push(`# Mission (objective given by the user — verbatim, authoritative)`);
  parts.push(obj.objective);
  parts.push("");
  if (firstSegment) {
    parts.push(
      "This is the FIRST segment. Derive an interpretation, explicit completion criteria, and a plan in your state block — then begin executing immediately (do not wait for approval of the plan)."
    );
    if (lessons && lessons.trim()) {
      parts.push(
        `\n# Lessons from past missions (durable memory — advisory; verify before relying)\n${lessons.trim()}`
      );
    }
  } else {
    parts.push(`# Mission state (durable — your memory across segments)`);
    if (obj.interpretation) parts.push(`Interpretation: ${obj.interpretation}`);
    parts.push(`\n## Completion criteria\n${fmtCriteria(obj.criteria)}`);
    parts.push(`\n## Plan${obj.planVersion ? ` (v${obj.planVersion})` : ""}\n${fmtList(obj.plan, { max: 40 })}`);
    if (obj.currentSubtask) parts.push(`\n## Current subtask\n${obj.currentSubtask}`);
    parts.push(`\n## Remaining work\n${fmtList(obj.remaining, { max: 40 })}`);
    parts.push(`\n## Progress so far\n${fmtList(obj.progress, { max: 40 })}`);
    parts.push(`\n## Key findings\n${fmtList(obj.findings, { max: 40 })}`);
    if (obj.decisions.length) {
      parts.push(`\n## Decisions already made (do not re-litigate)\n${fmtList(obj.decisions, { max: 20 })}`);
    }
    if (obj.assumptions?.length) {
      parts.push(`\n## Working assumptions (proceeding on these — challenge only if evidence contradicts)\n${fmtList(obj.assumptions, { max: 20 })}`);
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
/**
 * E-A (Master Evolution Directive): deterministic completion gate. When the
 * objective carries typed verify checks, NO done-path may complete while a
 * check fails — command exits and file assertions outrank any narration
 * (the actor's or the verifier segment's).
 */
async function runDeterministicChecks(obj) {
  if (!Array.isArray(obj.verify) || !obj.verify.length) return { ok: true, ran: false };
  try {
    const { runVerifyChecks } = await import("../jobs/verify.mjs");
    const res = await runVerifyChecks(obj.workingDir || process.cwd(), obj.verify);
    const failing = (res.results || []).filter((r) => !r.pass);
    return {
      ok: res.ok,
      ran: true,
      failing,
      summary:
        failing
          .map(
            (r) =>
              `${r.type}${r.path ? " " + r.path : ""}${r.cmd ? " " + r.cmd : ""}: FAIL${r.detail ? " (" + r.detail + ")" : ""}`
          )
          .join("; ") || null,
    };
  } catch (e) {
    return { ok: false, ran: true, error: String(e?.message || e) };
  }
}

/**
 * Learning write-path: persist a durable outcome memory when a mission
 * completes, so future missions with a similar goal recall what happened
 * (see the lessons injection before the segment loop). Best-effort — a
 * mission never fails because we could not record its outcome. Idempotent
 * via a persisted flag so a re-run of an already-done mission never
 * double-logs.
 */
async function persistOutcome(cfg, obj) {
  if (!obj || obj._outcomeLogged) return;
  if (cfg?.memory?.enabled === false) return;
  try {
    await rememberNote(
      cfg,
      obj.workingDir || process.cwd(),
      `Mission ${obj.verdict || "done"}: ${String(obj.objective || "").slice(0, 180)}`,
      {
        type: "outcome",
        goal: String(obj.objective || "").slice(0, 500),
        verdict: obj.verdict || "done",
        objectiveId: obj.id,
        segments: obj.totals?.segments ?? null,
        toolCalls: obj.totals?.toolCalls ?? null,
        criteria: (obj.criteria || []).map((c) => ({
          text: String(c.text || "").slice(0, 200),
          done: !!c.done,
        })),
      }
    );
    obj._outcomeLogged = true;
    await saveObjective(cfg, obj);
    // W3 — learning write-path: one tool-free reflection call turns the
    // finished mission into up to three durable "lesson" events, which the
    // recall above feeds into the NEXT mission's first segment. Best-effort,
    // gated by memory.reflection (default on).
    try {
      const { reflectOnMission } = await import("../memory/reflection.mjs");
      const r = await reflectOnMission(cfg, obj);
      if (r?.written) {
        console.log(`[objective] reflection wrote ${r.written} lesson(s) for ${obj.id}`);
      }
    } catch {
      /* reflection is additive — never block on it */
    }
  } catch {
    /* memory is best-effort — never let a logging failure surface */
  }
}

/**
 * Public entry: run the segmented orchestrator, then record the outcome on
 * any done-path (there are several scattered returns; wrapping the boundary
 * catches them all — current and future — in one place).
 */
export async function runObjective(cfg, opts = {}) {
  const result = await runObjectiveInner(cfg, opts);
  if (result?.objective?.status === "done" && !result.objective._outcomeLogged) {
    await persistOutcome(cfg, result.objective);
  }
  return result;
}

async function runObjectiveInner(cfg, opts = {}) {
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
      // Preference write-back: the owner's mid-mission answer is where durable
      // preferences surface ("always run tests", "never force-push"). Mirror
      // job.mjs's on-success extraction; approve-only answers yield no hints.
      if (cfg.memory?.preferenceWriteBack !== false) {
        try {
          const { extractPreferenceHints, writePreferences } = await import(
            "../memory/preferences.mjs"
          );
          const hints = extractPreferenceHints(pendingAnswer);
          if (hints.length) {
            const w = await writePreferences(cfg, hints, { source: obj.id });
            if (w.written)
              obj.preferencesWritten = (obj.preferencesWritten || 0) + w.written;
          }
        } catch { /* preference write-back is best-effort */ }
      }
    }
    obj.status = "running";
    obj.stopRequested = false;
    // Operator may raise (or set) the deadline / budget when resuming a
    // paused mission — this is how /objective resume continues past a cap.
    if (opts.deadline !== undefined && opts.deadline !== null)
      obj.deadline = normalizeDeadline(opts.deadline);
    if (opts.budget) obj.budget = normalizeBudget(opts.budget);
  } else {
    obj = newObjective({
      objective: opts.objective,
      sessionKey: opts.sessionKey || null,
      channel: opts.channel || null,
      chatId: opts.chatId || null,
      workingDir: opts.workingDir || null,
      verify: opts.verify || null,
      deadline: opts.deadline || null,
      budget: opts.budget || null,
    });
    if (opts.seed) mergeStateUpdate(obj, opts.seed);
    ledgerEvent(cfg, obj, "objective_started", { objective: obj.objective.slice(0, 200) });
  }
  ensureCounters(obj);

  // A restart mid-segment leaves inFlightSegment set: that segment's tool
  // work happened on disk but was never recorded. Tell the next segment so
  // it verifies instead of blindly redoing (or worse, double-applying).
  if (opts.resumeId && obj.inFlightSegment) {
    obj.failures = [
      ...obj.failures,
      {
        at: new Date().toISOString(),
        what: `segment ${obj.inFlightSegment.n} was interrupted mid-flight — its partial work may already exist on disk`,
        error: null,
        recovery: "verify what already exists before redoing it",
      },
    ].slice(-40);
    obj.inFlightSegment = null;
  }

  // Trust Sprint: owner ruling on a completion held by the fail-closed gate.
  if (opts.resumeId && obj.pendingCompletion) {
    const approveRe = /^(approve|approved|accept|accepted|ok|okay|yes|lgtm|confirm|confirmed)\b/i;
    if (pendingAnswer && approveRe.test(pendingAnswer.trim())) {
      obj.pendingCompletion = null;
      obj.status = "done";
      obj.verdict = "owner-approved";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_done", {
        ownerApproved: true,
        segments: obj.totals.segments,
        toolCalls: obj.totals.toolCalls,
      });
      onEvent({ type: "objective", phase: "done", id: obj.id, ownerApproved: true });
      await notify(
        `✅ Mission ${obj.id} accepted by owner (verdict: owner-approved).` +
          (obj.finalAnswer ? `\n\n${obj.finalAnswer.slice(0, 1500)}` : ""),
        { kind: "done" }
      );
      return { status: obj.status, id: obj.id, objective: obj };
    }
    if (pendingAnswer) {
      // Any non-approve answer clears the hold — the owner wants more work
      // (often: what to verify). The answer already became the directive.
      obj.pendingCompletion = null;
      obj.verdict = null;
    } else {
      // Resumed without an answer: re-ask; never burn segments to re-derive
      // the same held completion.
      obj.status = "awaiting_human";
      await saveObjective(cfg, obj);
      await notify(
        `⏸ Mission ${obj.id} is holding a finished-but-unverified result.\n` +
          (obj.humanQuestion || 'Reply "approve" to accept it, or tell me what to verify.'),
        { kind: "question" }
      );
      return { status: obj.status, id: obj.id, objective: obj };
    }
  }

  // Trust Sprint: derive deterministic checks from the project ONCE, arming
  // only the ones that pass a baseline run (a suite already red before the
  // mission started is the project's condition, not mission signal).
  if (
    cfg.objectives?.deriveChecks !== false &&
    !obj.verifyDeriveTried &&
    !(Array.isArray(obj.verify) && obj.verify.length)
  ) {
    obj.verifyDeriveTried = true;
    try {
      const { deriveVerifyChecks, baselineArmChecks } = await import("./objective-verify.mjs");
      const derived = await deriveVerifyChecks(obj.workingDir);
      if (derived.length) {
        const { armed, dropped } = await baselineArmChecks(obj.workingDir, derived);
        if (armed.length) {
          obj.verify = [...(obj.verify || []), ...armed];
          obj.progress = [
            ...obj.progress,
            `Runtime armed ${armed.length} deterministic verification check(s) derived from the project (baseline-passing).`,
          ];
        }
        ledgerEvent(cfg, obj, "verify_derived", { armed: armed.length, dropped: dropped.length });
        onEvent({ type: "objective", phase: "verify_derived", id: obj.id, armed: armed.length, dropped: dropped.length });
      }
    } catch {
      /* derivation is best-effort — the gate still fails CLOSED without checks */
    }
  }
  await saveObjective(cfg, obj);
  onEvent({ type: "objective", phase: "start", id: obj.id, resumed: Boolean(opts.resumeId) });

  const maxSegments = Number(cfg.objectives?.maxSegments) || DEFAULT_MAX_SEGMENTS;
  const progressEvery = Number(cfg.objectives?.progressEverySegments) || 5;
  const VERIFY_GATE_CAP = 2;
  // Trust Sprint: recovery/pushback counters live IN the objective and are
  // persisted with every save. As runObjective locals they reset on every
  // resume — a crash-looping mission could burn its recovery budget forever
  // without ever escalating (audit C#9).
  const ctr = obj.counters;
  let directive = pendingAnswer
    ? `The owner answered your question: "${pendingAnswer.slice(0, 500)}". Incorporate it and continue.`
    : null;

  /**
   * E-A: every done-path calls this before completing. Returns null when the
   * mission may close (verdict recorded), "continue" when a deterministic
   * failure was fed back as a directive, "escalated" when the cap is spent.
   */
  const deterministicGate = async (fallbackVerdict, { finalAnswer = null } = {}) => {
    const gate = await runDeterministicChecks(obj);
    if (gate.ok) {
      const checks = Array.isArray(obj.verify) ? obj.verify : [];
      // "Trusted" = operator-provided (api / no source stamp) or
      // runtime-derived. Model-proposed checks can reject but never close:
      // a model that gamed the work can just as easily propose a check that
      // passes on the gamed state.
      const trusted = gate.ran && checks.some((c) => c.source !== "model");
      if (trusted) {
        obj.verdict = "verified";
        return null;
      }
      obj.verdict = gate.ran ? "model-verified" : fallbackVerdict;
      if (cfg.objectives?.requireChecked === false) return null;
      // Fail-closed (Trust Sprint): no trusted deterministic evidence
      // exists, so hold the completion for the owner instead of narrating
      // success — the exact hole live benchmark F drove through.
      if (finalAnswer) obj.finalAnswer = String(finalAnswer).slice(0, 12000);
      obj.pendingCompletion = {
        reason: gate.ran ? "model_checks_only" : "no_checks",
        at: new Date().toISOString(),
      };
      obj.status = "awaiting_human";
      obj.humanQuestion =
        obj.pendingCompletion.reason === "model_checks_only"
          ? 'The work passed only model-proposed checks — no trusted verification exists. Reply "approve" to accept, or tell me what to verify.'
          : 'No deterministic verification exists for this mission. Reply "approve" to accept the result as-is, or tell me what to verify.';
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "verify_gate_hold", {
        reason: obj.pendingCompletion.reason,
        verdict: obj.verdict,
      });
      onEvent({ type: "objective", phase: "awaiting_human", id: obj.id, reason: obj.pendingCompletion.reason });
      await notify(
        `🔒 Mission ${obj.id} finished its work but has no trusted verification (` +
          (obj.pendingCompletion.reason === "model_checks_only"
            ? "only model-proposed checks passed"
            : "no deterministic checks exist") +
          `).` +
          (obj.finalAnswer ? `\n\nResult:\n${obj.finalAnswer.slice(0, 1200)}` : "") +
          `\n\nReply "approve" to accept, or tell me what to verify.`,
        { kind: "question" }
      );
      return "escalated";
    }
    const what = gate.summary || gate.error || "checks failed";
    if (ctr.verifyGateFails < VERIFY_GATE_CAP) {
      ctr.verifyGateFails += 1;
      directive = `Deterministic verification REJECTED completion — these checks fail: ${what}. Fix exactly these, then finish again.`;
      ledgerEvent(cfg, obj, "verify_gate_reject", { fails: ctr.verifyGateFails, what: what.slice(0, 300) });
      onEvent({ type: "objective", phase: "verify_gate_reject", id: obj.id, what });
      await saveObjective(cfg, obj);
      return "continue";
    }
    obj.status = "awaiting_human";
    obj.humanQuestion = `Deterministic verification still failing after ${VERIFY_GATE_CAP} fix attempts: ${what}`;
    await saveObjective(cfg, obj);
    ledgerEvent(cfg, obj, "verify_gate_escalate", { what: what.slice(0, 300) });
    onEvent({ type: "objective", phase: "awaiting_human", id: obj.id });
    await notify(`⚠️ Mission ${obj.id} paused — verification keeps failing: ${what}\n/objective resume to continue.`, { kind: "question" });
    return "escalated";
  };

  // Proactive learning: recall outcomes/notes of past missions with a
  // similar goal so the model starts from what worked / what failed instead
  // of relearning it. Mirrors loop.mjs preference read-back (S7): memory
  // that never changes behaviour is not memory. Advisory only, first
  // segment only, never on resume, never blocks the mission.
  let lessons = "";
  if (cfg.memory?.recall !== false && !opts.resumeId) {
    try {
      const recalled = await recallMemory(cfg, obj.workingDir || process.cwd(), {
        query: obj.objective,
        limit: 6,
      });
      const hits = (recalled?.hits || []).filter((h) => h.summary || h.goal);
      if (hits.length) {
        lessons = hits
          .slice(0, 6)
          .map((h) => `- ${String(h.summary || h.goal).slice(0, 200)}`)
          .join("\n");
      }
    } catch {
      /* recall is additive — never block a mission on it */
    }
  }

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
    // ── operator guardrails: wall-clock deadline + spend/tool-call budget ─
    const gr = checkObjectiveGuardrails(obj);
    if (gr) {
      obj.status = "paused_budget";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_paused", gr);
      onEvent({ type: "objective", phase: "paused", id: obj.id, ...gr });
      await notify(
        `⏸ Mission ${obj.id} paused: ${gr.message}. ` +
          `Progress is saved (${obj.criteria.filter((c) => c.done).length}/${obj.criteria.length} criteria done). ` +
          `/objective resume ${gr.reason === "deadline" ? "with a later deadline" : "with a higher budget"} to continue.`,
        { kind: "paused" }
      );
      return { status: obj.status, id: obj.id, objective: obj };
    }

    // ── run one segment ──────────────────────────────────────────────────
    const n = obj.totals.segments + 1;
    const firstSegment = n === 1 && !opts.resumeId;
    const prompt = buildSegmentPrompt(obj, { firstSegment, directive, reconcile, lessons: firstSegment ? lessons : "" });
    directive = null;
    reconcile = false;
    onEvent({ type: "objective", phase: "segment_start", id: obj.id, segment: n });
    // Mark the segment in-flight BEFORE running it: if the process dies
    // mid-segment, resume sees the marker and warns the next segment that
    // unrecorded partial work may exist (audit: benchmark H lost in-flight
    // work silently).
    obj.inFlightSegment = { n, startedAt: new Date().toISOString() };
    await saveObjective(cfg, obj);

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
        recovery: ctr.recoveries < RECOVERY_CAP ? "retrying segment" : "paused for operator",
      });
      if (ctr.recoveries < RECOVERY_CAP) {
        ctr.recoveries += 1;
        await saveObjective(cfg, obj);
        continue;
      }
      obj.status = "interrupted";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "objective_interrupted", { error: String(e?.message || e).slice(0, 200) });
      await notify(`⚠️ Mission ${obj.id} hit a runtime error twice and paused. /objective resume to retry.`, { kind: "error" });
      return { status: obj.status, id: obj.id, objective: obj };
    }

    obj.inFlightSegment = null;
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
    obj.totals.costUsd = (Number(obj.totals.costUsd) || 0) + segmentUsd(cfg, seg);
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
      ctr.missingStateRetries = 0;
    } else {
      // No parseable state block. Distinguish the model CHOOSING to end its
      // turn (stopReason "natural"/"hook") from the runtime CUTTING IT OFF
      // ("maxTurns"/"budget"/"guard"). A natural stop with a substantive
      // answer and no open criteria is the model signaling completion —
      // surface its answer as the result instead of a scary "runtime lost
      // state" error. (Omitting the fenced block once the work is clearly
      // finished is a formatting miss, not a failure — and models vary in
      // how reliably they emit it when they consider themselves done.)
      const prose = stripStateBlocks(text).trim();
      const modelEndedTurn = seg?.stopReason === "natural" || seg?.stopReason === "hook";
      const openCriteria = obj.criteria.filter((c) => !c.done);
      // Deterministic checks waive the prose-length heuristic: a mission with
      // api verify checks that all pass is provably complete no matter how
      // terse the model's answer was (live: a 1-tool-call file mission ended
      // awaiting_human because its answer was under 40 chars while its
      // file_equals check passed — obj_mt8e2yrr, 2026-08-25). The gate stays
      // fail-closed: failing checks still directive/escalate as before.
      const hasApiChecks = Array.isArray(obj.verify) && obj.verify.length > 0;
      if (modelEndedTurn && (prose.length >= 40 || hasApiChecks) && !openCriteria.length) {
        {
          const g = await deterministicGate("unverified", {
            finalAnswer:
              prose ||
              "(no final prose — completion earned by deterministic verify checks)",
          });
          if (g === "continue") continue;
          if (g === "escalated") return { status: obj.status, id: obj.id, objective: obj };
        }
        obj.status = "done";
        obj.finalAnswer = (prose || "(deterministic verify checks passed)").slice(0, 12000);
        if (Array.isArray(obj.progress)) {
          obj.progress.push("Segment ended naturally with a final answer (no state block emitted — accepted as complete).");
        }
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "objective_done", {
          segments: obj.totals.segments,
          toolCalls: obj.totals.toolCalls,
          viaNaturalStop: true,
        });
        onEvent({ type: "objective", phase: "done", id: obj.id, viaNaturalStop: true });
        await notify(
          `✅ Mission complete (${obj.totals.segments} segments, ${obj.totals.toolCalls} tool calls).\n\n${obj.finalAnswer}`,
          { kind: "done" }
        );
        return { status: obj.status, id: obj.id, objective: obj };
      }

      // Otherwise: one reminder segment, then hand the model's answer to the
      // user (never loop blind, never bury it behind a runtime error).
      if (ctr.missingStateRetries < MISSING_STATE_RETRY_CAP && seg?.stopReason !== "aborted") {
        ctr.missingStateRetries += 1;
        directive =
          `Your previous segment did not end with a parseable ${STATE_FENCE} block. ` +
          `Re-emit the full state block now (status continue/done/needs_human/blocked) and continue.`;
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "segment_missing_state", { segment: n });
        continue;
      }
      // Retry exhausted. A model that STILL ends its turn NATURALLY with a
      // substantive answer — after we explicitly asked it to re-emit the
      // state block — is insisting it is done. Trust that: a natural stop is
      // the model's completion signal, and we already gave it the checkpoint
      // chance. (Common shape: the model recorded criterion EVIDENCE but
      // never flipped the done flag, so a strict open-criteria gate would
      // pause a genuinely finished mission — the exact friction seen live.)
      if (modelEndedTurn && (prose.length >= 40 || hasApiChecks)) {
        {
          const g = await deterministicGate("unverified", {
            finalAnswer:
              prose ||
              "(no final prose — completion earned by deterministic verify checks)",
          });
          if (g === "continue") continue;
          if (g === "escalated") return { status: obj.status, id: obj.id, objective: obj };
        }
        obj.status = "done";
        obj.finalAnswer = (prose || "(deterministic verify checks passed)").slice(0, 12000);
        if (Array.isArray(obj.progress)) {
          obj.progress.push("Completed on a natural final answer after a state-block reminder (criteria flags not machine-set this segment).");
        }
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "objective_done", {
          segments: obj.totals.segments,
          toolCalls: obj.totals.toolCalls,
          viaNaturalStop: true,
          afterReminder: true,
        });
        onEvent({ type: "objective", phase: "done", id: obj.id, viaNaturalStop: true });
        await notify(
          `✅ Mission complete (${obj.totals.segments} segments, ${obj.totals.toolCalls} tool calls).\n\n${obj.finalAnswer}`,
          { kind: "done" }
        );
        return { status: obj.status, id: obj.id, objective: obj };
      }
      // S6b+ (Master Evolution Directive): before asking a HUMAN, ask the
      // GROUND TRUTH. A fresh-context verification segment — a different
      // conversation from the actor — inspects the working directory
      // against the objective and emits the state block. Deterministic
      // evidence beats prose-length heuristics; the human stays the
      // fallback, not the first resort. One attempt per run.
      if (!ctr.verifierSegmentUsed && seg?.stopReason !== "aborted") {
        ctr.verifierSegmentUsed = true;
        ledgerEvent(cfg, obj, "verify_segment_start", { segment: n });
        onEvent({ type: "objective", phase: "verify_segment", id: obj.id });
        try {
          const vSeg = await runSegment({
            prompt:
              `You are VERIFYING a mission another agent claims to have finished — you are not doing the work.
` +
              `Objective: ${obj.objective}
` +
              `Working directory: ${obj.workingDir || "(current)"}
` +
              `The actor's final answer was:
${(prose || "(empty)").slice(0, 1200)}

` +
              `Inspect the working directory READ-ONLY (list/read files; run no writes) and decide whether the objective is FULLY satisfied.
` +
              `Then emit ONLY the ${STATE_FENCE} fenced state block: status "done" with one criterion per requirement marked with its evidence, or status "continue" listing exactly what is missing, or "blocked" if you cannot verify.`,
            rescuePrompt: SEGMENT_RESCUE_PROMPT,
            sessionId: `objective-${obj.id}-verify`,
            objectiveId: obj.id,
            segment: n + 1,
          });
          const vText = vSeg?.text || "";
          const vUpdate = parseStateBlock(vText);
          obj.totals.segments += 1;
          obj.totals.turns += vSeg?.turns || 0;
          obj.segments.push({
            n: obj.totals.segments,
            turns: vSeg?.turns || 0,
            toolCalls: (vSeg?.toolTrace || []).length,
            stopReason: vSeg?.stopReason || null,
            status: "verify",
            at: new Date().toISOString(),
          });
          if (vUpdate && String(vUpdate.status || "").toLowerCase() === "done") {
            {
              const g = await deterministicGate("model-verified", {
                finalAnswer: prose || stripStateBlocks(vText).trim() || "Verified complete.",
              });
              if (g === "continue") continue;
              if (g === "escalated") return { status: obj.status, id: obj.id, objective: obj };
            }
            obj.status = "done";
            obj.finalAnswer =
              (prose || stripStateBlocks(vText).trim() || "Verified complete.").slice(0, 12000);
            if (Array.isArray(vUpdate.criteria) && vUpdate.criteria.length) {
              obj.criteria = vUpdate.criteria.map((c) =>
                typeof c === "string" ? { text: c, done: true } : { ...c, done: true }
              );
            }
            if (Array.isArray(obj.progress)) {
              obj.progress.push(
                "Completed via independent verification segment (fresh context, read-only inspection)."
              );
            }
            await saveObjective(cfg, obj);
            ledgerEvent(cfg, obj, "objective_done", {
              segments: obj.totals.segments,
              toolCalls: obj.totals.toolCalls,
              viaVerifier: true,
            });
            onEvent({ type: "objective", phase: "done", id: obj.id, viaVerifier: true });
            await notify(
              `✅ Mission complete — independently verified (${obj.totals.segments} segments).

${obj.finalAnswer}`,
              { kind: "done" }
            );
            return { status: obj.status, id: obj.id, objective: obj };
          }
          if (vUpdate && String(vUpdate.status || "").toLowerCase() === "continue") {
            // The verifier found concrete gaps — feed them back to the actor.
            const missing = stripStateBlocks(vText).trim().slice(0, 1000);
            directive =
              `An independent verification found the objective NOT yet satisfied. Address exactly these gaps, then emit the ${STATE_FENCE} block:
${missing || JSON.stringify(vUpdate).slice(0, 800)}`;
            ledgerEvent(cfg, obj, "verify_segment_gaps", { segment: n });
            await saveObjective(cfg, obj);
            continue;
          }
          ledgerEvent(cfg, obj, "verify_segment_inconclusive", { segment: n });
        } catch (e) {
          ledgerEvent(cfg, obj, "verify_segment_error", {
            error: String(e?.message || e).slice(0, 200),
          });
        }
      }
      // Genuine cutoff (maxTurns/budget/guard) or empty output → pause
      // resumable, with the model's actual answer surfaced (never a bare
      // "lost state" error).
      obj.status = "awaiting_human";
      if (prose) obj.finalAnswer = (prose || "(deterministic verify checks passed)").slice(0, 12000);
      obj.humanQuestion =
        "The mission was cut off without a machine-readable state block — its partial answer is above. Reply to continue, or /objective stop.";
      await saveObjective(cfg, obj);
      ledgerEvent(cfg, obj, "segment_missing_state_final", { segment: n, stopReason: seg?.stopReason || null });
      await notify(
        prose
          ? `⚠️ Mission ${obj.id} paused (cut off, no structured state). The model's partial answer:\n\n${prose.slice(0, 1500)}\n\n/objective resume to continue.`
          : `⚠️ Mission ${obj.id}: no output and no state from the model. /objective resume to retry.`,
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
      if (ctr.recoveries < RECOVERY_CAP) {
        ctr.recoveries += 1;
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
      if (open.length && ctr.pushbacks < CRITERIA_PUSHBACK_CAP) {
        // anti-drift: done without satisfied criteria gets bounded pushback
        ctr.pushbacks += 1;
        directive =
          `You reported done, but these completion criteria are NOT satisfied:\n` +
          open.map((c) => `- ${c.text}`).join("\n") +
          `\nEither complete them, or mark a criterion done with concrete evidence, or explain in findings why it is unachievable and adjust the criteria honestly. Then continue (or done again if truly complete).`;
        await saveObjective(cfg, obj);
        ledgerEvent(cfg, obj, "objective_pushback", { openCriteria: open.length });
        continue;
      }
      {
        const g = await deterministicGate("unverified", { finalAnswer: stripStateBlocks(text) });
        if (g === "continue") continue;
        if (g === "escalated") return { status: obj.status, id: obj.id, objective: obj };
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
