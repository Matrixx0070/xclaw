# XClaw Autonomy

Single knob for how much the agent may act without a human in the loop.

## Levels

| Level | autoApprove | Heartbeat | Default maxTurns | Intended use |
|-------|-------------|-----------|------------------|--------------|
| `off` | false (always ask) | off | 8 | Demos / high-risk hosts |
| `supervised` | safe tools only | off | 12 | Production default |
| `lab` | all tools | off | 20 | Local eval / development |
| `full` | all tools | **on** | 24 | Long-lived owner agent |

Set via config or env:

```json
{ "autonomy": { "level": "full" } }
```

```bash
XCLAW_AUTONOMY_LEVEL=supervised XCLAW_PROFILE=prod node bin/xclaw.mjs gateway
```

If `autonomy.level` is omitted, **profile** is used: `prod`/`dev` → `supervised`, else `lab`.

Explicit `security.*` and `agent.maxTurns` always win over level defaults.

## Heartbeat (R4)

When `autonomy.heartbeat.enabled` is true (default on for `full`):

- Runs on a schedule (`everyMs`, **minimum 60s**)
- Prompt defaults to asking for `HEARTBEAT_OK` when nothing needs action
- Honors `quietHours` and `maxUsdPerDay`
- Optional delivery to Telegram/Discord/Slack via `autonomy.heartbeat.delivery`

Force a run:

```bash
curl -X POST http://127.0.0.1:18790/cron/jobs/<heartbeat-id>/run
```

List jobs: `GET /cron/jobs`

## Related surfaces

- **Jobs** — `POST /jobs` with `verify[]` for objective long-horizon goals
- **Checkpoints** — `GET /checkpoints`, `POST /checkpoints/resume`
- **Queue** — `POST /queue` (pass `workspace` for correct verify roots)
- **Swarm** — `POST /swarm/run/stream` DAG with implement → verify
- **Live e2e** — gateway arms the nightly check only when `liveE2e.cron.enabled === true` (boolean; Chromium spend). Missing/false stay off. CLI: `xclaw live-e2e` / `live-e2e-schedule`

Doctor reports `autonomy.level` and `autonomy.heartbeat`.


## Prod hardening

When `profile=prod` (or `XCLAW_PROFILE=prod`), load-time **enforceProdHardening** prevents a shared lab config file from disabling safety:

| Setting | Forced on prod |
|---------|----------------|
| `security.autoApprove` | `false` |
| `approvalPolicy: never` | → `risky` |
| `autonomy.level` `lab`/`full` | → `supervised` (unless `XCLAW_AUTONOMY_LEVEL` set) |
| `swarm.autoMerge` | `false` |

Break-glass: `XCLAW_ALLOW_PROD_AUTO=1`.

`XCLAW_AUTONOMY_LEVEL` **overrides** `autonomy.level` in the config file (same idea as `XCLAW_PROFILE`).

Doctor reports `prod.hardening` when actions were applied.


## Skill install (self-evolution)

Failed jobs may **propose** skills under `~/.xclaw/skill-proposals/` (always safe).

**Installing** into `~/.xclaw/skills/` is gated:

| Profile | Default |
|---------|---------|
| lab / dev | install allowed |
| prod | **blocked** unless `skills.allowInstall: true`, `XCLAW_SKILLS_INSTALL=1`, or `ownerApproved` on the install call |

Proposals stay review-only in prod until the owner promotes them.

```bash
xclaw skills proposals
xclaw skills install <file.md> --owner-approved   # prod
xclaw skills reject <file.md> "not useful"
```


## Approvals inbox

```bash
xclaw approvals list
xclaw approvals approve <id>
xclaw approvals deny <id> "reason"
```

Gateway: `GET /approvals`, `POST /approvals/approve`, `POST /approvals/deny` (also `/security/pending` + `/security/decide`).

Unknown id → `APPROVAL_NOT_FOUND` (404).


## Cost governor

Hard daily / per-job USD caps (`cost.dailyHardUsd`, `cost.perJobUsd`, or `autonomy.maxUsdPerDay`).

Over hard cap → agent/job **stops** with `BUDGET_EXCEEDED` (no further provider calls). Soft cap warns only.

```bash
xclaw cost
xclaw doctor   # cost.governor check
```


