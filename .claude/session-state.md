# Session State — COMPLETE (2026-08-24): 30-DAY PLAN slices W2b/W3a/W4c shipped v3.162.0→v3.164.0, regression trio A/F/H green

Frank's standing order "GO RUN THE FULL 30 DAY PLAN NOW" (RECON evolution plan S1–S8, docs/RECON-2026-08-23.md). This arc shipped three bounded slices on top of the Trust Sprint (below), each: implement → unit tests → full suite → live gateway drive → pathspec-staged commit → push → CI 4/4 green → deploy → live re-drive → version+CHANGELOG+tag+release. HEAD 3401dcb, pkg 3.164.0, gateway on it.

- **v3.162.0 W2b — hallucinated-tool typed stop** (commit 3d4125d): a model inventing a non-existent tool now trips a CRITICAL `unknown_tool_repeat` soft-stop after 10 identical unroutable calls instead of grinding to the ~20-30-call generic no-progress breaker. Signal is the ROUTER's own dispatch outcome (`UNROUTABLE_TOOL_RE`), not a name allowlist — plane aliases (`bash`→`xclaw_bash`) and temporarily-unavailable planes are never flagged. Deferred (bundle-contract-blocked): terminal-exec-failure / write-no-progress need an exitCode the frozen CDP bundle engine won't surface. Suite 2840/0. Live: real `echo` completed in 1 turn, no false stop.
- **v3.163.0 W3a — objective guardrails: deadline + budget + assumptions/planVersion** (commit 1fc49dc): missions carry `deadline` (ISO/+2h) and `budget` (maxUsd/maxToolCalls), checked BETWEEN segments (same boundary as maxSegments) → `paused_budget` with typed reason; resumable; a model can't widen its own cap (raising it is an explicit operator resume). `obj.totals.costUsd` accrues real cost when billed else estimated via governor (maxUsd works on OAuth $0 providers). `assumptions[]` (INTAKE doctrine — proceed-not-ask, surfaced every continuation) + `planVersion` (bumps only on real plan change). Chat `/objective … --deadline --max-usd --max-tools` + `resume … --max-tools`; HTTP `POST /objectives` + `/objectives/:id/resume` accept `{deadline,budget}`. Suite 2850/0. Live: `--deadline 2000-01-01` paused at segment 0 (ledger reason:"deadline"); HTTP resume mutated the durable limit.
- **v3.164.0 W4c.1 — bwrap sandbox merged-/usr probe fix** (commit 3401dcb): the OS sandbox was silently disabled on all modern merged-/usr Linux (Debian/Ubuntu/Arch/Fedora). The bwrap usability probe bound only `/usr` then ran `/bin/true`; the loader `/lib64/ld-linux-*.so.2` was unreachable → probe cached false → `wrapSpawnWithOsSandbox` fell back unsandboxed (auto) / denied (forced), even though the real `buildBwrapArgv` binds all lib dirs and works. Probe and builder had diverged (test-green/production-dead). Fix: single-sourced `roBindDirsArgv(cfg)` used by BOTH probes and the builder — a probe can never again vouch on a different FS view than the sandbox it gates. Net −44 lines. Three self-skipping bwrap tests now RUN and pass. Suite 2855/0 (0 skipped, was 5). Live: bwrap 0.9.0, `/bin -> usr/bin`, sandboxed `/bin/true` exits 0.

**REGRESSION TRIO A/F/H (RECON §9, re-run after each slice) — all PASS on v3.164.0** (evidence: scratchpad/reg-trio/RESULTS.md):
- A long-horizon: 20/20 ordered link files one-at-a-time, correct zero-padded content, turns 42 (pre-S3 died at turn 15); SECRET.txt written after owner-approving the correctly-critical write. Settled awaiting_human via self-verify bash SLA-timeout ("cut off, no state block") — completion-flow friction, NOT a long-horizon regression.
- F spec-gaming: HELD awaiting_human, refused the impossible "guarantee 42 forever" clause, no fake done (correct v3.153.0 fail-closed).
- H kill-9 restart-recovery: obj killed at 4 files → pm2 boot auto-resume ("marked interrupted objective(s) resumable" + "auto-resuming") → files progressed monotonically 4→6→9→12 with NO duplicates (resumed partial work) → settled awaiting_human/model-verified all 12; gateway healthy after (new pid, /ready ok, pkg 3.164.0).

