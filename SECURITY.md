# Security

## Reporting

If you find a vulnerability in XClaw, prefer private disclosure to the maintainer rather than a public issue with exploit detail.

## Operator hygiene

- **Never commit** API keys, OAuth tokens, or GitHub PATs.
- Prefer environment variables or a local `~/.xclaw/xclaw.json` that is not shared.
- If a secret was pasted into chat, logs, or a ticket → **rotate it immediately**.
- Prod gateway: set `XCLAW_GATEWAY_TOKEN` (or `gateway.token`) and keep `XCLAW_PROFILE=prod`.

## Prod defaults (load-time)

When `profile=prod`, XClaw forces safer posture even if a shared lab config file says otherwise:

| Knob | Prod behavior |
|------|----------------|
| `security.autoApprove` | forced `false` (break-glass: `XCLAW_ALLOW_PROD_AUTO=1`) |
| `approvalPolicy: never` | forced `risky` |
| `autonomy.level` lab/full | forced `supervised` unless `XCLAW_AUTONOMY_LEVEL` set |
| `swarm.autoMerge` | forced `false` |
| `security.osSandbox` | `auto` (bwrap when usable) |
| Skill **install** | blocked unless owner-approved |
| Telegram `dmPolicy=open` | forced to `allowlist` (if allowFrom set) or `pairing` |

See `docs/AUTONOMY.md` and `docs/FABRIC.md`.

## Browser fabric

Enable for multi-agent browser work:

```bash
export XCLAW_COMMIT_GATES=1
export XCLAW_FABRIC_ENFORCE=1
```

Irreversible URLs require a critic/operator commit gate; tabs need exclusive motor leases.

## Skills writeback

Failed jobs may **propose** skills under `~/.xclaw/skill-proposals/`. Installing into `~/.xclaw/skills/` on prod requires:

```bash
xclaw skills install <proposal.md> --owner-approved
```

## Checklist before exposing a host

1. `XCLAW_PROFILE=prod`
2. `XCLAW_GATEWAY_TOKEN` set
3. `xclaw doctor` — no `autoApprove` errors; `skills.install` gated
4. Optional: `XCLAW_COMMIT_GATES=1` `XCLAW_FABRIC_ENFORCE=1`
5. Optional: install `bubblewrap` for OS sandbox
6. Rotate any secrets that ever appeared outside the host
