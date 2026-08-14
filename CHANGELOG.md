# Changelog

## 3.123.0 — read-only exec risk classification

Fresh live observation: on the DM bot every diagnostic command (`pm2 list`,
`tail`, `cat`, `df -h`) tiered "risky" and pended the full approval SLA
identically to genuinely dangerous commands — the A2 audit hardened the
dangerous direction but the safe direction was never built, which made
`security.autoApproveMaxTier` useless for channel bots (observed live: an
owner diagnostic request died on SLA timeout; another needed a manual
`/approve` for a `pm2 list`-class command).

- **`isReadOnlyExecCommand()`** in `src/security/risk.mjs`: deterministic,
  FAIL-CLOSED classifier — every pipeline/chain segment must have a bare
  head in the read-only set (or a constrained subcommand for
  git/pm2/npm/systemctl/find/journalctl/crontab/env); any redirection,
  substitution, subshell, path-prefixed head, or env-prefix disqualifies.
  Verified read-only chains map to tier **"low"** (never "safe" — reads can
  exfiltrate), overridable via `security.risk.tiers.readOnlyExec`.
  Credential-path reads (`cat ~/.ssh/id_rsa`) stay **critical** — the
  irreversible fact outranks the read-only path.
- With `security.autoApproveMaxTier: "low"` a channel bot now auto-runs
  provable diagnostics and still pends writes/risky/critical to the owner.
- Telegram `notifyOwnerApproval` now logs prompt delivery/failure — the
  gateway log previously could not show whether an approval prompt ever
  reached the owner.

## 3.122.1 — suite determinism + append-only rotation + alerter singleton fix

Mandate-2 closeout hygiene (all three found by re-reading the shipped arc):

- **Ops maintenance timer** (`src/ops/maintenance.mjs`): closes the audit's
  accepted finding "unbounded append-only files (rotation deferred)".
  `compactLedger()` existed but was CLI-only — nothing ever ran it; the
  gateway's daily ops timer now compacts the ledger (90d retention) and
  size-rotates the host-global JSONL appenders (router-events, cost-ledger,
  cron/doctor logs): head archived to `<file>.1`, newest line-aligned tail
  kept in place so live readers keep their recent window.
  `ops.maintenance {enabled, intervalMs, maxBytes, keepBytes}`.
- **Shared alerter no longer freezes target-less**: `getSharedAlerter` was
  first-caller-wins (the 3.102.1 approval-gate singleton class) — a bare-`{}`
  early caller silenced every later alert with `no_targets` even after
  `alerting.targets` was wired (observed live at 08:48). It now upgrades in
  place when a caller offers a config that resolves targets; never downgrades.
- **Deflaked the pending-approval tests** (`gateway-routes-security`,
  `system-run-plan-gate`): short SLA timeouts + fixed sleeps raced the
  parallel-suite load (observed 1/5 full-suite failure); now generous
  timeouts + deadline-polling for pending registration. Suite determinism is
  load-bearing — A4 self-deploy gates on it.
- Changelog backfilled for the mandate-2 arc (3.112.1–3.122.0 below).

## 3.113.0 → 3.122.0 — Mandate-2: autonomous engineering OS (backfill)

Ten slices + adversarial audit, each live-proven; full detail in
`docs/NEXT-LEVEL-AUDIT.md` §Mandate-2 arc.

- **3.113.0 (A1)** operational ledger — durable JSONL black box, graph by
  joins on correlation ids; `xclaw ledger tail|query|who-touched`; `GET /ledger`.
- **3.114.0 (B1)** persistent repo intelligence — incremental index keyed by
  git-common-dir (worktrees share it), notes + compounding brief,
  `xclaw_repo_intel` tool for all runs.
- **3.115.0 (A2)** zero-trust risk policy — facts→tier safe|low|risky|critical,
  durable allow-always pins (fingerprinted, TOCTOU-safe), missions
  `autoApprove` → `autoApproveMaxTier`.
- **3.116.0 (A3)** time-travel — commit-on-merge with `XClaw-Mission:` trailer,
  `refs/xclaw/*`, `xclaw timeline list|diff|revert|attribute`.
- **3.117.0 (B3)** economic routing — model metadata + measured stats +
  governor normal|economy|halt band; verify never auto-downshifts.
- **3.118.0 (B5)** Mission Control live canvas — swarm WS producer wired,
  zero-dep SVG DAG live-patched from events.
- **3.119.0 (B2)** hierarchical context — dormant `summarizeFn` wired to a
  cheap model, fold-of-folds, mission phase carryover.
- **3.120.0 (B4)** swarm blackboard + dynamic roles (narrow-only tool
  intersection) + `voteNodes` + tournament strategy (winner-only merge).
- **3.121.0 (A4)** self-modification loop — self profile + edit-surface guard
  + autonomous merge→deploy→health→auto-rollback via `xclaw self-deploy watch`;
  live-proven incl. fire-drill rollback.
- **3.122.0** adversarial audit — 2 BLOCKERs (edit-surface arg-key bypass;
  tournament merged all competitors) + 10 HIGH/MED closed.
- **3.112.1** doctor pm2-daemon leak fix — doctor only queries pm2 when a
  daemon already exists (612 orphaned God Daemons / 13.6GB on a live host).

## 3.112.0 — tmp sweeper + LSP cancellation + doctor accuracy

Fresh-observation release #2 (all three from reading the live host).

- **Stale-tmp sweeper**: `xclaw sweep-tmp [--dry-run] [--max-age-h N]` +
  `src/ops/tmp-sweeper.mjs` — removes `/tmp/xclaw-*` entries older than 24h
  that no stored mission worktree references (a live host had accumulated
  10k+ from suite runs; the first sweep removed 10,330 with zero errors).
  The gateway runs it daily (`ops.tmpSweep.enabled: false` to opt out) and
  doctor warns at >50 stale entries (`ops.tmp`).
- **LSP cancellation**: `$/cancelRequest` honored (in-flight completions
  answer -32800 instead of landing late), and a newer completion request
  for the same document supersedes the older in-flight one — safe to use
  with aggressive editor auto-trigger.
- **Doctor accuracy**: `computer.watchdog` and `eval.cron` used to warn
  "not running (start gateway)" while the gateway was demonstrably up —
  they read process-local state. `/gateway/info` now exposes a sanitized
  `ops` block (computerWatchdogActive / evalCronRegistered /
  channelWatchdogRunning) and doctor consults the RUNNING gateway when
  reachable.

## 3.111.0 — Channel outage alerting + self-healing dedicated browser

Fresh-observation release (post-NEXT-LEVEL): both items came from reading the
live host — a day of `[telegram] poll error` bursts that alerted nobody, and
a Control-browser pm2 unit at 425 restarts from stale Chrome Singleton locks.

- **Channel outage alerting**: the Telegram poll loop now reports poll-level
  liveness (`onPollOk` → `lastPollOkAt` / `lastPollErrorAt` /
  `consecutivePollFails` in channel status — `messagesHandled` is useless
  for a quiet DM bot). The channel health watchdog raises a real alert
  (shared alerter → doctor-cron delivery / PagerDuty) on the outage
  TRANSITION (consecutive failures ≥ `channels.healthWatchdog.pollFailThreshold`
  (8) or last successful poll older than `outageAfterMs` (5 min) with newer
  errors), emits a recovery event to live Control surfaces, and also alerts
  when the restart circuit opens — which used to give up silently. This is
  the channel-side twin of the 3.92.1 lesson: loop alive ≠ service reachable.
- **`xclaw browser`** — dedicated UI browser launcher with singleton-lock
  self-healing: reads the `SingletonLock -> hostname-pid` symlink, clears
  locks whose owner pid is dead on this host (never steals live or
  foreign-host locks), refuses profiles held by a live non-CDP Chrome
  without `--force`, detects an already-running CDP instance, and runs
  Chrome in the foreground for supervisors. Live-proven: `kill -9` on the
  running Chrome → pm2 relaunch through `xclaw browser` → locks healed →
  CDP back up, no crash-loop.

## 3.110.0 — LSP server over the completion service

Post-roadmap candidate 5 (final): editor integration without an editor-
specific plugin.

- `xclaw lsp` — zero-dep Language Server Protocol over stdio
  (`src/completion/lsp.mjs`): Content-Length framing with an incremental
  parser, full-document sync, `textDocument/completion` backed by the
  repo-aware completion service. Workspace root → `repoDir`; the completion
  is built from the LIVE buffer at the cursor (prefix ≤8k, suffix ≤2k).
  Works with neovim, helix, or any generic LSP client (docs/COMPLETION.md
  has copy-paste configs).
- 35ms initialize; live-proven end-to-end: real
  `textDocument/completion` returned `return farewell(name).toUpperCase();`
  for a buffer importing the repo's own module, 1.65s via claude-sonnet-5.
- Also documents the full completion surface (HTTP/CLI/LSP) in
  docs/COMPLETION.md.

## 3.109.0 — Workers CLI bootstrap + federation TLS guidance

Post-roadmap candidate 4.

- `xclaw workers list|add|remove|ping` (coordinator) and
  `xclaw workers token|join-command` (worker bootstrap): `token` ensures the
  worker gateway has an operator token (generates + persists once);
  `join-command` prints the exact `xclaw workers add …` line for the
  coordinator, flagging non-loopback plain-http with a TLS pointer instead
  of silently emitting `--allow-insecure`.
- `src/missions/workers-cli.mjs` shared core (same registry as the routes/UI;
  tokens redacted in listings, persisted 0600 via saveConfigPatch).
- `docs/FEDERATION.md`: worker/coordinator setup, reverse-proxy TLS examples
  (Caddy/nginx), URL policy rationale, credential-isolation rules (never
  share an anthropic OAuth store between gateways).
- Live-proven: CLI add → ping (version + computer health) → join-command
  echoing the live token unchanged → remove.

## 3.108.0 — Point-and-prompt in the webchat

Post-roadmap candidate 3: the picker is no longer Control-UI-only.

- The webchat composer gains a 🎯 button: prompts for the app URL (+ optional
  repository path, both remembered), arms the picker overlay in the app's tab
  via POST /point/pick, and drops the picked element's descriptor + resolved
  source locations (/point/resolve) into the composer — the chat agent takes
  it from there with its normal tools.
- Live-proven: 🎯 → real click on a running page's element → composer
  auto-filled with `[pointed element] <p class="tagline">…` + correct
  `src/index.html:11, src/style.css:3` resolutions.

## 3.107.0 — Phase-aware mission resume + transactional worktree merge

Post-roadmap candidates 1 & 2.

- Missions record `executedAt` when the execute phase completes; resume maps
  failed/interrupted missions to planning | executing | verifying by ACTUAL
  progress — a mission that died mid-execute re-runs its implementation
  instead of skipping to verification. Swarm missions resume their fan-out
  journal (terminal-ok nodes replayed, only missing work re-runs).
  Live-proven: gateway killed mid-execute → boot reconcile marked the
  mission interrupted → resume re-entered at executing → merge_ready →
  merged.
- `applyWorktreeMerge` is transactional: `git apply --check` runs BEFORE any
  untracked copy (a failing patch leaves the repo byte-untouched — previously
  copies landed first), existing destinations are conflicts instead of silent
  overwrites (identical content = idempotent re-merge), and a post-check
  apply failure rolls the copies back (`rolledBack: true`).

## 3.106.1 — completion path containment

Commit security review follow-up: `buildCompletionContext` now refuses a
target file that resolves outside `repoDir` (`../../x` or absolute escapes →
empty context, no out-of-repo reads). The arbitrary-`repoDir` surface of
/complete//missions//point is acknowledged by design: those routes are
operator-token gated, and the operator already holds `xclaw_bash`-level host
access — same trust class, no widening.

## 3.106.0 — Repo-aware code completion service

Final NEXT-LEVEL roadmap increment: completion-aware code completion.

- `src/completion/service.mjs`: fill-in-the-middle over the provider chat
  API with repo-intel neighborhood context — symbols from the files the
  target imports (parsed from the LIVE editor buffer first: new/unsaved
  files are the common case, disk may be stale) plus files that import the
  target. Fence/echo cleanup; suffix-echo cut. Provider resolves exactly
  like agent runs (OAuth hot-path refresh, failover, cost accounting).
- `POST /complete {prefix, suffix?, file?, repoDir?, language?}` —
  token-gated in BOTH auth modes (each call spends provider tokens).
- `xclaw complete [file] [--repo dir] [--suffix code] [--lang js]` — prefix
  on stdin, completion on stdout (editor-pluggable).
- Live-proven: gateway completion for a NEW file resolved contextFiles from
  the prefix buffer's requires and used both repo APIs correctly (~2s,
  claude-sonnet-5); CLI round-trip returned `return clamp(x, 0, 100);`.

## 3.105.0 — Remote mission workers (federation)

Roadmap increment: dispatch missions to OTHER xclaw gateways and drive them
from one Mission Control.

- `src/missions/remote.mjs`: worker registry (`cfg.missions.workers`
  `[{name,url,token,allowInsecure?}]`, tokens redacted in every listing),
  URL policy mirroring provider base-urls (https anywhere, plain http
  loopback-only unless allowInsecure), start/list/get/diff/merge/rollback
  proxies + `pingWorker` (version + computer health via the sanitized
  `/gateway/info`).
- Routes under the existing `/missions` auth umbrella, matched BEFORE the
  `:id` regex: `GET|POST /missions/workers`, `DELETE /missions/workers/:name`
  (config-persisted via saveConfigPatch), `POST /missions/remote` dispatch,
  `GET /missions/remote/:worker[/:id[/diff]]`, `POST …/merge`, `POST …/rollback`.
- Control UI: Remote workers card (add/ping/list/remove; per-worker mission
  table with remote Merge/Rollback) and a launch-target selector (local or
  any worker) on the mission form.
- The worker's OWN evidence gate, approval story, and token auth apply
  unchanged on its host; `repoDir` is a worker-side path. Coordinator and
  worker can run different models.
- Live-proven: a second gateway (ollama `glm-5.2:cloud`, shared computer
  plane) registered as `w1`; the coordinator dispatched a mission, tracked
  it to merge_ready through the proxy, merged remotely, and the worker's
  repo gained the module + test (suite green on the worker repo).

## 3.104.0 — Visual point-and-prompt (element → source → change → rebuild → verify)

Roadmap increment: point at an element in the RUNNING app, describe the
change, and a mission lands it at the element's real source — verified.

- `src/browser/cdp-client.mjs`: zero-dep CDP client primitive (loopback-only
  by default) for driving the operator's own display browser — list/attach/
  new-tab, evaluate, navigate, screenshot, raw `send`. No bundle, no fabric
  leases: the picker overlay appears in the browser the operator is looking at.
- `src/intel/element-resolver.mjs`: element descriptor → ranked repo
  locations, pure lexical scoring (id/getElementById/`#id` 40, data-attrs 20,
  visible text 25, class names 8 with 3-char utility classes dropped; markup
  files get a defining-file bonus). `PICKER_JS` = injected one-shot overlay
  picker (hover highlight, click captures descriptor, Esc cancels).
- Routes (token-gated both modes): `POST /point/pick` (opens/attaches the
  target page — NEVER the Control tab itself — arms the picker, returns the
  clicked element), `POST /point/resolve` (preview ranked locations),
  `POST /point/mission` (launch a mission with the element + resolved
  locations pinned into the goal). Control UI: "Point & Prompt" card in the
  Missions view.
- `scanRepo` now includes UI file types (html/css/scss/vue/svelte) — element
  resolution and front-end missions need them in the intel scan.
- Live-proven end-to-end on the display: real CDP click on a running app's
  `<h1>` → resolver ranked its html/css definition sites → mission changed
  exactly `.hero-title { color: red → #0b57d0 }` → tests passed → merged →
  page reloaded with computed color rgb(11, 87, 208).

## 3.103.0 — Swarm-backed missions

Missions can now execute as a dependency-aware swarm instead of a single
agent (`strategy: "swarm"` on POST /missions / the Control-UI selector, or
`cfg.missions.strategy`). Roadmap increment "swarm-backed missions".

