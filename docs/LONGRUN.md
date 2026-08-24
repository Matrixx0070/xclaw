# Long-Running Objectives — execution architecture

## The failure (traced, 2026-08-14)

A high-level objective given over a channel ("read, analyze, and fully
understand project X") stopped after ~20–30 tool calls and asked the user
"should I continue?". Root cause chain, traced in code:

1. **A channel turn = ONE `runAgentLoop` call**, bounded by
   `agent.maxTurns` (default 15). One turn ≈ 1 model call with 1–3 tool
   calls → the wall lands at ~20–30 tool calls. The turn cap — an
   *execution constraint* — was the de-facto *completion condition*.
2. At the cap, the final-answer rescue asks the model to summarize "what
   remains unverified" → the model naturally ends with "want me to
   continue?". **The question was manufactured by the runtime.**
3. Any assistant reply without tool calls is a natural stop
   (`loop.mjs` ~L901). The runtime cannot tell "mission complete" from
   "model paused to chat".
4. Across turns the only memory is the raw transcript, capped at
   `maxHistoryMessages` (40) and evicted in-run — the original objective
   itself rolls out of the window. Rediscovery and drift follow.
5. Nothing tracked objective / plan / criteria / progress for channel work
   (missions cover code-change worktrees; goal automations cover cron).

## The architecture

**Principle** (validated against Kastra's model): *the LLM decides what
needs to happen; the runtime ensures the mission survives execution
boundaries and actions are governed by explicit policy.* XClaw already had
the policy half (risk tiers, approval gate, ledger). This adds the mission
half.

```
user objective
   └─ objective store (durable JSON, ~/.xclaw/objectives/<id>.json)
        objective (verbatim, immutable) · interpretation · completion
        criteria · plan · current subtask · remaining · progress ·
        findings · decisions · constraints · open questions · failures ·
        inspected files/dirs/components · totals · segment log
   └─ orchestrator (src/agent/objective.mjs)
        loop: build segment prompt FROM STATE → run one loop segment
              (maxTurns = segment size) → parse fenced state block →
              merge → classify → continue | done | needs_human | blocked
```

- **Segments, not sessions.** Each segment starts a *fresh* model context
  rebuilt from durable state — context boundaries are invisible by
  construction; nothing depends on transcript replay surviving eviction.
- **State block contract.** Every segment ends with a fenced
  `xclaw-objective-state` JSON block (status + deltas). The runtime owns
  the merge (objective immutable, criteria `done` sticky, arrays capped).
  At the segment turn cap, the loop's rescue call asks for the state block
  instead of a user-facing answer (`rescuePrompt` seam).
- **Completion is criteria-driven.** The first segment derives explicit
  completion criteria; `done` with open criteria gets bounded pushback
  (cap 2) — complete them, evidence them, or honestly mark unachievable.
- **Independent verification before completion.** Before a mission closes,
  an independent read-only *verifier segment* (fresh context) checks the
  work against the objective — replacing the old prose-length heuristic.
  If the objective carries typed `verify` checks (command exits + file
  assertions, same shape jobs use, passed to `POST /objectives` as
  `verify:[…]`), those run as a **deterministic gate**: no done-path may
  complete while a check fails. A failure is fed back to the actor as a fix
  directive (cap 2) then escalates to the human with the exact failing
  checks.
- **Completion is fail-closed (Trust Sprint, v3.153).** Checks carry
  provenance: `api` (operator), `runtime` (auto-derived at mission start
  from the project's own test/lint scripts, armed only if they pass a
  baseline run), `model` (proposed by the model in its state block —
  file assertions and READ-ONLY commands only). A mission CLOSES only when
  trusted (api/runtime) checks pass → `verdict: verified`. With no trusted
  evidence — no checks at all, or only model-proposed ones passing — the
  completion is HELD: status `awaiting_human`, `pendingCompletion` set, and
  the owner replies `approve` (→ `verdict: owner-approved`) or says what to
  verify (the answer becomes the next segment's directive). Set
  `objectives.requireChecked:false` to restore narrated completion.
- **Decision classification.**
  - *Autonomous*: everything the model can infer — it is instructed the
    turn budget is never completion and to decide-and-record rather than
    ask; the runtime auto-continues `continue` segments.
  - *Policy-controlled*: destructive/sensitive actions still pend through
    the risk-tier approval gate (unchanged) — never via chat questions.
  - *Human-required*: only `needs_human` with a **concrete question**
    escalates (question-less `needs_human` is pushed back); the owner's
    next chat message is routed in as the answer and the mission resumes.
- **Recovery.** Tool failures are recorded in state and worked through.
  `blocked` gets one diagnose-and-recover directive before escalating; a
  crashed segment retries once, then parks `interrupted` (resumable).
- **Limits are typed.** Safety = risk gate/hooks (unchanged). Resource =
  cost governor + `objectives.maxSegments` (default 40) + **operator caps**
  (`deadline`, `budget.maxUsd`, `budget.maxToolCalls`, checked between
  segments) → `paused_budget` with a typed reason + resume hint, never
  silent death. A model cannot widen its own caps; raising one is an
  explicit operator `resume` with a new value. Model/context = per-segment
  eviction/compaction (unchanged, now scoped to a segment). Execution =
  `maxTurns` per segment. Completion = criteria only.
- **Restart survival.** Boot marks `running` objectives `interrupted`,
  then **auto-resumes** them (Trust Sprint: `objectives.autoResume`, newest
  first, cap `autoResumeMax:3`; notifications route WS + shared alerter).
  The owner's next message (or `/objective resume`) still works. Recovery,
  pushback, and verify-gate counters are PERSISTED in the objective, so a
  restart can never hand a crash-looping mission a fresh retry budget; a
  segment interrupted mid-flight is flagged to the next segment so partial
  on-disk work is verified, not blindly redone.
- **Auditability.** Every lifecycle event (started / segment / pushback /
  recovery / escalated / paused / done) journals to the ops ledger under
  the objective id.

## Entry points

- `/objective <goal>` — explicit mission start (also `status|stop|resume`).
  Operator caps as flags, stripped from the goal before the model sees it:
  `--deadline <ISO|+30m|+2h|+1d>`, `--max-usd <n>`, `--max-tools <n>`.
  Raise a cap past a pause with `/objective resume <id> --max-tools <n>`
  (etc.). HTTP mirrors this: `POST /objectives` and
  `POST /objectives/:id/resume` accept `{deadline, budget}` in the body.
- **Auto-promotion**: a normal channel turn cut off by `maxTurns` becomes
  a mission automatically (seeded with the partial turn's inspected files),
  and the user is told it is continuing — the old failure mode now *starts*
  the correct machinery. `objectives.autoPromote:false` disables.
- Telegram: detached updates via the bot; messages during a running
  mission get a status reply instead of forking a parallel task.
  Webchat: same router; updates append to the session.

## Config

`objectives.{enabled, autoPromote, maxSegments, progressEverySegments, dir}`

Per-mission durable fields (set at start or on resume, not global config):
`deadline`, `budget.{maxUsd,maxToolCalls}`, plus the audit-trail state
`assumptions[]`, `planVersion`, and `totals.costUsd`.

## Known limitations

- Discord/Slack/email pass no `notify` sender yet → no detached missions
  there (router degrades gracefully; commands still answer).
- Mission concurrency is 1 per chat by design.
- The final deliverable is the last segment's prose. Verification is a
  separate read-only pass (verifier segment + optional deterministic
  `verify` checks); there is no separate *synthesis* pass yet.
