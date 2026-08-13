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
