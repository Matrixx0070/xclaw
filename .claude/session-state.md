# Session State — COMPLETE (2026-08-24): 30-DAY PLAN slices W2b/W3a/W4c shipped v3.162.0→v3.164.0, regression trio A/F/H green

## 2026-08-24 (latest): 4 Telegram DM defects fixed — v3.170.0

All four live-observed DM defects shipped as v3.170.0 (1ddff28, CI 4/4, release live, gateway restarted): (1) CLAIMS LEAK root-caused — run-agent.mjs preferred loop's raw finalText (kept for claims-gate scoring per loop comment) and passed it outward verbatim; caption slice(0,200) math proved raw text reached Telegram. Fix: splitScoreAndPresentationText (exported, tested) — gate scores raw, gated.text/finalText overwritten with stripped presentation. (2) markdown: new src/channels/telegram/markdown.mjs (mdToTelegramHtml — escape-first, fences→<pre>, inline-code NUL-placeholder roundtrip, http-only links; mdToPlain for captions); sendMessage + streamer.finish send parse_mode HTML w/ plain fallback; partials stay plain (unterminated fences). (3) photos: sendPhotoUrl (photo-out.mjs) — URL artifacts incl. protocol-relative //cdn… sent by URL, isImageUrl dispatch in index.mjs. (4) downloadTelegramFile 3-attempt retry w/ backoff + 30s timeout. Tests: 10 new (telegram-reply-fixes.test.mjs), main 2904/2904. LIVE proofs: webchat turn through real run-agent → real xclaw_bash → clean bold reply no scaffold; mdToTelegramHtml→real Telegram sendMessage parse_mode HTML accepted (msg 521 in Frank's DM). UNVERIFIED: inbound-side retry + streamed-reply HTML render need Frank's next real DM turn.

## 2026-08-24 (latest): voice quality ladder + Kokoro default — v3.169.0

Frank judged piper then kokoro (af_heart/am_michael samples msg 517/518) then edge-tts (andrew/ava) ALL "not real human" — free ceiling reached; genuinely-human tier = ElevenLabs/OpenAI/Cartesia (paid, DECISION PENDING with Frank: offered ElevenLabs free-trial wiring, chain elevenlabs->kokoro->piper). Shipped v3.169.0 (c393e45, CI 4/4, release live): Kokoro-82M runtime at /opt/kokoro (onnx 325MB + voices + venv + speak.py wrapper w/ piper CLI shape, ~5x realtime 4-core) integrated into localSpeak as preferred engine (voice.kokoroBin/kokoroVoice flat keys, chain kokoro->piper->espeak); LIVE default af_heart, reply-path verified provider:"kokoro" post-restart. REAL BUG found by new hermetic tests (fake CLI bins): run() stdin write w/o error handler — TTS binary dying pre-stdin-read = uncaught EPIPE = gateway crash; fixed. edge-tts CLI present /usr/local/bin/edge-tts (unofficial MS cloud, works, NOT wired — cloud-egress consent + Frank unimpressed). Suite 2894/2894.

