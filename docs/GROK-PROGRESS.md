# GROK-PROGRESS

> **Ledger rule (append-only):** new entries go at the BOTTOM. Never delete or
> overwrite earlier entries — this file is the audit trail of claimed vs shipped.
> Reconstructed 2026-08-12 from git history after entries were being overwritten
> per-commit (every entry below was recovered from the commit that wrote it).

## 2026-08-12 — Phase 1.0–1.2 (fab4444)

STATUS: green
BUILT:
- systemRunPlan revalidate in agent loop (TOCTOU)
- gateway requireAuth fail-closed for prod
- conversation history threading (body.history → runAgentLoop)
RAN: node --test plan/auth/history suites → 22/22 pass
RUBRIC: plan binding enforced; auth not default-open in prod; history supported
UNVERIFIED: live human-approval TOCTOU e2e with binary swap
NEXT: eval CI secrets fix; parallel tools; golden path soak

## 2026-08-12 — Session complete, partial rubric (b9d61f4)

STATUS: **amber** (Phase 1 core green; full 10/10 NOT claimed)
BUILT & PUSHED: plan TOCTOU revalidate · prod auth fail-closed · conversation
history · eval CI workflow fix (no `secrets` in job-level `if`) · prod profile
(requireAuth, publicUi false, bindSystemRunPlan) · doctor gateway_auth
RAN: 22/22 targeted suites
NOT DONE: live binary-swap TOCTOU e2e · parallel tool execution · real Anthropic streaming

## 2026-08-12 — Phase 1.3–1.4 (b9cfa08)

STATUS: green (partial rubric)
BUILT: TOCTOU e2e tests (file hash drift + argv rewrite + loop wiring) ·
`src/agent/tool-concurrency.mjs` + loop partition (read/list/recall concurrent;
bash/write/browser serial)
RAN: 20/20 targeted suites
NOT DONE: Anthropic streaming · progress-based circuit breakers · browser out of
17MB bundle · persistent session transcript store

## 2026-08-12 — Phase 1.5–1.6 (4bb6d57)

STATUS: green (partial)
BUILT: progress-aware global circuit breaker (warn if progressing; critical at
1.5x or no-progress streak) · critical guard soft-stop (no throw) · Anthropic
real SSE chatStream (text_delta + tool input_json_delta)
RAN: 9/9
NOT DONE: browser out of bundle · transcript store · live Anthropic stream e2e

## 2026-08-12 — Phase 1.7 transcripts + browser policy (4ac8ee6)

STATUS: green (partial)
BUILT: `src/sessions/transcript.mjs` JSONL transcripts · loop load/save via
`chatSessionId`/`sessionId` · gateway `GET /transcripts(/:id)` ·
`docs/BROWSER_UNBUNDLE.md` Strategy C policy (no 16MB hand-edits)
RAN: 7/7
NOT DONE: full CDP parity in native/generated · live Anthropic stream e2e

## 2026-08-12 — Phase 1.8 native browser P1 (b470637)

STATUS: green (partial)
BUILT: native browser-tab-tool (redirects, list/read/navigate, links + meta) ·
clear CDP errors for jsCode/screenshot · CLI `xclaw transcripts list|show`
RAN: 6/6

## 2026-08-12 — Phase 1.9 registry + thin browser hard-wire (c194976)

STATUS: green (partial)
BUILT: `BrowserTabTool` export on native module · registry + thin-server health
expose `xclaw_browser_tab`
RAN: 6/6

## 2026-08-12 — Live golden-path e2e, xAI (800774f)

STATUS: green
RAN (env XAI_API_KEY only — never committed): chat-only `LIVE_OK` ok ·
tools bash write+read `PROOF_LIVE` disk match ok · native thin computer healthy :4243
CI: unit + unit-media (apt ffmpeg) + install-e2e green as of 6afe2ab
SECURITY: rotate any API key pasted in chat; prefer Actions secret `XAI_API_KEY`

## 2026-08-12 — Egress + kill-switch (c0b0242)

STATUS: green
BUILT: `src/security/egress.mjs` allow/deny/allowlist (prod default deny) · loop
hooks `guardToolEgress` after sandbox · `src/agent/session-control.mjs`
register/kill/killAll · CLI `xclaw stop-all`, `xclaw sessions-active`
RAN: 9/9

## 2026-08-12 — Kill-switch wired into runAgentLoop (0e09b39)

STATUS: green
BUILT: every `runAgentLoop` registers a session + merges AbortSignal · outer
try/finally always `unregisterSession` · caller signal + killSession/stop-all abort

## 2026-08-12 — Docs + multi-step soak (fc29ab3)

STATUS: green
RAN: multi-step live (xAI grok-4.5): step1 + step2 + concat → STEP1STEP2 ok, 1 turn
DOCS: XCLAW.md — egress, kill-switch, transcripts

## 2026-08-12 — Doctor + CI security pack (7b921ca)

STATUS: green
BUILT: doctor checks security.egress + security.killSwitch · CI security pack
RAN: 11/11

## 2026-08-12 — 3.76.0 ship readiness (bf2922b)

STATUS: green — version bumped to 3.76.0. See CHANGELOG + docs/RELEASE_3.76.md

## 2026-08-12 — Design-review P0 honesty fixes (da9826c)

STATUS: green
FIXED (Claude Code report): swarm early-merge no longer forces autoMerge:true ·
soak-multinight synthetic backdated nights removed · release-gate no exit 1→0
remap · eval cron intervalMs/everyMs aligned (not silent 60s)
RAN: test/swarm-early-merge-policy.test.mjs 3/3

## 2026-08-12 — Spawn-time plan enforcement (9381e8f)

STATUS: green
BUILT: `src/security/spawn-enforce.mjs` assertPlanAtSpawn + buildEnforcedBashSpawn
(-c not -lc) · bash-tool refuses command mutation when systemRunPlan present ·
loop attaches auth.plan as args.systemRunPlan
RAN: test/spawn-enforce.test.mjs 6/6
LIMITS: still not a kernel sandbox — binding = the frozen string is exactly what
was approved.

## 2026-08-12 — bwrap OS sandbox (3aee6af)

STATUS: green
BUILT: `src/security/os-sandbox.mjs` detect bwrap, binds, unshare-net/pid ·
bash-tool wraps spawn · doctor security.osSandbox · tests skip live bwrap when missing

## 2026-08-12 — P0 docs polish (f9bf5ff)

STATUS: green — README 15-minute start, secrets, profiles table, Strategy C,
security knobs, slim docs map · XCLAW.md aligned · docs/README.md index

## 2026-08-12 — P1 CLI / doctor polish (4ea6369)

STATUS: green — doctor grouped Config·Security·Computer·Runtime with exit legend ·
status sessions + --json · help additions · first-run tip shortened + XCLAW_QUIET

## 2026-08-13 — P2 prod honesty (2cd4d12)

STATUS: green
- prod profile: egress deny, osSandbox auto, spawnEnforce check, swarm.autoMerge false
- doctor: security.prod.* (token, autoApprove, egress, swarm, requireAuth)
- eval cron: writes last-cron.json; main.json only if XCLAW_UPDATE_BASELINE=1
- test/prod-profile-honesty.test.mjs 3/3

## 2026-08-12 — Claude review follow-up: security top fixes (this commit)

STATUS: green
BUILT:
- Egress is now a real boundary: bwrap `--unshare-net` defaults ON whenever
  egress mode ≠ allow (netns probe + honest `netnsDegraded` fallback flag);
  regex screen demoted to fast pre-check
- Tool spawn env policy (`src/security/env-policy.mjs`): strip-secrets default,
  allowlist in prod, inherit opt-out — secrets are no longer ambient in bash
- Non-login `-c` bash on ALL spawn paths (was `-lc` when no plan); BASH_ENV/ENV
  rc-injection cleared everywhere; `security.bashLogin` escape hatch
- Gateway bind guard: refuses non-loopback bind without a token
  (XCLAW_GATEWAY_ALLOW_OPEN=1 escape hatch); `xclaw init --profile prod`
  generates + stores the token, config chmod 600
- Global circuit breaker counts ALL calls (`totalCalls`) — was counting the
  sliding window, so historySize < threshold silently disabled the breaker
- findMitmCaCert: explicit confdir authoritative (no ~/.mitmproxy fallback) —
  fixes 2 host-leak test failures; build stamp gains `fullRebuild:false` —
  fixes strategy-c stamp test
- This ledger reconstructed append-only from git history

## 2026-08-12 — 3.77.0 MCP reaches the agent loop (0b2f199, Claude)

STATUS: green
BUILT: cfg.mcp.servers tools join every runAgentLoop as mcp__<server>__<tool>
via src/agent/mcp-tools.mjs; stdio transport (src/mcp/stdio-client.mjs) +
client manager rework (initialize handshake, TTL cache, status/close);
same sandbox/egress/approval path as built-ins; fail-open discovery;
GET /mcp/status; doctor mcp check. Strategy C: bundle + modules untouched.
RAN: suite 1043/0 · eval:ci exit 0 · self-check OK · CI green on 0b2f199 ·
9 new MCP tests incl. real spawned stdio fixture round-trip
UNVERIFIED: live LLM selecting an MCP tool (no API key on build host)

## 2026-08-12 — Tool planes T0–T4 + bundled skills + automations (a691c72..cc4171d, Grok)

STATUS: green (ledger entry added retroactively by Claude — Grok did not append)
BUILT: planes.mjs plane map + ToolCall contract · Tool Router single dispatch ·
runToolBatches plane concurrency + abort · computer-only plane (heavy tools
never in-process) · allowlisted web_search plane (Brave/DDG) · bundled skills
(office/pdf/ffmpeg/ImageMagick/skill-creator/memory-edit/color/finance/
image-gen-edit, 4.6MB) · automations (schedule/list/pause/run/results)
RAN: CI green per-commit (eval-regression + install-e2e)
REGRESSION: T1 refactor dropped the 3.77.0 MCP loop integration — see next entry

## 2026-08-12 — 3.78.0 polish: MCP regression fix + hygiene (Claude)

STATUS: green
FIXED: T1 Tool Router refactor had removed createAgentMcpTools from loop.mjs
(mcp__* dispatch would throw "No MCP adapter"; stdio children never closed).
Restored through the router's agentHandlers plane + new router-level e2e test
(fixture stdio server → router.dispatch → content round-trip) so the regression
cannot silently recur. Source-assertion test updated to router wiring.
HYGIENE: session reports moved repo root → docs/reports/ · CHANGELOG 3.78.0
covering Grok's T0–T4/skills/automations (was undocumented) · version 3.78.0
RAN: (see commit) full suite + eval:ci + self-check before push

## 2026-08-12 — ledger-guard CI: append-only now enforced (Claude)

STATUS: green
BUILT: scripts/ledger-guard.mjs (fails when this file shrinks in bytes OR any
existing line is deleted/rewritten vs the push/PR base) + .github/workflows/
ledger-guard.yml (push+PR to main, injection-safe env interpolation) +
test/ledger-guard.test.mjs (7 cases in a temp git repo: append ok, unchanged ok,
shrink FAIL, rewrite-while-growing FAIL, delete FAIL, missing-base skip,
new-file skip).
RAN: 7/7 unit tests · live check vs HEAD~3 OK · replay against Grok's historical
overwrite commit b9cfa08 correctly exits 1 ("shrank 1469 -> 759 bytes")
NOTE: from this commit on, overwriting this ledger fails CI — append entries at
the bottom only.

## 2026-08-12 — 3.79.0 SSRF guard + WebSocket upgrade auth (Claude)

STATUS: green
BUILT: src/security/ssrf.mjs — web_fetch now http/https-only, DNS-resolves host
and blocks any loopback/private/link-local/ULA/CGNAT/metadata IP (169.254.169.254),
canonicalizes decimal/hex encodings, follows redirects MANUALLY re-validating each
hop. WS /ws/events upgrade now runs an authorize gate BEFORE 101: 401 unless a
valid token (query / x-xclaw-token / xclaw.token.<t> subprotocol) when token set
or requireAuth; control UI carries localStorage.xclaw_token. doctor security.ssrf
+ security.wsAuth.
RAN: 18 new tests (SSRF classifier + live redirect-hop-into-metadata block; WS
handshake auth over a real socket) · full suite 1094/0 · both closed the last two
UNVERIFIED items from the 2026-08-12 review.
SCOPE: browser-tab navigation fetch NOT covered here (separate role-binding hooks);
finance/search/openai fetches hit hardcoded hosts — future work if agent-parameterized.

## 2026-08-12 — 3.79.1 SSRF: pin connection to validated IP (Claude)

STATUS: green
FIXED: DNS-rebind window in safeFetch — it validated via DNS then let fetch
resolve again. Now safeFetch connects via requestPinned (node:http/https +
lookup override) to the exact validated IP; URL keeps its hostname so Host/SNI/
cert are intact. assertUrlAllowed returns pinIp (null on off/allowPrivate/
allowHosts bypass). requestPinned decodes gzip/deflate/br, Accept-Encoding
identity, redirects re-validated per hop by safeFetch. Zero new deps.
RAN: pinning proven deterministically (example.com pinned to 127.0.0.1 hits
local server, Host preserved) · live web_fetch https://example.com → 200 via
pinned path, metadata still blocked · full suite 1097/0 · eval:ci 0 · self-check OK.

## 2026-08-12 — 3.80.0 16MB CDP bundle → release artifact (Claude)

STATUS: green
BUILT: src/computer/xclaw-server.mjs (16.8MB, ~64% of repo) untracked from git +
gitignored; published as the `computer-bundle` GitHub release asset. New
scripts/fetch-computer-bundle.mjs (sha256-verified vs src/computer/
bundle-artifact.json manifest; gh release download preferred, direct-URL
fallback; idempotent) + npm run fetch:bundle. Startup auto-fetches when
engine=bundle and missing (XCLAW_BUNDLE_AUTOFETCH=0 to disable), else clear
error. build:computer + doctor tolerant of absent bundle (doctor a.bundle
informational unless engine needs it). Strategy C intact — default native/
generated never need the bundle.
RAN: build w/ bundle absent OK · fetch:bundle downloads 16839070B sha256-match ·
idempotent skip on re-run · untracked-in-git tripwire test · full suite 1098/0 ·
eval:ci 0 · self-check OK — all with the bundle ABSENT (CI condition).
NOTE: git history still holds the blob; a history purge is a separate destructive
op (blocked by branch protection) — this stops carrying it forward + leans shallow clones.

## 2026-08-12 — 3.80.1 atomic bundle publish helper (Claude)

STATUS: green
BUILT: scripts/publish-bundle.mjs + npm run publish:bundle — updates the release
asset AND bundle-artifact.json in one step (hash → gh release upload --clobber →
re-download + verify round-trip → only then rewrite manifest; manifest untouched
on failure). Closes the 3.80.0 footgun where uploading a new bundle but forgetting
the manifest sha would make fetch:bundle reject. Auto-derives repo from manifest
URL; --dry-run previews.
RAN: 4 hermetic tests (dry-run/missing/guards/canary) · live end-to-end — published
an altered bundle (manifest→new sha), republished the original (manifest restored to
canonical 9d95d0…), fetch:bundle re-verifies · full suite + eval:ci + self-check.

## 2026-08-12 — 3.80.2 restore install/onboard shortcuts + bundle-safe marker (Claude)

STATUS: green
FIXED: while verifying "ready for one-command install + onboard?", found Grok's
3.76.0 commit (bf2922b) had dropped the install:local/onboard/init/prove:install
npm aliases from package.json (files intact, install-e2e CI stayed green — only
the shortcuts vanished). Restored all four. Also check-bundle-markers now SKIPs
when the opt-in bundle is absent (was hard-reading the release-fetched file).
README quickstart now shows the one-command path.
RAN: npm run onboard -> exit 0, ~/.xclaw/xclaw.json created · npm run install:local
-> exit 0 · check-bundle-markers SKIP with bundle absent · suite 1102/0 ·
install-e2e CI green on clean bundle-less checkout.

## 2026-08-12 — 3.81.0 P0/P1 close-out + first live LLM→MCP proof (Claude)

STATUS: green
BUILT: (1) native browser_tab SSRF guard — fetchUrl → safeFetch with per-hop
DNS-validate + IP-pin, private/loopback blocked by default, NEW metadataFloor
(cloud-metadata blocked in every mode incl. off/allowPrivate); manager forwards
policy env to computer child. (2) swarm merge self-approve closed —
approveMergeProposal principal gate: in-loop tool = agent → PRINCIPAL_DENIED,
CLI/gateway = operator; lab-only swarm.allowAgentMergeApprove, never in prod.
(3) worktreeDiff merge-base (committed subagent work no longer NOOPs) +
checkOnly pure dry-run + trailing-newline PATCH_CORRUPT fix. (4) cron full
5-field parser + durable job store. (5) provider-scoped credential fallback +
failover half-open recovery. (6) constant-time token compare + 1MB body cap.
(7) memory walk stops at git root (planted /tmp/XCLAW.md dead). (8) runAgentOnce
passed messages[] the loop drops → content:undefined 400 on every automations
one-shot; fixed + tripwire. (9) eval-regression '|| true' removed. (10) Docker
env bind overrides recovered from fix/docker-onboard before branch cleanup.
RAN: suite 1107 → 1149 total, 0 fail (1144 pass, 5 env-skipped) · eval:ci OK · LIVE: ollama glm-5.2:cloud through
the real loop chose mcp__echo__echo("XCLAW-LIVE-42") and reported the tool
response (last UNVERIFIED item closed) · browser_tab live: example.com 200,
metadata + loopback SSRF_BLOCKED · env bind override live: host 0.0.0.0:19999.
BOARD: 10 superseded remote branches deleted after per-branch git-cherry checks;
only main remains.

## 2026-08-12 — 3.82.0 P2 tier: structured verdicts, cache on wire, gateway hygiene (Claude)

