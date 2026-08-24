# COMPUTER_SOURCE_OF_TRUTH

Since the engine reversal (ADR 0006, 2026-08-24) the single computer server
is the tracked, hand-patched bundle:

- `src/computer/xclaw-server.mjs` — THE computer HTTP server (single engine).
  Tracked in git; every hand edit carries an `// A6: thin-server merge — …`
  marker. Anchor line numbers drift with each edit — re-grep before editing.
- `src/computer/modules/*` — maintained tool source (bash, files, browser
  tab, network details, computer act). The bundle bridges into these via
  `loadNativeMergeModule` for env policy, sandboxing, SSRF, motor, hooks,
  and the thin browser verbs — edit these directly for that logic.
- `src/computer/chrome-session.mjs` — managed headless Chrome lifecycle
  (library, used by the bundle's bridges).
- `src/computer/modules/browser-cdp.mjs` — CDP tab layer (jsCode,
  screenshots, console, network capture).
- `src/computer/chrome-args.mjs` — canonical Chrome argv builder.
- `scripts/ensure-computer.mjs` — spawn-or-adopt helper for the lab.

`thin-server.mjs` is deleted (thin parity was proven gap-by-gap first).
History: [`docs/adr/0006-bundle-engine-reversal.md`](adr/0006-bundle-engine-reversal.md)
(supersedes the direction of [ADR 0005](adr/0005-computer-engine-unification.md)).