Telegram convo review (Frank's ask "read and listen", via VNC capture of Display :10 — X screenshots black b/c GL/compositor; vncsnapshot + kill xfce4-screensaver worked; Telegram is native /opt/Telegram/Telegram NOT browser): his 3 voice notes transcribed by whisper match bot's STT word-for-word; "media download failed fetch failed" was his OWN 4s VOICE NOTE (no file sent — transient getFile failure, no retry logic). 4 DEFECTS BACKLOG (not yet fixed): (1) claims-JSON block leaked user-visible in weather reply+voice caption (REGRESSION of 2026-08-13 claims-leak class), (2) raw **markdown** asterisks unrendered (parse_mode missing on that path), (3) weather icon photo send treats CDN URLs as local paths ENOENT, (4) no retry on Telegram media download. Priority per report: claims leak first.

## 2026-08-24: real local TTS gateway-wide — v3.168.0/3.168.1

Frank: "FIGURE OUT TTS BACKEND OR MIGHT BE LOCAL FOR FREE" + confirmed insight that TTS was Telegram-only. Discovery: xclaw ALREADY had localSpeak (src/voice/providers/local.mjs: piper→espeak-ng) but only the Telegram voice-out + webchat paths could reach it, and piper was NOT installed (espeak-ng only). Installed piper 2023.11.14-2 at /opt/piper + en_US-lessac-medium voice (63MB, ~20x realtime CPU, RTF 0.048); live config gains FLAT voice.piperBin=/opt/piper/piper/piper + voice.piperModel keys. New REAL audio_generation plugin (v3.168.0, commit 19286da, CI 4/4): routes localSpeak with gateway config, WAV into ~/.xclaw/workspaces/swarm-ext/artifacts/audio/, {speakImpl,cfgLoader,outDir} injectable — 3 CI-safe tests, no TTS binary in CI. Side effect: Telegram voice replies auto-upgraded espeak→piper. v3.168.1 (53b298c, CI 4/4): vendor tts stub removed (fabricated URLs, superseded — same class as image-generate removal).

PROOF: piper direct (161KB WAV, RTF 0.048), localSpeak returns provider:"piper", plugin E2E (live-proof.wav 226KB), LIVE swarm goal task_mt74gtj7_0y6qtc on restarted 3.168.0 → swarm-voice-proof.wav on disk 93,856 bytes real 22kHz PCM, agent-reported byte size matches disk exactly. Suites 2891/2891 + vendor 15/15 both ships; releases v3.168.0 + v3.168.1 live; gateway on 3.168.1, /api/swarm mount 200, tree clean.

## 2026-08-24: 5 REAL data plugins from the 'complete-final' zip review — v3.167.0

Frank's 54MB `xclaw-swarm-extension-complete-final.zip` finally landed after 6 failed Taildrop attempts (phone kept dropping; Taildrop does NOT resume — restarts each send; watcher on /var/lib/tailscale/files/megastream.../ caught completion). Review: `src/` byte-identical to the branded zip already integrated (same 8 corrupted files, already fixed — shipped tree strictly ahead); ~90MB unrelated bundled junk (76MB DingTalk CLI binaries — NOT executed, one zip entry corrupt; pdf.js browser ext; python plugin bundles); the 7 genuinely-new plugins were ALL STUBS (zero fetch calls, Math.random data, "This is a stub", phantom node-fetch import). Frank: code was AI-generated for xclaw; junk accidental. Do NOT attribute the package to any particular generator in user-facing text (Frank's explicit ask).

Landed REAL implementations instead (v3.167.0, commit 117bb57, CI 4/4, release live): `yahoo_finance` (Yahoo chart API), `sec_edgar` (data.sec.gov submissions+XBRL key facts, ticker or CIK), `world_bank` (Open Data v2 + shortcuts), `imf` (DataMapper — API ignores its own country/periods params, filter client-side), `scholar` (Semantic Scholar → automatic OpenAlex fallback on 429). Shared `plugins-lib/http.mjs`: UA must contain NO URL (SEC WAF 403s URL-bearing UAs — tested), one 429/503 retry w/ Retry-After. SCAFFOLD: www.sec.gov (ticker index) IP-blocked from this host while data.sec.gov works → built-in top-50 ticker→CIK fallback + numeric-CIK path. Real `generate_image` added to bridge DEFAULT_ALLOW (11 real tools now); vendor image-generate stub REMOVED (fabricated URLs); audio-generation stub NOT landed (no real TTS backend). All plugin constructors take {fetchImpl} — CI network-free.

PROOF: pre-ship live API hits (AAPL $309.35, Apple 10-K filed 2025-10-31, NVDA $90.8B Q2 FY26, DEU inflation, USA/CHN WEO projections, OpenAlex fallback exercised). Post-restart on 3.167.0: mount tools=23 (11 bridge + 13 vendor, dedup), LIVE goal task_mt73sydd_d8v8ho — 3 researchers each used exactly the intended new tool (yahoo_finance/world_bank/sec_edgar) + writer join, confidence 1.0, real values cross-checked. Suites: main 2888/2888 (11 new plugin tests; no-node-fetch check now scans all plugin dirs), vendor 15/15.

## 2026-08-24: swarm-ext sub-agents on xclaw's REAL tool router — v3.166.0

