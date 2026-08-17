# XClaw Browser Fabric

Enforcement plane for multi-agent browser control. Prevents two actors from fighting over the same tab and blocks irreversible navigations until a critic/operator approves.

## Enable (prod)

```bash
export XCLAW_PROFILE=prod
export XCLAW_AUTONOMY_LEVEL=supervised
export XCLAW_COMMIT_GATES=1
export XCLAW_FABRIC_ENFORCE=1
export XCLAW_GATEWAY_TOKEN=...   # required in prod
```

Optional:

| Env | Effect |
|-----|--------|
| `XCLAW_TAB_LEASE_AUTO=1` | Auto-acquire lease on navigate/input when missing |
| `XCLAW_ROLE_FROM_ENV=1` | Allow `XCLAW_AGENT_ROLE` (lab only; ignored under strict fabric unless set) |
| `XCLAW_FABRIC_DIR` | Override fabric state dir (default `~/.xclaw/fabric`) |

## Roles

| Role | motor (click/type) | navigate | read |
|------|--------------------|----------|------|
| observer | no | no | yes |
| critic | no | no | yes |
| actor | yes | yes | yes |
| planner | (see `ROLE_CAPS`) | | |

Role resolution order:

1. `bindRole(sessionId, role)` registry  
2. `ctx.role` when `ctx.roleTrusted === true` (gateway/swarm)  
3. `XCLAW_AGENT_ROLE` only if `XCLAW_ROLE_FROM_ENV=1`  
4. Default `actor`

## Tab leases

Exclusive **motor** lease per `tabId`:

- `acquireTabLease(tabId, { agentId, role })`
- `requireTabLease` — fail if held by another agent
- `renewTabLease` / lease heartbeat
- `releaseTabLease` — holder only (or `force`)

Observers cannot hold motor leases (`ROLE_NO_LEASE`).

## Commit gates

Irreversible URLs (checkout, pay, transfer, delete, …) require an approved gate when `XCLAW_COMMIT_GATES=1`:

```text
beforeNavigate(checkout URL)
  → COMMIT_GATE_REQUIRED + pending gate
resolveCommitGate(id, "approve", { role: "critic" })
  → approved
beforeNavigate(same URL)
  → ok
```

Safe pages (`/about`, etc.) skip the gate.

## Hook order (`beforeNavigate`)

1. Role motor/navigate capability  
2. Tab lease (if fabric enforce + `tabId`)  
3. Commit gate (if enabled + sensitive URL)  
4. Issue `actionId`, touch lease heartbeat  

Returns `{ ok:false, code, reason }` on denial — never throws into a bare crash.

## Doctor

```bash
XCLAW_COMMIT_GATES=1 XCLAW_FABRIC_ENFORCE=1 XCLAW_PROFILE=prod node bin/xclaw.mjs doctor
```

Look for:

- `a.prod_commit_gates`
- `a.prod_fabric`
- `a.hooks_status` (`fabricEnforce` / `commitGates`)

## Related

- [docs/AUTONOMY.md](./AUTONOMY.md) — autonomy levels  
- `src/browser/physics.mjs` — leases, gates, roles  
- `src/browser/hooks.mjs` — driver enforcement plane  
- `src/browser/role-binding.mjs` — session role registry  


## Durable browser profile

Default user-data-dir: `~/.xclaw/browser-profiles/default` (cookies / localStorage survive restarts).

| Env | Effect |
|-----|--------|
| `XCLAW_BROWSER_PROFILE_DIR` | Override vault path |
| `XCLAW_BROWSER_PROFILE_DIR=tmp` or `ephemeral` | Ephemeral mkdtemp |
| `XCLAW_BROWSER_EPHEMERAL=1` | Force ephemeral |
