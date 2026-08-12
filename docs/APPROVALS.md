# Approval policies

## Decision order (`needsApproval`)

1. `security.autoApprove === true` → **never ask**
2. `security.approvalPolicy === "never"` → **never ask**
3. Tool in `security.safeAuto` → **never ask** (reads, list_dir, …)
4. `approvalPolicy === "always"` → **always ask**
5. `approvalPolicy === "risky"` (default) → ask only if tool ∈ `requireApproval`

Default `requireApproval`: `xclaw_bash`, `bash`, `xclaw_file_write`

## Profiles

| Profile | autoApprove | policy |
|---------|-------------|--------|
| `dev` | false | risky |
| `lab` | true | never |
| `prod` | false | risky (+ more tools) |

## Merge order (v2.5.10+)

```
DEFAULT_CONFIG → profile defaults → user xclaw.json → env
```

**User `security.*` always wins** over the profile.  
(Earlier bug: profile overwrote user settings → Telegram hung on `⏳ approval`.)

## Config example (bot-friendly)

```json
{
  "profile": "dev",
  "security": {
    "autoApprove": true,
    "approvalPolicy": "never"
  }
}
```

Or simply `"profile": "lab"`.

## Pending approvals

- Agent emits `security` / `approval_required` with `pendingId`
- SLA: `approvalSlaMs` (default 5m), action `deny` | `approve`
- Gateway can decide via shared gate APIs