STATUS: green
BUILT: (1) critic merge-gate structured — critics end with an authoritative
JSON verdict line; parseCriticVerdict (balanced-brace, last-wins) decides;
keyword regex demoted to fallback-only ("I would not reject this" now merges).
(2) Anthropic cache_control reaches the wire — toAnthropicMessages was
stringify-ing structured system content; now native text blocks with
cache_control, 4-breakpoint cap, opt-outs honored, OAuth attestation first.
(3) CORS wildcard removed — loopback-reflect default, gateway.corsOrigin
override; /security/* served by the routes module (SLA stats, allow-always
parsing) replacing 3 stale inline duplicates. (4) Sweeper: DELETED zombie
browser-service.mjs (undefined identifiers, could never run) + unwired
secure-tool-call.mjs + policy-matrix.mjs (+tests); wired cfg.providers.routes
(was dead documented config). (5) skills.roots config-driven, Grok-sandbox
paths on-disk-gated; eval scorer normalized any-of matching, hard.json
brittle literals fixed. NOTE: automations re-arm at boot was already wired
(hydrateAutomations, gateway line ~947) — earlier audit line was stale.
RAN: suite 1182 total, 0 fail (1177 pass, 5 env-skipped) · eval:ci OK ·
build:computer + C4 parity gate OK · doctor 0 errors · LIVE gateway boot:
/security/policy serves module payload (approvalGate+computerEngine keys),
CORS reflects http://127.0.0.1:5173, blocks https://evil.example.
DEFERRED: router split + /v1, WS library, skills progressive disclosure,
swarm handoff caps, SCAFFOLD sweep, signed skills.

## 2026-08-12 — 3.83.0 deferred P2/P3 tier (Claude)

STATUS: green
BUILT: (1) skills progressive disclosure — prompt carries an index (name/
description/triggers), whole-body-or-nothing inlining under skills.inlineMaxChars
(1500), new read-only xclaw_skill tool loads full bodies on demand;
skills.progressive:false restores legacy. (2) provider sampling — agent.temperature
config (null omits), agent.reasoning {enabled,effort,maxTokens} → reasoning_effort
(OpenAI-compat) / thinking budget_tokens (Anthropic, temperature auto-omitted,
max_tokens auto-grown); thinking_delta tolerated in SSE; zero wire change unset.
(3) swarm scale — handoff limits config (defaults 1800→6000 / 1500→4000) with
VISIBLE truncation markers; caps config (maxNodes/maxParallel, ceilings 50/16);
spawn depth guard via cfg._spawnDepth (default max 2, SPAWN_DEPTH_EXCEEDED).
(4) SLA auto-approve revalidates the frozen plan (deny plan_drift at resolve) +
REAL BUG: pending-approval timeout timers never cleared → process held alive up
to 120s after settle; now tracked+cleared (suite ~4s faster). (5) EXEC_TOOLS
single-sourced from system-run-plan (approvals defaults derive). (6) /v1 API
aliasing for every gateway route + X-XClaw-Api-Version header. (7) SCAFFOLD
markers on all named heuristics incl. the Claude Code OAuth identity spoof +
doctor WARN security.oauthIdentity when an sk-ant-oat token is in use.
RAN: suite 1213 total, 0 fail (1208 pass, 5 env-skipped) · eval:ci OK ·
build:computer OK · LIVE gateway: /v1/health 200 + X-XClaw-Api-Version:1,
/v1/security/policy serves, unversioned routes intact.
DEFERRED w/ rationale: WS library (zero-dep stance), signed skills (trust-model
decision needed), router file split (churn>value), swarm resume journal
(design sketched: append-only NDJSON at node state transitions, replay into
resultsByNodeId), sessions/seats durability.

## 2026-08-12 — 3.84.0 final deferred tier (Claude)

STATUS: green
BUILT: (1) WS RFC6455 hardening ZERO-DEP — old parser had NO payload cap
(10GB claim = buffered), ignored FIN (fragmented messages silently corrupted),
no mask enforcement; new createFrameParser: stateful chunking, 1009 on header
before buffering (1MB cap), 1002 unmasked/protocol, full fragmentation state
machine, close handshake w/ code echo + grace, 1007 UTF-8; garbage → clean
close, never a crash; API + auth-before-101 unchanged. (2) swarm resume
journal — append-only NDJSON per run (graph-hash header, node transitions),
resumeSwarmRun + `xclaw swarm resume <id>` replays ok results and re-runs
failed/skipped; JOURNAL_GRAPH_MISMATCH refusal; torn lines tolerated;
advisory (write errors never fail runs). (3) skills integrity manifest —
`xclaw skills lock`/`verify`, skills.lock.json at workspace git root
(sha256 over SKILL.md bytes); modes off (no lockfile) / warn (lockfile) /
enforce (lockfile+prod: changed/unmanifested excluded incl. xclaw_skill tool);
doctor skills.integrity row. (4) router split started — routes/swarm.mjs +
routes/cron.mjs extracted (index 2451→2380 lines; SSE handlers stay inline);
STALE findings closed: sessions persist already atomic, seats/manager.mjs
no longer exists.
RAN: suite 1235 total, 0 fail (1230 pass, 5 env-skipped) · eval:ci OK ·
LIVE gateway boot: /cron/status + /cron/jobs + /swarm/merges via extracted
modules, /swarm/<bad-id> 404, /v1/cron/status 200 · WS pack 46/46 incl.
raw-socket fragmentation/oversize/masking/close tests · swarm+spawn+worktree
114/114 incl. resume-only-failed-node proof · skills lock/verify CLI smoke
(22 pinned, drift → exit 1).
PARKED (explicit): full router split, thinking-block replay (loop.mjs),
bundle git-history purge (needs Frank's opt-in).

## 2026-08-12 — bundle git-history purge EXECUTED (Claude, Frank's explicit opt-in)

STATUS: green — ALL SHAs REWRITTEN. Old clones are broken by design; re-clone.
DID: git-filter-repo removed src/computer/xclaw-server.mjs (16,839,070 bytes,
the only >3MB blob) from ALL history. 129 commits parsed, 1 became empty and
was pruned (the 03:18 "include full bundle" dump commit). Tip TREE verified
byte-identical pre/post (9ff7244e…) — content untouched, only history slimmed.
Branch protection: recorded → lifted → force-pushed heads+tags → restored
byte-equivalent (force-push blocked, deletions blocked, enforce_admins on).
SHA MAP (old → new): main/v3.84.0 9d7dff2→6560125 · v3.83.0 be7a106→d4f48d6 ·
v3.82.0 95d4616→1c7eb60 · v3.81.0 506f1f3→01354bc · v3.80.2 87412f8→1522636 ·
v3.76.0 bf2922b→08e44ca · computer-bundle 775ec40→6a35e82. Full 128-line
commit map + pre-purge git bundle at /root/backups/ (xclaw-pre-purge-20260812
.bundle, xclaw-purge-commit-map-20260812.txt, xclaw-purge-mirror.git).
Historical SHAs referenced in EARLIER ledger entries above are pre-rewrite ids —
translate via the commit map.
RAN: fresh clone .git = 3.1MB (was ~6MB pack / 24MB tracked era) with ZERO
blobs >3MB · all 6 releases intact, computer-bundle asset present ·
npm run fetch:bundle → sha256 ok · CI green on rewritten 6560125 (all 3
workflows) · suite 1235 total 0 fail · protection verified restored.
CAVEAT: GitHub server-side refs/pull/* still reference pre-rewrite commits
internally until GitHub GC (not client-fetchable as heads; private repo —
acceptable residual; a support ticket can force it if ever needed).
NOTE FOR GROK: your working clone is now stale — fresh clone required; do NOT
force-push old history back (protection will reject it).

## 2026-08-12 — 3.85.0 router split complete + thinking-block replay (Claude)

STATUS: green
BUILT: (1) router split FINISHED — 6 new modules (jwks, alerts, ops,
eval-queue, tokens, api) join security/swarm/cron; index.mjs 2380→1564 lines;
SSE/webchat/webhook/WS handlers deliberately inline (writer-state closures).
REAL BUG fixed: inline POST /queue contained pasted startup code registering
a new approval-digest setInterval on EVERY enqueue (unbounded interval leak).
(2) Anthropic thinking-block replay — SSE parser captures thinkingBlocks
verbatim incl. previously-discarded signature_delta + redacted_thinking;
toAnthropicMessages re-emits them first in assistant content when thinking
enabled (omitted otherwise); ZERO loop.mjs changes (message object flows by
reference; eviction spread preserves the field — both proven). Two-call mock
proves the signature round-trips to the 2nd request body.
RAN: suite 1252 total, 0 fail (1247 pass, 5 env-skipped) · eval:ci OK ·
LIVE gateway: extracted groups + /v1 aliases all 200 (alerts/status,
tokens/cost, transcripts, media/providers, sessions, queue, health, metrics);
/doctor 503 = correct keyless-host semantic. NB: /mcp/status verified ABSENT
pre-split (dropped in an earlier Grok refactor — /mcp, /mcp/tools, /mcp/call
are the surviving surface).
BOARD: the 2026-08-12 design review + Grok brief are now FULLY closed —
nothing parked, nothing deferred.

## 2026-08-12 — 3.85.1 routes/api.mjs split into per-plane modules (Claude)

STATUS: green
BUILT: the 3.85.0 catch-all routes/api.mjs (5 planes in one file) split into
routes/sessions.mjs (+transcripts/checkpoints), subagents.mjs, mcp.mjs,
media.mjs; /skills · /memory · /providers/route one-off reads moved to
ops.mjs. Pure mechanical move, behavior byte-identical; api.mjs deleted.
RAN: suite 1255 total, 0 fail · LIVE smoke: sessions/transcripts/subagents/
mcp/tools/media/providers/skills/memory/providers/route/checkpoints +
/v1/sessions all 200.

## 2026-08-12 — 3.85.2 install-hardening (Claude)

STATUS: green
CONTEXT: installed the CLI on this host (npm run install:local + npm link →
/usr/bin/xclaw 3.85.1) and drove a REAL end-to-end agent turn. Install itself
clean; found 3 latent bugs + 1 test-hermeticity gap in the process:
BUILT: (1) doctor Phase-A bridge checks anchored on PACKAGE root (were cwd/
XCLAW_ROOT → 6 spurious errors when `xclaw doctor` run outside the repo).
(2) provider baseUrl scoping — agent.baseUrl/apiBase (loadConfig derives from
agent.provider) applied even when XCLAW_PROVIDER selected a DIFFERENT provider,
so ollama requests went to api.x.ai; now applied only when resolved provider ==
agent.provider. (3) env-over-config precedence for XCLAW_MODEL/XCLAW_PROVIDER
in resolver + chain builder (matches XCLAW_SSRF convention). (4) R11 cred-scoping
tests isolate the auth-profile store to a temp dir (a real stored OAuth token
on-disk was leaking into env-fallback assertions).
RAN: suite 1255 total, 0 fail · eval:ci OK · LIVE: real Claude turn via the
installed `xclaw agent` (Anthropic OAuth token, claude-sonnet-5) →
"INSTALL-OK-CLAUDE", tokens in=99 out=17. Install is functionally live.
NOTE: xclaw is now linked on PATH + an anthropic:default OAuth profile is
stored in ~/.xclaw (8h expiry, refresh token present).

## 2026-08-12 — 3.86.0 multi-provider management (Claude)

STATUS: green
CONTEXT: user wants every provider configurable independently (own API key +
OAuth + base URL, all SEPARATE) and to pick a model from the provider's LIVE
model list after entering the credential — via CLI TUI and web UI.
BUILT: shared core src/providers/manage.mjs (providerInventory/setProviderBaseUrl/
setActiveProvider/checkProviderCredential) + saveConfigPatch (atomic deep-merge
writer) in config/load.mjs. CLI src/cli/providers-cli.mjs: list/set/oauth/use(TUI)/
setup(sequential wizard) — credential-first: after key/OAuth stored →
fetchLiveModels(force) → numbered live-model picker. Gateway routes/providers.mjs:
GET /providers/manage + POST base-url|key|models|use|check|prefer + DELETE key;
control-UI Providers panel (paste key→live model dropdown→Use). Separate creds:
<provider>:apikey vs <provider>:oauth coexist (setAuthOrder picks active).
REAL FIX: anthropic discovery used x-api-key which 401s for OAuth tokens — now
sk-ant-oat→Bearer+oauth-beta, sk-ant-api→x-api-key (both live-fetch models).
SECURITY (3 HIGH from review, all fixed+live-proven): /providers gated in both
auth.mjs branches (no/wrong token→401); base-url validated (https any / http
loopback only; evil http, file:→400); UI esc() on every interpolation (XSS).
RAN: full suite 1279 total, 0 fail (1274 pass, 5 skip), NO hang · providers-cli
12/12 · gateway-providers 9/9 · LIVE gateway (token set): auth 401/401/200,
base-url 400/400/200/200, POST models anthropic→10 real models via OAuth,
use route ok, inventory NO secret leak, /control/ 200, 10 esc() calls.
CLI live: list renders real table, base-url + use roundtrips persist/restore.
NOTE: xclaw installed on this host (v3.86.0 via npm link) + anthropic OAuth
profile stored; agent turns work live (INSTALL-OK-CLAUDE earlier).

## 2026-08-12 — 3.86.1 cross-provider credential leak fix (Claude)

STATUS: green
CONTEXT: setting up xAI api key alongside the active Anthropic provider —
found xai runs were sent the ANTHROPIC OAuth token (→ "Anthropic HTTP 404:
model grok-4.5", then "Incorrect API key" once adapter fixed). Real cred-leak:
one vendor's token reaching another's endpoint.
FIXED (3 scoping spots): (1) registry resolveProviderRouteAsync/Route —
cfg.agent.apiKey (active provider's cached key) only used when
agent.provider===resolved provider (mirrors 3.85.2 baseUrl guard); (2)
resolveProviderToken step 1 — removed legacy `|| p==="xai"` clause; (3) step 2
— opts.profileId (loadConfig fills it with active provider's authProfileId)
honored only when profile.provider===p; (4) createProvider — sk-ant-oat
token-shape no longer forces anthropic adapter for explicit non-anthropic
providers.
RAN: provider tests 31/31 · full suite 1279/0 · LIVE: xai:apikey → grok-4.5
"XAI-KEY-OK" real inference cost-tracked $0.0177, anthropic still "ANTHRO-OK"
no regression · resolveProviderToken(xai)=profile:xai:apikey,
(anthropic)=profile:anthropic:default. Regression test added.
NOTE: xAI API key setup COMPLETE + live-verified for the user; xai OAuth still
pending (device/pkce 403 — no public xAI OAuth app; needs `grok login --oauth`
then import-grok).

## 2026-08-12 — 3.86.2 cross-provider leak in model discovery (Claude)

STATUS: green
CONTEXT: verifying all 4 configured creds (xai apikey+oauth, anthropic apikey+
oauth) fetch live models via CLI list + web-UI. xAI model-fetch → HTTP 400
because discovery.mjs resolveApiKey (a 3rd resolution path, missed in 3.86.1)
used cfg.agent.apiKey (active=anthropic's cached key) for xai → anthropic key
sent to api.x.ai/models.
FIXED: resolveApiKey provider-scoping guard (same as registry/profiles 3.86.1);
XCLAW_API_KEY stays generic last-resort. Exported + 2 regression tests.
RAN: suite 1280/0 · LIVE gateway: /providers/manage/models xai→7 grok models,
anthropic→10 claude models (both fixed, 400→success). All 4 creds fetch live
models (CLI + UI): xai:apikey/xai:oauth→7, anthropic:oauth/anthropic:apikey→10
(model listing needs no credit — the anthropic apikey has none but lists fine).
STATE: 4 creds all separate + verified: xai:apikey★ xai:oauth, anthropic:oauth★
anthropic:apikey (renamed from anthropic:default). Parity complete.

## 2026-08-12 — 3.87.0 Ollama one-command install + cloud API-key credential (Claude)

STATUS: green
BUILT: (1) src/providers/ollama-install.mjs — oneClickInstall (installRuntime via
official script if missing → ensureDaemon → pullModel → localModels), idempotent;
wired as `xclaw providers install ollama [--model M]`. (2) Ollama cloud credential:
`providers set --provider ollama --api-key <ollama.com key>` → ollama:apikey;
registry ollamaEffectiveDefault + discovery route ollama to ollama.com/v1 when a
key resolves, 127.0.0.1:11434 when not (cfg per-provider baseUrl still overrides;
OLLAMA_CLOUD_BASE_URL override). manage inventory shows the effective endpoint.
RAN: suite 1284/0 · LIVE: `providers install ollama` (runtime detected, daemon up,
llama3.2 pulled) · cloud key → 18 cloud models fetched · real xclaw turn via
ollama cloud gpt-oss:120b → OLLAMA-CLOUD-XCLAW-OK · providers list shows ollama
https://ollama.com/v1 (key present). Routing unit tests (registry+discovery).
STATE: 3 providers configured — xai(apikey★+oauth), anthropic(oauth★+apikey),
ollama(apikey=cloud, local=no-key). User provided the ollama.com cloud key.

## 2026-08-13 — 3.87.1 split Ollama into ollama (local) + ollama-cloud (Claude)

STATUS: green
CONTEXT: user asked to split the routed single ollama provider into two entries.
BUILT: added "ollama-cloud" builtin (baseUrl ollama.com/v1, defaultModel
gpt-oss:120b, envKey OLLAMA_API_KEY, seed cloud models); REMOVED the 3.87.0
key-routing hack (registry ollamaEffectiveDefault + discovery/manage special
cases) — each entry now carries its own baseUrl. Migrated stored ollama:apikey
→ ollama-cloud:apikey. Install cmd help points cloud at ollama-cloud. Routing
tests rewritten (ollama→127.0.0.1, ollama-cloud→ollama.com).
RAN: suite 1284/0 · LIVE: providers list shows BOTH ollama(127.0.0.1, no key)
+ ollama-cloud(ollama.com, ollama-cloud:apikey); ollama-cloud fetch 18 cloud
models + gpt-oss:120b turn OLLAMA-CLOUD-SPLIT-OK; local daemon direct generate
llama3.2 OK (0.5s). NB: local agent-turn slow (large sysprompt × small model
on CPU) — routing fine, latency only.
STATE: providers now — xai(apikey★+oauth), anthropic(oauth★+apikey),
ollama(local no-key), ollama-cloud(apikey).

## 2026-08-13 — 3.88.0 add NVIDIA NIM provider (Claude)

STATUS: green
BUILT: nvidia builtin provider — baseUrl integrate.api.nvidia.com/v1,
openai-completions, envKey NVIDIA_API_KEY, defaultModel meta/llama-3.3-70b-
instruct, 10 seeded popular models. NVIDIA catalog is PUBLIC (200 no key) so
live discovery works keyless; key (nvapi-) only for inference.
RAN: suite 1285/0 · LIVE: providers list shows nvidia; fetchLiveModels(nvidia)
→ 90 chat models keyless (integrate.api.nvidia.com/v1/models public). Routing
test added.
PENDING: user nvapi- key to store nvidia:apikey + verify inference.
STATE: providers — xai(apikey★+oauth), anthropic(oauth★+apikey), ollama(local),
ollama-cloud(apikey), nvidia(no key yet, discovery live).

## 2026-08-13 — 3.89.0 polish providers CLI/TUI/UI (Claude, 2 forks)

STATUS: green
BUILT: CLI providers list — endpoint elide + plain-text padding (google/nvidia
no longer break alignment), grouped active→configured→"not configured" dim,
MODELS count column, clean `↳ oauth★ apikey` cred line, N/12 footer. TUI —
reformatted wizard/picker headers, inline status, ollama one-command install
option, non-TTY + live-models spine intact. Web UI — grouping mirror, per-
provider hints (ollama local/ollama-cloud key/nvidia public), key→models→Use
spine finished, credential badges (★prefer/×remove), loading/empty/error/busy
states, esc() XSS + token on every call.
RAN: suite 1285/0 · LIVE CLI list aligned across 12 providers · gateway panel:
12 providers, nvidia 90 public models via /providers/manage/models, no-token
401, /control/ 200, esc()×12. providers-cli 12/12, gateway route/split 22/22.
STATE: 5 providers configured (xai apikey★+oauth, anthropic oauth★+apikey,
nvidia apikey, ollama-cloud apikey, ollama local); 12 total selectable.

## 2026-08-13 — 3.90.0 channel management CLI/TUI/UI (Claude, 2 forks)

STATUS: green
BUILT: src/channels/manage.mjs core (CHANNEL_SPECS declarative fields,
channelInventory secrets-redacted, setChannelField/setChannelEnabled via
saveConfigPatch). CLI src/cli/channels-cli.mjs — list(aligned table,
enabled-first)/set/enable/disable/setup wizard, mirrors providers-cli. Gateway
routes/channels.mjs — GET /channels/manage (+live status merge) + POST field/
enabled/restart; /channels operator-token gated in auth.mjs both branches.
Control-UI Channels panel (enable toggle, masked secret inputs, badges, restart)
mirrors Providers. 5 channels: telegram/slack/discord/email/webchat.
RAN: suite 1285→1304/0 · channels-cli 11/11 · gateway-channels+split 21/21 ·
LIVE: no-token /channels/manage 401, inventory 5 channels NO secret values
leaked, /channels/status 200, /control/ 200, chan panel present. CLI list
aligned (enabled webchat first, disabled below).
STATE: channels now manageable same as providers across CLI/TUI/UI. webchat on;
telegram/slack/discord/email need setup (tokens).

## 2026-08-13 — telegram channel live + dmPolicy lock (Claude)

STATUS: green
DID: set up Telegram channel with the user's bot @xxclaw_bot (token validated
getMe, stored redacted, enabled). Locked DMs to owner: allowedChatIds
["8087386717"] + dmPolicy="allowlist" (added dmPolicy to CHANNEL_SPECS.telegram
so it's CLI/UI-manageable). Gateway now runs under pm2 (name xclaw-gateway,
logs /root/.xclaw/logs/gateway.log) + pm2 startup systemd + pm2 save →
reboot-persistent. Live-verified end-to-end: user DM'd bot → Claude reply
(anthropic:oauth active). 3.90.1 shipped the dmPolicy spec field.
NOTE: user hit generate_image fail via bot — image-gen reads XAI_API_KEY env
directly (not the xai:apikey profile); env not set → images fail. Separate gap.

## 2026-08-13 — 3.90.2 image-gen reads provider credential + current models (Claude)

STATUS: green
CONTEXT: user's telegram bot hit generate_image "XAI_API_KEY not set" — the image
tools read the env var directly, not the xai:apikey profile.
FIXED: image-tools.mjs resolveXaiKey → resolveProviderToken(cfg,"xai") (env
fallback); cfg threaded registry→createImageTools→generate/edit tools;
description degeneric-ized. Also imagine-models.mjs matrix: grok-2-image* retired
→ grok-imagine-image / -2.0 / -quality (verified via /v1/models on the account),
old ids kept as fallback.
RAN: suite 1306/0 · LIVE: generate_image produced a real 60KB PNG via
profile:xai:apikey with XAI_API_KEY unset. Regression test added. pm2 gateway
restarted to pick up the fix so @xxclaw_bot can now generate images.

## 2026-08-13 — 3.90.3 telegram image delivery (Claude)

STATUS: green
CONTEXT: user's bot generated an image but only sent text — telegram outbound had
no local-file photo upload (only voice-out used multipart).
BUILT: channels/telegram/photo-out.mjs (multipart sendPhoto → sendDocument
fallback); base.mjs extractImageArtifacts(toolTrace) → images field; runtime.mjs
passes images through processInbound; telegram reply path uploads out.images as
photos after text (cap 10). 
RAN: suite 1308/0 · LIVE: sent the earlier generated logo to chat 8087386717 →
sendPhoto ok message_id 70 (user received it). pm2 gateway restarted so future
generate_image auto-delivers the picture.

## 2026-08-13 — 3.90.4 strip claims grounding block from channel replies (Claude)

STATUS: green
CONTEXT: user's telegram screenshot showed the raw {"claims":…,"evidence_ids":…}
json block leaking into the bot's reply (BASE_SYSTEM_PROMPT asks the model to emit
it for grounding).
FIXED: stripClaimsBlock(text) in loop.mjs removes trailing fenced OR bare claims
object; applied to the user-facing `text` return field only (raw finalText/
replyText kept for verify/claims consumers); unrelated json untouched.
RAN: suite 1311/0 · pm2 gateway restarted so replies are clean.

## 2026-08-13 — 3.91.0 full doctor (Providers/Channels/Services) (Claude)

STATUS: green
BUILT: xclaw doctor extended — Providers section (providerInventory +
checkProviderCredential per configured provider, active model, image-gen
readiness), Channels section (channelInventory enabled/configured + live
telegram getMe), Services section (pm2 xclaw-gateway status). doctorGroup +
order updated (Providers, Channels between Security and Computer). No secrets.
RAN: suite 1311/0 · LIVE doctor: 0 err 8 warn — Providers 4/12 all resolve +
imageGen ready, Channels 2/5 (telegram bot @xxclaw_bot reachable), pm2
xclaw-gateway online.

## 2026-08-29 — 3.376.0 default agent surfaces persist and continue

STATUS: green
DISCOVERED: Feature 2 (durable `~/.xclaw/agent-runs/` snapshots) and
objective auto-promote were live on Telegram `processInbound` but dead on
the path operators type into. The loop persisted only on `sessionId` /
`persistRun`; CLI, TUI, POST /agent/run, and `runAgent` pass
`chatSessionId`. CLI also called `runAgentLoop` directly (skipped A0
claims gate) and exited at the turn cap.
BUILT: `resolveRunPersistId` (chatSessionId counts; persistRun:false
opt-out; persist id resolved once per run). CLI → `runAgent` + persist +
in-process auto-promote (`awaitRun`). Webchat auto-promotes the same
helper. Stream results include `stopReason`.
RAN: 147 related tests pass (agent/objective/channel/claims + new
persist-id, default-path-durability, auto-promote predicate). Doctor 0
err / 8 warn. Did not run the full 876-file suite this slice.
UNVERIFIED: live `xclaw agent` turn-cap → mission on a real model;
gateway boot auto-resume of agent-runs (objectives already auto-resume);
full npm test.

## 2026-08-29 — 3.377.0 crashed runs resume as objectives

STATUS: green
DISCOVERED: snapshots wrote (3.376) but gateway boot never read them.
Objectives auto-resumed; agent-runs did not. A kill -9 left durable
state that nothing continued.
BUILT: `src/agent/run-resume.mjs` — classify resumable (active /
maxTurns / segment; NOT aborted/approval/budget/completed), stamp
interrupted, promote into existing objective orchestrator with
in-flight "verify before rewrite", idempotent resumedAt/objectiveId.
Cap 3, age 48h, `agent.autoResume:false` opt-out. Wired in gateway
boot next to objective auto-resume.
RAN: 28 persist/resume tests + 35 with objective/loop suites, all
pass. Defaults parse (`autoResume true 3`).
UNVERIFIED: live kill -9 of a real agent then gateway restart on
this host; full npm test; false-completion on default chat (next).

## 2026-08-30 — 3.378.0 Done is not done when the file is missing

STATUS: green
DISCOVERED: default loop stopReason natural = model stopped calling
tools. Jobs/objectives already evidence-gated. README one-shot
"Create /tmp/xclaw-hello.txt with text ok" could accept a lie.
BUILT: `src/agent/complete-gate.mjs` derives file_contains from
create/write-with-text goals; loop re-enters on fail; cap →
`unverified` (not completed). Chat/questions untouched.
RAN: 72 tests (complete-gate + contract + resume + continuation +
loop-stages) pass.
UNVERIFIED: live model that lies then writes the file after reject;
full npm test.

## 2026-08-30 — 3.380.0 touch/write-to still have to exist

STATUS: green
BUILT: complete-gate derives file_exists for touch/create-path and
file_contains for `write TEXT to PATH`. Chat/how-to still empty.
RAN: 35 pass (complete-gate, autonomy-contract, continuation, resume).

## 2026-08-30 — 3.379.0 live-e2e cron on the gateway, opt-in

STATUS: green
DISCOVERED: `ensureLiveE2eCronJob` existed; doctor/eval wired at
gateway boot; live-e2e was CLI-only (`live-e2e-schedule`). A JSON
`"enabled": true` did nothing on the process that stays up.
BUILT: `liveE2eCronShouldArm` (`=== true` only) + `armLiveE2eCronJob`
called from gateway next to eval. `anchorKey: cron.liveE2e` so a 24h
interval survives restarts. Profiles do not opt in.
RAN: live-e2e-cron-boot + live-e2e-spawn + cron-job-cfg (hermetic).
UNVERIFIED: a live gateway with `enabled: true` actually spawning
the enforcement script; full npm test.

## 2026-08-30 — 3.385.0 write-a-file containing TEXT still has to match

STATUS: green
DISCOVERED: eval smoke `Write a file hello.txt containing exactly:
hello xclaw` then `Then stop.` derived nothing (required named/called;
`.` could not span the closer line), so Done. was natural.
BUILT: FILE_PREFIX allows `a file PATH`; CONTENT includes
`whose first line is`; cleanExpectedText strips `exactly:` and
Then-stop/When-done closers. How-to still empty.
RAN: 31 pass 0 fail (complete-gate, autonomy-contract, default-path-durability).
UNVERIFIED: live lying-model then rewrite; full npm test.

## 2026-08-30 — 3.388.0 relative dotfiles still have to exist

STATUS: green
DISCOVERED: PATH needed `/` or a non-leading extension, so
`touch .gitignore` / `create .env` derived nothing.
BUILT: leading-dot alternative `.[A-Za-z][\\w.-]*`. How-to stays empty.
RAN: 36 pass 0 fail (complete-gate, autonomy-contract, default-path-durability).
UNVERIFIED: live lying-model then rewrite; full npm test.

## 2026-08-30 — 3.390.0 mkdir / create directory still have to exist

STATUS: green
DISCOVERED: `mkdir out` / `create a directory named build` derived
nothing. mkdir+write eval still correctly prefers the file check.
BUILT: dedicated mkdir/create-directory matcher after write checks;
stopwords ("of files") and how-to stay empty.
RAN: 41 pass 0 fail (complete-gate, autonomy-contract, default-path-durability).
UNVERIFIED: live lying-model then rewrite; full npm test.

## 2026-08-30 — 3.392.0 results/PROOF is the path, not result

STATUS: green
DISCOVERED: v3.391 `RESULT` matched as a prefix of `results/PROOF`,
so the gate checked a file named `result`.
BUILT: known basenames are whole tokens; optional `dir/` prefix.
Duplicate delete matcher removed. How-to empty.
RAN: 46 pass 0 fail (complete-gate, autonomy-contract, default-path-durability).
UNVERIFIED: live lying-model then rewrite; full npm test.

## 2026-08-30 — 3.472.0 background bash uses canonical pid-alive (Claude reverify)

STATUS: green (local hermetic; GitHub `ci` was red v3.410.0→v3.471.0)
DISCOVERED: Grok v3.410.0 (`953f767`) waited on `process.kill(pid, 0)`
before BASH_BG_STARTED; v3.411.0 added a local `pidAlive` that treated
EPERM as dead. `test/pid-alive-single-source.test.mjs` failed both.
A third red was `test/react-tool.test.mjs` pinning a one-liner
`createAllLocalTools({ workingDir, cfg, computer, sessionId, channelContext })`
that v3.421.0 expanded with `setSessionId` — both sites already passed
`channelContext`. Honesty-series commits (HTTP 200 HTML, leftover dest,
engine failure, missing files) were not the `ci` red; install-e2e /
eval-regression / ledger-guard stayed green.
BUILT: bash-tool imports `isPidAlive` from `src/shared/pid-alive.mjs`
(list + background-start). React pin still requires both loop sites to
pass `channelContext`; no longer demands the one-liner.
RAN: `node --test` pid-alive + react + bash-tool-codes → 36/36;
`npm test` → `# tests 5008` `# fail 0` (exit 0).
UNVERIFIED: GitHub `ci` on this SHA (skills smoke / p2 still to run on
Actions); live gateway drive after merge.

## 2026-08-30 — 3.473.0 eval leftovers do not auto-resume as live missions (Claude)

STATUS: green (local hermetic; GitHub `ci` UNVERIFIED until this SHA)
DISCOVERED: Feature 2 recovery was correct for owner interrupted work and
wrong for ephemeral eval trees. Eval cases persist under
`os.tmpdir()/xclaw-eval/<runId>/<caseId>` into `~/.xclaw/agent-runs`
because persistRun is on. Gateway boot treated `maxTurns` as owner
work. Live: `obj_mtffg2yd_aaaad3` auto-started from
`2026-08-30T03-23-54-655Z_wc-a-04_Search_Retrieval_task_6_excel_with_search`
(30 tool calls, $0.41, then fail-closed `no_checks`). Census: 264
eval-like snapshots; 1 still unpromoted bomb
(`2026-08-30T03-23-54-655Z_intel-symbol-locate`, maxTurns, wd exists).
BUILT: `isEvalLeftoverWorkingDir` + skip in `isResumableAgentRun` so
list/resume/boot all refuse eval leftovers. Owner interrupted and
maxTurns with a non-eval workingDir still resume. Kill, approval,
budget stay put.
RAN: `node --test test/agent-run-resume.test.mjs` → 14/14;
`npm test` → `# tests 5010` `# fail 0` (exit 0).
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving
`intel-symbol-locate` stays put and `obj_mtffg2yd_aaaad3` stays
awaiting_human.

## 2026-08-30 — 3.472.0 GitHub ci + live drive now verified (Claude)

STATUS: green
CLOSED UNVERIFIED from the 3.472.0 entry: GitHub `ci` succeeded on
`3110bb8`; live drive after restart: `/version` 3.472.0 stale false,
`/ready` ready true, webchat POST `{message}` → assistant `PONG`,
telegram poller healthy writerLock pid=3157966. That restart is also
what auto-started the eval leftover above.

## 2026-08-30 — 3.473.0 GitHub ci + live drive now verified (Claude)

STATUS: green
CLOSED UNVERIFIED from the 3.473.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `80c194b`. Live after
pm2 restart: `/version` 3.473.0 stale false, `/ready` ready true,
webchat POST `{message}` → assistant `PONG`. Boot after 07:01:28Z
emitted no `[xclaw:agent-runs] auto-resumed` line.
`intel-symbol-locate` stayed `maxTurns` with no `resumedAt` /
`objectiveId`; `obj_mtffg2yd_aaaad3` stayed `awaiting_human`;
`new_objectives_since_restart` 0.

## 2026-08-30 — 3.474.0 operator list uses the same resume classifier (Claude)

STATUS: green (local hermetic)
DISCOVERED: v3.473.0 skipped eval leftovers in `isResumableAgentRun`
but `listAgentRuns` still re-derived `resumable` from status/stopReason.
Live mismatch: `intel-symbol-locate` classifier false, operator list
true. Control claimed “auto-resume on gateway boot”.
BUILT: `listAgentRuns` calls `isResumableAgentRun` via dynamic import
(run-resume already imports run-store). Control meta only claims
auto-resume when `resumable` is true; not-ok eval leftovers stay put.
RAN: `node --test` store+resume+doctor → 24/24; `npm test` →
`# tests 5013` `# fail 0` `# duration_ms 68402`.
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw runs list` /
Control after restart showing `intel-symbol-locate` not resumable.

## 2026-08-30 — 3.474.0 GitHub ci + live drive now verified (Claude)

STATUS: green
CLOSED UNVERIFIED from the 3.474.0 entry: GitHub `ci` (rerun after
flake `web_search returns structured text` `isError true` vs
`undefined` on first 24.15 gate), `install-e2e`, `eval-regression`,
`ledger-guard` succeeded on `9cfa018`. Live after pm2 restart:
`/version` 3.474.0 stale false, `/ready` ready true, webchat POST
`{message}` → assistant `PONG`. Boot after 07:32:18Z emitted no
`[xclaw:agent-runs] auto-resumed` line. `GET /agent-runs?limit=400`
row for `2026-08-30T03-23-54-655Z_intel-symbol-locate`:
`resumable: false`, `ok: false`. `listAgentRuns` resumable_count 0.
Doctor `agentRuns.attention: no unfinished agent-run snapshots`.
Served `/control/app.js` contains `stay put (not auto-resumed)`.
`intel-symbol-locate` stayed `maxTurns` with no `resumedAt` /
`objectiveId`; `obj_mtffg2yd_aaaad3` stayed `awaiting_human`;
`n_objectives` 23 unchanged.

## 2026-08-30 — 3.475.0 operator list sorts by updatedAt not filename (Claude)

STATUS: green (local hermetic)
DISCOVERED: after 3.474.0 made the classifier honest, Control's
default 20-row window still hid `intel-symbol-locate`.
`listAgentRuns` sliced reverse filenames before reading bodies;
`job_*` / `objective-*` sort ahead of ISO-timestamp ids. Live:
`GET /agent-runs?limit=20` not-ok 0; `limit=400` not-ok 4 including
that leftover.
BUILT: load all snapshots, sort by `updatedAt`, then apply limit.
RAN: `node --test` store+resume+doctor → 25/25; `npm test` →
`# tests 5014` `# fail 0` `# duration_ms 69822`.
UNVERIFIED: GitHub `ci` on this SHA; live `GET /agent-runs?limit=20`
includes `intel-symbol-locate` as `resumable: false` / `ok: false`.

## 2026-08-30 — 3.475.0 GitHub ci + live drive now verified (Claude)

STATUS: green (sort live; leftover still outside default window)
CLOSED UNVERIFIED from the 3.475.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `6dae4b9` (ci 33299746772
1m43s, no web_search flake). Live after pm2 restart pid 3255831 created
2026-08-30T07:43:17Z: `/version` 3.475.0 stale false, `/ready` ready true,
webchat POST `{message}` → assistant `PONG`. Boot after 07:43:17Z emitted
no `[xclaw:agent-runs] auto-resumed` line (last still 06:27:15
obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=400` n=292, `updatedAt_desc`
true, filename_eq_actual false. Leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` rank 75
(`resumable: false`, `ok: false`, updatedAt 04:17:33.558Z);
75 newer rows, so `limit=20` still omits it (not_ok_only_20 empty;
not_ok_only_400_n 4). Doctor `agentRuns.attention: no unfinished
agent-run snapshots`. Leftover stayed `maxTurns` with no `resumedAt` /
`objectiveId`; `obj_mtffg2yd_aaaad3` stayed `awaiting_human`;
`n_objectives` 23 unchanged. NEXT: pin attention rows into the
operator window so Control's default 20 still shows not-ok leftovers.

## 2026-08-30 — 3.476.0 operator list pins attention rows into the window (Claude)

STATUS: green (local hermetic)
DISCOVERED: after 3.475.0 sorted by `updatedAt`, Control's default
20-row window still hid `intel-symbol-locate`. Live leftover sat at
rank 75 (`updatedAt` 04:17) behind 75 newer ok runs, so
`GET /agent-runs?limit=20` not-ok 0 while `limit=400` not-ok 4.
BUILT: `listAgentRuns` pins resumable / not-ok / corrupt rows ahead
of ok ones, then applies the limit. Newest-ok order among the rest
is unchanged.
RAN: `node --test` store+resume+doctor → 26/26; `npm test` →
`# tests 5015` `# fail 0` `# duration_ms 69054`.
UNVERIFIED: GitHub `ci` on this SHA; live `GET /agent-runs?limit=20`
includes `intel-symbol-locate` as `resumable: false` / `ok: false`.

## 2026-08-30 — 3.476.0 GitHub ci + live drive now verified (Claude)

STATUS: green (leftover in default 20; window flooded by missing-workdir)
CLOSED UNVERIFIED from the 3.476.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `1ff28d2` (ci 33300337647
1m34s, no web_search flake). Live after pm2 restart pid 3276851 created
2026-08-30T07:55:51Z: `/version` 3.476.0 stale false, `/ready` ready true,
webchat POST `{message}` → assistant `PONG`. Boot after 07:55:51Z emitted
no `[xclaw:agent-runs] auto-resumed` line (last still 06:27:15
obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=20` n=20, leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` in window (`resumable:
false`, `ok: false`, status maxTurns, updatedAt 04:17:33.558Z). not_ok_20
= sandbox-escape-denied, intel-symbol-locate, campaign-static-site,
campaign-svc-admin. Remaining 16 of 20 are `SESSION_WORKDIR_MISSING`
(a4-G*/W* from 2026-08-19). `limit=400` n=293: error 101, not_ok 4,
resumable 0, ok 188. Leftover stayed `maxTurns` with no `resumedAt` /
`objectiveId`; `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. NEXT: do
not pin missing-workdir rows into the operator window — they crowd out
newest ok runs after the 4 not-ok leftovers.

## 2026-08-30 — 3.477.0 operator list does not pin missing-workdir rows (Claude)

STATUS: green (local hermetic)
DISCOVERED: 3.476.0 pinned leftover into Control's default 20, then
filled the rest with SESSION_WORKDIR_MISSING. Live: limit=20 error 16
/ not-ok 4 / ok 0; limit=400 error 101 of 293 (a4-G*/W* from 2026-08-19).
BUILT: `listAgentRuns` pins only `resumable` / `ok === false`. Missing
workingDir and corrupt rows stay in newest-ok order among the rest.
RAN: `node --test` store+resume+doctor → 27/27; `npm test` →
`# tests 5016` `# fail 0` `# duration_ms 69244`.
UNVERIFIED: GitHub `ci` on this SHA; live `GET /agent-runs?limit=20`
includes leftover as not-ok and has 0 SESSION_WORKDIR_MISSING rows.

