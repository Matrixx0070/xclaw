# XClaw Security Checklist

Run: `xclaw doctor` · `xclaw security-audit`

## Deploy checklist

| Check | Requirement |
|-------|-------------|
| Gateway bind | Prefer `127.0.0.1`; if `0.0.0.0`, require reverse proxy + TLS |
| Gateway token | `XCLAW_GATEWAY_TOKEN` set for any shared host |
| Metrics | `gateway.protectMetrics: true` when scraped publicly |
| Profile | `XCLAW_PROFILE=prod` without `autoApprove` |
| Approvals | write/exec/network require approval in prod |
| Sandbox | `sandbox.enabled` (default on) — path escape denied |
| Computer remote | `XCLAW_COMPUTER_TOKEN` + auth proxy if `remoteUrl` |
| API keys | Only via env — never commit `xclaw.json` secrets |
| Channels | Avoid `dmPolicy: open`; use pairing / allowlist |
| Cost | Daily hard cap + queue pause on hard |

## xAI auth
Prefer `xclaw auth login --api-key` or env keys. See [AUTH.md](./AUTH.md).

## Secrets
- `XAI_API_KEY` / `OPENAI_API_KEY` / `XCLAW_API_KEY`
- `XCLAW_GATEWAY_TOKEN`
- `XCLAW_COMPUTER_TOKEN`
- Channel bot tokens

## Incident
1. `xclaw cost pause` if spend runaway  
2. `xclaw computer stop` if tool abuse  
3. Rotate gateway + computer tokens  
4. Review `~/.xclaw/` job + queue history  

See also [RUNBOOK.md](./RUNBOOK.md).
