# ADR 0005 — Computer engine unification (retire the vendored CDP bundle)

Date: 2026-08-24
Status: accepted — direction superseded by [ADR 0006](0006-bundle-engine-reversal.md) (2026-08-24): the bundle survives, thin merged in

## Problem

xclaw ran two computer-server engines:

- **native** (`src/computer/thin-server.mjs` + `src/computer/modules/*`):
  auditable source, bwrap-sandboxed bash, but browser capability limited to
  SSRF-guarded fetch — `jsCode`, `screenshot`, `click`/`type`, console logs,
  and multi-request network capture all returned "requires the CDP bundle".
- **bundle** (`src/computer/xclaw-server.mjs`): a 16,839,070-byte vendored
  artifact (395k lines, gitignored, fetched from a GitHub release,
  sha256-verified) with its own headless-Chrome lifecycle and full CDP
  browser capability, but unauditable, hand-edit-forbidden, and needing
  three env bridge modules to reach back into native source for
  enforcement hooks, motor, and Chrome argv.

Two engines meant doubled selection logic (engine resolver, gateway policy,
manager spawn paths, doctor checks), schema-probe workarounds in the agent
loop and swarm bridge (the frozen bundle's strict zod rejected the injected
`cwd`/`systemRunPlan` keys), and a live box pinned to the unauditable path
just to get a real browser.

## Alternatives

1. **Keep both engines** — status quo: permanent double maintenance, and the
   default config ships without real-browser capability.
2. **Make bundle the only engine** — full browser, but the primary execution
   plane becomes a 16MB unauditable blob; hand-edits forbidden; every fix
   requires a bundle republish.
3. **Native parity, then delete the bundle path** (chosen) — extend the
   native engine with a managed Chrome lifecycle + CDP tab layer, prove
   parity, delete the bundle machinery.

## Decision

Native gains the bundle's real-browser capability and becomes the single
engine:

- `src/computer/chrome-session.mjs` — managed headless Chrome per computer
  server process: lazy spawn (`--headless=new`, OS-assigned port via
  `DevToolsActivePort`), adoption of a still-live Chrome across server
  restarts, `XCLAW_CDP_URL` attach override, teardown on close.
- `src/computer/modules/browser-cdp.mjs` — CDP tab layer for
  `xclaw_browser_tab`: `render:true` real navigation, `jsCode`
  (Runtime.evaluate + console capture), full-PNG screenshots to disk with
  desktop/mobile device emulation, `action=console`, and Network.* event
  capture feeding `xclaw_browser_network_details`.
- `src/browser/cdp-client.mjs` gained CDP **event subscription** (`on()`),
  previously impossible (event frames were dropped).
- `xclaw_computer_act` falls back to the managed Chrome when no
  `XCLAW_CDP_URL` is attached — GUI actuation works with zero config.
- Phase A enforcement hooks (`beforeNavigate`/`beforeInput`: commit gates,
  role gates, jsCode motor-pattern policy) now run **engine-side** in
  `runBrowserTab`, preserving the in-process enforcement the bundle got via
  its bridges.

Deleted: `xclaw-server.mjs` handling, `hooks-bridge`/`motor-bridge`/
`chrome-args-bridge`/`bundle-entry`, bundle metadata JSONs, fetch/publish/
verify/bench bundle scripts and npm scripts, engine-selection branches,
`BUNDLE_ONLY_REGIONS`, and the `computerAcceptsCwd`/`computerAcceptsRunPlan`
schema probes + router strip branches (native always accepts both keys).

Legacy selectors (`engine:"bundle"|"full"|"xclaw-server"`, `generated`,
`XCLAW_COMPUTER_NATIVE=0`) resolve to native with a one-time notice, so
existing configs keep working.

## Tradeoffs

- The retired bundle's internal, never-exposed regions (its own HTTP server,
  `skills-context` prompt scaffolding, `BrowserService`) are superseded by
  thin-server / native prompts / chrome-session+browser-cdp respectively;
  nothing reachable through the tool API was dropped.
- The last published bundle stays archived and downloadable — GitHub release
  `computer-bundle`, asset `xclaw-server.mjs`, sha256
  `9d95d067d7e20229305ff87370705c77a29f96506f10ed6aa19dac976ab33a46` —
  verified byte-identical before deletion.
- Native CDP navigation applies the same SSRF policy as the fetch tier
  (`assertUrlAllowed`, metadata floor) at navigate time; DNS re-resolution
  inside Chrome remains out of scope (same as the bundle).

## Consequences

One engine, one spawn path, one policy answer. The computer server owns its
browser lifecycle; the gateway keeps supervising by HTTP health only.
Screenshots land on disk as full PNGs instead of truncated base64. Doctor
checks Chrome binary presence instead of bundle markers.