- The plan phase asks the model for a fenced ` ```xclaw-mission-tasks ` JSON
  graph (2–6 nodes, roles implement/research/verify, `dependsOn` ordering);
  `parseMissionTasks` validates via the swarm's own `normalizeTaskGraph`
  (last block wins). Caller-provided `tasks` skip the plan model run
  entirely. An unparseable graph degrades honestly to solo execute.
- Execute fans out via `runSwarmFanOut` INSIDE the mission worktree:
  implement nodes get their own worktrees branched from the shadow
  workspace and early-merge back into it — the user's repo stays untouched
  and the evidence gate (verification-before-merge_ready) is unchanged. A
  failed fan-out degrades to the solo execute path.
- `approvalGate` is threaded through `spawnSubagent` and the swarm input so
  every node inherits the mission's worktree autonomy (same shared-gate
  singleton hazard fixed for solo missions in 3.102.1).
- Mission records carry `strategy` + `swarm {tasks, runId, nodes}`; Control
  UI shows Strategy and per-node status in the mission detail.
- Live-proven: a swarm mission on a real repo — model authored a 2-node
  graph, both nodes ran in parallel, early-merged, verification passed with
  the nodes' own tests, merge landed 4 new files.

## 3.102.1 — Mission approval-gate override + tool pairing invariant + resume evidence gate

Three real bugs found while live-verifying 3.102.0 through the gateway (a
mission failed with Anthropic 400 "tool_use ids were found without tool_result
blocks"; the full chain was reproduced and pinned in tests):

- **Missions now build their own approval gate** from the mission-scoped
  config. The loop's default is a process-wide shared gate (first caller
  wins) that a live gateway primes with `autoApprove:false` — silently
  overriding the mission's declared worktree autonomy: every exec tool
  pended for a human who was never asked, timed out after 120s, and the
  mid-batch stop skipped remaining calls. Hooks still compose through the
  mission gate.
- **tool_use/tool_result pairing invariant** in the agent loop: when a
  pending-approval or guard stop ends a turn early, remaining tool calls in
  the batch now get explicit "Not executed" tool messages (+ a
  `tool skipped` event) instead of orphaned tool_use blocks that 400 the
  next provider request.
- **Resume cannot bypass the evidence gate**: `resumeMission` maps
  `failed` → `verifying` (a stale failed status used to skip every phase
  block in `runMission` and fall through to `merge_ready` with zero
  evidence), and `runMission` now structurally refuses `merge_ready`
  without a recorded passing verification run.

## 3.102.0 — Mission integrity: tool scoping, complete merge evidence, artifact-free merges

Evidence-driven increment. The planned "local-plane fast file ops" roadmap item
was killed by measurement (an instrumented live mission put ALL tool time at
0.6s of a 260s wall — computer-plane file ops run in 5–20ms; the wall-clock is
model turns + npm install/test). What the measurement surfaced instead:

- **Run-scoped tool allowlist** (`cfg.agent.allowTools`, new
  `src/agent/tool-filter.mjs`): exact names + trailing-`*` globs, enforced on
  BOTH the advertised schema list and dispatch (hallucinated names get a
  blocked tool result). When the filter can never match `mcp__*`, MCP servers
  are not connected/spawned at all for that run. No filter configured = no
  behavior change.
- **Missions default to a code-work tool scope** (`DEFAULT_MISSION_TOOLS`;
  override `cfg.missions.allowTools`, `false` disables): bash + file ops +
  glob/grep + web search/fetch + skills/recall. Closes a real autonomy gap:
  mission agents run `autoApprove: true` for worktree isolation, but that
  blanket approval also covered 58 MCP tools (incl. Linear WRITE ops), browser,
  image-gen, X/finance tools — side effects far outside the worktree. It also
  drops ~100 irrelevant schemas from every mission model turn.
- **Merge evidence now shows everything the merge will do**: mission diffs
  include untracked (new) files — previously the human approved a merge seeing
  only the tracked patch while `applyWorktreeMerge` silently copied new files.
  New-file contents are synthesized into the patch via
  `git diff --no-index` (`untrackedPatch`), listed in `diff.untracked`, and
  shown in Mission Control ("New files" row).
- **Verification artifacts never merge**: `runVerification` snapshots untracked
  files before/after (its own `npm install` creates lockfiles etc. →
  `mission.verify.artifacts`), and `applyWorktreeMerge` gained
  `excludeUntracked` patterns (`partitionUntrackedByExcludes`). Missions merge
  with `DEFAULT_MERGE_EXCLUDES` (node_modules, package-lock.json, venv/pycache
  caches; extend via `cfg.missions.mergeExclude`) + recorded artifacts.
  Excluded paths are reported honestly (`diff.excludedUntracked`, merge result
  `excluded`, "Excluded" row in Mission Control).
- Tests: `test/tool-filter.test.mjs` (filter semantics + loop advertise/dispatch
  enforcement, hermetic) and `test/mission-merge-evidence.test.mjs` (pattern
  partition, untracked patch synthesis, real-git merge with exclusions,
  missionCfg scoping).

## 3.101.0 — Autonomous engineering missions (plan→verify→repair→prove) + Mission Control

The first increment of XClaw's autonomous-engineering core: take a high-level
objective and a repo, and carry it through to a proven result with minimal
intervention. Built by COMPOSING existing primitives (worktrees, approval gate,
sandbox/egress, hooks, provider routing) — nothing ripped out. Full audit +
roadmap: docs/NEXT-LEVEL-AUDIT.md; guide: docs/MISSIONS.md.

- **Codebase intelligence** (src/intel/repo-intel.mjs) — assembles the RIGHT
  task context (repo structure + regex symbols + import graph + lexical search
  + git change-frequency, ranked) instead of dumping code at the model.
- **Mission engine** (src/missions/engine.mjs) — plan → execute → verify →
  repair → merge_ready → merge/rollback, entirely in an isolated git
  worktree (the shadow workspace). The user's repo is byte-untouched until an
  explicit gated merge; rollback discards the worktree. Verification runs the
  project's OWN checks (npm/pytest/go/cargo auto-detected); a mission can NEVER
  reach merge_ready without a recorded passing run — success is never claimed
  without evidence. Bounded repair loop on failures.
- **Durable state + recovery** (src/missions/store.mjs) — atomic per-mission
  persistence; boot reconciliation marks crash-interrupted missions resumable;
  resumeMission continues from the recorded phase (recreating a vanished
  worktree if needed). Terminal statuses guarded against late-handler clobber.
- **Mission Control** — /missions routes (token-gated both auth modes) + WS
  mission channel + a Control-UI section: launch, live progress, verification
  evidence, timeline, diff, and gated Merge / Resume / Rollback.
- Carried-over fix: approvals now show a **hook** origin badge when a
  pre_tool_use hook (not policy) demanded human review.
- runAgentLoop gained provider/hookManager injection seams (hermetic tests).

Live-proven end-to-end on the operator display: a real model fixed a real bug
(cart total ignoring quantity) in a real repo through Mission Control — planned,
edited in a shadow worktree, verified with the project's own npm test (PASS),
and merged only after the human clicked Merge; the repo stayed byte-identical
until then and npm test passed afterward.

Adversarial pass found + fixed a path-traversal (a crafted mission id read
arbitrary .json under the config dir, e.g. credentials.json) and a rollback
race (an aborted run clobbered the terminal status) — both regression-pinned.
Suite 1463/0.

## 3.100.1 — command-hook runner: survive fast-exiting hook scripts (EPIPE)

A command hook that exits before stdin is written (one-liner `exit 2` guards
under load) emitted an async EPIPE on the child's stdin, rejecting the hook
with the wrong error instead of honoring the exit-code verdict — surfaced as a
load-dependent flake in the 3.100.0 pre-ship suite (which the ship script then
failed to gate on; this release's ship WAS gated). stdin errors are now
swallowed — the exit code is the verdict. Suite 1453/0 twice consecutively.

## 3.100.0 — hook system v2: tool-phase hooks, command hooks, matchers, stop veto, runtime management

Market-parity-plus upgrade after studying the field (Claude Code's 30-event hook
architecture being the bar):

- **pre_tool_use / post_tool_use** — matcher-scoped hooks on every tool call.
  System hooks return `{decision, reason}` merged deny > ask > allow: deny
  blocks before dispatch, **ask escalates to the human approval gate even on
  auto-approve policy** (hooks compose with the security stack, never bypass
  allowlists), and `{args}` rewrites input before the security plan binds.
  post_tool_use may rewrite the result text the model sees.
- **on_stop veto cycle** — a system hook may veto a clean completion
  (`{abort:"reason"}`): the reason is injected as a user turn and the loop
  re-enters, capped by hooks.stopBlockCap (default 2); `stopHookActive` guards
  against hook loops. Never fires on guard/budget/approval/abort stops.
- **Command hooks (out-of-process)** — hooks.commands[] run as separate
  processes in any language: JSON context on stdin, JSON verdict on stdout,
  exit 2 = universal block. Real isolation: the script never touches gateway
  memory regardless of tier.
- **Matchers** (`xclaw_bash|bash`, `mcp__github__*`) + `once` self-removing
  hooks.
- **Runtime management** — GET /hooks + /hooks/history, POST /hooks/toggle,
  POST/DELETE /hooks/commands (persisted + hot-applied, token-gated in both
  auth modes) and a Control-UI **Hooks** section: category toggles, hook
  table, execution history, command-hook editor.

Live-proven on the operator display: a `no-rm` command hook added through the
UI (system tier, matcher xclaw_bash|bash) hot-applied without restart and
denied a real agent's `rm -rf` attempt before dispatch — the model received
"Tool xclaw_bash blocked by hook: rm -rf is not allowed on this host." The
hook stays installed. 11 new tests; suite 1453/0.

## 3.99.1 — MCP OAuth callback: escape rendered error text (XSS)

Security-review follow-up: the auth-exempt `/mcp/oauth/callback` page rendered
its title/subtitle unescaped — the failure branch interpolates exchange error
text, which can carry a remote authorization server's `error_description`.
All interpolations are now HTML-escaped; pinned by a reflection test. Suite 1442/0.

## 3.99.0 — lifecycle hook system (dynamic, tiered, failure-isolated)

New `HookManager` (src/hooks/manager.mjs) with five lifecycle categories wired
into the agent loop: `pre_process` (may rewrite the incoming message or —
system tier — abort the run before any model call), `on_request` /
`on_response` (every turn), `post_process` (may transform the final text,
runs BEFORE the transcript save so redactions persist), `on_error` (observes
loop failures; the error still propagates).

- **Registration API**: registerHook/removeHook/listHooks/history with hard
  validation (category, callable, single-context-arg arity, tier).
- **Permission tiers**: system (full context incl. cfg + live messages, may
  mutate + abort) · trusted (redacted context, may mutate whitelisted fields)
  · user (read-only sanitized copy, returns ignored). Config-loaded modules
  are capped at the tier the OPERATOR assigns in `hooks.modules[]` — a module
  claiming system is clamped and the attempt logged.
- **Isolation**: per-hook try/catch + timeout (hooks.timeoutMs, default 2 s);
  a throwing or hanging hook is recorded and skipped, never crashes the run;
  executeAll never rejects.
- **Logging**: every registration/execution in a 200-entry ring buffer +
  stdout lines (hooks.log).
- **Config**: hooks.enabled global kill-switch, per-category disables,
  module loading from xclaw.json.
- **Examples** (src/hooks/examples.mjs, one per tier): redact-secrets
  (system, post_process), timestamp-context (trusted, pre_process),
  timing-logger (user, request/response). Docs: docs/HOOKS.md.
- runAgentLoop now accepts injected `provider` and `hookManager` options
  (hermetic tests / embedders).

Live-verified on the real gateway: a config-loaded module fired on a real
agent run (timing logged per turn), and its self-claimed system hook was
clamped to user tier — its attempted output hijack was ignored (reply stayed
intact). 21 new tests; suite 1440/0.

## 3.98.1 — real-world remote MCP proven (DeepWiki + GitHub) + SSE CRLF fix

First contact with real third-party remote MCP servers, driven end-to-end through
the Control UI: **DeepWiki** (mcp.deepwiki.com — no auth) and **GitHub MCP**
(api.githubcopilot.com — Bearer PAT, session ids). It immediately caught a real
transport bug: the SSE parser split frames on `\n\n` only, but the SSE spec
allows CR/CRLF terminators and DeepWiki sends CRLF — every response buffered
forever and surfaced as "stream ended before response". Frames/lines now split
on any spec terminator; the fixture server emits CRLF to pin it.

Live-verified through UI clicks on the operator display: DeepWiki tested green
(3 tools) and `read_wiki_structure` returned real wiki content; GitHub added
with `allowTools: get_me,search_repositories` — the filter cut its ~90 tools to
exactly 2 against the real server — and `get_me` returned the operator's real
account over an Mcp-Session-Id session. Suite 1419/0.

## 3.98.0 — MCP overhaul: Streamable HTTP, OAuth 2.1, resources/prompts, spec server, full management surface

Closes the remaining 6 findings of the 2026-08-13 MCP audit (finding #1 shipped as 3.97.2):

- **Streamable HTTP client transport** (2025-03-26+): POSTs accept SSE-stream *or*
  JSON answers, sessions ride `Mcp-Session-Id` (DELETE teardown on close), the
  negotiated revision is echoed as `MCP-Protocol-Version`, notifications expect 202,
  legacy JSON-POST servers still work. clientInfo now reports the real package version.
- **OAuth 2.1 for remote servers**: RFC 9728 protected-resource discovery → RFC 8414
  AS metadata → RFC 7591 dynamic registration → PKCE S256 authorize with RFC 8707
  resource binding → token exchange + auto-refresh; per-server grants in
  `~/.xclaw/mcp-oauth.json` (0600). Browser callback at `/mcp/oauth/callback`
  (state-authenticated, auth-exempt — pinned in the matrix test); `xclaw mcp login`
  drives the flow from the CLI and polls for the grant.
- **Resources + prompts client-side**: resources/list+read and prompts/list+get
  across servers, gateway routes, and a Resources & Prompts browser in the UI.
- **Spec-compliant server**: newline-delimited stdio framing (was LSP Content-Length),
  notifications no longer get replies, protocol-version negotiation echoes supported
  revisions, real serverInfo version. Tool surface grew from 2 to 5 (skills_list,
  status_get, job_run w/ destructive annotation) and transcripts + memory files are
  exposed as `xclaw://` resources.
- **Server-initiated traffic**: stdio client answers server `ping` requests and
  surfaces notifications; `tools/list_changed` invalidates the tool cache via a
  generation counter (a timestamp-zeroing first cut lost the race against an
  in-flight list — caught by an intermittent test, fixed properly).
- **Management surface**: `xclaw mcp list/add/remove/test/login/logout` CLI,
  /mcp/servers CRUD + /mcp/servers/test + /mcp/status routes, and an MCP servers
  editor card in the Control UI (add stdio/http servers, API keys write-only,
  allowTools filters, live Test, OAuth login, remove). The gateway's MCP client now
  reads the live config, so UI/CLI edits apply without a restart — proven by adding
  xclaw's own `mcp serve` as a server through the UI and calling its tools + reading
  a real transcript resource end-to-end on the operator display.

Suite 1419/0 (5 env-gated skips).

## 3.97.2 — SECURITY: MCP tools no longer bypass the approval gate

MCP audit finding #1: under the default `risky` approval policy, only tools on the
requireApproval name list (bash/file_write) ever paused for approval — every
`mcp__<server>__<tool>` auto-ran unapproved, no matter how destructive. MCP tools
are third-party code the operator never vetted tool-by-tool, so they now default
to requiring approval. Opt-outs: `security.safeAuto` for specific tools,
`security.mcpAutoApprove: true` for all (explicit choice). Plus per-server
`allowTools`/`denyTools` config filters enforced in the client — filtered tools
never reach the agent, the UI listing, or callTool. Tool annotations/outputSchema
now survive discovery for future use. Suite 1413/0.

## 3.97.1 — eviction stream: operator token out of the URL

