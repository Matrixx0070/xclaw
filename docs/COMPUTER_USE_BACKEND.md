# Computer Use Backend (integrate, don’t rewrite)

XClaw attaches CUA capabilities to the **existing** computer plane:

- `src/computer/modules/*` — edit source (Strategy C)
- `thin-server.mjs` / `xclaw-server.mjs` — runtime
- `src/tools/planes.mjs` — computer plane, serial actuation
- `src/browser/*` — Horizon/CDP helpers (agent process)

## Policy order

`tools / connectors → observe (structure) → GUI screenshot/click (bundle/CDP)`

Encoded as `capability-reach.cuaPolicy = "tools_first_then_observe_then_gui"`.

## Native engine (default lab)

| Action | Support |
|--------|---------|
| navigate / list / read | yes |
| **observe** | yes — HTML-derived interactive elements (`ref`, `role`, `name`) |
| screenshot / jsCode / click / type | no — returns `CUA_ACT_REQUIRES_BUNDLE` |

## Bundle / CDP

Set `XCLAW_COMPUTER_ENGINE=bundle` or `XCLAW_CDP_URL=http://127.0.0.1:9222`.

## Reach fields

`resolveReach()` reports: `browserObserve`, `screenshot`, `desktopGui` (false until DesktopDriver), `cuaPolicy`, `fullBrowser`.

## Roadmap

- **I1** observe — done (native structure)
- **I2** wire Horizon motor click/type on bundle path
- **I3** planes serial marks for actuation (done for existing computer tools)
- **I4–I5** DesktopDriver optional
- **I6** long-horizon eval

Do **not** hand-edit `xclaw-server.mjs`; extend modules and rebuild.
