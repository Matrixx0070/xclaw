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

## Risk-tiered zero-trust (A2, v3.115)

Every action is assessed deterministically before the gate decides
(`src/security/risk.mjs`): facts (tool family, resolved path scopes, command
patterns, egress) → factors `{scope, impact, reversibility, blastRadius,
recovery}` → tier `safe|low|risky|critical` (table overridable via
`security.risk.tiers`). Models may only RAISE risk (pre_tool_use hook
`decision:"ask"`); they never authorize.

- `security.autoApproveMaxTier: "risky"` — risk-bounded autonomy: tiers ≤ max
  run free, higher pend. Missions use this instead of blanket autoApprove
  (worktree writes are discardable by construction; force-push/publish/
  credential paths still pend mid-mission).
- Blanket `autoApprove: true` no longer covers `critical`
  (`security.criticalOverride`: `ask` (default) | `deny` | `legacy` — the
  legacy escape hatch is SCAFFOLD for one release).
- **Durable allow-always** (closes brief gap 1.7): `POST /security/decide
  {decision:"allow-always"}` persists a pin to `~/.xclaw/decisions.json`. The
  default pin is the plan FINGERPRINT (exact argv+cwd+exe) — TOCTOU
  revalidation still runs; `wide:true` pins exe+argv0 with a 30-day expiry. A
  pin below the currently-assessed tier does not match (tier drift breaks
  pins). Manage: `GET /security/decisions`, `DELETE /security/decisions/:id`.
- Pending entries and `approval_required` events carry `risk`
  (tier/factors/reasons); every resolution (human/SLA/timeout/pinned) is
  journaled to the operational ledger.
