# COMPUTER_SOURCE_OF_TRUTH

Since the engine unification (ADR 0005, 2026-08-24) the source of truth for
the computer plane is simply the maintained source tree:

- `src/computer/thin-server.mjs` — the computer HTTP server (single engine)
- `src/computer/modules/*` — every tool (bash, files, browser tab, network
  details, computer act) — edit these directly
- `src/computer/chrome-session.mjs` — managed headless Chrome lifecycle
- `src/computer/modules/browser-cdp.mjs` — CDP tab layer (jsCode,
  screenshots, console, network capture)
- `src/computer/chrome-args.mjs` — canonical Chrome argv builder

There is no generated or vendored engine artifact. History of the retired
bundle pipeline: [`docs/adr/0005-computer-engine-unification.md`](adr/0005-computer-engine-unification.md).
