# BROWSER_UNBUNDLE — completed (historical)

The browser un-bundling effort is **complete**: the computer plane runs a
single native engine with full real-browser capability (managed headless
Chrome + CDP tab layer). The vendored 16MB CDP bundle was retired on
2026-08-24.

- Decision + details: [`docs/adr/0005-computer-engine-unification.md`](adr/0005-computer-engine-unification.md)
- Current backend guide: [`docs/COMPUTER_USE_BACKEND.md`](COMPUTER_USE_BACKEND.md)
- Archived artifact (forensics only): GitHub release `computer-bundle`, asset
  `xclaw-server.mjs`, sha256
  `9d95d067d7e20229305ff87370705c77a29f96506f10ed6aa19dac976ab33a46`