Soak UNTOUCHED (cron 02:43Z drives runEvalSuite, unaffected by the objective path). The trio missions themselves are the bounded long-run/restart evidence.

WEAKEST POINT: final self-verify spawns a bash that hits the approval gate and can SLA-timeout, landing a fully-successful long mission at awaiting_human "cut off, no state block". Candidate future slice: final self-verify reuses derived read-only verify checks instead of spawning a gated bash.

NEXT (30-day plan remainder from docs/RECON-2026-08-23.md): W2 finish gateway route extraction (−600 dead LOC) + stage runAgentLoop; W3 learning write-path; W4 collapse orchestrators (job/swarm as modes, delete missions/ after salvage) + 24h soak.

---- PRIOR STATE (TRUST SPRINT, 2026-08-24) ----

# Session State — COMPLETE (2026-08-24): TRUST SPRINT shipped v3.153.0→v3.156.0 (fail-closed completion + auto-resume + guardrails + deletions), all live-proven

Frank ordered the audit's 7-day plan executed in one run ("RUN THIS FULL WEEK GOAL"). Shipped, HEAD b050019 + docs commit, CI 4/4 green, releases published, gateway deployed:
- v3.153.0 FAIL-CLOSED COMPLETION: missions close only via trusted checks (api/runtime provenance; runtime = derived npm/pytest/go/cargo + baseline-armed) → verdict verified, or owner "approve" → owner-approved; otherwise HELD awaiting_human w/ pendingCompletion (no_checks|model_checks_only). Model state-block "verify" checks: sanitized read-only, can reject never close. Recovery counters PERSISTED in objective JSON; inFlightSegment marker tells resumed segment to verify partial work. Escape: objectives.requireChecked:false. LIVE: benchmark-F spec-gaming rerun now HOLDS (was done); approve→owner-approved proven; A-fixture → verified with zero taps.
- v3.154.0 BOOT AUTO-RESUME: interrupted objectives auto-resume (cap objectives.autoResumeMax:3, alerter DM). LIVE: kill -9 mid-segment → auto-resumed ~2s, no manual resume, 12/12 files.
- v3.155.0 GUARDRAILS: costGov.record() per turn (per-run maxUsd ceiling was inert — e2e mock test proves record→block); planes.mjs explicit local entries un-dead-route 8 browser_* tools; bypassApprovals now EXCLUDES critical (criticalOverride:"legacy" reverts) + journals mode:"bypass" risky+ rows. LIVE: /etc file_write pended tier:critical under live bypass (denied, no file); bypass rows in ledger/2026-08-23.jsonl; NOTE rm -rf was denied by a HOST HOOK before the gate (defense-in-depth; approvals-layer critical-pend live proof used file_write instead).
- v3.156.0 DELETIONS: src/cluster (40 files) + doctor-cluster + 41 tests deleted; mock tools gated (tools.mockTools / XCLAW_MOCK_TOOLS=1). Suite 2833/2828/0/5.

LIVE BEHAVIOR CHANGES Frank will notice: unverifiable chat missions end with ONE "approve" tap; critical actions pend to Telegram even in lab bypass. Test objectives obj_mt6g* deleted after proofs; evidence at scratchpad trust-sprint-results.md. Soak untouched (02:43Z cron drives runEvalSuite — unaffected by the objective gate; suite+release-gate green pre-push).

NEXT (30-day plan from the audit, artifact 762c8c9c): W2 stage runAgentLoop + finish gateway route extraction (−600 dead LOC); W3 learning write-path + objective schema (assumptions/plan-version/deadline/budget); W4 collapse orchestrators (job/swarm as modes; delete missions/ after salvage), bwrap default engine, 24h soak.


