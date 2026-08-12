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
