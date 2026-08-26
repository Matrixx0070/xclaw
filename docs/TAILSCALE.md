# Tailscale exposure

Reach your xclaw gateway from your other devices — or, deliberately, from the
public internet — without opening a port on your router or standing up a
reverse proxy. xclaw drives the `tailscale` CLI directly (no daemon library, no
extra dependency): it shells out to the binary you already installed to log in
to your tailnet.

## What it does

A gateway that binds `127.0.0.1` is reachable only from the machine it runs on.
Tailscale can put a stable HTTPS front door in front of that loopback port:

- **serve** — an HTTPS route reachable only from *your own tailnet* (the
  devices logged into the same Tailscale account). Private by default.
- **funnel** — an HTTPS route reachable from *the public internet*. Tailscale
  terminates TLS and forwards to your loopback port. Only ports **443, 8443,
  10000** are routable, and Funnel must be enabled for your tailnet.

In both modes the gateway itself never leaves loopback — Tailscale is the only
thing listening on an externally reachable address, and it forwards to
`127.0.0.1:<port>`.

## Configuration

Two knobs live under `gateway` in `~/.xclaw/xclaw.json`:

```jsonc
{
  "gateway": {
    "port": 18790,
    "bind": "custom",            // where the gateway socket itself listens
    "tailscale": {
      "mode": "off",             // "off" | "serve" | "funnel"
      "resetOnExit": false       // tear the route down when the gateway stops
    }
  }
}
```

### `gateway.bind` — the listen host

| value      | listens on            | notes                                              |
| ---------- | --------------------- | -------------------------------------------------- |
| `loopback` | `127.0.0.1`           | this machine only                                  |
| `auto`     | `127.0.0.1`           | alias of loopback                                  |
| `lan`      | `0.0.0.0`             | every interface — requires a gateway token         |
| `tailnet`  | this node's 100.x IP  | tailnet-only, direct (no serve) — requires a token |
| `custom`   | explicit `gateway.host` | back-compat default; host used verbatim          |

`bind` is resolved to a concrete host at gateway start, *before* the bind-safety
guard runs, so a non-loopback bind (`lan`, `tailnet`) is held to the same rule
as any other public bind: no gateway token, no start. `tailnet` degrades to
`127.0.0.1` if the tailnet can't be reached, so a tailnet outage can't wedge
startup.

### `gateway.tailscale.mode` — the front door

`serve` and `funnel` are *couplings*: choosing either one pins the gateway to
loopback regardless of what `bind`/`host` say, because Tailscale is meant to be
the single front door — binding the gateway to the LAN while a public Funnel is
live would expose it directly and bypass that door. `funnel` additionally forces
`gateway.authStrict = true`, because a public route with no token is an open
gateway. These overrides are applied at config load and recorded on
`_tailscaleCoupling` so `doctor` and the logs report honestly what was changed
and why.

`resetOnExit` is off by default: Tailscale routes persist across restarts (its
own default), which is usually what you want for an always-on gateway. Turn it
on if you want the route torn down (`serve reset` / `funnel reset`) the moment
the gateway shuts down.

## Onboarding

`xclaw init` (and `xclaw onboard`) asks for the exposure interactively:

```
Tailscale lets you reach this gateway from your other devices, or from the
public internet, without opening a router port.
  off    — gateway stays on this machine only (default)
  serve  — reachable from your own tailnet (private, HTTPS)
  funnel — reachable from the public internet (HTTPS; needs auth)
Docs: docs/TAILSCALE.md
Tailscale exposure (off|serve|funnel) [off]:
```

Choosing `serve` or `funnel`:

- warns if the `tailscale` binary isn't on `PATH` (nothing is written that
  can't be honored — you can install it and restart),
- pins the gateway to loopback and says so,
- asks whether to reset the route on exit,
- for `funnel`, prints a public-exposure warning and **guarantees a gateway
  token exists** — one is generated if you don't already have one, so a public
  Funnel is never written without auth.

## Design

- **CLI shell-out, no library.** Every Tailscale operation is a `spawnSync` of
  the `tailscale` binary with an argument array and **no shell** — there is no
  string interpolation into a command line, so there is no command-injection
  surface. The binary is located via `XCLAW_TAILSCALE_BIN`, then `PATH`, then a
  short list of well-known install locations (Linux, Homebrew, macOS app).
- **Never fatal.** Host resolution, whois, and route setup all degrade to
  `null` / an inactive handle and log — a Tailscale hiccup can slow or disable
  exposure but can never take the gateway down.
- **Background routes.** Routes are registered with `serve --bg --yes` /
  `funnel --bg --yes` and torn down with `serve reset` / `funnel reset`.
- **Noisy JSON.** `status --json` / `whois --json` output is sliced between the
  first `{` and last `}` before parsing, so a leading warning line from the CLI
  doesn't break identity or host resolution.

The module is `src/net/tailscale.mjs`; it is wired into config load
(`coupleTailscaleExposure`), the gateway lifecycle
(`resolveGatewayBindHost` + `startGatewayTailscaleExposure` +
teardown on shutdown), and onboarding (`src/cli/init.mjs`).

## Documented follow-ups (not yet wired)

Two capabilities from the reference design are intentionally left for a later
slice — the primitives exist in the module but are not yet consumed by the live
auth/CORS paths:

- **Tailnet identity headers.** `readTailscaleWhoisIdentity(ip)` maps a
  connecting tailnet IP to `{ login, name? }` (60s cache). A future slice can
  surface this as an authenticated principal for requests arriving over the
  tailnet, so tailnet peers are attributable without a shared token.
- **Automatic tailnet CORS origin.** On `serve`/`funnel` start the resolved
  `https://<tailnet-host>` origin is appended to `gateway.corsOrigin` *when that
  is already an allowlist array*, so the Control UI served over the tailnet host
  can call the gateway. It does not otherwise widen CORS.