Security-review follow-up on 3.97.0: the eviction live stream carried the operator
token as a `?token=` query param (EventSource can't set headers) — URLs land in
access logs and proxies. The stream is now a fetch-based SSE reader, so the token
travels as a header via the same wrapper as every other call; lastEventId resume
and decorrelated backoff kept. Verified live: stream reconnects "live" post-restart,
and no `?token=` carrier remains anywhere in either UI.

## 3.97.0 — every editable surface on the web UI: 8 new Control sections + auth sweep

The 8-gap close: every gateway capability that was editable only via API/CLI now has a
Control-UI section, each verified by real clicks on the operator display. New sections:
**Automations** (cron jobs: create/run-now/delete, humanized schedules, cron activity),
**Alerts** (status, history, test-fire, PagerDuty setup/policies/levels/webhooks),
**Skills** (catalog, outcome stats, proposal review queue with Install/Reject),
**MCP** (tools list + call console), **Images** (providers, generate with inline render,
job history), **Sessions** (live session list, create, peer binding, transcript reader),
**Subagents** (spawn/view/merge), **Memory** (agent memory file viewer). Health & Ops
gains Reload-config and Run-and-record-doctor buttons.

Security sweep (all pinned in the both-modes auth matrix test):
- **/cron/jobs leaked the full config** — every job carried `_cfg` with the gateway
  token, Telegram bot token and the live OAuth access token. Responses now strip
  `_cfg`/`handler` (test: cron-jobs-leak).
- **9 route families were in NEITHER auth branch** — /alerts, /media, /memory,
  /transcripts, /checkpoints, /skills, /eval, /tokens, /profile (+ /computer/*,
  /events/*, /doctor, /webhooks/pagerduty/recent). Unauthenticated callers could fire
  real pages, spend money on image jobs, install skills and read conversation
  transcripts. All token-gated in BOTH strict and legacy modes; HMAC webhook ingest
  stays open; the eviction EventSource carries the token via query param.

Real bugs found by clicking:
- POST /media/jobs never awaited the async job — every caller got literally `{}`.
- Image generation was dead end-to-end: the HTTP route only looked at env vars for
  credentials (now resolves the per-provider credential store like the agent tool),
  the xai registration pinned retired `grok-2-image` (now tracks the imagine matrix),
  the provider always sent `size` which xAI rejects outright (now only when asked),
  and xAI's string-shaped error bodies were swallowed. Verified: UI Generate → real
  grok-imagine-image render inline.
- Installing a skill proposal left it in the review queue (second click errored) —
  install now archives the source to installed/.
- New route: POST /skills/proposals/decide (filename-scoped; traversal 400s).
- GET /memory?full=1 returns bounded bodies for the viewer.

Suite 1409/0 (5 env-gated skips).

## 3.96.1 — Swarm section verified on-screen + phantom approvals badge fix

Eyes-on check of the Swarm view on the operator display: runs table with status pill + live count, the View drill-down (full run JSON incl. child subagent ids), merges table, live stream, checkpoints — all verified working (the Run + live SSE path was already proven end-to-end earlier by a real 2-node run). One cosmetic-but-real bug caught by looking: the pending-approvals nav badge rendered a phantom "0" when it should be hidden — `.nav-badge`'s `display:inline-flex` overrode the `hidden` attribute (same defeat-the-hidden-attribute class as the 3.94.0 stop-button). `.nav-badge[hidden]{display:none}` added; verified computed style. Suite 1400/0.

## 3.96.0 — full-robustness pass: every section audited, first-run login, live console

The three things standing between the web UI and an honest "fully robust" (operator-demanded):

**Every section audited.** Endpoint sweep of all 44 URLs the Control UI calls + click-through of the six never-audited views (Swarm, Approvals, Agents & Jobs, Health & Ops, Cost & Evals interiors, Overview). Result: one more dead-route family — the **Pairing** panel's `/pairing/pending|approve|revoke` never existed (5th such family). Wired to the real file-backed pairing store (routes/security.mjs; the gateway now dispatches `/pairing/*` there too), auth-gated, 3 route tests. Everything else verified rendering real data: swarm runs + live status, checkpoints, job queue + admission live, approvals + policy, dashboard, doctor, cron logs, eviction viz LIVE, eval baseline 21/21, scoreboard, skills.

**First-run login.** A fresh install on a strict gateway used to show silent "unauthorized" panels with no way in (the token had to be hand-planted in localStorage). Any same-origin 401 now raises a token-entry overlay — in both Control and WebChat — that verifies the token against a protected endpoint before reloading. Live-proven: cleared token → overlay → wrong token rejected with a clear message → real token → console loads. Tokenless lab installs never see it.

**Live console.** The gateway now broadcasts `security`/`budget` loop events on the existing WS hub, and the Control UI reacts: a pulsing pending-approvals badge on the nav (visible from any view) and a live-refreshing Approvals table. Live-proven end-to-end: fired a guarded bash via the API without touching the console — badge appeared with "1" and the approval row rendered unprompted; denied it from the UI — badge cleared. Also: display :10 screensaver/DPMS disabled so the operator console stays visible.

Suite 1400/0.

## 3.95.4 — Channels panel: live status pills were silently broken since 3.90.0

Checking the Channels section on the operator display: config management was complete (all 5 channels, per-field saves, secrets never echoed, Restart) — but no live status anywhere. Root cause: `channelManager.status()` returns an **array** of `{name, running, …}` while `mergeStatus` indexed it like a **map** keyed by id — `array["telegram"]` is always undefined, so the status merge silently never happened and the UI's (already-written!) running pill never rendered. `mergeStatus` now accepts both shapes; the row shows **running · N msg** (green, with bot username + last-ok tooltip), **stopped** (red, with the last error) for enabled-but-dead channels, and an **err** pill when a running channel carries a lastError. 2 regression tests. Live-verified on the display: Telegram shows "running · 0 msg" (@xxclaw_bot). Suite 1397/0.

## 3.95.3 — fix: the test suite was making a real paid grok-4.5 call on every run

Found by looking at the new Logs section on the operator display: recurring `noop` grok-4.5 rows at ~10.8K prompt tokens each lined up exactly with `npm test` runs. `test/session-kill-loop.test.mjs` assumed deleting `XAI_API_KEY` meant no credential — but since credentials moved into the profile store (3.86.0), the key resolved from `~/.xclaw` anyway, so every suite run executed a REAL grok-4.5 request and wrote it to the REAL cost ledger. Tally before it was caught: **38 calls · 402K tokens · $0.55**.

The test is now hermetic: temp HOME + `XCLAW_STATE_DIR` (no stored credential can resolve), baseUrl pinned to a dead loopback port (nothing can escape even if one does), ledger disabled, env restored and temp dir cleaned in `finally`. Proven: full suite run adds **zero** ledger rows. The 38 historical rows stay in the ledger — the spend was real and the ledger is truthful.

## 3.95.2 — Usage & Logs: provider selection live-syncs across open Control windows

Observed on the operator display with two Control surfaces open: both share the persisted provider selection but didn't live-sync — one window could show anthropic while the other showed nvidia, exactly the cross-provider confusion this section exists to prevent. A storage-event listener now converges every open window on the same selection instantly.

## 3.95.1 — security: /cost·/usage·/logs were strict-mode-only protected

Automated review of the 3.95.0 commit caught that the new `/cost`, `/cost/pause`, `/usage` and `/logs` paths were added only to the STRICT auth list — on a non-strict deployment with a token set, `POST /cost/pause` (state-changing: pauses ALL spend) and the session-preview-exposing usage/logs reads were unauthenticated. Now protected in both branches, with a matrix test asserting token-required + token-accepted across strict AND legacy modes for all five paths. Suite 1395/0.

## 3.95.0 — Usage & Logs: per-provider analytics console (xAI-console style)

New "Usage & Logs" section in the Control UI, modeled on the xAI console's Usage/Logs pages — with **provider separation as the organizing principle**: a provider chip bar (All · xai · anthropic · nvidia · …) rescopes every chart, breakdown, model table and log row together, so one provider's traffic can never be confused with another's.

**Usage**: spend / tokens / requests stat tiles with per-day zero-dep SVG charts (tokens stacked by type: prompt · cached · completion · reasoning), 7d/30d range, token-type breakdown table with share bars, and a by-model table (runs · tokens · spend).

**Logs**: one row per API request (time, provider badge, model, in/out/cached tokens, USD, message preview), filterable by run id / model / session / message text, newest first — click any row for the full run drill-down (all turns, cache stats, session, raw JSON).

**Data layer** (`src/tokens/usage-analytics.mjs`): aggregates the existing cost ledger — whose `turns[]` already record per-request token detail — instead of inventing a second store. Ledger entries now carry `provider` + `runId` (loop persists them); pre-3.95 entries infer provider from the model name. New token-gated routes: `GET /usage`, `GET /logs`, `GET /logs/run`.

Two bugs caught during the build by its own tests: daily buckets were built but never stored (charts rendered flat while totals were right), and synthetic run ids for legacy entries were computed from the filtered index in the list but the unfiltered index in the detail lookup — drill-down missed. Both fixed; 7 analytics tests including provider-separation no-leakage and the bucket regression. Suite 1393/0. Live-verified with screenshots: All + anthropic views, charts, breakdown, provider-scoped logs, drill-down.

## 3.94.5 — Cost & Evals: inbound/outbound token columns + governor card were dead

Operator report: the ledger's In/Out token columns were all dashes and the governor section empty. Three defects, one view:

- **In/Out columns + summary read wrong field names.** The ledger API emits `promptTokens`/`completionTokens` per row and `runs`/`costUsd`/`path` at the top level; the panel read `inputTokens`/`prompt_tokens`/`count`/`totalUsd`/`ledgerPath` — none of which exist. The data was in the payload the whole time. Now mapped correctly, with thousands separators, an `~` marker on estimate-only rows, and a richer summary: runs, total tokens in (prompt), total tokens out (completion), total USD, ledger file.
- **Cost governor card said "not found" and Pause/Resume were dead.** The card called `GET /cost` and the buttons `POST /cost/pause` — routes that never existed, while a full governor implementation (`src/tokens/cost-governor.mjs`: daily soft/hard USD caps, spend ledger, pause) sat unwired. Both routes now exist (in routes/tokens.mjs), token-gated via the strict auth list. Live-verified: card shows $5/$15 caps + spend + pressure; Pause→paused:true→Resume→false round-trip through the real buttons.
- 3 route tests including a contract guard on the row field names the UI binds to.

Suite 1386/0.

## 3.94.4 — fix: running gateway never refreshed the active OAuth token mid-flight (the outage, not fully closed)

The "did auto-refresh work?" question surfaced that 3.92.1 only half-fixed the 2026-08-13 outage. The refresh *logic* worked — but the running gateway never reached it for the **active** provider, so it was only masked by frequent restarts (each `loadConfig` refreshes).

`loadConfig` caches the active provider's OAuth token into `cfg.agent.apiKey` at boot. Then **both** `resolveProviderRouteAsync` (the per-request hot path) **and** `resolveProviderToken` (step 1) short-circuited on that static snapshot — the `resolveProviderToken` call that checks expiry and refreshes sat behind an `if (!apiKey)` that was never true. A gateway running past the token's ~8h lifetime kept sending the dead cached token → 401 → outage, exactly as before.

Fix: when the active provider is OAuth-backed (`cfg.agent.authMode === "oauth"`), the hot path bypasses the boot cache (new `freshOAuth` option on `resolveProviderToken`) and resolves through the profile store each run, which checks expiry and refreshes near the boundary. API keys don't expire → they keep the fast cached path, and healthy OAuth tokens don't refresh either (proven: 3 resolutions on an 8h-out token, zero rotations — no per-request storm).

Live-proven end to end on the real token: forced near-expiry → the hot path minted a fresh token per-request (`:refresh` source, ~8h expiry) → the new token authenticated (10 models). 3 regression tests (refreshes near expiry, no storm when healthy, `freshOAuth` bypasses the cache). Suite 1383/0.

## 3.94.3 — provider page: live credential health check + unknown-provider validation

Two gaps found auditing the Providers page for robustness:

**Live health check (the "is this key actually working?" feature).** Every provider row gains a **Test** button and a status dot. `POST /providers/manage/verify` first confirms a credential resolves, then makes a forced, uncached, real `/models` call — credential *resolving* is not the same as *authenticating* (the 2026-08-13 outage had a resolving-but-dead token). Dot goes grey (untested) → amber (testing) → green (`live · N models`) or red (`no credential` / `auth failed`), with the failure reason in the tooltip. Live-verified: Anthropic green with 10 models via the OAuth profile, a keyless provider red at the credential stage.

**Unknown-provider validation.** `POST /providers/manage/key` (and `base-url`, `use`, `verify`) accepted any provider string — POSTing a key for `"notreal"` returned `ok:true` and wrote an orphan `notreal:default` profile to disk that never showed in the inventory. All create/mutate paths now reject providers not in the known list (`400 unknown provider`); delete/prefer already no-op on non-existent profiles. 5 new route tests. Also updated the panel copy (OAuth is in-UI now, not CLI-only).

Suite 1380/0.

## 3.94.2 — OAuth login from the web UI (was CLI-only)

The Providers page could store API keys but OAuth said "use the CLI". Now the whole flow runs in the browser:

- **`POST /providers/manage/oauth/start`** — for paste-code PKCE providers (Claude/Anthropic) returns the authorize URL + state; the PKCE verifier never leaves the gateway (in-memory, 10-minute TTL, single-use, size-capped). Providers whose flows can't run as a browser round-trip (xai/openai need env-configured client ids + local callbacks) return the exact CLI command instead of a dead button.
- **`POST /providers/manage/oauth/complete`** — exchanges the pasted code (`CODE` or `CODE#STATE`) through the existing `exchangeAnthropicAuthCode` core and stores the profile via `loginOAuthTokens` — same result as `xclaw providers oauth`, tokens never echoed back.
- **UI**: every provider row gains an **OAuth login** button — for Anthropic it opens the Claude approval tab and shows a paste-code field + Complete right in the row (then auto-fetches live models); for others it shows the CLI command inline. Both the routes and the whole `/providers/manage` plane remain operator-token gated (the old "OAuth stays CLI-side" comment predated that gate and is corrected).

4 new tests: authorize URL + state (verifier never serialized), CLI fallback, unknown/expired state rejection, and a full start→complete exchange against a mocked token endpoint asserting the verifier reaches the token endpoint, the profile stores and resolves, tokens are never echoed, and the state is single-use. Live-verified in the UI: Anthropic row shows the paste-code flow, xai row shows the CLI command. Suite 1376/0.

## 3.94.1 — Control UI restructured into a sectioned console (was: one endless scroll)

Operator feedback: everything lived on a single page — 22 panels in one scroll. The Control UI is now a proper sectioned console:

- **Grouped sidebar navigation** — Monitor (Overview · Health & Ops · Cost & Evals), Run (Agents & Jobs · Swarm · Approvals), Configure (Providers · Channels). One view at a time, hash-routed and deep-linkable (`#/swarm`, `#/providers`, …), mobile slide-in nav.
- **Zero logic risk**: every panel kept its element IDs, so the existing `app.js` bindings work unchanged; the restructure is markup + styles + a ~30-line router. Design tokens now match the new WebChat (crimson accent, same dark system).
- **Two long-dead panels resurrected**: the Gateway status card had shown "not found" and Eviction/LRU "unavailable" ever since the `/status` and `/config` routes were dropped in an old refactor — silently, because nothing tested them. Both now read the sanitized `/gateway/info`, which gained non-secret `agent.provider` and an `eviction` summary block (a raw `/config` dump would leak secrets, so it stays gone).
- Also fixed: two sections shared `id="cardChannels"` (invalid HTML, `getElementById` ambiguity); channel status rows now cover Slack/Email too; sticky table headers.

Live-verified: all 8 views route with the correct panels, Overview cards populate with real data (host/provider/model/auth mode/version, eviction config, channel states), Providers renders as its own page with live credential badges. Suite 1372/0.

## 3.94.0 — the new WebChat: streaming markdown, live tool timeline, inline approvals, in-chat images

Full rewrite of `ui/webchat/` (zero dependencies, ES modules) — the front end finally shows what the backend already does:

- **Streaming-first**: `model/delta` events render as progressive markdown with a caret, throttled via rAF; Stop button aborts the stream mid-turn.
- **Safe markdown + code**: new `ui/webchat/markdown.mjs` — escape-first renderer (headings, lists with nesting, tables, blockquotes, fenced code with a zero-dep syntax highlighter for js/py/sh/sql families, protocol-filtered links) with 16 unit tests including XSS cases (script tags, event-handler attributes, `javascript:` and protocol-relative links).
- **Live tool timeline**: every `tool start/end` event becomes an expandable card — status dot (running-pulse/ok/fail), args, duration, result preview.
- **Inline approvals**: `security/approval_required` renders an amber card with the exact command and Allow/Deny buttons wired to `/security/decide` — approve guarded bash without leaving the conversation. Budget/guard events render as notices.
- **In-chat images**: generated images from the tool trace render inline via the new `GET /artifacts/file` route — strict workspace containment (traversal + symlink-escape tested, extension allowlist, size cap; `src/gateway/artifact-file.mjs`, 7 tests).
- **Sessions sidebar**: history list with message counts and relative times, switch/restore, New chat; status dots (gateway/computer), model + version chips; message actions (copy/retry), suggestion chips with the preserved shown/tapped feedback loop; empty-tool-turn replies fall back to the last tool output instead of "(no response)"; responsive down to mobile with a slide-in sidebar.

**Security fix (found during the build): `/gateway/info` leaked the operator token.** The route returned `gateway: cfg.gateway` verbatim — token included — while being deliberately reachable without auth (UIs poll it for status). Any unauthenticated loopback caller got the key to every token-gated API. Now a sanitized subset (`tokenSet`/`authStrict` booleans, host/port); regression test asserts no token-shaped value in the payload.

**Also fixed**: the static server had no MIME entry for `.mjs` (`application/octet-stream` → browsers hard-refuse ES module imports — would have broken any module-based UI); stop button visible when hidden.

Suite 1372/0 (24 new tests). Live-verified end-to-end on display :10: streamed markdown tour (tables/code/quotes), guarded bash approved via the inline Allow button (card → ✓ allowed → tool card 26ms → output), generated image rendered in-chat via `/artifacts/file`.

## 3.93.3 — webchat token support + origin-check hardening of the 3.93.2 fetch wrapper

Two follow-ups from actually using the UIs on a screen:

**WebChat had zero token support.** With `gateway.authStrict` (this host's config) the `/channel/` API is token-gated, and the webchat client never sent one — every message failed `401 unauthorized`. The same central same-origin fetch wrapper as the control UI now attaches `localStorage.xclaw_token` when present; tokenless lab setups are unchanged (nothing is sent when nothing is stored). Live-verified: message sent through the real UI, streamed reply rendered.

**Security: the 3.93.2 wrapper's origin check was bypassable** (caught by automated review of the pushed commit). `u.startsWith("/")` matches protocol-relative URLs (`//evil.example/x`), and `u.startsWith(location.origin)` is prefix-spoofable (`http://host:port.evil.example`) — both would have sent the operator token cross-origin if a call site ever fetched an attacker-influenced URL. Both wrappers now resolve the real target via `new URL(raw, location.href)` and compare `.origin` strictly; `Request` objects are unwrapped via `.url`. Verified in-page: both bypass shapes now resolve to non-same-origin (no token), relative and absolute same-origin still pass.

## 3.93.2 — fix: control UI sent the operator token on 1 of ~35 gateway calls

Found by actually putting the control UI on a screen: exactly one call site attached `x-xclaw-token`, so every operator-gated panel (swarm merges, providers, channels, queue controls, …) showed "unauthorized" even with a valid token in `localStorage.xclaw_token`. Now a central same-origin `fetch` wrapper attaches the token for every gateway call — existing and future call sites alike (the WS events path already carried it via the subprotocol; unchanged).

Operational note from the same session, for anyone hosting UIs on this box: do **not** open xclaw UI tabs inside the sudo-ai grok-oracle warm browser (CDP :9223) — that browser is actively driven by another agent's synthetic clicks/typing, which will wander your tab and press your buttons (observed: an unintended 2-node swarm run started by a stray click on "Run + live SSE"). The control UI gets its own dedicated Chrome instance/profile instead.

## 3.93.1 — fix: Telegram same-channel approval deadlock (poll loop blocked by the pending turn)

Found by live-testing the 3.92.0 approval flow over real Telegram: the getUpdates poll loop `await`ed every update handler inline, so a turn blocked on human approval (up to 120s) froze the loop — the owner's `/approve` (or the inline Allow tap) could not even be *read* until the SLA had already denied the approval, which then failed with `unknown_pending`. Same-channel approval was structurally impossible over polling (webhook transport was unaffected — independent HTTP requests).

`poll-loop.mjs` dispatch policy: callback_query updates and slash-command messages are handled inline (fast — no LLM) so they overtake a blocked turn; all other messages go to per-chat serial queues, preserving in-chat ordering while the loop returns to getUpdates immediately. Different chats may now process concurrently (previously global-serial) — for the DM-locked single-owner deployment this is effectively unchanged.

4 new tests including a faithful reproduction of the deadlock (approve arrives mid-blocked-turn, must complete before the turn does). Live-verified over real Telegram end-to-end: bash request → approval prompt with Allow/Deny buttons → `/approve` from the same chat while pending → `Approved` + command output delivered 15s after the request (previously: 120s SLA deny). Suite 1353/1348 pass.

## 3.93.0 — ship-readiness closeout: outage-proof doctor, automations locking, tool execute-smoke sweep

Closes the three gaps identified in a ship-readiness review after 3.92.1: doctor could go green through an outage, the automations store had a lost-update race, and nothing exercised tool bodies to catch the "shipped with a missing import" bug class generically.

**Doctor now makes a real, forced authenticated call to the active provider** (`providers.liveCheck`), not just a credential-resolution check — status ERROR (not warn) so hourly doctor-cron's `notifyOnFail` actually pages the operator. Credential *resolving* is not the same as credential *working*: the 3.92.1 outage had a token that resolved fine (a separate bug) for 9 hours while every real request 401'd. Opt out per-environment with `doctor.providersLiveCheck: false` (existing doctor tests set this so they stay hermetic).

**Automations store race fixed** (`src/automations/store.mjs`, `src/automations/index.mjs`): `executeAutomation` used to read the store once, await a multi-second-to-minute LLM call, then save that same stale in-memory snapshot — silently clobbering any write another process made in the meantime (a manual `automations run` racing the gateway's own scheduled tick, or an unrelated `add`/`delete`). Now: (1) a new `withStoreLock` always operates on a freshly-loaded copy under an exclusive cross-process lock (`src/browser/fabric-lock.mjs` generalized with an optional `root` — the same proven exclusive-lockfile-with-stale-pid-reclaim algorithm already used for fabric state, not duplicated); (2) an in-process guard rejects overlapping executions of the *same* automation instead of double-ticking it. 3 new tests reproduce the exact race (slow + fast writer to different automations; same-id overlap; lock sees prior writes) and pass only with the fix.

**Tool execute-smoke sweep** (`test/tools-execute-smoke.test.mjs`): calls `execute()` on every registered local tool (24) and every browser tool (21, via a stub computer client) with minimal args chosen per-tool so nothing reaches a real network call, paid API, or slow subprocess — asserts none throw. This is a smoke test, not full behavioral coverage, but it directly re-creates how the 3.91.1 born-broken-tools bug was found and generalizes that discovery method across the whole tool surface. Verified it actually catches the regression class: reintroducing the exact missing-import bug in browser-tools.mjs makes this test fail with the same `ReferenceError` as the original incident, restoring it passes again.

Suite 1349/1344 pass (5 pre-existing host-quirk skips), all new tests included.

## 3.92.1 — fix: live outage — anthropic OAuth token sat expired for 9 hours, never refreshed

Discovered live: a goal-automation e2e test hit a real 401, and so did the running gateway itself when probed directly — `@xxclaw_bot` had been unable to answer any Anthropic-backed request for roughly 9 hours with no visible error to the operator (the failure surfaced only as "Anthropic HTTP 401: OAuth access token has expired").

Root cause was two compounding bugs in `src/auth/profiles.mjs`, not the "connected token refresh scheduler" (that scheduler covers a different subsystem — third-party connected-app integrations — and was never involved in refreshing provider credentials at all):

1. **The expiry check silently never fired.** `anthropic-oauth.mjs` stores `expiresAt` as a raw epoch-ms **number** on every exchange/refresh. `credentialFromProfile`'s staleness check called `Date.parse(profile.expiresAt)` — which only understands strings; called on a number it returns `NaN`, and `Date.now() > NaN - 30000` is always `false`. The token has looked "not expired" to xclaw since the moment it actually expired.
2. **Even a firing check refreshed through the wrong OAuth server.** The one generic refresh path (`refreshProfileOAuth`) defaults to xAI's token endpoint and client id (`auth.x.ai/oauth/token`) for every provider — there was no Anthropic-specific dispatch, so a correctly-detected anthropic expiry would still have failed.

Fixed both: a `parseExpiresAtMs()` helper accepts numeric or ISO-string `expiresAt`; `refreshProfileOAuth` now dispatches anthropic profiles to `anthropic-oauth.mjs`'s own `refreshAnthropicOAuthToken` (real token endpoint, real Claude Code client id, JSON body shape) instead of the xAI-shaped generic path. 4 new tests, including one with a mocked `fetch` asserting the refresh request target is Anthropic's endpoint, not xAI's — it fails against the pre-fix code.

Live-verified: manually triggered the fixed refresh (real network call, real token returned, profile store updated with a fresh ~8h expiry), restarted the gateway, and a real webchat turn through Anthropic succeeded again. Suite 1341/0 (1336 pass, 5 pre-existing host-quirk skips).

## 3.92.0 — unattended-operation guardrails: approval mode live, commit gates config knob, per-run budgets, goal-mode automations

Frank opted into "full autonomy prep." Three slices, each flag-gated and default-compatible:

**1. Approval guardrails applied + config-driven commit gates.**
- The live host config now runs `security.autoApprove: false` — the `requireApproval` list (bash, file writes) actually gates: the tool call pends, the owner resolves it with the existing `/pending` + `/approve <id>` channel commands (Telegram inline keyboards included), SLA timeout denies. Live-verified round-trip: bash pended → `/approve` → executed.
- New `security.commitGates: true` config knob — the gateway exports `XCLAW_COMMIT_GATES=1` at startup (env still wins) so browser fabric commit gates are declarative instead of env-only. Doctor's prod check accepts either.
- FIX: webchat slash commands crashed the non-stream HTTP route ("Cannot read properties of undefined (reading 'content')") — the command branch returned no `reply` field. Every `/pending`, `/approve`, `/help` via `POST /channel/webchat/message` 500'd; Telegram/stream were unaffected, so it hid.

**2. Per-run budget caps** (`src/agent/run-budget.mjs`): `cfg.agent.budget = { maxToolCalls, maxTokens, maxWallMs }` — each optional, active when > 0, checked at every turn boundary. On exceed the run stops gracefully (`budget` event + "Stopped: run budget exceeded" final text; post-run pipeline still runs). Tokens come from the existing usage tracker (real usage or estimates). Off by default. Includes the source-assertion tripwire against refactor drops.

**3. Goal-mode automations** (`src/automations/goal.mjs`): `xclaw automations add --goal [--max-ticks N] -- <goal>` creates a `mode: "goal"` automation. Each scheduled tick composes a prompt from the goal + persisted state (plan, last progress notes, tick count), the agent does one useful step and ends with a fenced `xclaw-goal-state` JSON block (`plan` / `progressNote` / `done`), and the automation folds it into durable state. It self-disables on `done: true` or maxTicks (default 20). Unparsable replies burn a tick with a marker note — no infinite loops. Plain prompt automations are byte-for-byte untouched. This closes the "automations can't pursue open-ended goals across self-directed steps" gap; combined with approval mode + budgets, long unattended loops now have re-planning, spend ceilings, and human checkpoints.

Suite 1332/0 (13 new tests).

## 3.91.2 — fix: browser dead on root-run hosts (Chrome refused to start without --no-sandbox)

The live bot self-reported "my browser is navigate + read-only, no click/type/screenshots" — wrong diagnosis, real symptom. The bundle engine's full CDP browser was configured and advertised (`jsCode`, `screenshot`), but every launch died with `Browser exited before getting port`: Chrome hard-refuses to start as root without `--no-sandbox`, and `chrome-args.mjs` only added the flag for CI / docker / explicit `XCLAW_BROWSER_NO_SANDBOX`. Bare-metal root hosts (this one) got a browser that could never start.

- `buildChromeArgs` now detects uid 0 and adds `--no-sandbox` automatically (the bundle picks this up through the chrome-args bridge — no bundle change). Regression tests cover root-forces-flag and non-root-keeps-sandbox.
- Verified live end-to-end after restart: direct computer call (DOM mutate + same-tab readback + desktop screenshot) and through the real agent flow — the bot filled and submitted the httpbin.org test form via `jsCode` and read back `custname: "XCLAW_FORM_TEST"` from the response.

Corrections to the bot's other self-report claims, for the record: the computer engine already *was* `bundle` (not `native`); a gateway token *is* set; localhost being blocked is the SSRF guard working as designed; env API keys "missing" is env-policy stripping secrets by design (keys live in the provider credential store). Suite 1321/0.

## 3.91.1 — fix: every live bash call rejected by the bundle engine + 21 browser tools born broken

Two live-bot-breaking bugs, both found from the running gateway's own logs (`ALRIGHT RECHECK AGAIN` turn, 2026-08-13 01:43):

**1. `xclaw_bash` failed on every call with `InputValidationError: unrecognized key 'systemRunPlan'`.**
The approval path freezes a `systemRunPlan` and the loop/router inject it into exec-tool args so the computer plane can enforce it at spawn (3.81.0 design). The module engines accept the key — but the opt-in CDP **bundle** engine validates input with strict zod and rejected the whole call. With `security.autoApprove` + plan binding active, that meant *every* bash call through the live bot died before running.

- `modules/bash-tool.mjs` now declares `systemRunPlan` in its input schema, so engines built from modules *advertise* support.
- The loop reads that advertisement from `listTools` and passes `computerAcceptsRunPlan` to the tool router.
- When the engine can't accept the key, the router runs the same `assertPlanAtSpawn` gate the module engine would run — gateway-side, fail-closed — then strips the key before forwarding. Plan enforcement is preserved, not dropped: a drifted plan is denied without the computer ever being called (regression-tested).
- Second latent bug this surfaced: plans were frozen against `security.planRoot || process.cwd()` (the gateway's launch dir), so the spawn-time cwd pin *always* drifted from the session workspace (`cwd drift at spawn (plan=/root/xclaw live=/root/.xclaw/workspaces)`) — masked until now because the bundle rejected the key before any cwd check ran. The loop now binds exec plans against the run's `workingDir` (model-supplied `cwd`/`workingDir` still wins).

**2. 21 browser tools were born broken — `fabric_status` → `fabricStatus is not defined`.**
`src/tools/browser-tools.mjs` (single Grok bulk commit) only ever imported the mitm helpers; the lease/gate/fabric/sense/truth/timetravel/role tools referenced 22 identifiers from six modules that were never imported. Every `execute` of `tab_lease`, `commit_gate`, `fabric_status`, `session_role`, `browser_assert` (mitm-on path), `mitm_policy`/`mitm_export`, `trace_replay`/`trace_score` was a guaranteed ReferenceError. The suite stayed green because nothing invoked them — closed with imports plus `test/browser-tools-integrity.test.mjs` executing the previously-broken read-only paths.

Verified live end-to-end through the running gateway (webchat → agent loop → router → bundle computer): `xclaw_bash` returns real output with a bound plan, `fabric_status` returns a real fabric snapshot. Suite 1319 tests / 0 fail.

## 3.91.0 — full doctor: Providers + Channels + Services sections

`xclaw doctor` now covers the provider/channel subsystems and the live bot, not just config/security/computer/runtime:

- **Providers**: summary (N/12 configured + active provider/model), per-configured-provider credential resolution (does the `apikey`/`oauth` profile actually resolve, and via which source) + endpoint, and an image-generation readiness check (xai credential).
- **Channels**: summary (enabled/total), per-channel enabled/configured state + which fields are set, and live Telegram bot reachability (`getMe`) when a token is configured.
- **Services**: pm2 `xclaw-gateway` status (online/restarts/uptime) so the persistent bot's health shows in the report.

New display groups (Providers, Channels) slot between Security and Computer. No secrets are printed — only resolution booleans and sources.

## 3.90.4 — hide the {"claims"} grounding block from channel replies

The system prompt asks the model to append a ```json {"claims":…,"evidence_ids":…} ``` block for internal grounding, but it was leaking verbatim into user-facing replies (Telegram, etc.). `stripClaimsBlock` now removes the trailing fenced or bare claims object from the presented `text` field only — the raw reply is kept for internal verification/claims consumers. Unrelated JSON (e.g. a config example) is left untouched.

## 3.90.3 — deliver agent-generated images to Telegram (was text-only)

The bot could generate an image but only sent the text description — the picture stayed on the server, because the Telegram outbound path had no local-file photo upload (only voice used multipart).

- New `channels/telegram/photo-out.mjs` — multipart `sendPhoto` for a local image file, falling back to `sendDocument` if Telegram refuses it (mirrors voice-out).
- The agent turn now surfaces produced image paths: `base.mjs` extracts image artifacts (png/jpg/webp/gif) from the tool trace's collected artifacts into an `images` field; `runtime.mjs` passes them through `processInbound`.
- The Telegram reply path uploads each produced image as a photo after the text reply (cap 10/turn).

Verified live: a generated image was delivered to a real chat via `sendPhoto` (message_id returned). Suite 1308/0.

## 3.90.2 — image generation uses the xai provider credential (not XAI_API_KEY env) + current models

Image generation failed with "XAI_API_KEY not set" even when an xAI key was configured, because `generate_image`/`edit_image` read the `XAI_API_KEY` env var directly instead of the provider credential store.

- The image tools now resolve the xAI key via `resolveProviderToken(cfg, "xai")` — the same `xai:apikey`/`xai:oauth` credential configured through `xclaw providers` (env vars remain a fallback). `cfg` is threaded from the tool registry → `createImageTools` → the generate/edit tools.
- Fixed the stale image-model matrix: the retired `grok-2-image*` ids are replaced by the current `grok-imagine-image` / `grok-imagine-image-2.0` / `grok-imagine-image-quality` (old ids kept as fallbacks).

Verified live: `generate_image` produces a real PNG using the stored `xai:apikey` profile with no `XAI_API_KEY` env set. Suite 1306/0.

## 3.90.1 — telegram dmPolicy manageable + live @xxclaw_bot setup

- Added `dmPolicy` (open|allowlist|pairing) to the Telegram channel spec so DM access control is manageable via `xclaw channels set --channel telegram --field dmPolicy` and the UI, alongside `allowedChatIds`. `allowlist` + a populated `allowedChatIds` hard-locks DMs to specific chat ids (others denied outright); the default `pairing` offers strangers a pairing request; empty `allowedChatIds` with `pairing` is open.

## 3.90.0 — channel management via CLI · TUI · web UI (mirrors providers)

Every channel (Telegram, Slack, Discord, Email, WebChat) is now manageable the same way as providers — CLI, interactive TUI, and the control-UI panel — instead of hand-editing config.

**Shared core** `src/channels/manage.mjs`: declarative `CHANNEL_SPECS` (per-channel fields with secret/required/type), `channelInventory(cfg)` (enabled + configured + per-field set/not-set, **secrets always redacted to booleans — values never returned**), `setChannelField(id,key,value|null)`, `setChannelEnabled(id,bool)`. Secrets stay inline in `cfg.channels.<id>` by existing design (config is chmod 600); writes go through `saveConfigPatch`.

**CLI** `xclaw channels`: `list` (aligned table — enabled channels first, then a `— disabled —` divider; per-channel status + which fields are set, secrets shown as `set` never values), `set --channel X --field K --value V [--clear]` (validated; secret fields confirm "stored — not echoed"; dot-paths like `email.imap.pass` nest; list fields split comma strings), `enable`/`disable`, and a sequential `setup` wizard over all five channels.

**Web UI** (control panel): a Channels card mirroring Providers — per-channel enable toggle, configured/running badges, per-field inputs (secrets = masked + Save/×, text/list/bool typed), per-channel hints, Restart button (live channel manager). `esc()` on every interpolation, operator token on every call, 401 → clear message.

**Gateway** `routes/channels.mjs`: `GET /channels/manage` (inventory + live `channelManager.status()` merge, no secrets), `POST /channels/manage/field|enabled|restart`. `/channels` is operator-token gated in both auth branches (channel secrets are bot tokens — writes must not be unauthenticated). The existing `/channels/status` keeps working.

Verified live: auth gate 401 without token; inventory returns 5 channels with zero secret values leaked; `/channels/status` 200; control UI serves; `xclaw channels` table renders. Suite 1304/0.

## 3.89.0 — polish the providers surface (CLI · TUI · web UI) for all providers

A consistency + clarity pass across every provider (now 12: xai, openai, anthropic, google, nvidia, openrouter, deepseek, groq, mistral, together, ollama, ollama-cloud).

**CLI `providers list`**
- Fixed column alignment — endpoints drop the scheme and elide to a fixed width, so wide URLs (google/nvidia/ollama-cloud) no longer break the table. Padding is computed on plain text so ANSI colors never skew columns.
- Grouped + sorted: active provider first, then other configured, then a dim "— not configured —" divider, then the rest dimmed — what's ready to use is on top.
- New MODELS column (per-provider model count); tidy uppercase header; footer shows `N/12 configured`.
- Cleaner credential line: `↳ oauth★  apikey` (dropped the redundant `<provider>:` prefix; kept ★preferred + expired).

**TUI** (setup wizard + use picker): reformatted section headers, spaced numbered menus, per-provider status shown inline; `ollama` gains a one-command **install** option in the wizard. Non-TTY guards + the paste-credential→live-models spine intact.

**Web UI (control panel)**: active/configured grouping mirrors the CLI; per-provider hints (ollama = local daemon/no key/install hint, ollama-cloud = needs ollama.com key, nvidia = public catalog); the key→models→Use spine finished (masked key input, "fetching live models…" state, live/built-in count tag, error fallback); credential badges (apikey/oauth/token, ★ preferred click-to-prefer, × remove); loading/empty/error/busy states; endpoint wraps in-cell (no page scroll). Security kept: `esc()` on every interpolation, operator token on every call, 401 → clear message.

Verified live: aligned CLI list across all 12 providers; gateway panel serves 12 providers, nvidia's 90 public models load without a key, auth gate 401, control UI 200. Suite 1285/0.

## 3.88.0 — add NVIDIA NIM provider (free model catalog)

NVIDIA offers a large catalog of models free through its OpenAI-compatible API (build.nvidia.com → `integrate.api.nvidia.com/v1`). Added as the `nvidia` provider — same per-provider credential model as the rest.

- **`nvidia`** — `https://integrate.api.nvidia.com/v1`, OpenAI-compatible, `NVIDIA_API_KEY` (an `nvapi-…` key from build.nvidia.com). Default model `meta/llama-3.3-70b-instruct`; 10 popular models seeded (Nemotron 70B/340B, DeepSeek R1, gpt-oss-120b, Qwen2.5 Coder, Mistral Large 2, Codestral, Phi 3.5 MoE).
- The catalog is **public** — `providers list` + live model discovery show all **90 chat models** even before a key is added; a key is only needed for inference. Add it with `xclaw providers set --provider nvidia --api-key nvapi-…`.

Verified: nvidia appears in `providers list`; live discovery returns 90 models from the public catalog. Suite 1285/0.

## 3.87.1 — split Ollama into two entries: `ollama` (local) + `ollama-cloud`

Follow-up to 3.87.0: instead of routing one `ollama` provider by whether a key is present, Ollama is now **two independent, always-visible provider entries** — cleaner and matching the per-credential model of the others.

- **`ollama`** — the local daemon, `http://127.0.0.1:11434/v1`, no key. Installed via `xclaw providers install ollama`.
- **`ollama-cloud`** — ollama.com, `https://ollama.com/v1`, uses an ollama.com API key (`ollama-cloud:apikey`). Add with `xclaw providers set --provider ollama-cloud --api-key <key>`.

Both appear separately in `providers list` and the UI, each independently selectable — no more implicit local/cloud switching on a single provider. The 3.87.0 key-based routing hack (registry `ollamaEffectiveDefault`, discovery + manage special-cases) is removed; each entry simply carries its own base URL. An existing `ollama:apikey` credential is migrated to `ollama-cloud:apikey`.

Verified live: `providers list` shows both entries with correct endpoints; `ollama-cloud` fetches 18 cloud models and runs `gpt-oss:120b` inference; the local daemon generates (llama3.2). Suite 1284/0.

## 3.87.0 — Ollama: one-command install + separate cloud API-key credential

Ollama now fits the same per-provider credential model as xAI/Anthropic — a local runtime you install in one command, plus a **separate cloud API key** that routes to ollama.com.

**One-command install** — `xclaw providers install ollama [--model M]` (`src/providers/ollama-install.mjs`): installs the runtime via the official script if missing, starts the daemon if down, pulls a default model (llama3.2), and reports readiness + local models. Every step idempotent and safe to re-run. Linux/macOS auto-install; Windows prints the download link.

**Cloud key as a second credential**: store an ollama.com API key with `xclaw providers set --provider ollama --api-key <key>` (profile `ollama:apikey`). The `ollama` provider now routes by credential — **local daemon (`127.0.0.1:11434`) when no key, ollama.com cloud (`https://ollama.com/v1`) when a key is present** — in both the agent loop (registry `ollamaEffectiveDefault`) and live model discovery. A user-set per-provider baseUrl still overrides both; `OLLAMA_CLOUD_BASE_URL` overrides the cloud host. `providers list` / the UI inventory show the endpoint requests actually go to.

Verified live: one-command install (runtime detected, daemon ensured, llama3.2 pulled); cloud key fetches **18 cloud models** and runs real inference (`gpt-oss:120b` → completion through xclaw's agent loop); local path unchanged (127.0.0.1). Suite 1284/0.

## 3.86.2 — fix cross-provider credential leak in model discovery (third site)

Found while verifying live-model discovery for all four configured credentials (xAI apikey+oauth, Anthropic apikey+oauth) through the web-UI panel: xAI's model-fetch returned HTTP 400 because `discovery.mjs`'s own `resolveApiKey` still used `cfg.agent.apiKey` (the ACTIVE provider's cached key — Anthropic's) for *any* provider. So `fetchLiveModels("xai")` sent the Anthropic key to `api.x.ai/models`.

`resolveApiKey` now applies the same provider-scoping guard shipped in 3.86.1 for `registry`/`profiles`: the cached `cfg.agent.apiKey` is used only when it belongs to the requested provider (or none is configured); `XCLAW_API_KEY` remains the explicit generic last-resort. Exported + regression-tested.

Verified live: all four credentials fetch their real model lists (xAI → 7 grok models via both apikey and the SuperGrok-seat oauth; Anthropic → 10 claude models via both oauth and the no-credit apikey — model listing needs no credit). Both the CLI (`xclaw providers list`) and the web-UI `/providers/manage/models` route serve them. Suite 1280/0.

## 3.86.1 — fix cross-provider credential leak (active provider's key sent to other providers)

Found while setting up a second provider (xAI) alongside Anthropic. With one provider's credential active, resolving a *different* provider returned the ACTIVE provider's token — so an agent run on xAI was sent your Anthropic OAuth token (and, because the token shape forced the Anthropic adapter, produced `Anthropic HTTP 404: model grok-*`). This is both a correctness bug and a credential-exposure bug (one vendor's token reaching another vendor's endpoint).

Three scoping fixes so each provider resolves ONLY its own credential:
- `resolveProviderRouteAsync`/`resolveProviderRoute`: `cfg.agent.apiKey` (the active provider's cached key) is used only when the resolved provider matches `agent.provider` (or none is set) — same guard already applied to `baseUrl` in 3.85.2.
- `resolveProviderToken` step 1: dropped the legacy `|| p === "xai"` default-to-xai clause that handed `cfg.agent.apiKey` to xai regardless of ownership; now returns it only for the matching provider.
- `resolveProviderToken` step 2: honors `opts.profileId` (which `loadConfig` fills with the active provider's `authProfileId`) only when that profile's provider matches the requested one.
- `createProvider`: the `sk-ant-oat` token-shape auto-detect no longer forces the Anthropic adapter when the provider is an explicit non-Anthropic one.

Verified live: `xai:apikey` resolves the xAI key and runs grok-4.5 inference (real reply, cost-tracked); `anthropic` keeps its own OAuth token; no regression. Regression test added. Suite 1279/0.

## 3.86.0 — multi-provider management: per-provider key + OAuth + base URL, CLI wizard, TUI, web UI

Configure every provider independently — its own API key, its own OAuth, its own base URL, all separate and switchable — and pick a model from the provider's LIVE model list after entering the credential.

**Credential-first live model discovery.** After a key or OAuth token is stored for a provider, xclaw fetches that provider's real `/models` list using the credential and presents it for selection — no more guessing from a static list. Anthropic OAuth (`sk-ant-oat`) discovery fixed to use the Bearer + oauth-beta headers (the `x-api-key` path 401s for OAuth); API keys (`sk-ant-api`) still use `x-api-key`.

**Separate credentials per provider.** API key and OAuth for the same provider are stored as distinct profiles (`<provider>:apikey` vs `<provider>:oauth`) so they coexist — keep both, switch which one resolves via auth-order. A stored key never clobbers an OAuth token.

**CLI — `xclaw providers`** (`src/cli/providers-cli.mjs`):
- `providers list` — table of every provider: endpoint (custom/default), key/oauth status, active model, per-credential badges.
- `providers set --provider X [--base-url U] [--api-key K] [--reset-url]` — non-interactive.
- `providers oauth --provider X` — provider-dispatched OAuth login (Anthropic/xAI/OpenAI PKCE flows).
- `providers use [X] [model]` — direct, or a zero-dep readline TUI (provider → credential → live-model menus).
- `providers setup` — sequential wizard walking every provider (skip / API key / OAuth / base URL / reset), then the active pick.

**Web UI + gateway** (`routes/providers.mjs`, `ui/control` Providers panel): `GET /providers/manage` inventory (no secrets), `POST base-url` / `key` / `models` / `use` / `check` / `prefer`, `DELETE key`. The panel implements the same spine: paste key → dropdown fills with live models → pick → Use; editable base URL, per-credential badges, active highlight.

**Security** (all verified live):
- `/providers/manage/*` is operator-token gated in both auth branches — a base-URL rewrite (which redirects the stored Bearer token) can't be done unauthenticated. No token / wrong token → 401.
- Base-URL writes are validated: `https://` any host, `http://` loopback only; `file:`, non-loopback `http:`, other schemes → 400.
- Control-UI panel escapes every interpolated value (provider names, ids, URLs, model ids) against stored XSS.

Shared core `src/providers/manage.mjs` (inventory / setBaseUrl / setActive / checkCredential) backs both transports; `saveConfigPatch` in config/load.mjs is the shared atomic deep-merge writer. Suite 1279/0.

## 3.85.2 — install-hardening: doctor cwd-independence, provider baseUrl scoping, env precedence

Found while installing the CLI locally (`npm run install:local` + `npm link`) and driving a real end-to-end agent turn.

- **Doctor false errors from any cwd**: the Phase-A bridge-file checks resolved repo paths against `cwd`/`XCLAW_ROOT`, so the installed `xclaw doctor` reported 6 spurious errors when run outside the repo (the very next check resolved the same files correctly via module path). Now anchored on the package root; passes from any directory.
- **Provider baseUrl mis-scoping**: `agent.baseUrl`/`apiBase` (which `loadConfig` derives from the configured provider) were applied even when a *different* provider was selected via `XCLAW_PROVIDER` — so `XCLAW_PROVIDER=ollama` with `agent.provider=xai` aimed the ollama request at `api.x.ai` and failed. They now apply only when the resolved provider matches `agent.provider` (or none is configured).
- **Env-over-config precedence**: `XCLAW_MODEL`/`XCLAW_PROVIDER` now beat file config in the route resolver and model-chain builder (matching the existing `XCLAW_SSRF`/`XCLAW_GATEWAY_HOST` convention) — a session override no longer loses to a baked config value.
- **Test hermeticity**: the R11 credential-scoping tests now isolate the auth-profile store to a temp dir, so a real stored OAuth token on the dev machine can't leak into the env-fallback assertions.

Behavior unchanged when provider/model aren't overridden. Suite 1255/0.

## 3.85.1 — split the catch-all routes/api.mjs into per-plane modules

The broadest module from the 3.85.0 router split carried five unrelated planes in one file. Now: `routes/sessions.mjs` (sessions + transcripts + checkpoints), `routes/subagents.mjs`, `routes/mcp.mjs`, `routes/media.mjs`, with the three one-off context reads (`/skills`, `/memory`, `/providers/route`) joining the misc reads in `routes/ops.mjs`. Behavior byte-identical — pure mechanical move. Suite 1255/0; all groups + /v1 aliases live-smoked 200.

## 3.85.0 — router split complete, Anthropic thinking-block replay

Suite 1252 total / 0 fail (1247 pass, 5 env-skipped). Live gateway smoke across all extracted groups + /v1 aliases green.

**Gateway router split finished** (design review 4.3)

- Six more route modules extracted — `routes/jwks.mjs`, `routes/alerts.mjs`, `routes/ops.mjs`, `routes/eval-queue.mjs`, `routes/tokens.mjs`, `routes/api.mjs` — joining security/swarm/cron. `index.mjs`: **2380 → 1564 lines**. Deliberately still inline: the three SSE stream handlers, the webchat static/OAuth block, the Telegram webhook, WS attach, and error handling — closures over writer/channel state, not route logic.
- **Real pre-existing bug fixed during extraction**: the inline `POST /queue` handler contained pasted gateway-startup code that registered a NEW approval-digest `setInterval` on every enqueue request (unbounded interval leak) plus redundant slo-monitor starts. The extracted handler keeps only the idempotent worker ensure-call.

**Anthropic multi-turn thinking-block replay** (closes the 3.83.0 known limitation)

- With extended thinking + tool use, the API requires prior-turn thinking blocks (with signatures) replayed in assistant history. The stream parser now captures `thinkingBlocks` verbatim — including the previously discarded `signature_delta` and `redacted_thinking` blocks — and `toAnthropicMessages` re-emits them first in assistant content when thinking is enabled for the request (omitted otherwise, as the API demands). Zero `loop.mjs` changes needed: the provider message object flows into history by reference, and eviction's shallow spread preserves the field (both proven by tests). End-to-end two-call mock proves the exact signature round-trips to the second request's wire body.
- Scope note: durable-transcript resume across process restarts reconstructs only role/content (it never restored `tool_calls` either), so cross-restart mid-tool-cycle resume doesn't exist as a flow — the in-process cycles the API requires are fully covered.

## 3.84.0 — final deferred tier: WS protocol hardening, resume journal, skills integrity, router split

Suite 1235 total / 0 fail (1230 pass, 5 env-skipped). Extracted routes + /v1 live-verified on a booted gateway.

**WebSocket protocol hardening (zero-dep — no library added)**

- The hand-rolled RFC6455 layer had real holes: NO payload cap anywhere (a client claiming a 10GB frame via the 64-bit length header would be buffered), the FIN bit was ignored entirely (fragmented messages were silently corrupted, first fragment parsed as the whole message), no client-mask enforcement, close frames never echoed the peer's code. New exported `createFrameParser`: stateful partial-chunk/multi-frame parsing, 64-bit lengths rejected on the header alone (1009 before any buffering, 1MB default cap matching the HTTP body cap), client mask required (1002), full fragmentation state machine with interleaved control frames, control-frame rules enforced, close-code validation + proper close handshake with grace, strict UTF-8 (1007), unknown opcodes/RSV → 1002. Garbage bytes can only produce a clean close, never a crash. Public API and auth-before-101 unchanged.

**Swarm resume journal**

- Per-run append-only NDJSON (`~/.xclaw/swarms/runs/<id>.journal`): `run_start` header with a graph hash, `node_start`/`node_result` at every transition. New `resumeSwarmRun(cfg, runId)` + `xclaw swarm resume <id>`: replays last-terminal-ok results, re-runs failed/skipped nodes, refuses on graph-hash mismatch (`JOURNAL_GRAPH_MISMATCH`), tolerates torn trailing lines. Journaling is advisory — a write error warns, never fails the run. The wave scheduler is reused via preloaded state, not duplicated.

**Skills integrity manifest (signed-skills lite, no external trust infra)**

- `xclaw skills lock` pins every discovered skill's SKILL.md sha256 into a versionable `skills.lock.json` at the workspace git root; `xclaw skills verify` reports ok/changed/new/missing (exit 1 on drift). Loader enforcement via `skills.integrity`: no lockfile → off (zero behavior change); lockfile present → warn; lockfile + prod → **enforce** (changed/unmanifested skills excluded from injection AND from the `xclaw_skill` tool). Doctor row `skills.integrity`.

**Gateway router split (started) + stale-finding closure**

- `/swarm` read/merge routes and `/cron` scheduler routes extracted into `routes/swarm.mjs` / `routes/cron.mjs` (the routes/security.mjs pattern); index.mjs shrinks 2451→2380 lines with the SSE-heavy handlers deliberately left inline. Remaining groups tracked.
- Stale audit findings closed by inspection: sessions persistence already writes atomically (tmp+rename), and the flagged `seats/manager.mjs` no longer exists in the tree.

Remaining (explicitly parked): full router split to ~400 lines, Anthropic multi-turn thinking-block replay (loop.mjs history plumbing), bundle git-history purge (destructive — needs explicit owner opt-in).

## 3.83.0 — deferred P2/P3 tier: progressive skills, reasoning params, swarm scale, /v1 API

Suite 1213 total / 0 fail (1208 pass, 5 env-skipped) — and ~4s faster from an approval-timer fix. Gateway /v1 aliasing live-verified.

**Skills progressive disclosure**

- The system prompt now carries a compact skill INDEX (name, description, trigger hints) instead of full bodies truncated mid-sentence; only skills that fit whole within `skills.inlineMaxChars` (default 1500) are inlined — nothing is ever cut mid-body. New read-only `xclaw_skill` tool loads any full skill on demand (list variant without a name). `skills.progressive: false` restores the legacy behavior.

**Provider sampling + reasoning**

- `agent.temperature` config (default stays 0.2; `null` omits the field — required by reasoning models). `agent.reasoning = {enabled, effort, maxTokens}` → `reasoning_effort` on OpenAI-compat paths, `thinking: {type:"enabled", budget_tokens}` on Anthropic (temperature auto-omitted; `max_tokens` auto-grown past the budget as the API requires). Stream parser tolerates `thinking_delta`/`signature_delta`; thinking accumulates into `message.reasoning`, never into text. Zero wire change when unset.

**Swarm scale**

- Handoff truncation limits are config (`swarm.upstreamMaxChars`/`resultMaxChars`), defaults raised 1800→6000 / 1500→4000, and every actual cut is marked visibly (`…[truncated N chars — raise swarm.upstreamMaxChars]`) instead of silent loss. Node/parallelism caps are config (`swarm.maxNodes`/`maxParallel`, ceilings 50/16, legacy `maxChildrenPerRun` honored). New spawn depth guard: children carry `_spawnDepth` through their cfg; spawn/swarm refuse beyond `swarm.maxSpawnDepth` (default 2) with structured `SPAWN_DEPTH_EXCEEDED`.

**Security + API plane**

- **SLA auto-approve now revalidates the frozen plan** exactly like a human decide — an environment that drifted while the request sat pending is denied with `plan_drift` (closes brief 1.2's remaining shape).
- **Real bug fixed**: pending-approval timeout timers were never cleared on resolution — any process using the gate stayed alive up to 120s after the approval settled. Timers are tracked and cleared on every resolution path (this is where the suite's ~4s speedup came from).
- `EXEC_TOOLS` is single-sourced from `system-run-plan.mjs`; approvals' `requireApproval`/`execTools` defaults derive from it (previously triplicated string sets that had already drifted).
- **`/v1` API versioning**: every gateway route is now reachable under `/v1/...` (marked with `X-XClaw-Api-Version: 1`) so clients can pin a version prefix before any breaking v2 surface exists.

**SCAFFOLD sweep (Phase 8 start)**

- The repo's named heuristics now carry `// SCAFFOLD:` markers stating what replaces them: `inferGoal`, `detectTurnClosure`, `collectArtifacts`, `isKnownPollToolCall`, `VERIFY_OK/REVISE` sentinels, `NON_CHAT_RE` model classification, tokenizer curve-fitting — and the Anthropic OAuth **Claude Code identity spoof**, which additionally gets a doctor WARN (`security.oauthIdentity`) whenever an `sk-ant-oat` token is in use.

Still deferred with rationale: WS library (violates the zero-dependency stance — hand-rolled RFC6455 stays), signed skills/manifest-first activation (needs a trust-model decision), gateway router file split (mechanical, low value vs. churn), swarm resume journal (design sketched in-session), sessions/seats durability.

## 3.82.0 — P2 tier: structured critic verdicts, prompt caching on the wire, gateway hygiene

Suite 1182 total / 0 fail (1177 pass, 5 env-skipped). Gateway boot + new routes + CORS live-verified.

**Bitter-lesson fixes**

- **Critic merge-gate is structured**: critics now end with an authoritative JSON verdict line (`{"verdict":"approve"|"block","confidence":0..1,"reasons":[...]}`); `parseCriticVerdict` (string-aware balanced-brace scanner, last-verdict-wins, fenced/bare/embedded) decides the gate. The keyword regex survives ONLY as a fallback for critics that emit no parseable verdict — "I would not reject this" no longer blocks a merge. Reasons mark which path decided.
- **Anthropic prompt caching finally reaches the wire**: `toAnthropicMessages` was JSON.stringify-ing structured system content into a text blob, destroying the loop's `cache_control` breakpoints. Now structured system content maps to native Anthropic text blocks with `cache_control` preserved (capped at the API's 4-breakpoint limit, keeping the last 4); plain-string system gets one trailing breakpoint by default. Opt-outs: `tokens.cacheBreakpoints.enabled:false` or mode `none`. OAuth attestation block stays first; shared `applySystem` dedupes chat/chatStream.

**Gateway hygiene**

- **CORS wildcard removed**: `Access-Control-Allow-Origin: *` was on every response — any web page could read loopback gateway responses on tokenless lab setups. Default now: no Origin → no header; loopback origins reflected; everything else blocked. Operator override `gateway.corsOrigin` (`"*"`, origin string, or list).
- **`/security/*` served by the routes module** (was an unwired extracted file + three stale inline duplicates): richer payloads — pending list with SLA stats, `allow-always`-style decision parsing, policy with approval-gate info + computer-engine snapshot.
- Preflight allows `Authorization`/`x-xclaw-token` headers.

**Sweeper pass**

- **Deleted** `src/computer/browser-service.mjs` — zombie module referencing undefined identifiers (could never run); every runtime pointer/doc updated; the CDP path is the bundle engine. Recovery via git history.
- **Deleted** `src/agent/secure-tool-call.mjs` + `src/security/policy-matrix.mjs` (+tests) — imported by nothing but their own tests; the live logic runs inline in the loop/approval gate.
- **Wired `cfg.providers.routes`** (documented config that was consumed by nothing): config prefix routes now win over the built-in table; `routes.default` beats the hardcoded fallback but never an explicit `agent.provider`.

**Skills + eval honesty**

- Skill roots are config-driven (`skills.roots`, highest precedence); legacy Grok-sandbox absolute paths are on-disk-gated fallbacks instead of hardcoded entries.
- Eval scorer gains normalized any-of matching (`fileContainsAny`/`replyContainsAny`, whitespace-insensitive); brittle literal expectations in `hard.json` converted — correct-but-reformatted answers pass, wrong answers still fail.

Deferred (tracked): gateway router split + `/v1` versioning, hand-rolled WS → library, skills progressive disclosure, swarm handoff truncation/caps, SCAFFOLD sweep (Phase 8), signed skills.

## 3.81.0 — P0/P1 close-out: browser SSRF, merge self-approve, correctness batch

Closes the remaining P0/P1 tier of the 2026-08-12 design review + Grok brief. Suite 1149/0 fail (1144 pass, 5 env-skipped; was 1107), live LLM→MCP loop verified end-to-end for the first time.

**Security (P0)**

- **Native `browser_tab` SSRF guard**: `fetchUrl` did raw `http/https.request` on any agent URL with blind redirect-follow — the 3.79.x guard was only wired to `web_fetch`. Now routed through `safeFetch` (scheme allowlist, DNS-validate + IP-pin every hop, private/loopback blocked by default, `XCLAW_SSRF_ALLOW_PRIVATE=1` lab bypass) plus a new **metadata floor**: cloud-metadata endpoints (169.254/16, `metadata.google.internal`, Alibaba 100.100.100.200, AWS IPv6) are blocked in EVERY mode, including `off`/`allowPrivate`. Manager forwards the SSRF policy env to the computer child; blocked navigations return structured `{ok:false, code:"SSRF_BLOCKED"}`.
- **Swarm merge self-approval closed**: `xclaw_swarm_merge_approve` was model-callable with no principal check — the agent that proposed a patch could approve it next turn, even in prod. `approveMergeProposal` now takes `opts.principal`; CLI/gateway stay operator surfaces, the in-loop tool passes `agent` and is refused with `PRINCIPAL_DENIED` (lab-only override `swarm.allowAgentMergeApprove`, never honored in prod).

**Correctness + hardening (P1)**

- **Worktree merges**: `worktreeDiff` diffs from the merge-base with the main repo, so **committed** subagent work finally surfaces instead of silently NOOPing (`committedCount`/`base` fields; `dirty` includes committed-only). `checkOnly` is now a pure dry-run (the unguarded `fs.cp` and pre-return `fs.mkdir` are gone). Real latent bug fixed: patches were written `trim()`med, stripping the trailing newline `git apply` requires — tracked-diff merges ending in an addition failed `PATCH_CORRUPT`.
- **Cron**: full 5-field matching (dom/month/dow, lists, ranges, steps, Vixie dom/dow OR-rule) — `0 0 * * 1` no longer fires daily. Durable job store (`~/.xclaw/cron-jobs.json`, atomic writes); `start()` restores + re-arms payload jobs after gateway restart.
- **Providers**: credential fallback is provider-scoped — a missing key no longer ships another vendor's env credential to an arbitrary baseUrl (`XCLAW_API_KEY` stays as the explicit generic override). Failover router gains half-open recovery (`cooldownMs`, default 60s) instead of staying demoted forever.
- **Gateway**: constant-time token comparison (HTTP + WS); request bodies capped at 1MB (413).
- **Memory trust boundary**: the `XCLAW.md`/`AGENTS.md` upward walk stops at the workspace git root (never the filesystem root) — a planted `/tmp/XCLAW.md` can no longer inject instructions.
- **`runAgentOnce` fixed**: passed a `messages` array the loop silently drops → every automations one-shot ran with `content:undefined` (Provider HTTP 400). Found during live verification; source-assertion tripwire added.
- **CI honesty**: removed the `|| true` softening on the OAuth/vault pack in eval-regression.

**Docker (recovered from `fix/docker-onboard` branch)**

- Env bind overrides (`XCLAW_GATEWAY_HOST/PORT`, `XCLAW_COMPUTER_HOST/PORT`, token via env) so compose-published ports work; Docker try-me path documented in INSTALL/README. Composes with bind-guard: non-loopback binds still require a token.

**Verified live**: real LLM (ollama `glm-5.2:cloud`) through the actual agent loop discovered the stdio MCP fixture, called `mcp__echo__echo("XCLAW-LIVE-42")`, and reported its response — the review's last UNVERIFIED item. Branch board cleaned: 10 superseded remote branches deleted after per-branch supersession checks.

## 3.80.2 — restore install/onboard npm shortcuts + bundle-safe marker check

- Restored the `npm run install:local` / `onboard` / `init` / `prove:install` script aliases that were dropped from package.json in the 3.76.0 release commit (the underlying `install/install.sh`, `src/cli/init.mjs`, and `scripts/prove-install-e2e.mjs` were always present and `install-e2e` CI stayed green — only the ergonomic shortcuts were missing).
- `check-bundle-markers` now SKIPs cleanly when the opt-in bundle isn't installed instead of hard-failing on the (now release-fetched) `xclaw-server.mjs`.
- README quickstart documents the one-command path: `XAI_API_KEY=… npm run install:local` (or `npm run onboard -- --yes --profile lab`).
- Verified live: `npm run onboard` → exit 0, `~/.xclaw/xclaw.json` created; `npm run install:local` → exit 0; one-command install-e2e proof green in CI on a clean bundle-less checkout.

## 3.80.1 — atomic bundle publish helper (closes the manifest-drift footgun)

- `npm run publish:bundle [path]` (`scripts/publish-bundle.mjs`) updates the release asset and the `bundle-artifact.json` manifest in one step, so the pinned sha256 can't drift from what `fetch:bundle` downloads. It hashes the bundle, `gh release upload --clobber`s it, **re-downloads and verifies the checksum round-trips**, and only then rewrites the manifest — if the upload or verify fails, the manifest is left untouched. Auto-derives the repo from the manifest URL; `--dry-run` previews.
- Tests: dry-run hashes + derives repo without uploading; missing-bundle error; round-trip/no-op guards present; a canary asserting the committed manifest sha stays canonical. Verified live end-to-end: published an altered bundle (manifest → new sha), then republished the original (manifest restored), `fetch:bundle` re-verifies.

## 3.80.0 — 16MB CDP bundle moved out of git into a release artifact

- `src/computer/xclaw-server.mjs` (16.8MB, ~64% of repo size) is no longer tracked in git. It is published as the `computer-bundle` GitHub release asset and git-ignored. Only `XCLAW_COMPUTER_ENGINE=bundle` (opt-in full CDP) needs it; the default native/generated engines don't.
- `npm run fetch:bundle` (`scripts/fetch-computer-bundle.mjs`) downloads it on demand, **sha256-verified** against the committed manifest `src/computer/bundle-artifact.json`; prefers `gh release download` (API-backed, private-repo friendly), falls back to the direct release URL; idempotent (skips when present + valid).
- Starting with `engine=bundle` and no local copy auto-fetches (disable with `XCLAW_BUNDLE_AUTOFETCH=0`); otherwise a clear "run npm run fetch:bundle" error.
- `build:computer` and `doctor` are now tolerant of the absent bundle (doctor `a.bundle` is informational unless the engine actually needs it); build stamp records `legacyBundlePresent`.
- Tests: bundle-artifact manifest shape + sha256, the file is untracked in git (tripwire against re-adding it), build never creates the bundle whether present or absent. Verified end-to-end: build with bundle absent → OK; `fetch:bundle` → downloads 16839070B with matching sha256; re-run → idempotent skip.
- NOTE: git *history* still contains the blob (a history rewrite is a separate, destructive op blocked by branch protection). This stops the repo carrying it forward and makes fresh shallow clones lean.

## 3.79.1 — SSRF: pin the connection to the validated IP (close DNS-rebind)

- `safeFetch` previously validated via DNS, then handed the URL to `fetch`, which resolved DNS **again** — a rebind between the two lookups could still send the socket to a private target. Now each hop connects through `requestPinned` (`node:http`/`node:https` with a `lookup` override) that forces the socket to the exact IP that passed validation, while the URL keeps its real hostname so Host header, TLS SNI, and cert validation are unchanged. Zero new dependencies.
- `assertUrlAllowed` now returns `pinIp` (the validated address; null when the guard is bypassed via off/allowPrivate/allowHosts, where the caller falls back to normal resolution).
- `requestPinned` handles redirects at the `safeFetch` layer (re-validated per hop), sets `Accept-Encoding: identity`, and decodes gzip/deflate/br responses (node:http does not auto-decompress).
- Tests: pinning proven deterministically — a request to `example.com` pinned to `127.0.0.1` reaches the local server (DNS bypassed at connect), Host header preserved; `pinIp` presence/absence asserted. Live-verified: `web_fetch https://example.com` → 200 through the pinned path; metadata still blocked.

## 3.79.0 — SSRF guard + WebSocket upgrade auth

- **SSRF guard** (`src/security/ssrf.mjs`) on `web_fetch` — the agent-controlled server-side fetch was the review's open SSRF vector. Now: http/https only; DNS-resolve the host and block if ANY address is loopback/private/link-local/ULA/CGNAT/**cloud-metadata (169.254.169.254)** (getaddrinfo canonicalizes decimal/hex host encodings, so `http://2130706433/` → 127.0.0.1 is caught); **redirects followed manually and re-validated per hop** (a public host 302-ing to metadata is blocked). Config `security.ssrf`: `mode` block|off, `allowPrivate` (lab dev), `allowHosts`, `maxRedirects`; `XCLAW_SSRF` env.
- **WebSocket upgrade auth** (`src/gateway/ws-hub.mjs` + `auth.mjs`): the `/ws/events` upgrade previously wrote `101` with zero auth. Now an `authorize` gate runs BEFORE the handshake — rejects with `401` whenever a token is set or `requireAuth`/prod. Token accepted via `?token=`, `x-xclaw-token`, or `Sec-WebSocket-Protocol: xclaw.token.<token>` (the browser-settable carrier, echoed back on accept). Control UI passes an operator token from `localStorage.xclaw_token`.
- Doctor: `security.ssrf` + `security.wsAuth` checks.
- Tests: SSRF IP classifier (v4/v6/mapped/metadata/garbage), URL/scheme/decimal-encoding blocks, **live redirect-hop-into-metadata block**; WS handshake auth over a real socket (open when tokenless, 401 on missing/wrong token, 101 via query/header/subprotocol, fail-closed on requireAuth-without-token). 18 new tests.

## 3.78.0 — Tool planes + bundled skills (Grok) · MCP-in-loop regression fix (Claude)

- **Tool planes T0–T4** (Grok): plane map + ToolCall contract (`src/tools/planes.mjs`), Tool Router single dispatch path (`src/tools/router.mjs`), `runToolBatches` plane concurrency with maxParallel + abort, computer-only plane for bash/files/browser (heavy tools never run in-process), allowlisted `web_search` plane (Brave/DDG, HTTP only — never shell).
- **Bundled skills** (Grok): docx/pptx/xlsx office, pdf (create/transform/forms/OCR), ffmpeg, ImageMagick, skill-creator/installer, memory-edit, color, finance, image-gen-edit (`skills/bundled/`, 4.6MB).
- **Automations** (Grok): schedule prompts + list/pause/run/results + tasks skill.
- **FIX — MCP regression**: the T1 router refactor dropped 3.77.0's MCP loop integration (no `createAgentMcpTools` discovery, no dispatch, no close — `mcp__*` calls would throw "No MCP adapter"). Restored via the router's own `agentHandlers` plane: discovery feeds tool defs, per-tool handlers dispatch to the MCP client, stdio children closed in `finally`. New router-level end-to-end test so this cannot silently regress again.
- Hygiene: session reports (`MILESTONE-2026-08-12`, `PROCESS_GATEWAY_FAILURE`, `SHELL_STATUS`) moved from repo root to `docs/reports/`.

## 3.77.0 — MCP reaches the agent loop

- **Agent-loop MCP** (closes the review's worst gap — memory/MCP 3/10): tools from `mcp.servers` are discovered at loop start and join the tool list as `mcp__<server>__<tool>`, dispatched through the SAME sandbox/egress/approval path as built-in tools. New `src/agent/mcp-tools.mjs` adapter; stdio clients closed in the loop's `finally`.
- **stdio transport** (`src/mcp/stdio-client.mjs`): spawn `command`+`args`, newline-delimited JSON-RPC out, accepts newline AND Content-Length frames in (interops with spec servers and our own stdio server); request correlation, per-request timeouts, fail-all on child exit.
- **Client manager rework** (`src/mcp/client.mjs`): per-server transports (http/stdio), MCP `initialize` handshake (tolerates minimal servers), `tools/list` cache with TTL + `refresh`, `status()`, `close()`; namespaced + provider-safe tool names.
- **Fail-open discovery**: a dead/misconfigured server emits an `mcp` event and contributes zero tools — the run never dies because of MCP.
- Gateway: `GET /mcp/status`, `GET /mcp/tools?refresh=1`. Doctor: `mcp` check. XCLAW.md section.
- Tests (MCP had ZERO): stdio round-trip against a real spawned fixture server, http mock with cache-hit assertions, dead-server tolerance, adapter defs/dispatch, loop wiring. 9 new tests.
- Strategy C respected: no changes to `xclaw-server.mjs` (16MB bundle) or computer modules — MCP is agent-side.

## 3.76.1 — Security hardening: real egress boundary, env policy, bind guard

- **Egress is now enforced by netns, not regex**: bwrap `--unshare-net` defaults ON whenever `security.egress.mode ≠ allow` (netns probe with honest `netnsDegraded` fallback; live-verified `curl` NET-BLOCKED under `--unshare-net`). The command-pattern screen stays as a fast pre-check only.
- **Tool spawn env policy** (`src/security/env-policy.mjs`): bash subprocesses no longer inherit secrets. `security.bashEnv`: `strip-secrets` (default) / `allowlist` (prod default) / `inherit`; `envAllow`/`envDeny` escape hatches; `XCLAW_BASH_ENV` override.
- **Non-login `-c` bash on every spawn path** (the no-plan path previously ran `-lc` with full env); `BASH_ENV`/`ENV` rc-injection cleared everywhere; `security.bashLogin: true` restores `-lc`.
- **Gateway bind guard** (`src/gateway/bind-guard.mjs`): refuses non-loopback bind without a token (`XCLAW_GATEWAY_ALLOW_OPEN=1` opt-out). `xclaw init --profile prod` now generates + stores the token; config file chmod 600.
- **Loop-guard fix**: global circuit breaker counts ALL calls (`totalCalls`) — it previously counted the sliding window, so `historySize < threshold` silently disabled it (broken in every profile's hard ceiling).
- **Hermetic tests**: `findMitmCaCert` no longer falls back to the operator's `~/.mitmproxy` when a confdir is explicitly configured (2 host-leak failures fixed); build stamp gains `fullRebuild: false` (stamp test fixed). Suite: 1034 pass / 0 fail.
- `docs/GROK-PROGRESS.md` reconstructed as an append-only ledger from git history.

## 3.76.0 — Security phase: egress, kill-switch, live e2e, media CI

- **Egress policy** (`src/security/egress.mjs`): prod default deny network shell; allowlist hosts; `XCLAW_EGRESS`
- **Agent loop** hooks egress after sandbox; blocks curl/wget/ssh/URL patterns in prod
- **Session kill-switch** (`src/agent/session-control.mjs`): register/kill/killAll; CLI `stop-all`, `sessions-active`
- **runAgentLoop** registers every run + merged AbortSignal; outer finally unregisters
- **Doctor**: `security.egress`, `security.killSwitch` checks
- **Native browser** list/read/navigate + redirects; `BrowserTabTool` registry; transcripts CLI
- **CI**: `unit-media` job (apt ffmpeg); skip frame test without ffmpeg; security pack includes egress/session tests
- **Live verified** (xAI grok-4.5): LIVE_OK, PROOF_LIVE tools, multi-step STEP1+STEP2 concat
- Docs: `XCLAW.md` security section

## 3.75.0 — Verify pass (strong model on final answer)


- `src/providers/verify-pass.mjs` — VERIFY_OK / VERIFY_REVISE protocol
- Agent loop runs verify when `router.roles.verify` is set and final text has no tools
- Soft mode: emit `verify_suggest`; hard mode: `rolePolicy.verifyReplace: true`
- Tests: `test/verify-pass.test.mjs`

## 3.74.0 — Native computer default + session API

- Default `computer.engine: "native"` (thin server, not 16MB bundle)
- `src/computer/engine.mjs` — resolveComputerEngine / isNativeComputer
- Thin server implements `/xclaw/sessions/*` for computer-client compatibility
- Bundle via `computer.engine: "bundle"` or `XCLAW_COMPUTER_NATIVE=0`
- Tests: `test/computer-engine.test.mjs`

## 3.73.0 — Role routing (draft / act / verify)

- `src/providers/role-router.mjs` — role map, policy, role-aware provider facade
- Agent loop: optional multi-model by turn (draft first, then act)
- Config: `router.roles`, `router.rolePolicy`, `XCLAW_ROLE_DRAFT` / `_ACT` / `_VERIFY`
- Events: `router` phase `role` | `roles_ready` | `role_failover`
- Tests: `test/role-router.test.mjs`

## 3.72.0 — Multi-provider failover router

- `src/providers/failover-router.mjs` — model chain, shouldFailover, createFailoverProvider
- Agent loop uses failover by default (`router.enabled !== false`)
- Config: `agent.fallbackModels`, `router.chain`, `router.roles`, `XCLAW_FALLBACK_MODELS`
- Failover on 429/5xx/transient/auth; skip permanent 4xx
- Events: `router` phase chain|failover|skip|ready
- Tests: `test/failover-router.test.mjs`

## 3.71.0 — P0 thin computer server + clean browser_tab

- `modules/browser-tab-tool.mjs` — lightweight fetch-based tab (CDP upgrade path)
- `thin-server.mjs` — `/health` `/tools` `/call` `/extraction` without 16MB bundle
- `manager.startComputer` uses thin server when `XCLAW_COMPUTER_NATIVE=1` or `computer.nativeServer`
- Native pack includes browser_tab

## 3.70.0 — P0 computer extraction (clean native tools)

- CLEAN modules: `modules/bash-tool.mjs`, `modules/file-tools.mjs` (no bundle scope)
- `native-tools.mjs` registry + `executeNativeTool`
- `extraction-status.mjs` + `scripts/check-extraction.mjs`
- MODULE_MAP updated with cleanStandaloneTools
- Tests: `test/native-tools.test.mjs`
- Next: browser_tab clean module + thin HTTP router over native pack

## 3.69.0 — xclaw_recall durable memory retrieval

- `src/memory/recall.mjs` — keyword recall over events.jsonl + optional swarm receipts
- Tool `xclaw_recall` wired into agent loop (register + execute)
- Config: `memory.recall=false` to disable
- Tests: `test/recall.test.mjs`

## 3.68.0 — Context compaction (P0 long-horizon)

- `src/tokens/compaction.mjs` — tool offload to disk + extractive fold under pressure
- Agent loop: after eviction, runs `compactMessages` when pressure ≥ trigger
- Protects leading system (OAuth attestation / cache prefix)
- Config: `tokens.compaction.*` (enabled, triggerPressure, foldPressure, offloadThresholdChars)
- Tests: `test/compaction.test.mjs`

## 3.67.0 — Full Claude OAuth in agent loop

- Native Anthropic Messages provider (`src/providers/anthropic-messages.mjs`)
- OAuth attestation + headers automatic for `sk-ant-oat*` tokens
- Agent loop resolves auth profiles async (anthropic oauth profile)
- Registry: anthropic api = anthropic-messages
- Models: sonnet/opus/fable/haiku selectable via agent.model

## 3.66.2 — OAuth system attestation (sudo-ai parity)

- Required system prefix: `You are Claude Code, Anthropic's official CLI for Claude.`
- Without it, Sonnet/Opus/Fable return misleading 429 rate_limit_error on OAuth
- `src/providers/anthropic-oauth-headers.mjs` — headers + ensureOAuthSystemAttestation
- Verified live: Sonnet/Fable/Opus 200 with attestation

## 3.66.1 — Claude Code binary endpoint parity + credential import

- Defaults aligned with Claude Code 2.1.226 native strings (`platform.claude.com/v1/oauth/token`)
- `importClaudeCodeCredentials` reads `~/.claude/.credentials.json` (`claudeAiOauth`)
- CLI: `--method import-claude-code`

## 3.66.0 — Claude / Anthropic OAuth PKCE

- `src/auth/anthropic-oauth.mjs` — PKCE authorize URL, paste-code exchange, refresh
- `oauth-policy` anthropic kind `claude_pkce`
- CLI: `xclaw models auth login --provider anthropic|claude --method oauth`
- Registry env: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`
- Docs: `docs/AUTH_CLAUDE_OAUTH.md`

## 3.65.0 — S2 merge/vote use receipts

- `evaluateReceiptPolicy`, `receiptVoteWeight`, `buildRunReceiptSummary`
- Merge gates fail when `requireReceipts` and implement/verify/critic lack receipts
- Vote weights multiply by receipt quality (missing → 0.25 or 0 if hard)
- Swarm run stores `receiptSummary` + returns `receipts` policy summary
- Config: `swarm.requireReceipts` or `XCLAW_SWARM_REQUIRE_RECEIPTS=1`

## 3.64.1 — Swarm failure receipts completeness

- Receipts on retry-exhausted failures and skipped nodes (`UPSTREAM_FAILED`, `DEPS_NOT_TERMINAL`)
- Docs: failure handling table in SWARM_RECEIPTS.md

## 3.64.0 — S1 universal swarm node receipts

- `src/agents/swarm-receipt.mjs` — build/write/list receipts for any domain (shell, files, repo, browser, …)
- Effects inferred from tool trace; browser fields optional
- `swarm-run` attaches receipt on node success and final failure
- Stored at `~/.xclaw/swarms/runs/<swarmId>/receipts/<nodeId>.json`
- Tests: `test/swarm-receipt.test.mjs`

## 3.63.0 — C2 trusted fabric role at swarm spawn

- `mapSwarmRoleToFabric` / `bindSwarmSpawnRole` in role-binding
- `spawnSubagent` binds fabric role when role/swarmRole set (spawn id + session id)
- swarm-run passes node role into spawn
- Agent loop resolves role from session bind (not free env) for browser belt
- `xclaw_spawn_subagent` accepts `role` enum
- Tests: `test/browser-c2-swarm-role.test.mjs`

## 3.62.0 — C1 auto-renew tab lease heartbeat

- `src/browser/lease-heartbeat.mjs` — start/stop/touch/acquireWithHeartbeat
- hooks: touch + start heartbeat on successful beforeNavigate/beforeInput when fabric enforce + tabId
- `tab_lease` acquire starts heartbeat; release stops; renew/heartbeats actions
- Env: `XCLAW_TAB_LEASE_HEARTBEAT`, `XCLAW_TAB_LEASE_HEARTBEAT_MS`, `XCLAW_TAB_LEASE_TTL_MS`
- Tests: `test/browser-c1-heartbeat.test.mjs`

## 3.61.0 — B4 alerting polish

- Alerter: `alertLiveE2eFailure`, `alertEnforcementFailure`
- Targets inherit `liveE2e.cron.delivery` (and doctor delivery)
- live-e2e cron uses shared live-e2e alert helper
- Doctor cron runs CLI `a.*`/`h0.*` enforcement slice and alerts on errors
- Doctor `quiet` option for scheduled runs
- Tests: `test/alerting-b4.test.mjs`

## 3.60.0 — B3 live e2e cadence

- `src/cron/live-e2e-job.mjs` — run + log + optional alert; ensureLiveE2eCronJob (default 24h)
- CLI: `xclaw live-e2e`, `xclaw live-e2e-schedule [everyMs]`
- docs/PROD_PRESET.md + OPS.md — nightly/pre-release/systemd timer
- npm: `live-e2e:cron`, `live-e2e:schedule`

## 3.59.0 — B2 production enforcement preset

- `docs/PROD_PRESET.md` — copy-paste prod/lab env, verify commands, checklist, incident hints
- `OPS.md` — Production enforcement preset section linking full doc

## 3.58.0 — B1 release-gate A-enforcement

- `release-gate` always runs `a-enforcement-e2e` (required, including `--quick`)
- `bundle-markers` step requires A2/A4/A5 strings in xclaw-server.mjs
- `--live` / `XCLAW_LIVE_E2E=1` adds live-enforcement-e2e
- npm: `release-gate:live`, `check-bundle-markers`
- Offline A-smoke exit 1 (warnings) treated as pass for gate; exit 2 fails release

## 3.57.0 — A8 fabric durability (locks + heartbeat)

- `src/browser/fabric-lock.mjs` — cross-process exclusive lock with stale reclaim
- Leases, gates, clock, session roles RMW under `withFabricLock`
- `renewTabLease` heartbeat (TTL extend + heartbeatCount)
- `tab_lease` tool action `renew`
- Tests: concurrent lock serialization, steal denied, parallel tabs, gate lock

## 3.56.0 — LIVE-E2E enforcement script

- `scripts/live-enforcement-e2e.mjs` — starts computer if needed, session + tools/call probes
- Asserts commit gate on /checkout, jsCode motor block, read js allowed, optional motor/nav
- Flags: `--json` `--no-start` `--keep`
- npm: `live-e2e` / `live-enforcement`

## 3.55.0 — A7 bypass closure (jsCode + role binding)

- `src/browser/jscode-policy.mjs` — block click/type-like jsCode under fabric/prod
- `src/browser/role-binding.mjs` — session-bound roles; env ignored under strict unless XCLAW_ROLE_FROM_ENV=1
- hooks beforeInput checks jsCode + resolveRole
- Bundle + gateway pass jsCode into beforeInput
- Tool: `session_role` bind|get|resolve
- Doctor: a.jscode_* + a.role_binding
- Tests: `test/browser-a7-bypass.test.mjs`

## 3.54.0 — A6-ops: doctor enforcement + e2e smoke

- Doctor section `a.*`: bridges, hooks, motor, chrome-args, role checks, bundle markers, prod strict
- `scripts/a-enforcement-e2e.mjs` — offline-first Phase A smoke (exit 0/1/2)
- npm scripts: `a6` / `a-enforcement`
- Env: `XCLAW_ROOT`, `XCLAW_ENFORCEMENT_STRICT=1` / `profile=prod` for hard gates in doctor

## 3.53.0 — Phase A5 single Chrome argv path

- `src/computer/chrome-args.mjs` — canonical buildChromeArgs (H0 + MITM + sandbox)
- `src/computer/chrome-args-bridge.mjs` — computer process loader
- Bundle `ensureRunning` replaces argv via bridge before spawn
- Clean `browser-service.mjs` uses same builder before spawn
- manager sets XCLAW_CHROME_ARGS_BRIDGE
- Tests: `test/chrome-args.test.mjs`
- Phase A (A1–A5) enforcement plane complete for launch + navigate + fabric + motor

## 3.52.0 — Phase A4 humanized CDP motor

- `src/browser/motor.mjs` — planClick/Type/Scroll via Fitts + key delays → Input.dispatch* steps
- `src/computer/motor-bridge.mjs` — load + runMotorOnClient
- `xclaw_browser_tab` accepts `motor: { op, x, y, text, ... }` and executes on tabClient
- Agent tools: `browser_click`, `browser_type`
- manager injects XCLAW_MOTOR_BRIDGE
- Tests: `test/browser-motor.test.mjs`

## 3.51.0 — Phase A3 fabric on more actuation paths

- Tab tool `call` entry runs `beforeInput` (lease + role) before any act
- Navigate path keeps `beforeNavigate` + `afterAction` binding
- Gateway belt: agent loop checks hooks before `computer.callTool` for `xclaw_browser_tab`
- Read-only observe allowed for observer; evaluate/navigate still motor-gated
- Auto-acquire lease via `XCLAW_TAB_LEASE_AUTO=1` under fabric enforce
- Tests: `test/browser-hooks-a3.test.mjs`

## 3.50.0 — Phase A2 driver hooks on navigate path

- `src/browser/hooks.mjs` — beforeNavigate / beforeInput / afterAction / buildChromeArgs
- `src/computer/hooks-bridge.mjs` — resolve + load hooks from computer process
- `xclaw-server.mjs` — Page.navigate calls beforeNavigate (fail-closed when gates/enforce on)
- `manager.mjs` — injects XCLAW_ROOT + XCLAW_HOOKS_BRIDGE into computer env
- Enforcement: XCLAW_COMMIT_GATES, XCLAW_FABRIC_ENFORCE, role caps, tab leases
- Tests: `test/browser-hooks.test.mjs`

## 3.49.3 — Full computer bundle mapped + app layer extracted

- `src/computer/MODULE_MAP.json` — complete ~16.8MB / 395k-line region map
- `src/computer/modules/*` — all xclaw_* tools + skills/context + HTTP main extracted
- Clean `browser-service.mjs` remains the importable Chrome owner
- Vendored ~380k lines left in bundle by design; app ~15k lines now addressable

## 3.49.2 — Clean BrowserService module extracted from computer bundle

- `src/computer/browser-service.mjs` — importable, syntax-checked BrowserService (from xclaw-server.mjs)
- `src/computer/browser-tab-tool.extracted.mjs` — reference extract of xclaw_browser_tab
- `docs/COMPUTER_EDITABLE_MODULES.md` — edit-here vs run-there contract
- A2 can attach hooks on the clean module instead of string-patching 16MB

## 3.49.1 — Phase A1: Computer source of truth

- Documented that `src/computer/xclaw-server.mjs` (~16.8MB bundle) **is** the Chrome/CDP source — no pre-bundle tree in-repo
- Ownership map: `manager.mjs` lifecycle, `BrowserService.ensureRunning` launch, `xclaw_browser_tab` actuation
- Artifacts: `docs/COMPUTER_SOURCE_OF_TRUTH.md`, `src/computer/SOURCE_OF_TRUTH.json`
- Defines A2 hook targets (beforeNavigate / beforeInput / afterAction / buildChromeArgs)

## 3.49.0 — Horizon 5 Time-travel & causal eval

- `src/browser/timetravel.mjs` — loadTimeline, replay plan, scoreCausal, synthetic origin server
- Eval `scoreCase` honors `expect.causal` / `expect.network` / forbidHosts
- Tools: `trace_replay`, `trace_score`
- Offline synthetic HTTP origin from recorded flows (`startSyntheticOrigin`)
- Sample case: `eval/cases/causal-network.json`
- Tests: `test/browser-timetravel.test.mjs`

## 3.48.0 — Horizon 4 Session Physics + Swarm fabric

- `src/browser/physics.mjs` — tab leases, commit gates, role caps, logical clock
- Tools: `tab_lease`, `commit_gate`, `fabric_status`
- Roles: observer / actor / critic / planner motor permissions
- Commit-sensitive URL patterns (checkout, pay, delete, transfer, …)
- Swarm roles extended: actor, observer + critic fabric instructions
- Persist under `~/.xclaw/fabric/` (`XCLAW_FABRIC_DIR`)
- Env: `XCLAW_COMMIT_GATES=1`, `XCLAW_TAB_LEASE_TTL_MS`, `XCLAW_AGENT_ID`
- Tests: `test/browser-physics.test.mjs`

## 3.47.0 — Horizon 3 Motor + Identity maturity

- Motor v2: Fitts-law `fittsDuration` / `fittsID`, `readingPause`, mousePath uses targetWidth for MT
- `humanClick` optional label → reading pause before move
- Origin-partitioned profiles: `resolveOriginProfile`, `sanitizeOriginHost`, `listOriginProfiles`
  - `XCLAW_BROWSER_PROFILE_MODE=origin|shared`
  - `XCLAW_BROWSER_ORIGIN_ROOT` override
- NSS CA trust: dual import (profile DB + nssdb/), explicit trustOrder fallback chain
- Tests: `test/browser-horizon3.test.mjs`

## 3.46.0 — Horizon 2 Truth control plane

- `src/browser/truth.mjs` — policy DSL load/save/match/evaluate, require-rules, proof export
- `confdir/policy.json` merged into mitmproxy block/map (addons.py)
- Agent tools: `mitm_policy`, `mitm_export`
- Agent loop: `XCLAW_TRUTH_AUTO_ASSERT=1` runs require-rules after browser_* tools
- Proof bundle: redacted flows + bindings + policy summary + sha256
- Docs: policy DSL in MITM_SCRIPTING.md
- Tests: `test/browser-truth.test.mjs`

## 3.45.0 — Horizon 1 Fusion Sense

Structure-first observation + action↔network causal binding:

- `src/browser/sense.mjs` — actionId, network cursor/delta, bindActionFlows, assertOutcome, STRUCTURE_SNAPSHOT_JS
- `browser_observe` — primary sense tool (structure, not pixels)
- `browser_snapshot` — a11y-oriented interactive tree + network delta footer
- `browser_assert` — outcome assertions against MITM flows / action bindings
- `withNetworkBinding()` — wrap any tool execute with actionId + flow delta
- Bindings persisted to `action-bindings.jsonl` under MITM confdir
- Tests: `test/browser-sense.test.mjs`

## 3.44.0 — Horizon 0 production foundations

First-principles hardening of the browser organism (identity, CDP, MITM, motor readiness):

- `src/browser/horizon0.mjs` — production Chrome arg builder, profile lock, flow rotation, checklist
- BrowserService: `--remote-allow-origins=*`, `--disable-dev-shm-usage`, headed window geometry, UA override
- Fix Docker flag bug (`--no-sandbox --disable-gpu` was a single invalid argv entry)
- Durable profile exclusive lock + reclaim stale PID; release on stop/exit
- CDP port acquire timeout (`XCLAW_BROWSER_PORT_TIMEOUT_MS`, default 30s)
- MITM: rotate `flows.jsonl` at start + supervisor tick; recover dead mitmdump
- Supervisor logs Horizon 0 checklist on boot
- Doctor: `h0.*` checks + production flag verification
- Tests: `test/browser-horizon0.test.mjs`

## 3.43.0 — Mitmproxy CA certificate management

- `getMitmCaInfo` / `ensureMitmCa` / `exportMitmCa` / `mitmCaStatus`
- Agent tool `mitm_ca`: status | ensure | export | trust
- Supervisor runs `ensureMitmCa` before wait-ready (SPKI on first Chrome start)
- Doctor reports CA subject / expiry / SPKI prefix
- Export writes PEM + P12 + `.spki` sidecar + chrome flag

## 3.42.3 — MITM integration hardening

- `findMitmdump` searches `~/.local/bin` even when PATH is minimal
- `mitmEnvFromConfig()` + inject into computer spawn and supervisor gateway env
- `waitForMitmReady()` — supervisor waits for listen + CA + ready before continuing
- `XCLAW_CHROME_MITM_ARGS` honored by BrowserService (bundle)
- Doctor: `mitm.binary` / `mitm.proxy` / `mitm.ca`
- INSTALL + OPS startup order; Dockerfile optional mitmproxy hint

## 3.42.2 — Addon hooks expansion

- `requestheaders` early block (before body)
- `responseheaders` optional Set-Cookie strip (`XCLAW_MITM_STRIP_COOKIES`)
- `error` + `tls_failed_client` / `tls_failed_server` → flows + stats.json
- `running` writes `confdir/ready` for supervisor probe
- `mitm_status` surfaces ready / errors / blocked / tlsFail*

## 3.42.1 — Mitmproxy scripting surface

- Expanded `addons.py`: block / path-map / body capture / host dumps / WS echo
- Env: `XCLAW_MITM_BLOCK`, `XCLAW_MITM_MAP`, `XCLAW_MITM_CAPTURE_BODY`, `XCLAW_MITM_BODY_MAX`, `XCLAW_MITM_DUMP_HOSTS`
- Docs: `docs/MITM_SCRIPTING.md`
- Example: `src/browser/mitm-confdir/examples/inject_header.py`

## 3.42.0 — M3 MITM agent tools

- `mitm_status` — enabled / running / port / CA / flowCount
- `mitm_flows` — filtered list (host, method, status, urlContains, sinceTs)
- `mitm_clear_flows` — truncate flows.jsonl
- `mitm_control` — start | stop | status sidecar
- `readMitmFlows` filters + `mitmStatus` / `clearMitmFlows` / `formatMitmFlows`
- Registered via `createBrowserTools` → agent local tools
- Tests: 22/22

## 3.41.0 — M2 Chrome proxy + CA trust

- `chromeMitmArgs()` / `findMitmCaCert()` / `mitmCaSpkiHash()` / `trustMitmCaInProfile()`
- `BrowserService.ensureRunning`: when `XCLAW_MITM` on → `--proxy-server` + `--proxy-bypass-list=<-loopback>`
- Prefer `--ignore-certificate-errors-spki-list=<SPKI>` from mitmproxy CA (openssl)
- Optional `certutil` import into profile NSS DB
- Lab escape: `XCLAW_MITM_INSECURE_CERTS=1` → `--ignore-certificate-errors`
- Runtime CDP `Security.setIgnoreCertificateErrors(true)` after connect
- Tests: 19/19 in `test/browser-mitm.test.mjs`

## 3.40.0 — M1 MITM sidecar (opt-in)

- Feature gate: `XCLAW_MITM=true` or `browser.mitm.enabled` (default **off**)
- `src/browser/mitm.mjs` — start/stop mitmdump, confdir, pid, flow log
- Package confdir + `addons.py` (redacts secrets, allowlist, flows.jsonl)
- Supervisor: `ensureMitm()` on boot + each tick
- `chromeProxyArgs()` ready for M2 (`--proxy-server=http://127.0.0.1:4444`)
- Env: `XCLAW_MITM`, `XCLAW_MITM_PORT`, `XCLAW_MITM_CONFDIR`, `XCLAW_MITMDUMP`, `XCLAW_MITM_ALLOWLIST`, `XCLAW_MITM_SSL_VERIFY`
- Tests: `test/browser-mitm.test.mjs` (14/14)

## 3.39.0 — B0 Human-like browser (1 year ahead)

- Durable Chromium profile vault (`XCLAW_BROWSER_PROFILE_DIR`, default `~/.xclaw/browser-profiles/default`)
- Headed mode via `XCLAW_BROWSER_HEADED=1` (visible window, human presence)
- `src/browser/humanize.mjs` — Gaussian delays, cubic-bezier mouse paths, typing cadence, scroll momentum
- `src/browser/profile.mjs` — resolve/seed/lock durable profiles
- `ensureRunning` respects profile vault; `stop` never wipes durable data
- Config: `browser.profileDir`, `browser.headless`, `browser.humanize`, `browser.humanizeSpeed`, `browser.copySession`
- Env: `XCLAW_BROWSER_PROFILE_DIR`, `XCLAW_BROWSER_HEADED`, `XCLAW_BROWSER_HUMANIZE`, `XCLAW_BROWSER_HUMANIZE_SPEED`, `XCLAW_BROWSER_COPY_SESSION`

## 3.38.0 — Suggestions / toolTrace / WebChat surfaces

- Normalized `toolTrace` (status, outcome, artifacts) + family outcome parsers
- Schema-native suggestion chips, closure suppress, durable feedback bias
- Commit chip when closed + git dirty (`closedAllowCommitChip: "auto"`)
- Turn goal/progress state + blocked/approval UX
- WebChat ↳ chips + feedback API
- Doctor + Prometheus agent/suggestion metrics
- Grafana dashboard: `deploy/grafana/xclaw-agent-suggestions-dashboard.json`
- E2E: `test/suggestions-e2e.test.mjs`

## 3.37.0 — Stream resume, CLI run, metrics

Durable SSE/NDJSON streaming with Last-Event-ID resume for agent, swarm, and webchat.

### Protocol
- Dual transport: `Accept: text/event-stream` or `application/x-ndjson`
- Heartbeat pings (configurable `stream.heartbeatMs`)
- Resume modes: `new` · `resume-live` · `replay-only` · `missing`
- Ring buffer per `streamId` (`stream.capacity`, `stream.ttlMs`)

### Endpoints
- `POST /agent/run/stream`
- `POST /swarm/run/stream`
- `POST /channel/webchat/message/stream`

### Client & CLI
- `src/client/stream-resume-client.mjs` — learn `streamId`/`lastEventId`, dedupe, outer resume
- `xclaw run [--ndjson] [--resume <id>] [--last-event-id <id>]`
- `xclaw agent --stream …` routes to the same path
- Exit codes: 0 success · 2 not-found/expired · 3 auth · 4 forbidden · 5 bad request · 6 max cycles · 7 transient · 130 aborted
- `--json-error` machine-readable failure payload + hints
- Backoff: `--backoff full|equal|decorrelated|none` (config `stream.backoff`)

### Observability
- Telemetry: `recordStreamError` / `recordResumeEvent` (no high-cardinality labels)
- Prometheus: `xclaw_stream_errors_*`, `xclaw_stream_resume_events_*`, `xclaw_stream_logs`
- Grafana: `deploy/grafana/xclaw-stream-dashboard.json` + recording rules
- Docs: `docs/stream-config.md`, `docs/cli-run-exit-codes.md`, `docs/backoff-strategies.md`, `docs/error-handling-stream.md`

### Config (`xclaw.json` / env)
```json
"stream": {
  "capacity": 500,
  "ttlMs": 300000,
  "heartbeatMs": 15000,
  "backoff": "full",
  "baseMs": 1000,
  "maxMs": 30000,
  "maxResumeCycles": 5
}
```
Env: `XCLAW_STREAM_CAPACITY`, `XCLAW_STREAM_TTL_MS`, `XCLAW_STREAM_HEARTBEAT_MS`, `XCLAW_STREAM_BACKOFF`, …

### Scripts
- `scripts/xclaw-run-lib.sh` — classify / should_retry / should_fresh
- `scripts/xclaw-run-with-retry.sh` — retry exit 7 with jitter strategies

### Tests
- `test/stream-resume*.test.mjs`, `stream-writer`, `stream-reconnector`, `stream-telemetry`, `prometheus-stream-metrics`, `stream-run-cli`, `stream-config`, e2e resume

## 3.31.0

- X1 admission control: maxDepth, maxWaitMs, concurrency, QED staffing
- GET /queue/admission
- D3 control swarm UI, SSE reconnect, backoff/IMM utilities (3.27–3.30)

## 3.11.0 — Three Grok auth modes

- 1) API key  2) OAuth/CLI  3) Web login (grok.com session import)
- xclaw auth login --method api|oauth|web
- xclaw auth web-import --cookie|--file|--token
- docs/AUTH_THREE_WAYS.md

## 3.10.0 — Sign in with Grok / xAI (OAuth Option B)

- xclaw auth login | logout | status | import-grok
- Device code, PKCE, import ~/.grok/auth.json, API key fallback
- src/auth/xai-oauth.mjs · docs/AUTH_XAI_OAUTH.md

## 3.9.0 — Live Voice Agent (Personal Assistant)

- Presets: Customer Support, Sales, Scheduler, Personal Assistant, Lead Qualification
- Personal Assistant: full host control (bash/files/browser/swarm) during live talk
- Speak-while-tools + barge-in mutes speech only
- docs/VOICE_AGENT_PERSONAL_ASSISTANT.md

## 3.8.0 — Mandatory XClaw commit signature

- Default commitAfterMerge: true
- prepare-commit-msg hook on worktree/merge
- Always: Generated with [XClaw] + Co-Authored-By: XClaw <noreply@xclaw.local>
- docs/XCLAW_COMMIT_SIGNATURE.md

## 3.7.9 — XClaw commit trailers

- Generated with [XClaw](https://x.ai/)
- Co-Authored-By: XClaw <noreply@xclaw.local>
- src/git/commit-trailers.mjs

## 3.7.8 — Vote tie-breaking + ship

- Strategies: none, first, last, lexical, confidence, prefer, random
- Role weights + ballot confidence field
- Default voteTieBreak: confidence
- Vote soak: scripts/soak-vote.mjs, docs/VOTE_SOAK.md
- docs/SHIP_3.7.8.md

## 3.7.7 — Structured majority voting

- swarm-vote: extract JSON ballots, tally fields, minority report
- Join summary includes consensus section
- Research role prompt asks for flat JSON ballot
- Config: voteEnabled, voteMinBallots, voteMinShare, voteFields
- test/swarm-vote.test.mjs

## 3.7.6 — Git remotes, credentials, SSH CA + ship

- validateGitRemoteUrl / listAndValidateRemotes
- git credential fill/approve/reject integration
- Env: XCLAW_GIT_TOKEN / GITHUB_TOKEN headless fill
- SSH CA helpers: inspect/sign/snippets (src/git/ssh-ca.mjs)
- REPO_MISSING handling on merge approve
- merge doctor diagnostics
- Doctor: git.remotes + git.credential + ssh.certs
- docs/GIT_CREDENTIAL.md, docs/SSH_CA.md, docs/SHIP_3.7.6.md

## 3.7.5 — S5 swarm/merge CLI

- `xclaw swarm status|show|policy`
- `xclaw merge list|show|approve|reject`
- Prefix id match, ASCII graph on show, --json
- docs/S5_CLI.md

## 3.7.4 — S4 merge governance + swarm arc close

- mergeRequireCleanMain — block when main worktree or index dirty
- mergeUseIndex — git apply --index / --check --index
- inspectRepoCleanliness helper
- Doctor: swarm.merge policy + pending proposals
- S1 mock spawnSubagent runtime fan-out tests
- docs/S4_MERGE_GOVERNANCE.md, docs/SHIP_3.7.4.md
- Swarm arc S0–S4 closed for release

## 3.7.3 — S3 safe worktree merge

- planAndMaybeMerge: gates → git apply --check → auto or pending_approval
- Durable merge proposals under ~/.xclaw/swarms/merge-proposals/
- Tools: xclaw_swarm_merge_approve | reject | status
- swarm.autoMerge default false (prod-safe)
- docs/S3_SAFE_MERGE.md

## 3.7.2 — S2 task graph (dependsOn)

- DAG tasks with `id` + `dependsOn`
- Topological wave scheduler (reuses graph-viz waves)
- Upstream result handoff into child prompts
- onDepFail: skip-downstream | fail-fast | best-effort
- Join summary includes ASCII wave diagram
- SwarmRun persists graph + ascii/mermaid/dot
- S1 flat tasks remain compatible
- docs/S2_TASK_GRAPH.md

## 3.7.1 — S1 swarm fan-out

- `xclaw_swarm_run` tool — parallel subagents + join summary
- Roles: research / implement / verify / critic
- Caps: maxParallel, maxChildrenPerRun
- SwarmRun records results + summary on disk
- docs/S1_SWARM_FANOUT.md

## 3.7.0 — R6 install + S0 swarm foundations

### R6
- install/install.sh + install.ps1
- INSTALL.md quick path + proof checklist

### S0
- ~/.xclaw/swarms/{agents,runs} durable store
- spawnSubagent timeout (default 5m) + persist snapshots
- configureSubagentPersistence on gateway start
- Metrics xclaw_subagents_*
- Doctor swarm.agents / persisted / runs

## 3.6.4 — R5 learning light

- proposeSkillFromSuccess (review-only drafts)
- Preference extract + ~/.xclaw/memory/preferences.md write-back
- Job pass hooks proposeOnSuccess + preferences
- Doctor: skills.proposals, memory.preferences

## 3.6.3 — R4 proactive heartbeat

- autonomy.heartbeat everyMs job via cron scheduler
- quietHours + maxUsdPerDay guards
- Optional channel delivery when result is not HEARTBEAT_OK
- Doctor autonomy.heartbeat status
- Gateway starts ensureHeartbeat when enabled

## 3.6.2 — R3 owner safety

- /link issue+redeem DM-only (status/help allowed in groups)
- isDm on normalizeInbound + channel fixtures
- Doctor: prod requires gateway token; allowlist hints; linkDmOnly
- First-run tip on new xclaw.json
- security.linkDmOnly default true

## 3.6.1 — R2 unified inbound path

- Live Slack / Telegram / Discord / Email use processInbound
- Shared commands + rate limit + replyWithAgent path
- R1 channel health watchdog retained

## 3.6.0 — R1 always-on reliability

- Channel health watchdog (restart dead enabled channels)
- Channel status: running, loopAlive, lastError, lastOkAt
- Manager restartChannel / get
- Doctor: channels.health + computer.watchdog
- scripts/soak-r1.mjs
- Telegram poll jittered backoff on errors

## 3.5.3 — Profile precedence fix

- Profile name: XCLAW_PROFILE env → user.profile → DEFAULT lab
- Env profile re-applies pack then re-merges user (no label-only lie)
- Doctor: profile.mismatch when prod+autoApprove or lab/dev+!autoApprove

## 3.5.2 — Low-setup P0 fixes

- Default profile **lab** (auto-approve tools)
- dev profile also auto-approve (no bot hang)
- readiness.requireComputer **false** by default
- Email channel passes userId/channel for vault linking
- INSTALL.md minimal setup for v3.5.x

## 3.5.1 — Doctor account checks

- accounts / accounts.<id> / accounts.pairing / accounts.vault.*
- Orphan links, empty accounts, legacy bare vault ids, migrate hints

## 3.5.0 — Multi-channel runtime (CL)

- src/channels/runtime.mjs — normalizeInbound + processInbound
- Fixtures: Telegram, Slack (message/app_mention), Discord, Email, WebChat
- Shared path: commands → rate limit → replyWithAgent
- Tests: channel-runtime-multi, agent-loop-mock (vault identity)

## 3.4.2 — Account linking L3 vault merge

- vaultMergeIntoAccount on linkIdentities
- Per-app last-write-wins by updatedAt
- Source vault dirs renamed to *.bak-<ts>
- CLI: xclaw auth accounts migrate <accountId>

## 3.4.1 — Account linking L2 pairing codes

- createPairingCode / consumePairingCode (single-use, TTL)
- Channel commands: /link, /link CODE, /link status, /unlink
- userId passed from Slack/Telegram/Discord/WebChat into commands

## 3.4.0 — Account linking L1

- normalizeChannelUserId (`channel:nativeId`)
- ~/.xclaw/accounts/links.json store
- link / unlink / list / create CLI
- replyWithAgent resolves vault user via linked account
- Discord userId wired into replyWithAgent

## 3.3.3 — Grafana dashboard + Slack app_mention + vault userId + alerts

- deploy/grafana/xclaw-dashboard.json
- deploy/grafana/xclaw-alerts.yaml + xclaw-alert-rules.json
- Slack Socket Mode handles **app_mention**
- Channel userId → AsyncLocalStorage → vaultResolveToken (Slack/Telegram/Discord)
- docs updates

- deploy/grafana/xclaw-dashboard.json (Gateway + Slack WS latency)
- deploy/grafana/README.md import + scrape notes

## 3.3.0 — P6 ops scale

- Multi-user token vault (`~/.xclaw/vault/<user>/`)
- Slack Socket Mode restored + reconnect backoff
- GitHub Actions: `.github/workflows/eval-regression.yml`
- `npm run docker:publish` / `docker:push`
- docs/PHASE_P6.md

## 3.2.0 — P5 OAuth ops

- Proactive connected token refresh scheduler
- `auth connected logout`
- Doctor checks for expiring/invalidated tokens
- Gateway `/oauth/callback` exchange
- AES-256-GCM token store (`XCLAW_TOKEN_STORE_KEY`)
- Mock provider refresh tests

## 3.1.4 — OAuth retry logic

- withOAuthRetry + isOAuthRetryable (decorrelated jitter default)
- Retries token exchange + refresh on network/429/5xx
- Honors Retry-After; never retries reauth errors
- docs/OAUTH_RETRY.md

## 3.1.3 — OAuth error handling details

- src/auth/oauth-errors.mjs: stable codes, hints, reauth/retryable flags
- Wired into oauth-browser + token-refresh
- docs/OAUTH_ERROR_HANDLING.md

## 3.1.2 — Token refresh logic

- ensureFreshToken with 5m expiry skew
- Single-flight refresh lock per app
- Refresh-token rotation + invalid_grant invalidation
- resolveToken auto-refresh; github_request 401 retry
- docs/TOKEN_REFRESH.md

## 3.1.1 — OAuth browser login (connected apps)

- PKCE helpers + generic loopback OAuth (`src/auth/oauth-browser.mjs`)
- Connected providers: GitHub, Google
- CLI: `xclaw auth connected login|refresh|status|list`
- Shorthand: `xclaw auth login --connected github`
- Tokens → `~/.xclaw/connected-tokens.json`
- docs/OAUTH_BROWSER.md

## 3.1.0 — P4 production publish

- Gateway authStrict + optional TLS (`XCLAW_GATEWAY_TOKEN`, `XCLAW_TLS_*`)
- Slack Socket Mode (`appToken` / `SLACK_APP_TOKEN`)
- Imagine model matrix (`src/media/imagine-models.mjs`)
- `npm run eval:regression`
- Dockerfile + docs/PUBLISH.md + docs/PHASES_P0_P4.md
- Release: XCLAW_RELEASE_v3.1.0.zip

## 3.0.0 — P3 platform

- Connected catalog: voice, github, generic_http + token store
- Neural TTS (API → espeak/piper)
- x_semantic_search, artifacts UI, browser_clipboard/pdf
- Persistence docs + watchdog

## 2.9.0 — P2 channels

- Slack poll channel, Email IMAP/SMTP, Discord attachments
- pptx template pack, Office script helpers

## 2.8.0 — P1 media

- view_x_video, stronger search_images, generate/edit_image, vision defaults

## 2.7.0 — P0 foundation

- Office skill trees, browser_screenshot/snapshot, Telegram media, LO profile isolation + UNO optional

## 2.6.0 — Full tool parity push

- Media: ocr, office_convert, view_image, search_images, generate_image, edit_image
- Finance: finance_quote (Polygon/CoinGecko)
- X: x_keyword_search, x_user_search, x_thread_fetch
- Connected: search_connected_tools, call_connected_tool (voice)
- Unified src/tools/registry.mjs
- docs/FULL_TOOL_SURFACE.md

## 2.5.10 — Extra tools (glob, grep, web_fetch, web_search)

- Agent tools: `glob`, `grep`, `web_fetch`, `web_search` (UI parity)
- Wired into agent loop list + execute
- Marked safeAuto (no approval under risky)
- Config merge fix: user security wins over profile
- docs/EXTRA_TOOLS.md, docs/APPROVALS.md

## 2.5.9 — Live model discovery

- Disk-cached live discovery (`~/.xclaw/cache/models/`, 1h TTL)
- Adapters: OpenAI-compat, xAI language-models, Anthropic, Gemini
- Chat filter by default; `--all` for full list
- CLI: `models list --live|--force|--all`, `models refresh`, `models cache-clear`
- docs/MODEL_DISCOVERY.md

## 2.5.8 — Latest model IDs (Aug 2026)

- OpenAI: GPT-5.6 Sol/Terra/Luna, 5.5, 5.4 family, o3/o4-mini, Codex
- Anthropic: Claude Fable 5, Opus/Sonnet 5, Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5
- Google: Gemini 3.6/3.5 Flash, 3.1 Pro, 2.5 family
- xAI: Grok 4.5 default + full 4.20 / Build line
- Defaults: xai→grok-4.5, openai→gpt-5.4, anthropic→claude-sonnet-5, google→gemini-3.6-flash

## 2.5.7 — Full provider model catalogs

- Expanded static catalogs: xai, openai, anthropic, google, deepseek, groq, mistral, together, ollama, openrouter
- Multiple models per provider (OpenClaw-style shipped catalog)
- `xclaw models list --live` merges GET /models discovery when API key present
- docs/PROVIDERS.md updated

## 2.5.6 — Phase 5 ops freeze gate

- `scripts/release-gate.mjs` — unit tests, security-audit, sandbox-redteam, fire-drill, evidence
- `npm run release-gate` / `release-gate:quick` / `release-gate:strict`
- `xclaw release-gate`
- docs/PHASE_5.md

## 2.5.5 — Phase 4 OAuth policy

- Explicit per-provider auth policy (API key first)
- xAI OAuth only with client id; clear errors pointing at console.x.ai
- Optional OpenAI Codex PKCE (`XCLAW_OPENAI_OAUTH_CLIENT_ID`)
- `xclaw models auth policy`
- docs/OAUTH.md

## 2.5.4 — Phase 3 seats

- Per-peer daily USD + token caps (`seats.enabled`)
- Job preflight hard deny + post-job ledger
- CLI `xclaw seats status|check|reset|pause`
- Channel `/seat` · `GET /seats`
- docs/SEATS.md — API credits ≠ Grok subscription seats

## 2.5.3 — Phase 2 provider registry

- Provider registry: xai, openai, anthropic, openrouter, compatible + custom `models.providers`
- Model refs `provider/model`; `xclaw models list|providers|route`
- Minimal `xclaw onboard --auth-choice xai-api-key|custom-api-key`
- docs/PROVIDERS.md

## 2.5.2 — Phase 1 auth profiles

- OpenClaw-style `auth-profiles.json` per agent under `~/.xclaw/agents/<id>/`
- Modes: `api_key`, `token`, `oauth` with ordered resolve + file-locked refresh
- CLI: `xclaw models status` · `xclaw models auth login|list|order|logout|resolve`
- `loadConfig` resolves token via profile chain before legacy credentials

## 2.5.1 — xAI auth

- **`xclaw auth login --api-key`** stores key in `~/.xclaw/credentials.json` (0600)
- **`xclaw auth login --oauth`** PKCE scaffold (requires `XCLAW_XAI_OAUTH_CLIENT_ID`)
- Token resolution: config → env → credentials → Grok CLI session
- docs/AUTH.md

## 2.5.0 — Phase S (LTS freeze)

- **Security audit**: `xclaw security-audit`, `GET /security/audit`, doctor integration
- **docs/SECURITY.md** deploy checklist
- **docs/LTS.md** — bugfix / soak-gated features for 2.5.x

## 2.4.0 — Phase R

- **Cost governor dashboard**: Control UI bar + pause/resume
- **WebChat checkpoints**: sidebar list + Resume
- **Provider pack**: xai / openai / openrouter / compatible (`XCLAW_PROVIDER`)
- **Multi-workspace isolation** helpers + tests

## 2.3.0 — Phase Q (production proof tooling)

- **7-day soak**: `SOAK_NIGHTS=7 SOAK_MIN_NIGHTS=7 npm run soak:nights` / `npm run soak:7`
- **Fire-drill**: `xclaw fire-drill` — computer_down, cost_hard, recover, alerter ping
- **Computer auth proxy**: `xclaw computer-proxy` verifies token before upstream
- **Sandbox red team**: deterministic `npm run sandbox-redteam` (no model)

## 2.2.0 — Phase P

- **SLO auto-alerts**: monitor interval + `xclaw slo-check` / `POST /slo/check`
- **WebChat command parity**: /job /queue /approve /resume /help
- **Flake quarantine**: auto-tag; excluded from releaseGate; `xclaw quarantine`
- **docs/RUNBOOK.md** operator runbook 2.0

## 2.1.0 — Phase O

- **Computer auth**: Bearer/`XCLAW_COMPUTER_TOKEN` + optional HMAC; client sends headers
- **Sandbox red team** case `sandbox-escape-denied`
- **Queue load**: `npm run queue:load` (interactive before batch + aging)

## 2.0.0 — Phase N (evidence cut)

- **Multi-night soak**: `npm run soak:nights` (live + 3-night ledger stamp)
- **Skill A/B case**: `skill-ab-trap` for measured learning loop
- **Strict evidence**: `REQUIRE_SOAK=1 npm run evidence` requires nightsOk
- Semver **2.0** — architecture complete; releases gated on scoreboard + soak

## 1.9.0 — Phase M

- **Queue priority classes**: interactive/batch/cron + aging anti-starvation
- **Approval digests**: `xclaw digest`, `POST /security/digest`, optional interval
- **Sandbox**: path escape deny + read-only; tool guard in agent loop
- **SLOs**: `xclaw slo`, `GET /slo` (job wall p99, computer, approvals)
- **eval:ci** runs computer-contract tests first

## 1.8.0 — Phase L

- **Skill A/B harness**: `xclaw skill-ab --id|--tag`, auto propose+install on fail, re-eval, metrics
- **Structured claims default** on tags campaign/long/campaign-v2 via `jobs.structuredClaimsOnTags`
- Prod profile enables groundHard + claimsRequireEvidence

## 1.7.0 — Phase K (evidence)

- **Campaign stress v2**: chaos (decoys), api health, migrate (+ prior campaign cases)
- **Soak ledger**: `npm run soak`, flake jsonl, summary gate (3 nights)
- **Evidence release**: `npm run evidence` → `eval/baselines/evidence-v*.json`

## 1.6.0 — Phase J (reliability)

- **Cost governor**: daily soft/hard USD caps; queue pause on hard; `xclaw cost`
- **Channel hardening**: `allowedCommands`, per-chat `workspaceByChatId`
- **Computer contract tests**: health API shape without Chromium
- Reliability freeze notes in docs/PHASE_J.md

## 1.5.0 — Phase I

- **Checkpoint UI**: Control UI list + one-click resume; `GET/POST /checkpoints`
- **Approval SLA**: age/remaining on pending; auto-deny/approve after `approvalSlaMs`
- **Worktree merge**: `xclaw merge <subagentId>`, `POST /subagents/merge`

## 1.4.0 — Phase H

- **Campaign eval**: `--tag campaign` + `npm run eval:campaign`
- **Structured claims**: JSON `claims` + `evidence_ids` block; requireStructuredClaims
- **Skill loop metrics**: `xclaw skill-loop`, scoreboard.skillLoop.helpRate

## 1.3.0 — Phase G

- **Channel job mode**: `/job` `/queue` `/approve` `/pending` `/resume` on Telegram & Discord
- **Checkpoints**: auto-save; `xclaw resume <id>`; recovery classify + replay
- **Prod policy matrix**: safe / write / exec / network
- **Remote computer**: `XCLAW_COMPUTER_URL` + `deploy/docker-compose.sidecar.yml`

## 1.2.0 — Phase F

- **Skill promotion**: job fail → proposal; `xclaw skills proposals|install|reject`
- **Git worktree subagents**: `worktree: true` + merge diff report
- **Context pressure meter**: adaptive eviction tweaks (events: `cache.pressure`)

## 1.1.0 — Phase E

- **Long-horizon eval pack** (`--tag long`): app fix, docs set, ETL, grounded report
- **Claim–evidence scorer v2**: citations `[ev:id]` / `(tool:name)`; orphan claim detection
- **Autonomy scoreboard**: `GET /eval/scoreboard`, `xclaw scoreboard`, Control UI

## 1.0.0 — Phase D

- **1.0 API freeze** (`GET /routes`, ops probes stable)
- **Docker** + **docker-compose** + **systemd** unit + **logrotate**
- Gateway token protects jobs/queue/agent; optional `/metrics` protection
- Secrets-via-env only for production (`deploy/env.example`)
- README golden path · `docs/RELEASE_1.0.md`

## 0.12.0 — Phase C

### Approvals
- `approvalPolicy`: always | risky | never
- `safeAuto` tools never need approval under risky
- Control UI Approvals card + `/security/policy`

### Durable memory
- `~/.xclaw/memory/<hash>/` events + MEMORY.md
- Jobs auto-remember; agent loads durable memory into context
- `GET /memory?workspace=`

### Subagents
- `isolate: true` → temp workspace
- Returns toolTrace + workspace for parent merge

## 0.11.0 — Phase B

### Hard eval pack
- Cases: hard-fix-sum, hard-pipeline-merge, hard-config-toggle, hard-todo-complete, hard-ground-no-invent
- Tag: `hard`

### Grounding hard mode
- Stronger claim detection; `groundHard` fails job on ungrounded action/content claims
- Eval: `replyContains` / `replyNotContains` / `requireEvidence`

### Tool result discipline
- Per-tool truncation budgets (bash / browser / file_read / file_write)

## 0.10.0 — Phase A

### Computer reliability
- Supervised computer: **PID file**, **log file**, **meta**, stale-pid cleanup
- CLI: `xclaw computer status|stop|restart|log|start [--bg]`
- Longer start timeout (45s); stop kills by PID file

### Eval CI gate
- `npm run eval:ci` — wait-ready → tag suite → baseline regress
- `eval:suite` appends `eval/baselines/trend.jsonl`

## 0.9.10

- Watchdog **restart backoff** (`minRestartIntervalMs` default 60s)
- **Circuit open** after `maxConsecutiveFails` (default 5)

## 0.9.9

- Watchdog **restartCount**, **lastRestartAt**, **lastCheckAt**, **lastError**
- Prometheus `xclaw_computer_watchdog_restarts`

## 0.9.8

- Watchdog visible in **doctor**, **dashboard**, and **Prometheus** (`xclaw_computer_watchdog_active`)
- ensureComputer normalizes bind-any hosts for URL reporting

## 0.9.7

- **Computer watchdog**: periodic health check + auto-restart (default 30s)
- Config `computer.watchdog.enabled` / `intervalMs`

## 0.9.6

- Hardened computer health probe (0.0.0.0→127.0.0.1, accept ok/healthy shapes)

## 0.9.5

- **`npm run dev-up`**: start gateway (background) + wait-ready

## 0.9.4

- eval-suite / eval-ci wait for readiness before live runs
- INSTALL.md scripted live-run notes

## 0.9.3

- **`xclaw wait-ready`**: poll readiness; auto `ensureComputer` unless `--no-start`
- Flags: `--timeout 60000` `--interval 1000`

## 0.9.2

- **`xclaw info`**: version + profile + ready + queue one-liner (exit 1 if not ready)

## 0.9.1

- **Route map**: `GET /routes`, `xclaw routes`, docs/API.md

## 0.9.0

- **GET /version** + `xclaw version` (version, profile, uptime)
- Uptime in dashboard + Prometheus `xclaw_uptime_seconds`

## 0.8.9

- **Soft config reload**: SIGHUP or `POST /config/reload` (safe keys only; no port rebind)

## 0.8.8

- **Graceful shutdown**: pause queue, drain running jobs (up to shutdown.drainMs), then stop computer

## 0.8.7

- **Prometheus metrics**: `GET /metrics` (queue, computer, eval spend)

## 0.8.6

- **Readiness probe**: `GET /ready`, `xclaw ready` (computer + queue depth)
- Config `readiness.requireComputer` / `maxQueued`

## 0.8.5

- `xclaw report --out <file>`
- Eval cron appends status report to log
- docs/REPORT.md

## 0.8.4

- **Markdown status report**: `xclaw report`, `GET /report`
- Dashboard version from package.json

## 0.8.3

- **Dashboard** snapshot: `GET /dashboard`, `xclaw dashboard`, Control UI
- Aggregates computer, queue, eval spend/cron, profile

## 0.8.2

- Queue **stats** + **dead letter** list (CLI/API)
- docs/QUEUE.md

## 0.8.1

- Queue **retry failed** + per-item **maxAttempts** / **timeoutMs**
- Auto-requeue on failure until maxAttempts

## 0.8.0

- Queue **cancel** item + **clear** completed (CLI, API, Control UI)
- `POST /queue/:id/cancel`, `POST /queue/clear`

## 0.7.9

- Queue **pause/resume** (CLI, API, Control UI)
- Doctor reports **eval.spend** when caps configured

## 0.7.8

- **Batch queue**: `xclaw queue batch <file.json|jsonl>`
- **Spend thresholds**: `eval.spend.maxUsdPerWindow` + `xclaw eval-spend check`
- Scheduled eval runs spend check after suite

## 0.7.7

- **Eval spend rollup**: `GET /eval/spend`, `xclaw eval-spend`, Control UI Spend
- Aggregates costUsd / tokens across eval history

## 0.7.6

- Eval **estimated USD cost** on reports + history (`costUsd`)
- Longer model-key match for rate table (gpt-4o-mini vs gpt-4o)

## 0.7.5

- Queue **concurrency** config (1–3, default 1); `GET /queue` returns worker status
- Eval **stress-weekly-report** (CSV totals + best day) — live PASS
- Baseline **10/10** on grok-4.3

## 0.7.4

- Deploy **profiles**: dev / lab / prod (`XCLAW_PROFILE`, `xclaw profile list|show`)
- Eval case **project-add-multiply** (extend JS lib + tests) — live PASS
- Baseline **9/9** on grok-4.3

# Changelog

## 3.75.0 — Verify pass (strong model on final answer)

- `src/providers/verify-pass.mjs` — VERIFY_OK / VERIFY_REVISE protocol
- Agent loop runs verify when `router.roles.verify` is set and final text has no tools
- Soft mode: emit `verify_suggest`; hard mode: `rolePolicy.verifyReplace: true`
- Tests: `test/verify-pass.test.mjs`

## 3.74.0 — Native computer default + session API

- Default `computer.engine: "native"` (thin server, not 16MB bundle)
- `src/computer/engine.mjs` — resolveComputerEngine / isNativeComputer
- Thin server implements `/xclaw/sessions/*` for computer-client compatibility
- Bundle via `computer.engine: "bundle"` or `XCLAW_COMPUTER_NATIVE=0`
- Tests: `test/computer-engine.test.mjs`

## 3.73.0 — Role routing (draft / act / verify)

- `src/providers/role-router.mjs` — role map, policy, role-aware provider facade
- Agent loop: optional multi-model by turn (draft first, then act)
- Config: `router.roles`, `router.rolePolicy`, `XCLAW_ROLE_DRAFT` / `_ACT` / `_VERIFY`
- Events: `router` phase `role` | `roles_ready` | `role_failover`
- Tests: `test/role-router.test.mjs`

## 3.72.0 — Multi-provider failover router

- `src/providers/failover-router.mjs` — model chain, shouldFailover, createFailoverProvider
- Agent loop uses failover by default (`router.enabled !== false`)
- Config: `agent.fallbackModels`, `router.chain`, `router.roles`, `XCLAW_FALLBACK_MODELS`
- Failover on 429/5xx/transient/auth; skip permanent 4xx
- Events: `router` phase chain|failover|skip|ready
- Tests: `test/failover-router.test.mjs`

## 3.71.0 — P0 thin computer server + clean browser_tab

- `modules/browser-tab-tool.mjs` — lightweight fetch-based tab (CDP upgrade path)
- `thin-server.mjs` — `/health` `/tools` `/call` `/extraction` without 16MB bundle
- `manager.startComputer` uses thin server when `XCLAW_COMPUTER_NATIVE=1` or `computer.nativeServer`
- Native pack includes browser_tab

## 3.70.0 — P0 computer extraction (clean native tools)

- CLEAN modules: `modules/bash-tool.mjs`, `modules/file-tools.mjs` (no bundle scope)
- `native-tools.mjs` registry + `executeNativeTool`
- `extraction-status.mjs` + `scripts/check-extraction.mjs`
- MODULE_MAP updated with cleanStandaloneTools
- Tests: `test/native-tools.test.mjs`
- Next: browser_tab clean module + thin HTTP router over native pack

## 3.69.0 — xclaw_recall durable memory retrieval

- `src/memory/recall.mjs` — keyword recall over events.jsonl + optional swarm receipts
- Tool `xclaw_recall` wired into agent loop (register + execute)
- Config: `memory.recall=false` to disable
- Tests: `test/recall.test.mjs`

## 3.68.0 — Context compaction (P0 long-horizon)

- `src/tokens/compaction.mjs` — tool offload to disk + extractive fold under pressure
- Agent loop: after eviction, runs `compactMessages` when pressure ≥ trigger
- Protects leading system (OAuth attestation / cache prefix)
- Config: `tokens.compaction.*` (enabled, triggerPressure, foldPressure, offloadThresholdChars)
- Tests: `test/compaction.test.mjs`

## 3.67.0 — Full Claude OAuth in agent loop

- Native Anthropic Messages provider (`src/providers/anthropic-messages.mjs`)
- OAuth attestation + headers automatic for `sk-ant-oat*` tokens
- Agent loop resolves auth profiles async (anthropic oauth profile)
- Registry: anthropic api = anthropic-messages
- Models: sonnet/opus/fable/haiku selectable via agent.model

## 3.66.2 — OAuth system attestation (sudo-ai parity)

- Required system prefix: `You are Claude Code, Anthropic's official CLI for Claude.`
- Without it, Sonnet/Opus/Fable return misleading 429 rate_limit_error on OAuth
- `src/providers/anthropic-oauth-headers.mjs` — headers + ensureOAuthSystemAttestation
- Verified live: Sonnet/Fable/Opus 200 with attestation

## 3.66.1 — Claude Code binary endpoint parity + credential import

- Defaults aligned with Claude Code 2.1.226 native strings (`platform.claude.com/v1/oauth/token`)
- `importClaudeCodeCredentials` reads `~/.claude/.credentials.json` (`claudeAiOauth`)
- CLI: `--method import-claude-code`

## 3.66.0 — Claude / Anthropic OAuth PKCE

- `src/auth/anthropic-oauth.mjs` — PKCE authorize URL, paste-code exchange, refresh
- `oauth-policy` anthropic kind `claude_pkce`
- CLI: `xclaw models auth login --provider anthropic|claude --method oauth`
- Registry env: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`
- Docs: `docs/AUTH_CLAUDE_OAUTH.md`

## 3.65.0 — S2 merge/vote use receipts

- `evaluateReceiptPolicy`, `receiptVoteWeight`, `buildRunReceiptSummary`
- Merge gates fail when `requireReceipts` and implement/verify/critic lack receipts
- Vote weights multiply by receipt quality (missing → 0.25 or 0 if hard)
- Swarm run stores `receiptSummary` + returns `receipts` policy summary
- Config: `swarm.requireReceipts` or `XCLAW_SWARM_REQUIRE_RECEIPTS=1`

## 3.64.1 — Swarm failure receipts completeness

- Receipts on retry-exhausted failures and skipped nodes (`UPSTREAM_FAILED`, `DEPS_NOT_TERMINAL`)
- Docs: failure handling table in SWARM_RECEIPTS.md

## 3.64.0 — S1 universal swarm node receipts

- `src/agents/swarm-receipt.mjs` — build/write/list receipts for any domain (shell, files, repo, browser, …)
- Effects inferred from tool trace; browser fields optional
- `swarm-run` attaches receipt on node success and final failure
- Stored at `~/.xclaw/swarms/runs/<swarmId>/receipts/<nodeId>.json`
- Tests: `test/swarm-receipt.test.mjs`

## 3.63.0 — C2 trusted fabric role at swarm spawn

- `mapSwarmRoleToFabric` / `bindSwarmSpawnRole` in role-binding
- `spawnSubagent` binds fabric role when role/swarmRole set (spawn id + session id)
- swarm-run passes node role into spawn
- Agent loop resolves role from session bind (not free env) for browser belt
- `xclaw_spawn_subagent` accepts `role` enum
- Tests: `test/browser-c2-swarm-role.test.mjs`

## 3.62.0 — C1 auto-renew tab lease heartbeat

- `src/browser/lease-heartbeat.mjs` — start/stop/touch/acquireWithHeartbeat
- hooks: touch + start heartbeat on successful beforeNavigate/beforeInput when fabric enforce + tabId
- `tab_lease` acquire starts heartbeat; release stops; renew/heartbeats actions
- Env: `XCLAW_TAB_LEASE_HEARTBEAT`, `XCLAW_TAB_LEASE_HEARTBEAT_MS`, `XCLAW_TAB_LEASE_TTL_MS`
- Tests: `test/browser-c1-heartbeat.test.mjs`

## 3.61.0 — B4 alerting polish

- Alerter: `alertLiveE2eFailure`, `alertEnforcementFailure`
- Targets inherit `liveE2e.cron.delivery` (and doctor delivery)
- live-e2e cron uses shared live-e2e alert helper
- Doctor cron runs CLI `a.*`/`h0.*` enforcement slice and alerts on errors
- Doctor `quiet` option for scheduled runs
- Tests: `test/alerting-b4.test.mjs`

## 3.60.0 — B3 live e2e cadence

- `src/cron/live-e2e-job.mjs` — run + log + optional alert; ensureLiveE2eCronJob (default 24h)
- CLI: `xclaw live-e2e`, `xclaw live-e2e-schedule [everyMs]`
- docs/PROD_PRESET.md + OPS.md — nightly/pre-release/systemd timer
- npm: `live-e2e:cron`, `live-e2e:schedule`

## 3.59.0 — B2 production enforcement preset

- `docs/PROD_PRESET.md` — copy-paste prod/lab env, verify commands, checklist, incident hints
- `OPS.md` — Production enforcement preset section linking full doc

## 3.58.0 — B1 release-gate A-enforcement

- `release-gate` always runs `a-enforcement-e2e` (required, including `--quick`)
- `bundle-markers` step requires A2/A4/A5 strings in xclaw-server.mjs
- `--live` / `XCLAW_LIVE_E2E=1` adds live-enforcement-e2e
- npm: `release-gate:live`, `check-bundle-markers`
- Offline A-smoke exit 1 (warnings) treated as pass for gate; exit 2 fails release

## 3.57.0 — A8 fabric durability (locks + heartbeat)

- `src/browser/fabric-lock.mjs` — cross-process exclusive lock with stale reclaim
- Leases, gates, clock, session roles RMW under `withFabricLock`
- `renewTabLease` heartbeat (TTL extend + heartbeatCount)
- `tab_lease` tool action `renew`
- Tests: concurrent lock serialization, steal denied, parallel tabs, gate lock

## 3.56.0 — LIVE-E2E enforcement script

- `scripts/live-enforcement-e2e.mjs` — starts computer if needed, session + tools/call probes
- Asserts commit gate on /checkout, jsCode motor block, read js allowed, optional motor/nav
- Flags: `--json` `--no-start` `--keep`
- npm: `live-e2e` / `live-enforcement`

## 3.55.0 — A7 bypass closure (jsCode + role binding)

- `src/browser/jscode-policy.mjs` — block click/type-like jsCode under fabric/prod
- `src/browser/role-binding.mjs` — session-bound roles; env ignored under strict unless XCLAW_ROLE_FROM_ENV=1
- hooks beforeInput checks jsCode + resolveRole
- Bundle + gateway pass jsCode into beforeInput
- Tool: `session_role` bind|get|resolve
- Doctor: a.jscode_* + a.role_binding
- Tests: `test/browser-a7-bypass.test.mjs`

## 3.54.0 — A6-ops: doctor enforcement + e2e smoke

- Doctor section `a.*`: bridges, hooks, motor, chrome-args, role checks, bundle markers, prod strict
- `scripts/a-enforcement-e2e.mjs` — offline-first Phase A smoke (exit 0/1/2)
- npm scripts: `a6` / `a-enforcement`
- Env: `XCLAW_ROOT`, `XCLAW_ENFORCEMENT_STRICT=1` / `profile=prod` for hard gates in doctor

## 3.53.0 — Phase A5 single Chrome argv path

- `src/computer/chrome-args.mjs` — canonical buildChromeArgs (H0 + MITM + sandbox)
- `src/computer/chrome-args-bridge.mjs` — computer process loader
- Bundle `ensureRunning` replaces argv via bridge before spawn
- Clean `browser-service.mjs` uses same builder before spawn
- manager sets XCLAW_CHROME_ARGS_BRIDGE
- Tests: `test/chrome-args.test.mjs`
- Phase A (A1–A5) enforcement plane complete for launch + navigate + fabric + motor

## 3.52.0 — Phase A4 humanized CDP motor

- `src/browser/motor.mjs` — planClick/Type/Scroll via Fitts + key delays → Input.dispatch* steps
- `src/computer/motor-bridge.mjs` — load + runMotorOnClient
- `xclaw_browser_tab` accepts `motor: { op, x, y, text, ... }` and executes on tabClient
- Agent tools: `browser_click`, `browser_type`
- manager injects XCLAW_MOTOR_BRIDGE
- Tests: `test/browser-motor.test.mjs`

## 3.51.0 — Phase A3 fabric on more actuation paths

- Tab tool `call` entry runs `beforeInput` (lease + role) before any act
- Navigate path keeps `beforeNavigate` + `afterAction` binding
- Gateway belt: agent loop checks hooks before `computer.callTool` for `xclaw_browser_tab`
- Read-only observe allowed for observer; evaluate/navigate still motor-gated
- Auto-acquire lease via `XCLAW_TAB_LEASE_AUTO=1` under fabric enforce
- Tests: `test/browser-hooks-a3.test.mjs`

## 3.50.0 — Phase A2 driver hooks on navigate path

- `src/browser/hooks.mjs` — beforeNavigate / beforeInput / afterAction / buildChromeArgs
- `src/computer/hooks-bridge.mjs` — resolve + load hooks from computer process
- `xclaw-server.mjs` — Page.navigate calls beforeNavigate (fail-closed when gates/enforce on)
- `manager.mjs` — injects XCLAW_ROOT + XCLAW_HOOKS_BRIDGE into computer env
- Enforcement: XCLAW_COMMIT_GATES, XCLAW_FABRIC_ENFORCE, role caps, tab leases
- Tests: `test/browser-hooks.test.mjs`

## 3.49.3 — Full computer bundle mapped + app layer extracted

- `src/computer/MODULE_MAP.json` — complete ~16.8MB / 395k-line region map
- `src/computer/modules/*` — all xclaw_* tools + skills/context + HTTP main extracted
- Clean `browser-service.mjs` remains the importable Chrome owner
- Vendored ~380k lines left in bundle by design; app ~15k lines now addressable

## 3.49.2 — Clean BrowserService module extracted from computer bundle

- `src/computer/browser-service.mjs` — importable, syntax-checked BrowserService (from xclaw-server.mjs)
- `src/computer/browser-tab-tool.extracted.mjs` — reference extract of xclaw_browser_tab
- `docs/COMPUTER_EDITABLE_MODULES.md` — edit-here vs run-there contract
- A2 can attach hooks on the clean module instead of string-patching 16MB

## 3.49.1 — Phase A1: Computer source of truth

- Documented that `src/computer/xclaw-server.mjs` (~16.8MB bundle) **is** the Chrome/CDP source — no pre-bundle tree in-repo
- Ownership map: `manager.mjs` lifecycle, `BrowserService.ensureRunning` launch, `xclaw_browser_tab` actuation
- Artifacts: `docs/COMPUTER_SOURCE_OF_TRUTH.md`, `src/computer/SOURCE_OF_TRUTH.json`
- Defines A2 hook targets (beforeNavigate / beforeInput / afterAction / buildChromeArgs)

## 3.49.0 — Horizon 5 Time-travel & causal eval

- `src/browser/timetravel.mjs` — loadTimeline, replay plan, scoreCausal, synthetic origin server
- Eval `scoreCase` honors `expect.causal` / `expect.network` / forbidHosts
- Tools: `trace_replay`, `trace_score`
- Offline synthetic HTTP origin from recorded flows (`startSyntheticOrigin`)
- Sample case: `eval/cases/causal-network.json`
- Tests: `test/browser-timetravel.test.mjs`

## 3.48.0 — Horizon 4 Session Physics + Swarm fabric

- `src/browser/physics.mjs` — tab leases, commit gates, role caps, logical clock
- Tools: `tab_lease`, `commit_gate`, `fabric_status`
- Roles: observer / actor / critic / planner motor permissions
- Commit-sensitive URL patterns (checkout, pay, delete, transfer, …)
- Swarm roles extended: actor, observer + critic fabric instructions
- Persist under `~/.xclaw/fabric/` (`XCLAW_FABRIC_DIR`)
- Env: `XCLAW_COMMIT_GATES=1`, `XCLAW_TAB_LEASE_TTL_MS`, `XCLAW_AGENT_ID`
- Tests: `test/browser-physics.test.mjs`

## 3.47.0 — Horizon 3 Motor + Identity maturity

- Motor v2: Fitts-law `fittsDuration` / `fittsID`, `readingPause`, mousePath uses targetWidth for MT
- `humanClick` optional label → reading pause before move
- Origin-partitioned profiles: `resolveOriginProfile`, `sanitizeOriginHost`, `listOriginProfiles`
  - `XCLAW_BROWSER_PROFILE_MODE=origin|shared`
  - `XCLAW_BROWSER_ORIGIN_ROOT` override
- NSS CA trust: dual import (profile DB + nssdb/), explicit trustOrder fallback chain
- Tests: `test/browser-horizon3.test.mjs`

## 3.46.0 — Horizon 2 Truth control plane

- `src/browser/truth.mjs` — policy DSL load/save/match/evaluate, require-rules, proof export
- `confdir/policy.json` merged into mitmproxy block/map (addons.py)
- Agent tools: `mitm_policy`, `mitm_export`
- Agent loop: `XCLAW_TRUTH_AUTO_ASSERT=1` runs require-rules after browser_* tools
- Proof bundle: redacted flows + bindings + policy summary + sha256
- Docs: policy DSL in MITM_SCRIPTING.md
- Tests: `test/browser-truth.test.mjs`

## 3.45.0 — Horizon 1 Fusion Sense

Structure-first observation + action↔network causal binding:

- `src/browser/sense.mjs` — actionId, network cursor/delta, bindActionFlows, assertOutcome, STRUCTURE_SNAPSHOT_JS
- `browser_observe` — primary sense tool (structure, not pixels)
- `browser_snapshot` — a11y-oriented interactive tree + network delta footer
- `browser_assert` — outcome assertions against MITM flows / action bindings
- `withNetworkBinding()` — wrap any tool execute with actionId + flow delta
- Bindings persisted to `action-bindings.jsonl` under MITM confdir
- Tests: `test/browser-sense.test.mjs`

## 3.44.0 — Horizon 0 production foundations

First-principles hardening of the browser organism (identity, CDP, MITM, motor readiness):

- `src/browser/horizon0.mjs` — production Chrome arg builder, profile lock, flow rotation, checklist
- BrowserService: `--remote-allow-origins=*`, `--disable-dev-shm-usage`, headed window geometry, UA override
- Fix Docker flag bug (`--no-sandbox --disable-gpu` was a single invalid argv entry)
- Durable profile exclusive lock + reclaim stale PID; release on stop/exit
- CDP port acquire timeout (`XCLAW_BROWSER_PORT_TIMEOUT_MS`, default 30s)
- MITM: rotate `flows.jsonl` at start + supervisor tick; recover dead mitmdump
- Supervisor logs Horizon 0 checklist on boot
- Doctor: `h0.*` checks + production flag verification
- Tests: `test/browser-horizon0.test.mjs`

## 3.43.0 — Mitmproxy CA certificate management

- `getMitmCaInfo` / `ensureMitmCa` / `exportMitmCa` / `mitmCaStatus`
- Agent tool `mitm_ca`: status | ensure | export | trust
- Supervisor runs `ensureMitmCa` before wait-ready (SPKI on first Chrome start)
- Doctor reports CA subject / expiry / SPKI prefix
- Export writes PEM + P12 + `.spki` sidecar + chrome flag

## 3.42.3 — MITM integration hardening

- `findMitmdump` searches `~/.local/bin` even when PATH is minimal
- `mitmEnvFromConfig()` + inject into computer spawn and supervisor gateway env
- `waitForMitmReady()` — supervisor waits for listen + CA + ready before continuing
- `XCLAW_CHROME_MITM_ARGS` honored by BrowserService (bundle)
- Doctor: `mitm.binary` / `mitm.proxy` / `mitm.ca`
- INSTALL + OPS startup order; Dockerfile optional mitmproxy hint

## 3.42.2 — Addon hooks expansion

- `requestheaders` early block (before body)
- `responseheaders` optional Set-Cookie strip (`XCLAW_MITM_STRIP_COOKIES`)
- `error` + `tls_failed_client` / `tls_failed_server` → flows + stats.json
- `running` writes `confdir/ready` for supervisor probe
- `mitm_status` surfaces ready / errors / blocked / tlsFail*

## 3.42.1 — Mitmproxy scripting surface

- Expanded `addons.py`: block / path-map / body capture / host dumps / WS echo
- Env: `XCLAW_MITM_BLOCK`, `XCLAW_MITM_MAP`, `XCLAW_MITM_CAPTURE_BODY`, `XCLAW_MITM_BODY_MAX`, `XCLAW_MITM_DUMP_HOSTS`
- Docs: `docs/MITM_SCRIPTING.md`
- Example: `src/browser/mitm-confdir/examples/inject_header.py`

## 3.42.0 — M3 MITM agent tools

- `mitm_status` — enabled / running / port / CA / flowCount
- `mitm_flows` — filtered list (host, method, status, urlContains, sinceTs)
- `mitm_clear_flows` — truncate flows.jsonl
- `mitm_control` — start | stop | status sidecar
- `readMitmFlows` filters + `mitmStatus` / `clearMitmFlows` / `formatMitmFlows`
- Registered via `createBrowserTools` → agent local tools
- Tests: 22/22

## 3.41.0 — M2 Chrome proxy + CA trust

- `chromeMitmArgs()` / `findMitmCaCert()` / `mitmCaSpkiHash()` / `trustMitmCaInProfile()`
- `BrowserService.ensureRunning`: when `XCLAW_MITM` on → `--proxy-server` + `--proxy-bypass-list=<-loopback>`
- Prefer `--ignore-certificate-errors-spki-list=<SPKI>` from mitmproxy CA (openssl)
- Optional `certutil` import into profile NSS DB
- Lab escape: `XCLAW_MITM_INSECURE_CERTS=1` → `--ignore-certificate-errors`
- Runtime CDP `Security.setIgnoreCertificateErrors(true)` after connect
- Tests: 19/19 in `test/browser-mitm.test.mjs`

## 3.40.0 — M1 MITM sidecar (opt-in)

- Feature gate: `XCLAW_MITM=true` or `browser.mitm.enabled` (default **off**)
- `src/browser/mitm.mjs` — start/stop mitmdump, confdir, pid, flow log
- Package confdir + `addons.py` (redacts secrets, allowlist, flows.jsonl)
- Supervisor: `ensureMitm()` on boot + each tick
- `chromeProxyArgs()` ready for M2 (`--proxy-server=http://127.0.0.1:4444`)
- Env: `XCLAW_MITM`, `XCLAW_MITM_PORT`, `XCLAW_MITM_CONFDIR`, `XCLAW_MITMDUMP`, `XCLAW_MITM_ALLOWLIST`, `XCLAW_MITM_SSL_VERIFY`
- Tests: `test/browser-mitm.test.mjs` (14/14)

## 3.39.0 — B0 Human-like browser (1 year ahead)

- Durable Chromium profile vault (`XCLAW_BROWSER_PROFILE_DIR`, default `~/.xclaw/browser-profiles/default`)
- Headed mode via `XCLAW_BROWSER_HEADED=1` (visible window, human presence)
- `src/browser/humanize.mjs` — Gaussian delays, cubic-bezier mouse paths, typing cadence, scroll momentum
- `src/browser/profile.mjs` — resolve/seed/lock durable profiles
- `ensureRunning` respects profile vault; `stop` never wipes durable data
- Config: `browser.profileDir`, `browser.headless`, `browser.humanize`, `browser.humanizeSpeed`, `browser.copySession`
- Env: `XCLAW_BROWSER_PROFILE_DIR`, `XCLAW_BROWSER_HEADED`, `XCLAW_BROWSER_HUMANIZE`, `XCLAW_BROWSER_HUMANIZE_SPEED`, `XCLAW_BROWSER_COPY_SESSION`

## 0.7.3

### Autonomy & eval
- Multi-step **workflow-publish-post** eval case (drafts → post + checklist)
- Live baseline **8/8** on `grok-4.3` (smoke → workflow)
- Eval **token totals** in reports; **eval history** (`~/.xclaw/eval-history.jsonl`)
- `GET /eval/baseline`, `GET /eval/history`
- `npm run eval:suite`, `npm run eval:ci`, `npm run package`

### Jobs & queue
- Job runtime: verify, evidence, history
- **Serial job queue** (`~/.xclaw/job-queue/`, concurrency 1)
- `POST/GET /queue`, CLI `xclaw queue`
- No-API-key fail-fast on queue workers

### Ops
- **Eval cron** (default 24h) + doctor cron
- `ensureComputer` preflight (agent, eval, suite)
- Doctor checks: queue depth, eval cron registration
- Control UI: jobs, queue, skills stats, eval baseline/history
- WebChat **job mode** checkbox

### Robustness
- Fixed `ensureComputer` import in agent loop
- Case-insensitive verify checks
- Clearer computer ECONNREFUSED messages
- Transport retry + jitter + Retry-After (Phase 7)

## 0.7.0 – 0.7.2

- Phase 7 hardening: tests, config validation, doctor CLI, safer `autoApprove: false`
- Skill stats + proposals (review-only drafts)
- Package scripts and Control UI job runner
