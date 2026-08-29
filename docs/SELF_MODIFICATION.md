# Self-Modification Loop

Missions targeting xclaw's own repository (detected by package name or
`cfg.self.repoDir`, symlink-safe) run under the **self profile** — a stricter
composition of existing guards, no new enforcement layer:

- **Edit surface**: a system-tier `pre_tool_use` hook denies writes and exec
  touching `src/security/`, `src/self/`, `src/hooks/manager.mjs`,
  `src/agent/loop.mjs`, `src/missions/engine.mjs`, `scripts/`, `package.json`,
  `bin/`, `.git/`, `.github/workflows/`. Reads are allowed everywhere.
  Security-critical paths stay human-only forever.

  The list covers the guard's *machinery*, not only its policy: the hook ranks
  through `src/hooks/manager.mjs`, only `src/agent/loop.mjs` acts on a `deny`,
  and `src/missions/engine.mjs` both installs the hook and decides `autoMerge`.
  It also covers the **verify floor** — `scripts/` holds the runners a mission's
  verify commands execute, and `package.json` is the script map `npm run`
  resolves them through. A self mission that could rewrite either one could pass
  its own gate, and with `self.requireMergeApproval` unset the engine merges
  automatically once verify reports green.

  `src/self/guard-surface.mjs` derives both sets from the repository — a marker
  scan for the enforcement chain, script resolution for the floor — and
  `test/self-mod.test.mjs` fails when either derives a file this list omits, so
  a new guard module cannot be added without also being denied. Honest limits:
  `test/` is not protected (a self mission legitimately adds tests), and the
  floor covers the entry runners, not every module they import.

  `self.denyPaths` **adds** to this list; it cannot shorten it. A knob for
  tightening must never be able to loosen — before v3.361.0 it replaced the
  built-ins, so an operator who added one path silently dropped all six others.
- **Verification floor**: `npm run release-gate:quick` is appended to the
  mission's verify commands. `self.verifyCommands` **adds** to it; like
  `denyPaths`, it cannot shorten it — an operator list that verified nothing
  would still force-merge to main.
- **Risk**: worktree autonomy stays risk-bounded (A2); `riskContext.selfTarget`
  marks the assessment.

## Deploy pipeline (autonomous per operator decision 2026-08-14)

The gateway cannot supervise its own restart, so deploy is split:

1. Gate passes → merge commits with the `XClaw-Mission` trailer (A3) → the
   engine writes `~/.xclaw/self-deploy.json` and parks the mission at
   `deploying`. (Self merges do NOT auto-mark known-good — a merge is not yet
   a good state.)
2. An **external watcher** (`xclaw self-deploy watch`, run under pm2 as its
   own process, or `run-once` for manual control) consumes the intent:
   restart (`self.restartCmd`, default `pm2 restart xclaw-gateway`, bounded by
   `self.restartTimeoutMs`, default 120000) → poll
   `GET /ready` (`self.health {retries, delayMs}`) →
   - **pass**: mark known-good, mission `deployed`, owner alert;
   - **fail**: `git reset --hard <previous known-good>` → restart → mission
     `deploy_rolled_back`, owner alert (or `failed` + loud alert if recovery
     itself fails).

Every phase lands in the operational ledger (`kind:"deploy"`). The brake:
`self.requireMergeApproval: true` re-gates merges at `merge_ready`.

## Config

```json
{ "self": {
    "repoDir": "/root/xclaw",
    "restartCmd": "pm2 restart xclaw-gateway",
    "restartTimeoutMs": 120000,   // the restart runs in its own process group, so this bound reaches grandchildren
    "health": { "retries": 10, "delayMs": 3000 },
    "requireMergeApproval": false,
    "denyPaths": null,   // extra denies; added to the built-ins, never replacing them
    "verifyCommands": null   // extra verify commands; added to the floor, never replacing it
} }
```