## Agent run resume (durable)

Snapshots under `~/.xclaw/agent-runs/`.

```bash
xclaw runs list
xclaw runs show <sessionId>
xclaw runs resume <sessionId>
```

`GET /agent-runs?id=` · Codes: `SESSION_NOT_FOUND` | `SESSION_CORRUPT` | `SESSION_UNSUPPORTED_VERSION` | `SESSION_WORKDIR_MISSING`

Pass `sessionId`, `chatSessionId`, or `persistRun` into the agent loop
to write snapshots after a run. Default surfaces (`xclaw agent`, TUI,
`POST /agent/run`, webchat) persist automatically under the conversation
id. Opt out with `persistRun: false`.

A turn-cap cutoff (`stopReason === "maxTurns"`) auto-promotes into a
durable objective on channels, Discord `/ask`, webchat, voice `/ws/voice`,
the TUI, and the CLI (CLI awaits the mission so the process does not
exit mid-work; voice, TUI, and channels leave it detached). Disable with
`objectives.autoPromote: false`.

A tool-free "Done." is not completion when the goal named a file (or
the caller passed `verify[]`). The loop runs `jobs/verify.mjs` and
re-enters on failure (`stopReason: unverified` at cap). Create/write
with text → `file_contains` (including `write a file PATH containing
TEXT` / `whose first line is`); touch/create-path → `file_exists`
(including relative dotfiles, `mkdir` / `create directory`, and
extensionless names like `PROOF` / `results/PROOF`). Chat and how-to
questions still derive nothing. `agent.verifyOnComplete: false` to
opt out. The objective path now arms those same goal-derived checks
as `source: "runtime"` without a baseline pass (the named artifact
does not exist yet, so baseline would drop every `file_exists` /
`file_contains`). Project-suite lint/test still baseline-filters.
Operator `verify[]` is never overwritten. Chat/how-to still hold
`no_checks`. `objectives.deriveChecks: false` to skip. Gateway
`POST /objectives` segments pass `continuation: false` the same way
channel objectives already did — the inner loop no longer auto-continues
4× inside one API-started segment. Automations ticks (`runAgentOnce`)
pass `continuation: false` the same way cron announce already did —
a scheduled tick (and each goal-mode step) no longer auto-continues 4×.

Gateway boot auto-resumes unfinished **agent-run snapshots** the same
way it already resumes interrupted objectives: `active` / `maxTurns`
runs are promoted into an objective stamped `interrupted` (so the
runtime-restart notice fires) with an in-flight warning so the next
segment verifies disk before rewriting. Channel auto-promote stays
`running` — that path is a live continuation, not a crash. Kill, approval, and budget
stops stay put. Eval leftovers whose `workingDir` is under
`tmp/xclaw-eval` also stay put — scored eval trees are not owner
missions. `xclaw runs list`, Control `/agent-runs`, and doctor
`agentRuns.attention` use that same classifier (`isResumableAgentRun`);
they do not re-derive resumable from status alone. The operator list
sorts by `updatedAt` (not filename), then pins resumable / not-ok
rows into the window before applying the row limit, so a leftover is
not hidden behind newer ok runs or `job_*` / `objective-*`. Missing
workingDir / corrupt rows are not pinned — they crowded out newest
ok after 3.476.0. Boot `listResumableAgentRuns` also loads all, keeps
resumable, sorts by `updatedAt`, then applies its limit (default 80)
— filename reverse-lex hid ISO-timestamp owner ids behind `job_*` /
`objective-*` (live leftover rank 96, outside the 80). Cap:
`agent.autoResumeMax` (default 3). Age: 48h. Opt out:
`agent.autoResume: false`.


## Telegram channel

```bash
xclaw channels telegram status
xclaw channels telegram test <chatId>
```

Config: `channels.telegram.token`, `dmPolicy` (`open|allowlist|pairing`), `allowedChatIds` / `allowFrom`, `rateLimit: { max, windowMs }`.

Inbound over limit → `RATE_LIMITED` (no agent spawn). Strangers denied silently under allowlist.

**Prod:** `dmPolicy=open` is forced to `allowlist` (when allowFrom set) or `pairing`. Break-glass: `XCLAW_TELEGRAM_DM_POLICY=open|allowlist|pairing`.