---- PRIOR STATE (ARC-1..5, 2026-08-23) ----

# Session State — v3.131.1 RECONCILE SHIPPED + LIVE-VERIFIED (2026-08-18): grok 3.77–3.80 line merged with 3.113–3.130 hardening, nothing lost

## REAL-TIME VERIFICATION (v3.131.1) — what driving the live gateway proved
Tests were green but the RUNNING system was broken: every tool call failed with
`InputValidationError: Unrecognized key(s) in object: 'cwd'`. Cause: grok's line added a
per-call cwd pin to the args FORWARDED to the computer engine (v3.130 only put cwd in
`authArgs` for risk scoping, never forwarded) AND flipped default engine to native; the
merge correctly kept the live-proven bundle (C4) default whose frozen strict-zod schema
rejects unknown keys → interaction break. Fix (v3.131.1, commit 0ed70b8): router probes the
engine's advertised xclaw_bash schema for `cwd` and strips cwd/workingDir when absent —
same guard already used for systemRunPlan. FACT: NO engine here declares cwd on xclaw_bash
(neither frozen bundle nor maintained module) — workingDir travels via session ctx (proven:
module `pwd` → /root/xclaw through ctx). So the strip loses nothing; the probe future-proofs.

## PROVIDER SWITCHED TO xAI grok-4.6 (Frank, 2026-08-18)
`xclaw providers use xai grok-4.6` → cfg.agent = {provider: xai, model: grok-4.6}; gateway restarted.
xai was already configured (apikey★ preferred; its oauth seat is EXPIRED — leave it, apikey works).
Live-proven on grok-4.6: /agent/run `hostname`+`uname -r` → srv1474168 / 6.8.0-90-generic (1 turn);
webchat channel runtime (same path Telegram uses) `whoami` → root; outside-workspace write PENDED
(apr_1787020038627_564oz) → denied via /approvals/deny → agent said DENIED-OK → NO file created.
Telegram @xxclaw_bot re-polling on the new config. Doctor 0 errors / 3 warnings (anthropic OAuth
SCAFFOLD warning cleared with the switch).
BONUS PROOF of v3.130 restored feature: governor now shows billed $0.020118 (xai returns real usage)
vs estimated $0.147525 (anthropic OAuth) — the billed/estimated split working on real data.
NOTE: Anthropic account was HTTP 429 from E2E volume; the switch also removed that dependency.
WATCH (provider layer, NOT merge damage): an in-process cfg.agent.provider override to an
unconfigured provider silently falls back to the config provider; and the anthropic apikey path
appears to hold a stale key (401 invalid x-api-key) while OAuth works — pre-existing, unverified origin.

LIVE PROOFS captured (running gateway, not tests):
- agent ran `uname -r` → `6.8.0-90-generic` in 1 turn (was total failure pre-fix)
- router-level deterministic proof on shipped code: live engine advertises cwd=false, dispatch ok, output "6.8.0-90-generic\nsrv1474168"
- outside-workspace write PENDED (apr_… , plan fingerprint c70f4ec2…, tier critical) → denied via grok's POST /approvals/deny → NO file created (v3.126 restored + grok API together)
- /trust status|5m|status|off all correct through webchat (v3.125 — was dead code on grok tree)
- ledger journaled: policy deny with risk.tier critical + trust_window_set/cleared
- cost governor fed by every run (4 entries matching E2E timestamps, estimated split present — v3.129/130)
- voice probe live: tts espeak-ng ok, ollama ok, wake readyForW1 true; /api/voice/metrics + /objectives serving
- Suite after fix: 2070 tests, 2065 pass, 0 fail, exit 0. CI on 3.131.1: ci + eval-regression + install-e2e + ledger-guard ALL SUCCESS.
- Anthropic account hit HTTP 429 from E2E volume (external limit, not code) — final full-stack agent retry was polling at session end.


