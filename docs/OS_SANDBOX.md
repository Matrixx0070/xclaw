# OS sandbox (bubblewrap)

XClaw isolates **bash / computer spawn** with Linux [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`), not a Docker or Wasm skill container. Workspace-level UI isolation is separate. Skill tools that go through the computer plane inherit this wrap; they do not get a second Docker runtime.

Code: `src/security/os-sandbox.mjs` (`wrapSpawnWithOsSandbox`, `buildBwrapArgv`). Doctor: `security.osSandbox`. Related: [SECURITY.md](../SECURITY.md) · [PROD_PRESET.md](./PROD_PRESET.md) · [TOOL_ROUTER.md](./TOOL_ROUTER.md)

## Enable

```bash
# Debian / Ubuntu
sudo apt install bubblewrap

export XCLAW_OS_SANDBOX=auto    # default: use bwrap when installed and usable
# export XCLAW_OS_SANDBOX=bwrap # force; missing/unusable → deny the spawn
# export XCLAW_OS_SANDBOX=off   # never wrap

node bin/xclaw.mjs doctor       # security.osSandbox probe
```

Config equivalent: `security.osSandbox`: `"off"` | `"bwrap"` | `"auto"` (default auto). Prod load-time sets `auto` (bwrap when usable). Override binary path with `XCLAW_BWRAP=/path/to/bwrap`.

| Mode | Missing bwrap | Installed but unusable (uid map denied, etc.) |
|------|----------------|-----------------------------------------------|
| `off` | no wrap | no wrap |
| `auto` | fallback unsandboxed (`bwrap_unavailable`) | fallback unsandboxed (`bwrap_unusable_fallback`) |
| `bwrap` | **deny** spawn (`bwrap_missing`) | **deny** spawn (`bwrap_unusable`) |

GitHub Actions and some containers cannot set user namespaces — the probe reports unusable rather than claiming isolation. Prod without a working bwrap is a doctor **warning**, not a silent success.

## What the wrap actually does

When the probe succeeds, argv is:

- `--die-with-parent`
- `--proc /proc` `--dev /dev` `--tmpfs /tmp`
- RO binds: `/usr` `/etc` `/bin` `/sbin` `/lib` `/lib64` `/lib32` (plus `security.osSandboxExtraRo`) — same list the usability probe uses, so merged-`/usr` hosts still find the ELF interpreter
- RW bind of the workspace (and cwd if outside it)
- `--unshare-pid`
- `--unshare-net` when egress is deny/allowlist **and** `probeBwrapNetns()` succeeds

`--unshare-net` is skipped when the host cannot create a netns (`RTM_NEWADDR` rejected). The sandbox still applies; the network boundary degrades to the egress command screen. That is surfaced as `netnsDegraded: true` so doctor/callers do not claim isolation they do not have.

Force netns: `security.osSandboxUnshareNet` or `XCLAW_OS_SANDBOX_NET=deny|allow`. Egress itself: `XCLAW_EGRESS=deny|allow|allowlist`.

Child env is stripped of secret-looking names by default (`XCLAW_BASH_ENV=strip-secrets`). See `src/security/env-policy.mjs`.

## What this is not

- **Not Docker.** `deploy/` compose is how you *run the gateway*, not how skill tools are jailed. The swarm `code-executor` SKILL.md may mention Docker; `tool.mjs` is a `child_process` stub — do not treat that as a container sandbox.
- **Not Wasm.** There is no Wasm skill runtime to enable.
- **Not Electron renderer isolation.** There is no `.exe` / `.dmg`.
- **Not a substitute for approvals / plan binding.** Router order remains: approve → revalidate plan → dispatch → computer applies spawn enforce + optional bwrap.

## Operator checklist

1. `apt install bubblewrap` on Linux hosts that will run untrusted bash.
2. `XCLAW_PROFILE=prod` (forces `osSandbox=auto`, `autoApprove=false`).
3. `XCLAW_EGRESS=deny` (or allowlist) so `--unshare-net` is attempted.
4. `node bin/xclaw.mjs doctor` — read `security.osSandbox` and any `netnsDegraded` note.
5. Red team: `npm run sandbox-redteam` when you need the scripted probe.

If doctor warns that bwrap is missing on prod, install it or accept that bash runs on the host filesystem with only egress regex + approvals.
