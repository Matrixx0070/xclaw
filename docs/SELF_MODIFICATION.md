# Self-Modification Loop

Missions targeting xclaw's own repository (detected by package name or
`cfg.self.repoDir`, symlink-safe) run under the **self profile** — a stricter
composition of existing guards, no new enforcement layer:

- **Edit surface**: a system-tier `pre_tool_use` hook denies writes and exec
  touching `src/security/`, `src/self/`, `scripts/gateway-supervisor.mjs`,
  `bin/`, `.git/`, `.github/workflows/` (override: `self.denyPaths`). Reads
  are allowed everywhere. Security-critical paths stay human-only forever.
- **Verification floor**: `npm run release-gate:quick` is appended to the
  mission's verify commands (`self.verifyCommands` overrides).
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
   restart (`self.restartCmd`, default `pm2 restart xclaw-gateway`) → poll
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
    "health": { "retries": 10, "delayMs": 3000 },
    "requireMergeApproval": false,
    "denyPaths": null,
    "verifyCommands": null
} }
```
