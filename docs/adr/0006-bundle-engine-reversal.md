# ADR 0006 — Computer engine unification, reversed: the bundle is the engine

Date: 2026-08-24
Status: accepted (supersedes the direction of ADR 0005; the "one engine" goal stands)

## Problem

ADR 0005 unified the two computer-server engines by making **native**
(`thin-server.mjs` + modules) the survivor and retiring the 16MB vendored CDP
bundle. The operator reversed that direction: the bundle
(`src/computer/xclaw-server.mjs`) is the one computer server, and the thin
server's unique functions are merged INTO it. The goal — exactly one engine,
no lost capability, no dead code — is unchanged; only which side survives
flipped.

The standing objection to the bundle was that it is a frozen, hand-edit-
forbidden artifact. That premise no longer holds: the bundle is now a
**tracked, hand-patched source file**. Every merge edit carries an
`// A6: thin-server merge — <reason>` marker (96 markers at merge completion),
and the bundle reaches back into the maintained native tree via
`loadNativeMergeModule` for the pieces that must stay auditable and shared
(env policy, os-sandbox/bwrap, SSRF floor, chrome-session, motor, hooks,
browser modules).

## Alternatives

1. **Keep ADR 0005's native direction** — rejected by the operator: the
   bundle's mature Express surface, session model, zod-validated tools, and
   CDP browser lifecycle are the richer base.
2. **Keep both engines** — the failure mode both ADRs exist to end.
3. **Bundle survives, thin merged in** (chosen) — hand-patch the thin
   server's behaviors into the bundle, prove parity gap-by-gap against a
   live rig, then delete `thin-server.mjs`.

## Decision

`src/computer/xclaw-server.mjs` is the single computer server, tracked in
git. The full thin-parity audit (50 numbered gaps) is closed: every blocker,
major, and minor either implemented in the bundle and live-verified by probe
(env-policy strip-secrets, bwrap sandbox bridge, spawn enforcement, workspace
confinement E_SANDBOX, relaxed file guards, browser lifecycle
adopt/teardown/stale-lock/re-probe, SSRF floor, network-capture record shape,
thin verb vocabulary for browser_tab, embeddable factory, host/port config,
lenient HTTP surface, envelope stamp `metadata:{name, engine:"bundle"}`), or
closed by construction (fixed file-tool root: the TransientShell re-anchors
every command at the session cwd), or deliberately skipped with a decision
note (16-slot FIFO concurrency ceiling kept; garbage numeric coercion kept
strict). `thin-server.mjs` is deleted only after that audit closed — the
operator's explicit gate.

Engine selection collapses the same way ADR 0005 did, mirrored:
`resolveComputerEngine` always returns `"bundle"`; legacy selectors
(`native`/`thin`/`generated`/`gen`/`c3`, `XCLAW_COMPUTER_NATIVE=1`) resolve
to the bundle with a one-time notice. `scripts/ensure-computer.mjs` replaces
`ensure-thin-computer.mjs` and accepts any healthy server on the port.

POST /call's result stays MCP-wrapped (`{ok, name, result:<CallToolResult>}`)
rather than thin's raw tool value: no in-repo caller of /call exists, and the
wrapped shape carries strictly more information.

## Tradeoffs

- The primary execution plane is a large generated-style file. Mitigated:
  tracked in git, every hand edit A6-marked and probe-covered, maintained
  logic imported from native source rather than duplicated.
- Anchor line numbers in the bundle drift with every edit; contributors must
  re-grep before editing (recorded in the merge ledger).
- The native browser stack from ADR 0005 (`chrome-session.mjs`,
  `browser-cdp.mjs`, modules) remains in-tree as the maintained source the
  bundle bridges to — it is a library now, not an engine.

## Consequences

- One engine, one health surface, one spawn path; doctor/status report
  `engine:"bundle"`, `strategyPhase:"unified-bundle"`.
- Thin-era callers keep working: bare tool names, camelCase aliases,
  any-Content-Type bodies, JSON 404s, lenient create/destroy, envelope
  stamp — all bundled behind the same routes.
- The parity evidence (probe scripts and the 50-gap ledger) lives in the
  session scratchpad and the release notes; the A6 markers in the bundle are
  the durable in-repo map of every hand edit.