## 2026-08-30 — 3.477.0 GitHub ci + live drive now verified (Claude)

STATUS: green (leftover in default 20; 0 missing-workdir in the window)
CLOSED UNVERIFIED from the 3.477.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `982df74` (ci 33301026923
1m45s, no web_search flake). Live after pm2 restart pid 3299306 created
2026-08-30T08:13:21Z: `/version` 3.477.0 stale false, `/ready` ready true,
webchat POST `{message}` → assistant `PING` (user sent `PONG`). Boot after
08:13:21Z emitted no `[xclaw:agent-runs] auto-resumed` line (last still
06:27:15 obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=20` n=20 error 0
missing 0 not_ok 4 resumable 0 ok 16. Leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` at index 1 (`resumable:
false`, `ok: false`, status maxTurns, updatedAt 04:17:33.558Z). not_ok_20
= sandbox-escape-denied, intel-symbol-locate, campaign-static-site,
campaign-svc-admin. Newest ok PONG uuid `096fd05a-631f-49e5-ac68-1bf59d930738`
at index 4. `limit=400` n=294: error 101, missing 101, not_ok 4,
resumable 0, ok 189. Leftover stayed `maxTurns` with no `resumedAt` /
`objectiveId`; `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives
23. Doctor `agentRuns.attention: no unfinished agent-run snapshots`.
NEXT: long-horizon / context compression (evolution directive).

## 2026-08-30 — 3.478.0 boot listResumableAgentRuns sorts by updatedAt not filename (Claude)

STATUS: green (local hermetic)
DISCOVERED: after 3.477.0 made Control honest, boot
`listResumableAgentRuns` still sliced reverse filenames at 80 then
loaded. Live leftover reverse-lex rank 96 (`in80` false); 23 `job_*`
+ 1 `objective-*` occupy the top; 212 ISO ids outside the 80. Doctor
uses `{ limit: 50 }`. Same class as 3.475.0, different surface
(boot/doctor vs Control). Compaction already default-on (3.68.0);
AUTONOMY_LONG_HORIZON.md is eval-harness only.
BUILT: `listResumableAgentRuns` loads all, classifies with
`isResumableAgentRun`, sorts by `updatedAt`, then applies the limit.
Eval leftovers stay skipped. Not-ok / corrupt not pinned into boot.
`agent.autoResumeMax` stays 3.
RAN: `node --test` store+resume+doctor → 28/28
(`# tests 28` `# fail 0` `# duration_ms 136.488396`);
`npm test` → `# tests 5017` `# fail 0` `# duration_ms 69346`.
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving
boot still does not auto-resume leftover and doctor attention stays
honest (live resumable_count is 0 — hermetic proof covers the
filename-slice class).

## 2026-08-30 — 3.478.0 GitHub ci + live drive now verified (Claude)

STATUS: green (boot sorts by updatedAt; leftover stay-put; doctor honest)
CLOSED UNVERIFIED from the 3.478.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `ce540f5` (ci 33302318784
1m44s, gates 22.22 + 24.15, no web_search flake). Live after pm2 restart
pid 3331647 created 2026-08-30T08:44:29Z: `/version` 3.478.0 stale false,
`/ready` ready true, webchat POST `{message}` → assistant `PONG`
(sessionId `88ed633a-51bd-4456-b220-0931fea231b0`). Boot after 08:44:32Z
emitted no `[xclaw:agent-runs] auto-resumed` line (last still 06:27:15
obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=20` n=20 error 0 missing 0
not_ok 4 resumable 0 ok 16. Leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` at index 1 (`resumable:
false`, `ok: false`, status maxTurns, updatedAt 04:17:33.558Z).
`limit=400` n=295: error 101, missing 101, not_ok 4, resumable 0, ok 190.
Leftover stayed `maxTurns` with no `resumedAt` / `objectiveId`;
`obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23. Doctor
`agentRuns.attention: no unfinished agent-run snapshots`. telegram
writerLock pid=3331647. NEXT: recon remaining evolution gap — do not
assume compaction or long-horizon still missing (compaction default-on
since 3.68.0; AUTONOMY_LONG_HORIZON.md is eval-harness only).

## 2026-08-30 — 3.479.0 recovered agent-runs stamp interrupted so restart notice fires (Claude)

STATUS: green (local hermetic)
DISCOVERED: `resumeAgentRunAsObjective` saved the promoted objective as
`running` (`newObjective` default). `runObjectiveInner` sets
`reconcile` only when `obj.status === "interrupted"`, so recovered
missions never got the "runtime restarted" notice. inFlight
`failures[]` DID fire. Channel auto-promote shares resumeId+running
but is a live continuation, not a crash — left alone. firstSegment
stays false (true would hide recovered seed progress/findings/files).
Empty-criteria done currently accepted (hermetic test depends on it) —
not this slice. Compaction already default-on (3.68.0).
BUILT: `resumeAgentRunAsObjective` stamps `obj.status = "interrupted"`
before save. Promotion test asserts status interrupted. New test
drives `runObjective` through the recovered path and asserts the
prompt contains "runtime restarted" plus seed progress and inspected
files.
RAN: `node --test test/agent-run-resume.test.mjs` → 16/16
(`# tests 16` `# fail 0` `# duration_ms 156.599237`);
`npm test` → `# tests 5018` `# fail 0` `# duration_ms 70462`.
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving
boot still does not auto-resume leftover and recovered path (when a
resumable owner snapshot exists) would fire the restart notice.

## 2026-08-30 — 3.479.0 GitHub ci + live drive now verified (Claude)

STATUS: green (recovered missions stamp interrupted; leftover stay-put; doctor honest)
CLOSED UNVERIFIED from the 3.479.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `0635d10` (ci 33305108598
1m41s, no web_search flake). Live after pm2 restart pid 3384836 created
2026-08-30T09:52:54.053Z: `/version` 3.479.0 stale false, `/ready` ready
true, webchat POST `{message}` → assistant `PONG` (sessionId
`aa134fdd-724b-48db-9bb0-4406a0f1935a`). Boot after 09:52:54Z emitted no
`[xclaw:agent-runs] auto-resumed` line (last still 06:27:15
obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=20` n=20 error 0 missing 0
not_ok 4 resumable 0 ok 16. Leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` at index 1 (`resumable:
false`, `ok: false`, status maxTurns, updatedAt 04:17:33.558Z).
`limit=400` n=296: error 101, missing 101, not_ok 4, resumable 0, ok 191.
Leftover stayed `maxTurns` with no `resumedAt` / `objectiveId`;
`obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23. Doctor
`agentRuns.attention: no unfinished agent-run snapshots`. telegram
writerLock pid=3384836. Recovered-path restart notice: live
resumable_count is 0 so no owner snapshot existed to promote; hermetic
test `"recovered agent-run first segment includes the runtime-restart
notice"` covers that path. NEXT: recon remaining evolution gap — do not
assume compaction or long-horizon still missing (compaction default-on
since 3.68.0; AUTONOMY_LONG_HORIZON.md is eval-harness only).
Empty-criteria done currently accepted (hermetic test depends on it).

## 2026-08-30 — 3.480.0 objective path arms goal-derived verify checks without baseline (Claude)

STATUS: green (local hermetic)
DISCOVERED: the default loop already derived file checks from the
goal (`deriveGoalVerifyChecks` in `evaluateNaturalStopVerify`). The
objective path only called `deriveVerifyChecks(workingDir)` (project
lint/test) then `baselineArmChecks`, which DROPS failures. A mission
"write OK to out.txt" in a non-node dir therefore held as `no_checks`
awaiting_human even if the file was written — production fail-closed,
but never VERIFIED the named artifact. Empty-criteria done is already
held by `deterministicGate` (`requireChecked: true`); hermetic longrun
opts out via `requireChecked: false`. Not this slice. Compaction
already default-on (3.68.0). Long-horizon orchestrator exists.
BUILT: objective derive block now imports `deriveGoalVerifyChecks`,
stamps `source: "runtime"`, arms WITHOUT baseline, then baseline-filters
project-suite checks and merges. Operator `verify[]` length-guarded.
`deriveChecks: false` still skips. Ledger/onEvent only if fromGoal or
fromProject nonempty.
RAN: `node --test test/objective-verify-gate.test.mjs
test/complete-gate.test.mjs` after deduping triplicate `it()` copies
→ `# tests 58` `# fail 0` `# duration_ms 2785.414306`;
`npm test` → `# tests 5022` `# fail 0` `# duration_ms 70221.041535`.
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving
leftover stay-put and that a live objective with a goal-named file
arms the check (hermetic covers the arm/reject/close path).

## 2026-08-30 — 3.480.0 GitHub ci + live drive now verified (Claude)

STATUS: green (goal-derived checks armed on objective path; leftover stay-put; doctor honest)
CLOSED UNVERIFIED from the 3.480.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `a10628f` (ci 33307335061
1m46s, no web_search flake). Live after pm2 restart pid 3419751 created
2026-08-30T10:47:50.109Z startedAt 10:47:52.004Z: `/version` 3.480.0 stale
false, `/ready` ready true, webchat POST `{message}` → assistant `PONG`
(sessionId `eca57da9-ac2f-4078-92d1-a1fb93e1841e`, model grok-4.6,
stopReason natural). Boot after 10:47:52Z emitted no
`[xclaw:agent-runs] auto-resumed` line (last still 06:27:15
obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=20` n=20 error 0 missing 0
not_ok 4 resumable 0 ok 16. Leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` at index 1 (`resumable:
false`, `ok: false`, status maxTurns, updatedAt 04:17:33.558Z).
Leftover stayed `maxTurns` with no `resumedAt` / `objectiveId`;
`obj_mtffg2yd_aaaad3` stayed `awaiting_human` (`pendingCompletion.reason`
`no_checks`, verdict unverified). n_objectives 23. Doctor
`agentRuns.attention: no unfinished agent-run snapshots`. telegram
writerLock true, lastPollOkAt 2026-08-30T10:48:53.740Z. Live objective
with a goal-named file was NOT driven on the gateway; hermetic tests
cover arm / reject-until-file / close-verified / how-to still
`no_checks`. NEXT: recon remaining evolution gap — do not assume
compaction or long-horizon still missing (compaction default-on since
3.68.0; AUTONOMY_LONG_HORIZON.md is eval-harness only). Empty-criteria
done is already held by `deterministicGate` (`requireChecked: true`).

## 2026-08-30 — 3.481.0 gateway objective segments opt out of inner-loop continuation (Claude)

STATUS: green (local hermetic)
DISCOVERED: Channel `startDetachedObjective` already passed
`continuation: false` so the inner loop kept a single-segment contract
(`totalTurnCap = maxTurns`). Gateway `startGatewayObjective` (`POST
/objectives`, boot auto-resume via `resumeObjectiveDetached`) omitted
the flag. `replyWithAgent` only forwards `continuation` when the caller
set it, so undefined meant ON (`maxTurns * 4` inside one API-started
segment, fighting the orchestrator's own segmentation). Jobs empty-verify
is NOT a missing derive hole — `runJob` goes through `runAgentLoop` with
`userMessage: goal` and does not set `verifyOnComplete: false`;
`sr === "unverified"` already maps to job failed. Recovered/promoted
missions still hit the 3.480.0 derive block (not gated on resumeId).
Empty-criteria done already held by `deterministicGate`. Compaction
already default-on (3.68.0). Long-horizon orchestrator exists.
BUILT: gateway `runSegment` now passes `continuation: false` next to
`history: []`, matching the channel path. Source-contract test pins both
live callers. Objective completion stays gated by `deterministicGate` +
3.480.0 derive — this slice does not touch `verifyOnComplete`.
RAN: `npm test` (hermetic) `# tests 5024` `# fail 0` `# duration_ms 69871.002828`. Targeted `node --test test/gateway-objective-continuation.test.mjs` `# tests 2` `# fail 0` `# duration_ms 46.850807`. Ship-gate `grep -qE "^# fail 0"` held.
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put and that POST /objectives segments inherit continuation:false
(hermetic source pin covers the caller).

## 2026-08-30 — 3.481.0 GitHub ci + live drive now verified (Claude)

STATUS: green (gateway continuation opt-out shipped; leftover stay-put; doctor honest)
CLOSED UNVERIFIED from the 3.481.0 entry: GitHub `ci` / `install-e2e` /
`eval-regression` / `ledger-guard` succeeded on `cd4f3e4` (ci 33308768125
1m37s, no web_search flake). Live after pm2 restart pid 3447913 created
2026-08-30T11:23:02.683Z startedAt 11:23:04.596Z: `/version` 3.481.0 stale
false, `/ready` ready true, webchat POST `{message}` → assistant `PONG`
(sessionId `5a349937-7e80-4716-ab59-6a8a720b895d`, model grok-4.6,
stopReason natural). Boot after 11:23:04Z emitted no
`[xclaw:agent-runs] auto-resumed` line (last still 06:27:15
obj_mtffg2yd_aaaad3). `GET /agent-runs?limit=20` n=20 error 0 missing 0
not_ok 4 resumable 0 ok 16. Leftover
`2026-08-30T03-23-54-655Z_intel-symbol-locate` at index 1 (`resumable:
false`, `ok: false`, status maxTurns, updatedAt 04:17:33.558Z, no
`resumedAt` / `objectiveId`). Snapshot workingDir still
`/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`.
`obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23. Doctor
`agentRuns.attention: no unfinished agent-run snapshots`. telegram
writerLock true, lastPollOkAt 2026-08-30T11:24:06.570Z, lock pid=3447913.
Live POST /objectives continuation opt-out was NOT driven on the gateway;
hermetic source-contract test pins both live `runSegment` callers.
NEXT: recon remaining evolution gap — do not assume compaction or
long-horizon still missing (compaction default-on since 3.68.0;
AUTONOMY_LONG_HORIZON.md is eval-harness only). Empty-criteria done is
already held by `deterministicGate` (`requireChecked: true`). Do not
treat jobs empty-verify as the next slice. Do not pass
`verifyOnComplete: false` as extra scope.

## 2026-08-30 — 3.482.0 automations ticks opt out of inner-loop continuation (Claude)

STATUS: green (local hermetic)
DISCOVERED: Cron `announceCronJob` already passed `continuation: false`.
Automations `executeAutomation` prefers `runAgentOnce`, which omitted
the flag. Undefined meant ON (`maxTurns * 4` inside one scheduled tick,
and inside each goal-mode "single most useful next step"). Goal-mode
already owns segmentation via ticks + the automations store. Sessionless
HTTP persist was inspected and REJECTED — AUTONOMY.md +
`test/default-path-durability.test.mjs` pin persist under the
conversation id. S3 listed callers (objective/spawn/jobs/missions/
rescue/cron) already opted out.
BUILT: `runAgentOnce` now passes `continuation: false` into `runAgent`.
Source-contract test pins run-once, executeAutomation still calling it,
and announceCronJob still opted out. Persist stays in the automations
store — this slice does not mint agent-run snapshots and does not invert
default-path durability.
RAN: node --test test/automation-continuation.test.mjs + related pins → # tests 40 # pass 40 # fail 0 # duration_ms 203.789378; npm test (hermetic) → # tests 5027 # pass 5027 # fail 0 # duration_ms 70797.467975
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live automation tick continuation opt-out is source-pinned, not
driven on the gateway.

## 2026-08-30 — 3.482.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.482.0 ship.
RAN:
- GitHub `ci` 33310667301 on `2d479c3` success, 1m37s (gate 24.15 1m30s, gate 22.22 1m37s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway`: GET /version → name=xclaw version=3.482.0 onDiskVersion=3.482.0 stale=false profile=lab.
- Leftover stay-put: agent-runs count 298 before and after restart; newest `5a349937-7e80-4716-ab59-6a8a720b895d` status=completed updatedAt=2026-08-30T11:23:33.746Z unchanged. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`.
- Webchat POST /channel/webchat/message `{"message":"ping 3.482.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 stopReason=natural.
UNVERIFIED: live automation tick continuation opt-out (source pin only; a live tick would mean a real agent loop). Live POST /objectives continuation opt-out remains source-pinned from 3.481.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers.

## 2026-08-30 — 3.483.0 voice /ws/voice auto-promotes a turn-cap cutoff (Claude)

STATUS: green (local hermetic)
DISCOVERED: Webchat, processInbound, and CLI `xclaw agent` already call
`autoPromoteIfNeeded` when `stopReason === "maxTurns"`. Voice
`runVoiceTurn` ran the same channel-invariant agent (named
`conversationId` already persists via chatSessionId) then sliced the
reply to 2000 chars and spoke it — a spoken cutoff never became a
durable objective. Continuation ON is intended (conversation). Persist
is not a hole — do not mint persistRun:true. HTTP POST /agent/run
auto-promote is caller-owned stopReason, not this slice. Command-intent
early return has no agent turn and stays unpromoted.
BUILT: `runVoiceTurn` agent path now calls `autoPromoteIfNeeded` +
`formatPromotedReply` before the 2000-char slice. Notify is a truthy
socket `sendJson` `{ type: "event", event: "objective" }` so
`shouldAutoPromoteTurn` can fire; promote_error uses the same frame
shape (voiceClientEvent drops type:"objective"). Mission is detached
(gateway stays alive). Source-contract pin in
`test/default-path-durability.test.mjs`.
RAN: node --test test/default-path-durability.test.mjs → # tests 13 # pass 13 # fail 0 # duration_ms 55.74735; npm test (hermetic) → # tests 5028 # pass 5028 # fail 0 # duration_ms 75471.661981
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live voice WS turn-cap → mission is source-pinned, not driven
on the gateway (a live voice turn would mean a real agent loop).

## 2026-08-30 — 3.483.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.483.0 ship.
RAN:
- GitHub `ci` 33312536514 on `e2d3ba3` success, 1m37s (gate 24.15 1m37s, gate 22.22 1m36s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3517717 created 2026-08-30T12:50:18.684Z startedAt 12:50:20.565Z: GET /version → name=xclaw version=3.483.0 onDiskVersion=3.483.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 299 before and after restart; leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=false ok=false objectiveId=null unchanged. Newest ok `c8dd816d-bb15-41fe-9088-11df6e353523` completed 2026-08-30T12:08:38.902Z unchanged. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3.
- Webchat POST /channel/webchat/message `{"message":"ping 3.483.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `aea7494a-eae5-4366-a114-4aa9db39148b`.
UNVERIFIED: live voice WS turn-cap → mission (source pin only; a live voice turn would mean a real agent loop). Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice.

## 2026-08-30 — 3.484.0 TUI auto-promotes a turn-cap cutoff (Claude)

STATUS: green (local hermetic)
DISCOVERED: Webchat, processInbound, voice `/ws/voice`, and CLI `xclaw
agent` already call `autoPromoteIfNeeded` when `stopReason ===
"maxTurns"`. The TUI streamed `/agent/run/stream` then printed `not
complete (maxTurns)` and waited — a cutoff never became a mission.
Named `sessionId` already persists. HTTP POST `/agent/run` auto-promote
is caller-owned stopReason, not this slice. POST `/objectives` was
rejected (skips derive/toolTrace). Do not mint persistRun:true.
BUILT: TUI submit path now calls `autoPromoteIfNeeded` +
`formatPromotedReply` after the stream result (detached notify into the
transcript). Skip the "not complete" line only when promoted.
Approval / budget / kill stay put. Source-contract pin in
`test/default-path-durability.test.mjs` (one `it()`, not three).
RAN: node --test test/default-path-durability.test.mjs → # tests 14 # pass 14 # fail 0 # duration_ms 51.895141; npm test (hermetic) → # tests 5029 # pass 5029 # fail 0 # duration_ms 69620.99076
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live TUI turn-cap → mission is source-pinned, not driven
(a live TUI turn would mean a real agent loop).

## 2026-08-30 — 3.484.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.484.0 ship.
RAN:
- GitHub `ci` 33315697794 on `7b9d7cc` success, 1m39s (gate 24.15 1m34s, gate 22.22 1m23s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3552308 created 2026-08-30T14:01:16.485Z startedAt 14:01:18.400Z: GET /version → name=xclaw version=3.484.0 onDiskVersion=3.484.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 300 before and after restart; leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=false ok=false objectiveId=null unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. Newest ok before webchat `aea7494a-eae5-4366-a114-4aa9db39148b` completed 2026-08-30T12:50:55.917Z unchanged. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3. `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.484.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `3e863f85-955c-459e-b572-796dc4cd2eaa` stopReason=natural. telegram writerLock true lastPollOkAt 2026-08-30T14:02:20.400Z lock pid=3552308.
UNVERIFIED: live TUI turn-cap → mission (source pin only; a live TUI turn would mean a real agent loop). Live voice WS turn-cap → mission remains source-pinned from 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice or TUI stream body. Do not auto-promote HTTP POST /agent/run.

## 2026-08-30 — 3.485.0 Discord /ask auto-promotes a turn-cap cutoff (Claude)

STATUS: green (local hermetic)
DISCOVERED: Webchat, processInbound, voice `/ws/voice`, the TUI, and CLI
`xclaw agent` already call `autoPromoteIfNeeded` when `stopReason ===
"maxTurns"`. Discord `/ask` called `replyWithAgent` then
`editInteraction` with the truncated reply — a cutoff never became a
mission. Discord MESSAGE_CREATE already went through `processInbound`
but omitted `notify`, so `shouldAutoPromoteTurn` stayed false even on
maxTurns. Named `chatId` already persists via replyWithAgent. HTTP POST
`/agent/run` auto-promote is caller-owned stopReason, not this slice.
Do not mint persistRun:true. `/status` and `/session` are not agent
turns. Slack/email notify is a sibling gap, not this slice.
BUILT: Discord `/ask` now calls `autoPromoteIfNeeded` +
`formatPromotedReply` after `replyWithAgent` (detached notify into the
channel via sendMessage; interaction tokens expire). MESSAGE_CREATE
`processInbound` now passes `notify` so processInbound promote can fire.
Source-contract pin in `test/default-path-durability.test.mjs` (one
`it()`, not three).
RAN: node --test test/default-path-durability.test.mjs → # tests 15 # pass 15 # fail 0 # duration_ms 55.708933; npm test (hermetic) → # tests 5030 # pass 5030 # fail 0 # duration_ms 69934.091489
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live Discord `/ask` turn-cap → mission is source-pinned, not
driven (a live Discord turn would mean a real agent loop).

## 2026-08-30 — 3.485.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.485.0 ship.
RAN:
- GitHub `ci` 33318642911 on `d03c3f2` success, 1m44s (gate 24.15 1m36s, gate 22.22 1m39s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3586461 created 2026-08-30T15:06:01.226Z startedAt 15:06:03.139Z: GET /version → name=xclaw version=3.485.0 onDiskVersion=3.485.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 301 before and after restart; leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=false ok=false objectiveId=null unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 15:00 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.485.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `ee251a93-ef7a-46ee-8b81-393ab94fd5d1` stopReason=null. telegram writerLock true lastPollOkAt 2026-08-30T15:06:34.338Z. discord enabled=false.
UNVERIFIED: live Discord `/ask` turn-cap → mission (source pin only; a live Discord turn would mean a real agent loop; live Discord is enabled=false). Live TUI / voice WS turn-cap → mission remain source-pinned from 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, or Discord `/ask`. Do not auto-promote HTTP POST /agent/run. Slack/email notify is a sibling gap — name it from live recon, do not silently expand.

## 2026-08-30 — 3.486.0 Slack processInbound auto-promotes a turn-cap cutoff

STATUS: green (local hermetic)
DISCOVERED: Telegram and Discord MESSAGE already pass `notify` into
`processInbound`, so `shouldAutoPromoteTurn` can fire on
`stopReason === "maxTurns"`. Slack went through the same helper but
omitted `notify`, so a truncated Slack turn never became a mission.
Named `chatId` already persists via processInbound → replyWithAgent.
HTTP POST `/agent/run` auto-promote is caller-owned stopReason, not
this slice. Do not mint persistRun:true. Email notify is a sibling
gap, not this slice.
BUILT: Slack `handleMessage` now passes `notify` (detached
`sendMessage` into the originating thread `msg.thread_ts || msg.ts`).
Source-contract pin in `test/default-path-durability.test.mjs` (one
`it()`, not three).
RAN: node --test test/default-path-durability.test.mjs → # tests 16 # pass 16 # fail 0 # duration_ms 71.564548; npm test (hermetic) → # tests 5031 # pass 5031 # fail 0 # duration_ms 69541.145019
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live Slack turn-cap → mission is source-pinned, not driven
(a live Slack turn would mean a real agent loop).

## 2026-08-30 — 3.486.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.486.0 ship.
RAN:
- GitHub `ci` 33319498418 on `c3ffdaa` success, ~1m40s (gate 24.15 1m35s, gate 22.22 1m23s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3609422 created 2026-08-30T15:23:32.452Z startedAt 15:23:34.371Z: GET /version → name=xclaw version=3.486.0 onDiskVersion=3.486.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 302 before and after restart; leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=None ok=None objectiveId=None unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 15:23 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.486.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `add00cf3-5913-4bfc-a30d-c480a7bf69c2` stopReason=natural. telegram writerLock held by live pid=3609422. discord enabled=false. slack enabled=false.
UNVERIFIED: live Slack turn-cap → mission (source pin only; a live Slack turn would mean a real agent loop; live Slack is enabled=false). Live Discord `/ask` / TUI / voice WS turn-cap → mission remain source-pinned from 3.485.0 / 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, or Slack. Do not auto-promote HTTP POST /agent/run. Email notify is a sibling gap — name it from live recon, do not silently expand.

## 2026-08-30 — 3.487.0 Email processInbound auto-promotes a turn-cap cutoff

STATUS: green (local hermetic)
DISCOVERED: Telegram, Discord MESSAGE, and Slack already pass `notify`
into `processInbound`, so `shouldAutoPromoteTurn` can fire on
`stopReason === "maxTurns"`. Email went through the same helper but
omitted `notify`, so a truncated email turn never became a mission.
Named `chatId` already persists via processInbound → replyWithAgent.
HTTP POST `/agent/run` auto-promote is caller-owned stopReason, not
this slice. Do not mint persistRun:true.
BUILT: Email `handleMail` now passes `notify` (detached `smtpSend`
In-Reply-To the originating message). Source-contract pin in
`test/default-path-durability.test.mjs` (one `it()`, not three).
RAN: node --test test/default-path-durability.test.mjs → # tests 17 # pass 17 # fail 0 # duration_ms 52.945103; npm test (hermetic) → # tests 5032 # pass 5032 # fail 0 # duration_ms 69061.505157
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live email turn-cap → mission is source-pinned, not driven
(a live email turn would mean a real agent loop).

## 2026-08-30 — 3.487.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.487.0 ship.
RAN:
- GitHub `ci` 33319795495 on `5c6852c` success, 1m41s (gate 24.15 1m32s, gate 22.22 1m37s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3628866 created 2026-08-30T15:30:12.868Z startedAt 15:30:14.771Z: GET /version → name=xclaw version=3.487.0 onDiskVersion=3.487.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 303 before and after restart; leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=None ok=None objectiveId=None unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 15:30 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.487.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `75b554b5-f719-445e-9515-8a45f50aeb51` stopReason=natural. telegram writerLock held by live pid=3628866. discord enabled=false. slack enabled=false. email enabled=false.
UNVERIFIED: live email turn-cap → mission (source pin only; a live email turn would mean a real agent loop; live email is enabled=false). Live Slack / Discord `/ask` / TUI / voice WS turn-cap → mission remain source-pinned from 3.486.0 / 3.485.0 / 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, or email. Do not auto-promote HTTP POST /agent/run.

## 2026-08-30 — 3.488.0 Voice TUI auto-promotes a turn-cap cutoff

STATUS: green (local hermetic)
DISCOVERED: Webchat, processInbound, voice `/ws/voice`, the TUI, Discord
`/ask`, Slack, email, and CLI `xclaw agent` already call
`autoPromoteIfNeeded` when `stopReason === "maxTurns"`. Voice TUI
preferAgent called `runJob` then printed/spoke the truncated reply — a
cutoff never became a mission. Distinct from closed `/ws/voice`.
`runJob` already persistRun by default. HTTP POST `/agent/run`
auto-promote is caller-owned stopReason, not this slice. Do not mint
persistRun:true. Voice listen is a sibling, not this slice. Command-intent
early continue has no agent turn and stays unpromoted.
BUILT: Voice TUI preferAgent path now calls `autoPromoteIfNeeded` +
`formatPromotedReply` after `runJob` (detached notify into the
transcript). Session id `voice-tui_${…}` minted for identity. Source-contract
pin in `test/default-path-durability.test.mjs` (one `it()`, not three).
RAN: node --test test/default-path-durability.test.mjs → # tests 18 # pass 18 # fail 0 # duration_ms 64.999324; npm test (hermetic) → # tests 5033 # pass 5033 # fail 0 # duration_ms 70592.693712
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live voice TUI turn-cap → mission is source-pinned, not driven
(a live voice TUI turn would mean a real agent loop).

## 2026-08-30 — 3.488.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.488.0 ship.
RAN:
- GitHub `ci` 33321616823 on `7bec956` success, 1m47s (gate 24.15 completed 16:10:02Z, gate 22.22 completed 16:10:22Z). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3674428 created 2026-08-30T16:08:54.309Z startedAt 16:08:55.105Z: GET /version → name=xclaw version=3.488.0 onDiskVersion=3.488.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 304 after restart (305 after webchat PONG — new ok session, leftover unchanged); leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=None ok=None objectiveId=None unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 16:08 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.488.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `3c295094-1ae9-4c78-a6d1-51694b7eb14a` stopReason=natural. telegram writerLock held by live pid=3674428 lastPollOkAt 2026-08-30T16:13:30.869Z. discord enabled=false. slack enabled=false. email enabled=false.
UNVERIFIED: live voice TUI turn-cap → mission (source pin only; a live voice TUI turn would mean a real agent loop). Live email / Slack / Discord `/ask` / TUI / voice WS turn-cap → mission remain source-pinned from 3.487.0 / 3.486.0 / 3.485.0 / 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, or voice TUI. Do not auto-promote HTTP POST /agent/run. Voice listen is a sibling gap — name it from live recon, do not silently expand.


## 2026-08-30 — 3.489.0 Voice listen auto-promotes a turn-cap cutoff

STATUS: green (local hermetic)
DISCOVERED: Webchat, processInbound, voice `/ws/voice`, the TUI, Discord
`/ask`, Slack, email, the voice TUI, and CLI `xclaw agent` already call
`autoPromoteIfNeeded` when `stopReason === "maxTurns"`. Voice listen
preferAgent called `runJob` then spoke the truncated reply — a cutoff
never became a mission. Distinct from closed `/ws/voice` and the voice
TUI. `runJob` already persistRun by default. HTTP POST `/agent/run`
auto-promote is caller-owned stopReason, not this slice. Do not mint
persistRun:true. Command-intent continue, casual replies,
streamSpeakReply, and the gateway-bridge path are not agent turn-caps
and stay unpromoted.
BUILT: Voice listen preferAgent path now calls `autoPromoteIfNeeded` +
`formatPromotedReply` after `runJob` (detached notify into the listen
transcript). Session id `voice-listen_${…}` minted for identity.
Source-contract pin in `test/default-path-durability.test.mjs` (one
`it()`, not three).
RAN: node --test test/default-path-durability.test.mjs → # tests 19 # pass 19 # fail 0 # duration_ms 56.388268; npm test (hermetic) → # tests 5034 # pass 5034 # fail 0 # duration_ms 69318.426724
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live voice listen turn-cap → mission is source-pinned, not driven
(a live voice listen turn would mean a real agent loop).


## 2026-08-30 — 3.489.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.489.0 ship.
RAN:
- GitHub `ci` 33322277215 on `c2d912b` success, 1m49s (gate 24.15 1m28s, gate 22.22 1m43s). ledger-guard / install-e2e / eval-regression also success on the same push.
- Live gateway after `pm2 restart xclaw-gateway` pid 3695988 created 2026-08-30T16:22:38.557Z startedAt 16:22:40.452Z: GET /version → name=xclaw version=3.489.0 onDiskVersion=3.489.0 stale=false profile=lab. GET /ready ready=true.
- Leftover stay-put: agent-runs count 305 after restart (306 after webchat PONG — new ok session, leftover unchanged); leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumable=None ok=None objectiveId=None unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 16:22 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.489.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `c7a0faec-65de-4c0c-8380-2e4acae5be25` stopReason=natural. telegram writerLock held by live pid=3695988 lastPollOkAt 2026-08-30T16:23:11.680Z. discord enabled=false. slack enabled=false. email enabled=false.
UNVERIFIED: live voice listen turn-cap → mission (source pin only; a live voice listen turn would mean a real agent loop). Live voice TUI / email / Slack / Discord `/ask` / TUI / voice WS turn-cap → mission remain source-pinned from 3.488.0 / 3.487.0 / 3.486.0 / 3.485.0 / 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run.

## 2026-08-30 — 3.490.0 CLI --gateway opt-in handoff; resume does not stamp a dead owner

STATUS: green (local hermetic)
DISCOVERED: Default `xclaw agent` / `job` / `runs resume` stay in-process.
`--gateway` is boolean presence (not the URL form `xclaw run --gateway <url>`).
Agent/job POSTs already fail closed. `runs resume --gateway` classified and
promoted locally (stamped snapshot `resumedAt`/`objectiveId`) BEFORE POST, so
a dead gateway left the snapshot un-resumable (`isResumableAgentRun` returns
false once stamped; CLI catch does not roll the stamp back). Stamp-then-POST
is the live-drive class: any writer holding a record across unbounded `await`
must re-read before its terminal write.
BUILT: `src/cli/gateway-handoff.mjs` (`takeGatewayFlag`, `runGatewayHandoff`,
`probeGateway` GET `/health` at `PROBE_TIMEOUT_MS=3000`). `gatewayGet` next
to `gatewayPost` (POST default 4000ms unchanged). CLI `runs resume --gateway`
probes before `resumeAgentRunAsObjective`. Dead-port e2e: snapshot stays
unstamped and `isResumableAgentRun` still true. Durability `it()` collapsed
to one copy; pin now requires probe-before-stamp. AUTONOMY no longer says
stamp-then-POST.
RAN: node --test test/gateway-handoff.test.mjs test/default-path-durability.test.mjs → # tests 34 # pass 34 # fail 0 # duration_ms 304.372323; npm test (hermetic) → # tests 5049 # pass 5049 # fail 0 # duration_ms 71857.683718
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart proving leftover
stay-put. Live `runs resume --gateway` against a running owner is source-pinned
plus dead-port e2e, not driven against the live pid (that would stamp a real
snapshot). A rejecting POST after a successful probe is still TOCTOU.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-08-30 — 3.490.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.490.0 ship.
RAN:
- GitHub `ci` 33331581979 on `66f4610` success, 1m48s after `gh run rerun --failed` (gate 24.15 1m22s first try; gate 22.22 first try 1m49s failed `# tests 5043 # pass 5035 # fail 1` at `test/horizon-live-report.test.mjs` "doctor exposes lastLiveReport" `SyntaxError: Unexpected end of JSON input` in `readLiveSoakReport`; rerun gate 22.22 1m42s success). ledger-guard / install-e2e / eval-regression also success on the same push. Unrelated to `--gateway`.
- Live gateway after `pm2 restart xclaw-gateway` pid 3762727 created 2026-08-30T19:35:39.624Z startedAt 19:35:41.537Z: GET /version → name=xclaw version=3.490.0 onDiskVersion=3.490.0 stale=false profile=lab. GET /ready ready=true. GET /health status=healthy version=3.490.0 computer=up webchat=true.
- Leftover stay-put: agent-runs count 306 after restart (307 after webchat PONG — new ok session, leftover unchanged); leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumedAt=None objectiveId=None unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 19:35 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.490.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `9a5bf0ba-82a1-463e-b631-dcf50ccdeaed` stopReason=natural. telegram writerLock held by live pid=3762727 at 2026-08-30T19:40:16.820Z host=srv1474168; gateway.log `[telegram] writer lock ok pid=3762727` then long-poll starting @xxclaw_bot. discord enabled=false. slack enabled=false. email enabled=false.
UNVERIFIED: live `runs resume --gateway` against the live pid (dead-port e2e + source pin only; a live resume would stamp a real snapshot). A rejecting POST after a successful probe is still TOCTOU. Live voice listen / voice TUI / email / Slack / Discord `/ask` / TUI / voice WS turn-cap → mission remain source-pinned from 3.489.0 / 3.488.0 / 3.487.0 / 3.486.0 / 3.485.0 / 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0. `lastPollOkAt` not present on this lock file (pid/at/host only).
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-08-30 — 3.491.0 Doctor live-soak evidence: truncated JSON is not a fault

STATUS: green (local hermetic pin)
DISCOVERED: Vendor-ready inventory of named roadmaps (NEXT-LEVEL-AUDIT, ROADMAP P0/P1/P2, ROADMAP_GAPS P0/P1, Trust Sprint, evolution S1–S8, doctor classes 1–55) is closed. The only shippable remainder was the GitHub ci flake: `readLiveSoakReport` threw on truncated/empty `.xclaw-evidence/last-live-report.json`; `doctorHorizon({})` reads checkout cwd with no isolated `base`. Gate 22.22 first try on 3.490.0 (`ci` 33331581979) failed `# tests 5043 # pass 5035 # fail 1` at "doctor exposes lastLiveReport" `SyntaxError: Unexpected end of JSON input`. Sibling `readLastScorecard` same ENOENT-only throw on the same doctor path.
BUILT: both readers fail-soft unparseable evidence the same as ENOENT (`ok: false, report/scorecard: null`). Tests pin truncated + empty + missing under isolated `base`. Doctor test no longer depends on checkout evidence being valid JSON.
RAN: node --test test/horizon-live-report.test.mjs test/horizon-scorecard.test.mjs test/doctor-horizon.test.mjs → # tests 13 # pass 13 # fail 0 # duration_ms 308.215837; npm test (hermetic) → # tests 5053 # pass 5053 # fail 0 # duration_ms 72408.832818
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-08-30 — 3.491.0 GitHub ci + live drive now verified

STATUS: green
BUILT: closeout only — no product change. Distinct heading from the 3.491.0 ship.
RAN:
- GitHub `ci` 33333943941 on `e366b59` success, 1m40s first try (gate 22.22 1m36s, gate 24.15 1m32s). ledger-guard / install-e2e / eval-regression also success on the same push. The truncated-JSON flake that failed gate 22.22 on 3.490.0 did not recur.
- Live gateway after `pm2 restart xclaw-gateway` pid 3800483 created 2026-08-30T20:33:48.165Z startedAt 20:33:50.067Z: GET /version → name=xclaw version=3.491.0 onDiskVersion=3.491.0 stale=false profile=lab. GET /ready ready=true. GET /health status=healthy version=3.491.0 computer=up webchat=true.
- Leftover stay-put: agent-runs count 307 after restart (308 after webchat PONG — new ok session, leftover unchanged); leftover `2026-08-30T03-23-54-655Z_intel-symbol-locate` status=maxTurns updatedAt=2026-08-30T04:17:33.558Z resumedAt=None objectiveId=None unchanged. Snapshot workingDir still `/tmp/xclaw-eval/2026-08-30T03-23-54-655Z/intel-symbol-locate`. CLI `xclaw doctor` → `agentRuns.attention: no unfinished agent-run snapshots`. Boot log last `[xclaw:agent-runs] auto-resumed` still 2026-08-30T06:27:15 obj_mtffg2yd_aaaad3 (after 20:33 count 0). `obj_mtffg2yd_aaaad3` stayed `awaiting_human`. n_objectives 23.
- Webchat POST /channel/webchat/message `{"message":"ping 3.491.0 live-drive — reply with the single word PONG and nothing else"}` → ok=true text=PONG model=grok-4.6 sessionId `1af00aec-cfd4-4fe4-910b-195456724978` stopReason=natural. telegram writerLock held by live pid=3800483 at 2026-08-30T20:34:21.265Z host=srv1474168; gateway.log `[telegram] writer lock ok pid=3800483` then long-poll starting @xxclaw_bot. discord enabled=false. slack enabled=false. email enabled=false.
UNVERIFIED: live `runs resume --gateway` against the live pid (dead-port e2e + source pin only; a live resume would stamp a real snapshot). A rejecting POST after a successful probe is still TOCTOU. Live voice listen / voice TUI / email / Slack / Discord `/ask` / TUI / voice WS turn-cap → mission remain source-pinned from 3.489.0 / 3.488.0 / 3.487.0 / 3.486.0 / 3.485.0 / 3.484.0 / 3.483.0. Live POST /objectives and live automation tick continuation opt-outs remain source-pinned from 3.481.0 / 3.482.0. `lastPollOkAt` not present on this lock file (pid/at/host only).
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-08-31 — 3.492.0 vendor analog docs (not an Electron/OpenClaw surface)

STATUS: green (local hermetic; GitHub `ci` UNVERIFIED — not pushed)
DISCOVERED: Vendor checklist named pnpm, ESLint, Electron `.exe`/`.dmg`,
`BRAVE_SEARCH_API_KEY`, Tavily, Docker/Wasm skill jails, WeChat QR, and
Feishu. Those are not this product. Existing CI (`.github/workflows/ci.yml`)
and MIT `LICENSE` stay as they are.
BUILT: `.env.example` + `!.env.example`; `docs/CHANNEL_RECOVERY.md`;
`docs/OS_SANDBOX.md`; `THIRD_PARTY.md`; SECRETS/README/SECURITY pointers;
`test/vendor-shipment-docs.test.mjs`. Did not recreate `ci.yml` or
`LICENSE`. Did not add Electron CI.
RAN: pin + hermetic `# fail 0` at ship (`46baed6`). Ledger entry written
retroactively with 3.493.0 — 3.492.0 committed without an append.
UNVERIFIED: GitHub `ci` on `46baed6`; live Telegram 409 / Slack heartbeat /
Discord resume / SQLite restore (docs only).
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-08-31 — 3.493.0 Doctor soak SIEM / checkpoint listing: truncated JSON is not a fault

STATUS: green (local hermetic pin)
DISCOVERED: Class 56 closed `readLiveSoakReport` / `readLastScorecard`.
The same `doctorHorizon({})` path still called `readSoakEvents({})` and
`listSoakJobs({})` with no isolated `base`. A truncated JSONL line in
`.xclaw/soak-siem/events.jsonl` or a truncated
`.xclaw/soak/<id>/checkpoint.json` threw `SyntaxError` through every
test that probes doctor with `{}`. Same flake class as GitHub ci
33331581979 on live-report.
BUILT: `readSoakEvents` skips unparseable JSONL lines; valid prior events
still count. `listSoakJobs` skips a job whose `checkpoint.json` is
unreadable. `readChecklistResult` matches the live-report catch-all.
`loadSoakCheckpoint` still throws on garbage — it is spend authority for
`runHorizonLive`. Fail-soft there would reset `usedUsd` to 0.
RAN: node --test test/horizon-soak-siem.test.mjs test/horizon-soak-checkpoint.test.mjs test/horizon-confirm-checklist.test.mjs test/horizon-live-report.test.mjs test/horizon-scorecard.test.mjs test/doctor-horizon.test.mjs → # tests 28 # pass 28 # fail 0 # duration_ms 722.241489; npm test (hermetic) → # tests 5061 # pass 5061 # fail 0 # duration_ms 69882.327843
UNVERIFIED: GitHub `ci` on this SHA; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-08-31 — 3.494.0 Telegram writer-lock touch does not overwrite a stolen lock

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Live-drive writers: queue `processNext` already re-reads (`settleAfterRun` + `getQueueItem`); `markCheckpointResumed` already re-reads; `updateSwarmRun` re-reads. Named remainder from source: `acquireTelegramWriterLock().touch()` wrote the in-memory payload after unbounded `getUpdates` (`onTouchLock`) without re-reading. Process A holds lock → poll hangs ≥ staleMs (120s) → process B reclaims → A's hung poll returns and `touch()` overwrites B — two processes on `getUpdates` for one token. `release()` already re-read pid before unlink.
BUILT: `touch()` re-reads the lock file and writes only if `cur.pid === process.pid`; otherwise no-op. Pin: acquire under tmp lockPath, overwrite with another pid, `touch()`, thief still owns the file. Happy-path touch still refreshes `at`.
RAN: node --test test/telegram-writer-lock-host.test.mjs test/telegram-p0.test.mjs test/doctor-telegram-writer.test.mjs → # tests 38 # pass 38 # fail 0 # duration_ms 86.515843; npm test (hermetic) → # tests 5063 # pass 5063 # fail 0 # duration_ms 68961.143456
UNVERIFIED: GitHub `ci` on this SHA; live Telegram 409 / two-process getUpdates on a real bot token; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.495.0 Completing-segment done does not overwrite a stop that landed on disk

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Live-drive writers: queue `processNext` already re-reads; `markCheckpointResumed` already re-reads; `updateSwarmRun` re-reads. Named remainder from source: `/objective stop` and `POST /objectives/:id/stop` set a disk flag (`stopRequested`) without changing `status`. Loop-top already re-read between segments. A completing segment (natural `done`, verifier `runSegment`, deterministic verify gate, crash → `interrupted`) saved `status=done` / `interrupted` without checking the flag — same class as queue cancel overwritten by a long-running writer. Channel copy says halt at the next segment boundary with state preserved; a done save is not that halt.
BUILT: `honorStopIfRequested` re-reads disk, copies the flag, stamps `stopped`, saves. Merge this segment's state first so a stop preserves progress. Called at loop-top, after every segment (before any done path), after `runDeterministicChecks`, after the verifier `runSegment`, and on the crash path before `interrupted`. Gate returns `"stopped"`; all four done-path callers return on it. Pin: stop during a completing natural-stop/`done` segment → `stopped` not `done`, progress preserved. Stop during a crash → `stopped` not `interrupted`. Existing continue-segment pin stays.
RAN: node --test test/objective-longrun.test.mjs → # tests 25 # pass 25 # fail 0 # duration_ms 3891.90081; npm test (hermetic) → # tests 5065 # pass 5065 # fail 0 # duration_ms 68876.771893
UNVERIFIED: GitHub `ci` on this SHA; live POST /objectives/:id/stop during a completing segment on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.496.0 Self-deploy does not overwrite a newer pending intent after restart/health

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Live-drive writers: queue `processNext` already re-reads; `markCheckpointResumed` already re-reads; `updateSwarmRun` re-reads. Heuristic load-await-write false positives this tick (closed, do not implement): suggestion-feedback, skills/registry, intel-store, auth/profiles, auth/xai, security/decisions, tokens/cost-governor, tools/browser-tools. Named remainder from source: `runDeployOnce` held the in-memory intent across unbounded `restartGateway` + `healthOk` then wrote healthy/rolled_back without re-reading. `requestDeploy` (gateway, `mergeMission` for profile `self`) can replace `~/.xclaw/self-deploy.json` while the watcher is polling. Writing the old mission over a newer pending slot — or `git reset --hard` to the old prevKnownGood — is the same class as queue cancel overwritten by a long-running writer. Watcher is serial (two `runDeployOnce` do not overlap in ONE watcher); the gateway process is a different writer.
BUILT: `settleAfterDeploy(held, onDisk)`: missing file → null (do not resurrect); different `missionId` → null; both sides have `mergeCommit` and they differ → null; else return held. Re-read after first health (before any terminal write or git mutation). Re-read again immediately before `git reset --hard` (status/stash are unbounded). Re-read after rollback health2 before writing rolled_back/failed. Superseded-healthy: markMission/ledger/alert for THIS mission; do not write the slot; do not `markKnownGood`. Superseded-unhealthy: ledger only; no reset. Pin: concurrent `requestDeploy` during health leaves the newer pending on disk. Existing A4 healthy/failed pins stay.
RAN: node --test test/self-deploy-settle.test.mjs test/self-mod.test.mjs test/self-deploy-restart-timeout.test.mjs test/self-deploy-config-refresh.test.mjs → # tests 35 # pass 35 # fail 0 # duration_ms 3820.168585; npm test (hermetic) → # tests 5074 # pass 5074 # fail 0 # duration_ms 69011.067053
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw self-deploy watch` vs concurrent self-mission merge on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.497.0 mergeMission does not overwrite a concurrent rollback

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. Heuristic load-await-write false positives this tick (closed, do not implement): eval/runner, eval/cli, eval-queue, loop persistTranscript, proposeSkillFromFailure, cookie-rotation, web-login, vault, account-links, swarm-store. Named remainder from source: `mergeMission` held the in-memory mission across unbounded `applyWorktreeMerge` then wrote `done`/`deploying` without re-reading. `rollbackMission` persists `rolled_back` (and discards the worktree) while merge is in flight. Merge is not in `running`, so abort is a no-op. Writing done/deploying over rolled_back — or `requestDeploy` over a rolled-back mission — is the same class as queue cancel overwritten by a long-running writer. `runMission` catch already re-reads TERMINAL_STATUSES; that path does not cover merge.
BUILT: `settleAfterMerge(held, onDisk)`: missing file → null (do not resurrect); different `id` → null; on-disk in `TERMINAL_STATUSES` → null; else return held. Re-read after `applyWorktreeMerge` (before any terminal write or `requestDeploy`). Re-read again immediately before `requestDeploy` (`latestKnownGood` is unbounded). Re-read immediately before the terminal `saveMission` (`setMissionRef`/`markKnownGood`/intel notes are unbounded). Pin: rollback during merge leaves `rolled_back` on disk. Existing mission pins stay.
RAN: node --test test/mission-merge-settle.test.mjs test/missions.test.mjs test/mission-merge-evidence.test.mjs → # tests 30 # pass 30 # fail 0 # duration_ms 2149.262527; npm test (hermetic) → # tests 5083 # pass 5083 # fail 0 # duration_ms 70968.891646
UNVERIFIED: GitHub `ci` on this SHA; live POST /missions/:id/rollback during applyWorktreeMerge on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.498.0 runMission does not overwrite a concurrent rollback after verify

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. Heuristic load-await-write false positives this tick (closed, do not implement): eval/runner, eval/cli, eval-queue, loop persistTranscript, proposeSkillFromFailure, cookie-rotation, web-login, vault, account-links, swarm-store. Named remainder from source: `runMission` catch already re-reads `TERMINAL_STATUSES` before writing `failed`. Success-path `saveMission` after unbounded `runVerification` did not. `sh()` takes no abort signal, so `rollbackMission`'s abort cannot interrupt a verify cmd. Writing verifying/failed/merge_ready over `rolled_back` is the same class as queue cancel overwritten by a long-running writer. `runSwarmFanOut` returns on abort rather than throwing — tournament/swarm saves after those awaits were the same hole.
BUILT: `bailIfAborted` after `createWorktree`, `runMissionTournament`, `runMissionSwarm`, `runVerification`, and both `captureDiff` sites (before the following `saveMission`). Pin: rollback during `sleep 1` verify leaves `rolled_back` on disk. Existing mission + merge-settle pins stay.
RAN: node --test test/mission-run-settle.test.mjs test/missions.test.mjs test/mission-merge-settle.test.mjs → # tests 18 # pass 18 # fail 0 # duration_ms 2147.173973; npm test (hermetic) → # tests 5085 # pass 5085 # fail 0 # duration_ms 71297.497556
UNVERIFIED: GitHub `ci` on this SHA; live POST /missions/:id/rollback during runVerification on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.499.0 approveMergeProposal does not overwrite a concurrent reject

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. runMission bailIfAborted after verify shipped 3.498.0. Heuristic load-await-write false positives this tick (closed, do not implement): recoverFromCompromise (re-reads before write), rotateKeys/recordKeyUse (no unbounded await), bindRole (fabric lock load-mutate-save), planAndMaybeMerge (writes a NEW proposal, not a held record). Named remainder from source: `approveMergeProposal` held the in-memory proposal across unbounded `applyWorktreeMerge` then wrote applied/failed/partial without re-reading. `rejectMergeProposal` persists `rejected` while apply is in flight. Writing applied over rejected is the same class as queue cancel overwritten by a long-running writer. applyWorktreeMerge does not commit on this path (approve commits after the write), so a pre-commit hook cannot delay the overwrite.
BUILT: `settleAfterApprove(held, onDisk)`: missing file → null (do not resurrect); different `id` → null; on-disk `rejected` → null; else return held. Re-read after cleanliness (before the apply loop). Re-read at apply loop-top (before each `applyWorktreeMerge`). Re-read immediately before the terminal proposal write. Pin: reject during `git apply` (PATH wrapper sleep, scoped to the drive it()) leaves `rejected` on disk. Existing S3 + principal pins stay.
RAN: node --test test/swarm-merge-settle.test.mjs test/s3-swarm-merge.test.mjs test/swarm-merge-principal.test.mjs → # tests 23 # pass 23 # fail 0 # duration_ms 3184.139217; npm test (hermetic) → # tests 5092 # pass 5092 # fail 0 # duration_ms 71853.359527
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw merge reject` during approve applyWorktreeMerge on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.500.0 resolveMcpAccessToken does not overwrite a concurrent drop

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. runMission bailIfAborted after verify shipped 3.498.0. approveMergeProposal settleAfterApprove shipped 3.499.0. Heuristic load-await-write false positives this tick (closed, do not implement): seats ledger (no unbounded await), connected `refreshAppToken` (already re-reads `getAppToken` after network), `storeMcpGrant` (no unbounded await), cookie-rotation. Named remainder from source: `resolveMcpAccessToken` held the whole MCP OAuth store across unbounded `refreshMcpToken` then `saveMcpOAuthStore` without re-reading. `dropMcpGrant` (CLI `xclaw mcp logout` and HTTP `DELETE /mcp/oauth`) persists a delete of the same file. Writing the stale whole-store snapshot resurrects a revoked grant — and any other server dropped during the await. Same class as queue cancel overwritten by a long-running writer. Connected analog already shipped: `refreshAppToken` bails on `updatedAt` mismatch.
BUILT: `settleAfterMcpRefresh(heldStore, onDisk, serverName)`: missing onDisk → null (do not resurrect); missing heldStore → null; missing onDisk[serverName] → null (this server was dropped); else overlay heldStore[serverName] onto onDisk so other-server drops survive. Re-read immediately before `saveMcpOAuthStore`. Return null from resolve if settle is null. Pin: drop during a 1s token-endpoint sleep leaves the grant gone; drop of a different server during refresh of A leaves A's new tokens and B gone. Existing MCP oauth pins stay. `dropMcpGrant` / `storeMcpGrant` unchanged.
RAN: node --test test/mcp-oauth-settle.test.mjs test/mcp-oauth.test.mjs test/mcp-oauth-callback-xss.test.mjs test/mcp-oauth-flow-ttl.test.mjs → # tests 16 # pass 16 # fail 0 # duration_ms 2134.831064; npm test (hermetic) → # tests 5100 # pass 5100 # fail 0 # duration_ms 72374.585053
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw mcp logout` during refresh on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.501.0 refreshXaiToken does not overwrite a concurrent logout

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. runMission bailIfAborted after verify shipped 3.498.0. approveMergeProposal settleAfterApprove shipped 3.499.0. resolveMcpAccessToken settleAfterMcpRefresh shipped 3.500.0. Heuristic load-await-write false positives this tick (closed, do not implement): `refreshConnectedOAuth` (delegates to `setAppToken` which re-loads the whole store before writing ONE app — not whole-store resurrect); `setAppToken`/`deleteAppToken`/`logoutConnected` (file I/O only, no unbounded network between load and save); `refreshAppToken` already re-reads. Named remainder from source: `refreshXaiToken` held the prior vault across unbounded `fetch` of the xAI token endpoint then `writeTokens` of `auth.json` without re-reading. `logoutXai` (CLI `xclaw auth logout`) unlinks the same file. Writing the stale snapshot resurrects a revoked login. Same class as queue cancel overwritten by a long-running writer.
BUILT: `settleAfterXaiRefresh(held, onDisk, prior)`: missing held → null; missing onDisk when a prior vault existed → null (logout won; do not resurrect); missing onDisk with no prior → held (first write; RULE(m) pin has no file yet); on-disk `refresh_token` differs from prior → null (concurrent login); else return held. Re-read immediately before `writeTokens`. Return null from refresh if settle is null. Pin: logout during a 1s token-endpoint sleep leaves `auth.json` gone. Existing RULE(m) file-mode pin stays. `logoutXai` unchanged.
RAN: node --test test/xai-oauth-settle.test.mjs test/xai-oauth-file-mode.test.mjs test/xai-auth.test.mjs → # tests 11 # pass 11 # fail 0 # duration_ms 1097.604708; npm test (hermetic) → # tests 5107 # pass 5107 # fail 0 # duration_ms 72402.793758
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw auth logout` during refresh on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.502.0 refreshOAuthToken does not overwrite a concurrent logout

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. runMission bailIfAborted after verify shipped 3.498.0. approveMergeProposal settleAfterApprove shipped 3.499.0. resolveMcpAccessToken settleAfterMcpRefresh shipped 3.500.0. refreshXaiToken settleAfterXaiRefresh shipped 3.501.0. Heuristic load-await-write false positives this tick (closed, do not implement): `refreshConnectedOAuth` (delegates to `setAppToken` which re-loads); `setAppToken`/`deleteAppToken`/`logoutConnected` (file I/O only); `refreshAppToken` already re-reads. Named remainder from source: `refreshOAuthToken` held the prior vault across unbounded `fetch` of the xAI token endpoint then `saveCredentials` of `credentials.json` without re-reading. `logout` (CLI `xclaw auth logout` via auth-legacy-cli) unlinks the same file. Writing the stale snapshot resurrects a revoked login. Overlay keeps a concurrent `loginWithApiKey` (`xaiApiKey`) on the same file. Same class as queue cancel overwritten by a long-running writer. Sibling of 3.501.0 `auth.json`.
BUILT: `settleAfterCredsRefresh(held, onDisk, prior)`: missing held → null; missing onDisk when a prior vault existed → null (logout won; do not resurrect); missing onDisk with no prior → held (first write; RULE(m) pin has no file yet); else overlay held oauth fields onto onDisk so a concurrent `loginWithApiKey` survives. Re-read immediately before `saveCredentials`. Return null from refresh if settle is null. `resolveXaiToken` null-guards `refreshed.accessToken`. Pin: logout during a 1s token-endpoint sleep leaves `credentials.json` gone; concurrent `loginWithApiKey` during refresh keeps `xaiApiKey`. Existing RULE(m) file-mode pin stays. `logout` unchanged.
RAN: node --test test/xai-creds-settle.test.mjs test/xai-credentials-file-mode.test.mjs test/xai-auth.test.mjs → # tests 12 # pass 12 # fail 0 # duration_ms 2114.948505; npm test (hermetic) → # tests 5115 # pass 5115 # fail 0 # duration_ms 74353.881073
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw auth logout` during refresh on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.503.0 refreshProfileOAuth does not overwrite a concurrent remove

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. runMission bailIfAborted after verify shipped 3.498.0. approveMergeProposal settleAfterApprove shipped 3.499.0. resolveMcpAccessToken settleAfterMcpRefresh shipped 3.500.0. refreshXaiToken settleAfterXaiRefresh shipped 3.501.0. refreshOAuthToken settleAfterCredsRefresh shipped 3.502.0. Heuristic load-await-write false positives this tick (closed, do not implement): `loginWithOAuth` (loads AFTER token exchange); `refreshConnectedOAuth` (delegates to `setAppToken` which re-loads); `setAppToken`/`deleteAppToken`/`logoutConnected` (file I/O only); `refreshAppToken` already re-reads. Named remainder from source: `refreshProfileOAuth` held the whole `auth-profiles.json` store across unbounded `fetch` of the token endpoint then `saveProfiles` without re-reading. `removeProfile` / `loginApiKey` / `loginToken` / `clearAllProfiles` are concurrent writers of the same file. Writing the stale whole-store snapshot resurrects a removed profile or overwrites a concurrent `api_key`. Overlay keeps other-profile removes. Same class as queue cancel overwritten by a long-running writer. Sibling of 3.500.0 `mcp-oauth.json` and 3.502.0 `credentials.json`.
BUILT: `settleAfterProfileRefresh(heldStore, onDisk, profileId)`: missing heldStore → null; missing onDisk → null (do not resurrect the file); missing heldStore.profiles[id] → null; missing onDisk.profiles[id] → null (this profile was removed); on-disk mode is a non-oauth replacement → null; else overlay heldStore.profiles[id] onto onDisk so other-profile removes / logins survive. Re-read immediately before `saveProfiles`. Return null from refresh if settle is null. `credentialFromProfile` null-guards `refreshed.accessToken`. Both anthropic and generic refresh branches persist through `persistRefreshedProfile`. Pin: remove during a 1s token-endpoint sleep leaves the profile gone; remove of a different profile during refresh of A leaves A's new tokens and B gone; concurrent `loginApiKey` on the same id keeps `api_key`; `clearAllProfiles` during refresh leaves the file gone. `removeProfile` / `loginApiKey` unchanged.
RAN: node --test test/auth-profiles-settle.test.mjs test/auth-profiles.test.mjs test/oauth-token-refresh.test.mjs → # tests 25 # pass 25 # fail 0 # duration_ms 4155.916284; npm test (hermetic) → # tests 5127 # pass 5127 # fail 0 # duration_ms 74883.484863
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw auth profiles` remove during refresh on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.504.0 refreshAppToken does not overwrite a concurrent delete

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Telegram `touch()` re-read shipped 3.494.0. Completing-segment stop-honor shipped 3.495.0. Self-deploy settleAfterDeploy shipped 3.496.0. mergeMission settleAfterMerge shipped 3.497.0. runMission bailIfAborted after verify shipped 3.498.0. approveMergeProposal settleAfterApprove shipped 3.499.0. resolveMcpAccessToken settleAfterMcpRefresh shipped 3.500.0. refreshXaiToken settleAfterXaiRefresh shipped 3.501.0. refreshOAuthToken settleAfterCredsRefresh shipped 3.502.0. refreshProfileOAuth settleAfterProfileRefresh shipped 3.503.0. Heuristic load-await-write false positives this tick (closed, do not implement): `setAppToken`/`deleteAppToken`/`logoutConnected` (file I/O only, no unbounded await); `loginConnectedOAuth` (first write after fetch); `loginDeviceCode`/`loginPkceLoopback` (first write); `refreshAccessToken` (returns tokens only). Named remainder from source: `refreshAppToken` re-read `getAppToken` after unbounded `refreshAccessToken` then still `setAppToken` when `latest` was null. Concurrent `deleteAppToken` / `logoutConnected` of THIS app was resurrected. `refreshConnectedOAuth` had the same THIS-app hole: `{...stored}` into `setAppToken` with no re-read. Overlay keeps other-app deletes. Same class as queue cancel overwritten by a long-running writer. Sibling of 3.500.0 `mcp-oauth.json`, 3.501.0 `auth.json`, 3.502.0 `credentials.json`, and 3.503.0 `auth-profiles.json`.
BUILT: `settleAfterAppRefresh(heldStore, onDisk, appId)`: missing heldStore → null; missing onDisk → null (do not resurrect the file); missing heldStore.apps[appId] → null; missing onDisk.apps[appId] → null (this app was deleted / logout-all); else overlay heldStore.apps[appId] onto onDisk so other-app deletes survive. Re-read immediately before `saveTokens`. Return `NO_TOKEN` from refresh if settle is null or re-read `latest` is null. `refreshConnectedOAuth` delegates to `refreshAppToken`. `opts.tokenUrl` / stored `tokenUrl` is a test seam; production provider map is unchanged. Pin: delete during a 1s token-endpoint sleep leaves the app gone; delete of a different app during refresh of A leaves A's new tokens and B gone; `logoutConnected all` during refresh leaves apps empty; `refreshConnectedOAuth` concurrent delete stays gone. `deleteAppToken` / `logoutConnected` unchanged.
RAN: node --test test/connected-app-settle.test.mjs test/token-refresh.test.mjs test/token-refresh-mock.test.mjs → # tests 19 # pass 19 # fail 0 # duration_ms 4133.514809; npm test (hermetic) → # tests 5139 # pass 5139 # fail 0 # duration_ms 76266.546912
UNVERIFIED: GitHub `ci` on this SHA; live `xclaw auth connected logout` during refresh on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.505.0 GET /computer/health does not hang forever on a silent upstream

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Heuristic load-await-write false positives this tick (closed, do not implement): resumeJobFromCheckpoint (markCheckpointResumed re-reads), jwks write-then-await, key-recovery file I/O, loginConnectedOAuth first write, crash-guard, vault, cookie-rotation, ops/due, account-links, pairing, seats oauth-rotation, last-drain, discovery cache, channel media writeFile, spawn this-id snapshot. Named remainder from source: GET `/computer/health` `await fetch(u)` with no AbortSignal. Node fetch has no total-request timeout; a hung computer parked the gateway request forever. Same class as v3.290.0. Gateway census: two `await fetch(` under `src/gateway/` — oauth-callback already times out 60s; this route was the remainder. Sibling health fetches already timeout (capability-reach, python-tools, manager probeHealth, doctor httpGet).
BUILT: `COMPUTER_HEALTH_TIMEOUT_MS = 3000`. Fetch carries `AbortSignal.timeout`. `computerHealthTimeoutMs` is a test seam. Catch still 502 names `upstream`. Pin: silent fetch with 40ms seam returns 502 in bounded time, not HUNG. Existing wrong-machine / 502-names-upstream pins stay. Source pin: no `await fetch(u);`.
RAN: node --test test/computer-address-report.test.mjs → # tests 12 # pass 12 # fail 0 # duration_ms 285.374835; npm test (hermetic) → # tests 5141 # pass 5141 # fail 0 # duration_ms 77164.30358
UNVERIFIED: GitHub `ci` on this SHA; live GET /computer/health against a hung remote computer on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.506.0 PagerDuty webhook history follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. Named remainder from source: `src/alerting/pagerduty-webhooks.mjs` `historyPath()` still `os.homedir()` while production `handlePagerDutyWebhook(body, { cfg, ... })` already received cfg and used it only for `shouldMirror`. Two instances shared one JSONL; the suite wrote the operator's real `~/.xclaw/pd-webhook-events.jsonl`. Same class as v3.297.0 `alert-state.json`. `test/pagerduty-webhook-route-wiring.test.mjs` HOME-overrode because of this. Closed siblings (do not re-fix): `alerts.mjs` defaultStatePath, `automations/store.mjs`, `cron/eval-job.mjs`, `cron/doctor-job.mjs`. Pairing / sessions / usage-tracker homedir remainders are siblings, not this slice.
BUILT: `historyPath(cfg)` honours `alerting.pagerduty.webhooks.historyPath` then `paths.configDir` then null. `appendHistory` still pushes the in-memory ring; file write only if path is non-null. `handlePagerDutyWebhook` passes `ctx.cfg`. `getPagerDutyWebhookHistoryPath(cfg)` and CLI `xclaw alerts pd-webhooks` thread cfg. GET `/webhooks/pagerduty/recent` stays in-memory. Pin: configDir write never touches home; explicit historyPath wins; no-configDir names no file and never writes home. Route-wiring accept case now passes `paths.configDir`.
RAN: node --test test/pagerduty-webhook-history-config-dir.test.mjs test/pagerduty-webhook-route-wiring.test.mjs test/pagerduty-webhook-signature.test.mjs → # tests 15 # pass 15 # fail 0 # duration_ms 186.374766; npm test (hermetic) → # tests 5145 # pass 5145 # fail 0 # duration_ms 83688.557788
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.507.0 Pairing store follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Named remainder from source: `src/pairing/pairing-store.mjs` `defaultStorePath()` still `os.homedir()` while production `createPairingStore({})` at gateway boot, security pairing routes (recreate per request — the file is the only shared state), doctor, and CLI already had cfg in scope and did not thread it. Two instances shared one pairing.json; the suite wrote the operator's real `~/.xclaw/pairing.json`. Same class as v3.297.0 `alert-state.json` and v3.506.0 PagerDuty webhook history. `test/pairing-routes.test.mjs` HOME-overrode because of this. `pairingJsonFile` was a sibling resolver that still homed. Closed siblings (do not re-fix): pagerduty-webhooks (3.506.0), alerts.mjs, automations/store, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath). Sessions / usage-tracker homedir remainders are siblings, not this slice.
BUILT: `resolvePairingStorePath(cfg)` honours `opts.storePath` then `paths.pairingFile` then `XCLAW_PAIRING_FILE` then `paths.configDir` then null. No home fallback. No configDir → in-memory only, `storePath: null`. `pairingJsonFile` is the same resolver so doctor-fix absorb cannot miss the live file. `absorbPairingJson` already no-ops a null path. Gateway boot, security pairing routes, doctor, CLI (`loadConfig`), telegram, and discord thread cfg. Empty `storePath` still lands in configDir. Pin: configDir write never touches home; explicit pairingFile wins; opts.storePath wins over both; no-configDir names no file and never writes home. Existing approve/revoke/404 pins stay. Route test now passes `paths.configDir`.
RAN: node --test test/pairing-store-config-dir.test.mjs test/pairing-routes.test.mjs test/control-plane.test.mjs test/doctor-fix.test.mjs test/pairing-gate-wiring.test.mjs test/discord-pairing-gate-wiring.test.mjs test/pairing-approved-gate.test.mjs → # tests 46 # pass 46 # fail 0 # duration_ms 1733.624545; npm test (hermetic) → # tests 5150 # pass 5150 # fail 0 # duration_ms 85268.639412
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Sessions / usage-tracker homedir remainders are siblings. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.508.0 Sessions persist follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Pairing store closed 3.507.0. Named remainder from source: `src/sessions/persist.mjs` `defaultSessionsPath()` still `os.homedir()` while production persist was import-time `configureSessionPersist({})` (gateway never reconfigured it) and doctor already had cfg in scope and did not thread it. Two instances shared one sessions.json; the suite wrote the operator's real `~/.xclaw/sessions.json`. Same class as v3.297.0 `alert-state.json`, v3.506.0 PagerDuty webhook history, and v3.507.0 pairing store. Gate-wiring tests passed an explicit `path:` because of this. Closed siblings (do not re-fix): pairing-store (3.507.0), pagerduty-webhooks (3.506.0), alerts.mjs, automations/store, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath). Usage-tracker homedir remainder is a sibling, not this slice.
BUILT: `resolveSessionsPath(cfg)` honours `opts.path` then `paths.sessionsFile` then `XCLAW_SESSIONS_FILE` then `paths.configDir` then null. No home fallback. `loadSessionState` / `saveSessionState` no-op a null path (do not `dirname(null)`). Import-time auto-load stays in-memory (`persistPath` starts null). Gateway boot after `loadConfig` calls `configureSessionPersist({ cfg })` so live still persists under configDir (never drop the capability). Doctor passes cfg. Empty opts (enabled / load only) keep the current path so existing gate-wiring pins stay. Pin: configDir write never touches home; explicit sessionsFile wins; opts.path wins over both; no-configDir names no file and never writes home.
RAN: node --test test/sessions-persist-config-dir.test.mjs test/email-sender-gate-wiring.test.mjs test/slack-sender-gate.test.mjs test/discord-pairing-gate-wiring.test.mjs test/pairing-gate-wiring.test.mjs → # tests 19 # pass 19 # fail 0 # duration_ms 961.448414; npm test (hermetic) → # tests 5155 # pass 5155 # fail 0 # duration_ms 83938.086167
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Usage-tracker homedir remainder is a sibling. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.509.0 Usage-tracker ledger follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Pairing store closed 3.507.0. Sessions persist closed 3.508.0. Named remainder from source: `src/tokens/usage-tracker.mjs` `defaultLedgerPath()` still `os.homedir()` while production loop / maintenance / analytics / tokens route / CLI already had cfg in scope and did `cfg.tokens?.ledgerPath || defaultLedgerPath()` — when ledgerPath unset (normal), they homed. Two instances shared one cost-ledger.jsonl; the suite wrote the operator's real `~/.xclaw/cost-ledger.jsonl`. Same class as v3.297.0 `alert-state.json`, v3.506.0 PagerDuty webhook history, v3.507.0 pairing store, and v3.508.0 sessions persist. Closed siblings (do not re-fix): sessions/persist (3.508.0), pairing-store (3.507.0), pagerduty-webhooks (3.506.0), alerts.mjs, automations/store, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath), model-stats.mjs (already configDir / getConfigDir).
BUILT: `defaultLedgerPath(cfg)` honours `tokens.ledgerPath` then `paths.configDir` then null. No home fallback. No `XCLAW_LEDGER_FILE`. persistLedger already no-ops `!ledgerPath`. `readCostLedger` treats a falsy path like ENOENT (do not `readFile(null)`). Keep `ledger !== false` gate in loop.mjs. Five callers become `defaultLedgerPath(cfg)`: loop, maintenance `costLedgerPath`, usage-analytics, tokens route, CLI `bin/xclaw.mjs`. Maintenance skips a null target. Pin: configDir write never touches home; explicit ledgerPath wins; no-configDir names no file and never writes home.
RAN: node --test test/usage-tracker-ledger-config-dir.test.mjs test/ops-maintenance.test.mjs test/cache-hit-rate.test.mjs test/usage-analytics.test.mjs → # tests 18 # pass 18 # fail 0 # duration_ms 242.663896; npm test (hermetic) → # tests 5159 # pass 5159 # fail 0 # duration_ms 84892.574287
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.510.0 Compaction offload follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Pairing store closed 3.507.0. Sessions persist closed 3.508.0. Usage-tracker ledger closed 3.509.0. Named remainder from source: `src/tokens/compaction.mjs` `defaultOffloadDir()` still `os.homedir()` while production loop already had cfg in scope and called `compactionOptsFromConfig(cfg)` → `compactMessages` with `offloadDir: c.offloadDir` — when offloadDir unset (normal), they homed. Compaction is default-ON. Two instances shared one compact-offload map; the suite wrote the operator's real `~/.xclaw/compact-offload`. Same class as v3.297.0 `alert-state.json`. Honour existing `XCLAW_COMPACT_OFFLOAD_DIR`. Closed siblings (do not re-fix): usage-tracker (3.509.0), sessions/persist (3.508.0), pairing-store (3.507.0), pagerduty-webhooks (3.506.0), alerts.mjs, automations/store, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath), model-stats.mjs (already configDir), transcript (already configDir first), auth siblings (already configDir first). Telegram writer lock and gateway supervised `stateRoot` are siblings, not this slice.
BUILT: `defaultOffloadDir(opts)` honours `opts.dir` then nested `tokens.compaction.offloadDir` / `compaction.offloadDir` then `XCLAW_COMPACT_OFFLOAD_DIR` then `paths.configDir` then null. No home fallback. `offloadToolResults` no-ops a null dir (do not `mkdir(null)`). `compactionOptsFromConfig` fills `offloadDir` from that resolver so live still offloads under configDir when compaction is on (never drop the capability). Fold still runs when offload skips. `compactMessages` threads `cfg`. Pin: configDir write never touches home; explicit dir wins; nested offloadDir wins; env wins over configDir; no-configDir names no dir and never writes home. Ride-along: pin `now` on `listResumableAgentRuns finds an ISO owner id behind 80 job_* names` — fixture `updatedAt` 2026-08-30T08:40Z is past `DEFAULT_MAX_AGE_MS` 48h on wall-clock 2026-09-01; test is about filename reverse-lex vs updatedAt sort, not the age window.
RAN: node --test test/compaction-offload-config-dir.test.mjs test/compaction.test.mjs test/compaction-llm.test.mjs test/compact-provenance.test.mjs → # tests 20 # pass 20 # fail 0 # duration_ms 162.032905; node --test test/agent-run-resume.test.mjs → # tests 16 # pass 16 # fail 0 # duration_ms 185.665922; npm test (hermetic) → # tests 5165 # pass 5165 # fail 0 # duration_ms 90671.136134
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Telegram writer lock and gateway supervised `stateRoot` are siblings. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.511.0 Telegram writer lock follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Pairing store closed 3.507.0. Sessions persist closed 3.508.0. Usage-tracker ledger closed 3.509.0. Compaction offload closed 3.510.0. Named remainder from source: `src/channels/telegram/webhook.mjs` `acquireTelegramWriterLock()` still `os.homedir()` while production `createTelegramChannel` already had cfg in scope and passed `conf.writerLockPath` — when unset (normal), they homed. Doctor independently homed the same path. `singleWriter !== false` is default-ON. Two instances with different configDirs shared one lock (B cannot start Telegram because A holds it); the suite wrote the operator's real `~/.xclaw/locks/telegram-writer.lock`. Same class as v3.297.0 `alert-state.json`. No lock-path env exists — do not invent one. Closed siblings (do not re-fix): compaction (3.510.0), usage-tracker (3.509.0), sessions/persist (3.508.0), pairing-store (3.507.0), pagerduty-webhooks (3.506.0), alerts.mjs, automations/store, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath), model-stats.mjs (already configDir), transcript (already configDir first), auth siblings (already configDir first). Gateway supervised `stateRoot` is a sibling, not this slice.
BUILT: `defaultTelegramWriterLockPath(opts)` honours `opts.lockPath` then `channels.telegram.writerLockPath` then `paths.configDir` then null. No home fallback. acquire no-ops a null path (`ok: true`, `skipped: true`, empty `release`/`touch`) so start does not treat missing path as `lock_held` (do not `mkdir(null)`). Production `createTelegramChannel` startInner and doctor thread cfg so live still locks under configDir when singleWriter is on (never drop the capability). Doctor skips `readFile` when lockPath is null. Same-bot sharing when they share configDir is still the point of the lock. Pin: configDir write never touches home; explicit lockPath wins; nested writerLockPath wins; no-configDir names no file and never writes home.
RAN: node --test test/telegram-writer-lock-config-dir.test.mjs test/telegram-writer-lock-host.test.mjs test/telegram-p0.test.mjs test/pid-alive-single-source.test.mjs test/doctor-telegram-writer.test.mjs test/telegram-standby-decline.test.mjs → # tests 67 # pass 67 # fail 0 # duration_ms 506.813518; npm test (hermetic) → # tests 5170 # pass 5170 # fail 0 # duration_ms 89797.350662
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Gateway supervised `stateRoot` is a sibling. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.512.0 Gateway supervised state follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Pairing store closed 3.507.0. Sessions persist closed 3.508.0. Usage-tracker ledger closed 3.509.0. Compaction offload closed 3.510.0. Telegram writer lock closed 3.511.0. Named remainder from source: `startGatewaySupervised()` still `os.homedir()` while cfg was already in scope. Companion `lockPath` independently homed when `stateDir` unset. `gateway.runLoop === true` is default-OFF, but when the flag is on two instances with different configDirs shared one crash-history and one `tmp/gateway-*.lock`; the suite wrote the operator's real `~/.xclaw`. Same class as v3.297.0 `alert-state.json`. Do not honour `XCLAW_STATE_DIR` (seats/auth fallback). No gateway state-dir env exists — do not invent one. Closed siblings (do not re-fix): telegram lock (3.511.0), compaction (3.510.0), usage-tracker (3.509.0), sessions/persist (3.508.0), pairing-store (3.507.0), pagerduty-webhooks (3.506.0), alerts.mjs, automations/store, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath), model-stats.mjs (already configDir), transcript (already configDir first), auth siblings (already configDir first). `cua-retry-metrics.mjs` `metricsPath()` is a sibling, not this slice.
BUILT: `defaultGatewayStateDir(opts)` honours `opts.stateDir` then `paths.configDir` then null. No home fallback. `lockPath` returns null before mkdir when !stateDir. acquire no-ops a null path (`file: null`, `skipped: true`, empty `release`) so start does not throw `XCLAW_GATEWAY_LOCKED`. `applyCrashLoopGuard` no-ops a null stateDir (do not `path.join(null)` which would write history in cwd). Production `startGatewaySupervised` threads cfg so live still locks under configDir when runLoop is on (never drop the capability). Keep identifier `stateRoot` and call `applyCrashLoopGuard(stateRoot)` so source pins stay. Pin: configDir write never touches home; explicit stateDir wins; no-configDir names no dir and never writes home; crash-guard null is a no-op; supervised path still calls `applyCrashLoopGuard(stateRoot)`.
RAN: node --test test/gateway-state-dir-config-dir.test.mjs test/run-loop.test.mjs test/run-loop-adoption.test.mjs test/crash-guard.test.mjs test/pid-alive-single-source.test.mjs → # tests 40 # pass 40 # fail 0 # duration_ms 738.275127; npm test (hermetic) → # tests 5176 # pass 5176 # fail 0 # duration_ms 90597.571821
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway with `gateway.runLoop: true`; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. `cua-retry-metrics.mjs` `metricsPath()` is a sibling. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.

## 2026-09-01 — 3.513.0 Automations store follows paths.configDir

STATUS: green (local hermetic pin)
DISCOVERED: JSON.parse / ENOENT / doctorHorizon({}) hunt exhausted (class 56/57). Load-await-write token-store remainder exhausted 3.500–3.504. Gateway request-path unbounded fetch exhausted 3.505.0. PagerDuty webhook history closed 3.506.0. Pairing store closed 3.507.0. Sessions persist closed 3.508.0. Usage-tracker ledger closed 3.509.0. Compaction offload closed 3.510.0. Telegram writer lock closed 3.511.0. Gateway supervised closed 3.512.0. Named remainder from source: `src/automations/store.mjs` `automationsPath()` still `os.homedir()` while production `hydrateAutomations(cfg)` at gateway boot already had cfg in scope. `loadConfig()` stamps `paths.configDir` unconditionally and does not stamp `automationsFile`, so the resolver still homed. Two instances shared one automations.json; the suite wrote the operator's real `~/.xclaw/automations.json`. Same class as v3.297.0 `alert-state.json`. Honour existing `XCLAW_AUTOMATIONS_FILE`. Closed siblings (do not re-fix): gateway supervised (3.512.0), telegram lock (3.511.0), compaction (3.510.0), usage-tracker (3.509.0), sessions/persist (3.508.0), pairing-store (3.507.0), pagerduty-webhooks (3.506.0), alerts.mjs, cron/eval-job, cron/doctor-job, cron/live-e2e-job (already cronLogPath), model-stats.mjs (already configDir), transcript (already configDir first), auth siblings (already configDir first). `cua-retry-metrics.mjs` `metricsPath()` is NOT this class (no cfg at live callers).
BUILT: `automationsPath(cfg)` honours `paths.automationsFile` then `XCLAW_AUTOMATIONS_FILE` then `paths.configDir` then null. No home fallback. `loadStore` returns empty in-memory on a null path. `saveStore` no-ops (do not `mkdir(null)`). `withStoreLock` mutates in-memory without a lockfile (do not `path.dirname(null)` which would lock cwd). Production already threads cfg so live still persists under configDir (never drop the capability). Pin: configDir write never touches home; explicit automationsFile wins; env wins over configDir; no-configDir names no file and never writes home; gateway still calls `hydrateAutomations(cfg)`.
RAN: node --test test/automations-store-config-dir.test.mjs test/goal-automations.test.mjs test/automations-concurrency.test.mjs → # tests 18 # pass 18 # fail 0 # duration_ms 167.33543; npm test (hermetic) → # tests 5182 # pass 5182 # fail 0 # duration_ms 82275.283777
UNVERIFIED: GitHub `ci` on this SHA; live two-instance configDir isolation on a running gateway; live gateway restart leftover stay-put.
NEXT: remaining non-S3 evolution gap from live source. Do not invert default-path durability. Do not rebuild S3 listed callers. Do not mint persistRun:true on voice, TUI stream body, Discord `/ask`, Slack, email, voice TUI, or voice listen. Do not auto-promote HTTP POST /agent/run. Do not stamp `runs resume --gateway` before GET `/health`.