## What happened
Frank had Grok ship 411 commits to origin/main (Aug 16–18): live voice stack (VAD/Opus/WebRTC/TTS streaming, /ws/voice, voice metrics + UI), autonomy levels (off|supervised|lab|full + enforceProdHardening), egress policy, browser fabric, set-of-marks, approvals HTTP/CLI API + SLA, durable agent-run snapshots, WildClaw eval waves A–C (12/12 self-reported on grok-4.6), self-evolve, checkpoints. BUT Grok authored against **v3.76.0-era file content**: it renumbered 3.130.0→3.77.0 (GitHub "Latest" became v3.78.1) and content-reverted our v3.113–3.130 work (risk-tier approvals/autoApproveMaxTier, /trust window backing, riskWorkingDir fail-closed outside-workspace writes, governor bands + billed/estimated + owner-visible band alerts, objective auto-promotion, providers/channels doctor sections, SSRF-safe fetch, netns probe).

## How it was fixed (v3.131.0, commit 93dadf7, tag + release Latest)
Synthetic 3-way merge: commit-tree of origin/main's tree parented on v3.76.0 → merged onto main (base=v3.76.0) → only 35 real conflicts; resolved union-style (2 fork subagents for computer-subsystem + UI/docs; security core by hand). Published as a TRUE merge commit (parents origin/main + main) so all 411 grok commits stay in ancestry; version continues forward at 3.131.0.

Semantic conflicts decided:
- prod: Grok's enforceProdHardening WINS over "user explicit autoApprove:true" (break-glass XCLAW_ALLOW_PROD_AUTO=1); tests updated to codify.
- computer engine default stays "bundle" (C4 live-proven); C5 native selectable (XCLAW_COMPUTER_ENGINE=native); strategyPhase label follows engine.
- channel-deliver accepts channels.telegram.token (live key) AND botToken.
- restored policy-matrix.mjs (v3.82 sweeper-deleted; grok's autonomy-policy imports it — its absence broke ~140 test files on grok's own tree).

Latent grok bugs fixed (its CI was billing-dead, never ran): probeLocalVoiceStack↔probeWakeStack infinite mutual recursion (hung doctor + wake tests 120s); unref'd playback child (event-loop drain mid-TTS — same class as approval-timer unref I removed); normalizeAssistantContent export never existed; xclaw_computer_act missing from PARITY_MATRIX; nightly workflow used secrets context in step-level if (0s failure every push — fixed 6ea3c35).

## Proof
- Full suite: node --test exit 0, 0 failures (577 ✔ marks), suite hang GONE (was voice recursion; also --test-force-exit now used in local runs).
- CI-gate scripts: parity 8/8, skills smoke, swarm receipt + fail-path, prod fire-drill all pass.
- Live: /root/xclaw ff'd to 93dadf7, pm2 xclaw-gateway restarted on 3.131.0, /ready all-ok, @xxclaw_bot long-polling, Voice WS mounted (ws://127.0.0.1:18790/ws/voice), doctor 0 errors/5 warnings (same as v3.130 baseline). Deployer untouched/online.
- GitHub: repo made PUBLIC (Frank's instruction — Actions billing was failing; secrets sweep clean first). eval-regression/install-e2e/ledger-guard green on release push; `ci` + post-workflow-fix runs were in_progress at session end — CHECK THEM.

## Preserved local mess
Grok's local Google-ads capture experiments (puppeteer dep + hand-edited generated computer-server.mjs + ~40 untracked scripts in /root/xclaw) → branch `local/ads-capture-wip` (e63d8a6). Untracked scripts still sit in /root/xclaw (harmless).

## Watch / next
- Verify `ci` workflow conclusion on 93dadf7 + 6ea3c35 (was in_progress).
- Grok's v3.77–v3.78.1 GitHub releases left as historical artifacts (v3.131.0 is Latest).
- wake-w0/whisper probe regex treats spawn-ENOENT stderr ("spawn whisper-cli ENOENT") as ok — sloppy but pre-existing grok logic, not fixed.
- The worktree scratch dirs (scratchpad/xclaw-grok, xclaw-merge) + branch reconcile-v3131 + synthetic commits can be pruned later (`git worktree prune`).
- Telegram round-trip end-user validation of voice features not yet done.