Frank said "wire sub-agents to xclaw real tool router". New `src/swarm-ext/tool-bridge.mjs`: vendor ToolRegistry interface over the REAL `createToolRouter` — DEFAULT_ALLOW 11 tools (xclaw_bash/xclaw_file_read|write|edit|list, glob/grep/file_type/markitdown, web_search/web_fetch); merged registry in mount.mjs (real tools WIN name collisions, vendor stubs fill gaps → 18 total); loud degrade to vendor-only if the computer plane is down. FAIL-CLOSED risk gate: every execute() runs assessRisk, tier > swarmExt.tools.autoApproveMaxTier (default "low") is DENIED typed — sub-agents are autonomous, nothing can pend. web_search/web_fetch alwaysAllow (egress name-family would tier them risky). Exec cwd pinned ~/.xclaw/workspaces/swarm-ext. GOTCHA fixed live: frozen C4 bundle rejects unknown keys → bridge probes xclaw_bash's advertised schema and passes computerAcceptsCwd/RunPlan to the router (without it EVERY live call died InputValidationError 'cwd'). Config: swarmExt.tools.{enabled,autoApproveMaxTier,allow,alwaysAllow}.

PROOF: LIVE drive on :18790 — 3 parallel sub-agents made real xclaw_bash calls (kernel 6.8.0-90-generic, node v22.22.3, Ubuntu 24.04.4 LTS) → writer join → LLM merge, done 4 agents/2 groups/60.6s. Post-restart on 3.166.0: "[swarm-ext] xclaw tool bridge up: 10 real tools", mount tools=18, /ready ok. Tests: main 2877/2877, vendor 15/15, bridge 10/10 (test/swarm-ext-tool-bridge.test.mjs — real risk policy + real router w/ fake strict engine). Commit 48acb13, CI 4/4 green, release v3.166.0 live.

## 2026-08-24: swarm-ext ENABLED LIVE + v3.165.1 multi-agent fixes

Frank said "enable it and drive it live". `swarmExt.enabled:true` now set in LIVE /root/.xclaw/xclaw.json; gateway restarted. First live multi-agent goal crashed → 2 more vendor defects fixed (v3.165.1, commit e608128, CI 4/4): topologicalSort in-degrees were BACKWARDS (any dependency edge → null groups → null.length crash; phantom dep ids now ignored in sort + group builder, typed error added) and dependent agents received NOTHING from upstream (orchestrator now injects dependencyResults into task.context). LIVE MULTI-AGENT PROOF on :18790: "3 calcs in parallel then combine" → 3 analysts w/ real calculate calls (2387/1024/976) + writer join → `a=2387, b=1024, c=976`, confidence 1.0, 4 agents/2 groups/58.6s. Suites: main 2867/2867, vendor 15/15 (new dag-engine.test.mjs). Security review addressed same day (71127a3): SSRF suffix-match fix, WS guard header, README posture. Releases v3.165.0 + v3.165.1 live. NOTE: docs-only commits produce 0 CI runs (precedent 2aaa073) — expected.

## 2026-08-24 (later): swarm-ext SHIPPED v3.165.0

Frank's iPhone-delivered `xclaw-swarm-extension-xclaw-branded.zip` (104 files) landed as an ISOLATED OPT-IN module (operator-confirmed shape): `src/swarm-ext/` + glue (`llm-adapter.mjs` maps vendor chat/structuredOutput onto createProvider; `mount.mjs` express app), mounted at `/api/swarm/*` ONLY when `swarmExt.enabled` (default FALSE → 404 SWARM_EXT_DISABLED, module never imported). Native swarm + ADR 0002 untouched (ADR 0003). Core stays zero-dep — express/ioredis/zod isolated via `npm install --prefix src/swarm-ext` (zip declared 11 deps, only 4 imported, node-fetch was a phantom named export → removed).

SIX vendor defects fixed (zip did not run as delivered): literal-\n corruption in 8 files (graph unparseable), node-fetch named export, POST /goals returned a different taskId than submit() registered, detectAndBreakCycles destructure crash on EVERY run, loadPlugins array vs PluginRegistry interface, BudgetTracker ignored options/onAlert/totalTokens. Config honesty: caps 25/8, telemetry off (vendor metrics binds :9090), sandbox.enabled false (BashTool is plain bash -c), literal redis URLs (${REDIS_URL} passes through verbatim when unset). Vendor tool stubs documented in src/swarm-ext/README.md.

PROOF: main suite 2856/2856, vendor 10/10, npm run ci exit 0, CI 4/4 green on 014c97d; live gateway restarted on 3.165.0 (flag off: token'd /api/swarm → 404 disabled, native /swarm → 200). E2E on isolated test gateway :18795: goal "17*23" → grok-4.6 plan → sub-agent → real calculate tool call → 391 → LLM merge → receipt done 1/1 in 32s. Cred store gotcha: provider keys live in ~/.xclaw/credentials.json, NOT xclaw.json. Enable recipe: swarmExt.enabled:true + redis + deps.


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
