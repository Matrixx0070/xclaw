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

## CDP motor path (I2b)

When `XCLAW_CDP_URL=http://127.0.0.1:9222` (loopback Chromium with remote debugging):

```bash
chromium --remote-debugging-port=9222 --user-data-dir=$HOME/.xclaw/chrome-cdp
export XCLAW_CDP_URL=http://127.0.0.1:9222
```

`xclaw_computer_act` uses `src/browser/cdp-client.mjs` + `src/browser/motor.mjs` (planClick/planType/planScroll → Input.dispatch*).

| action | needs |
|--------|--------|
| click | x, y |
| type | text |
| key | key |
| scroll | deltaY (optional x,y) |
| screenshot | — |

`ref` from observe: cached on observe; on CDP click, resolved via DOM getBoundingClientRect (ref eN index or name match). Explicit x,y still preferred when known.

## Roadmap

- **I1** observe — done (native structure)
- **I2** stub — done (fail closed)
- **I2b** CDP motor path — done (CLEAN); bundle BrowserService still BUNDLE_ONLY
- **I3** planes serial — done
- **I4** observe ref→coords via CDP evaluate — done
- **I5** DesktopDriver — done (opt-in, Linux xdotool/ydotool; fail closed)
- **I6** long-horizon eval

Do **not** hand-edit `xclaw-server.mjs`; extend modules and rebuild.


## DesktopDriver (I5)

OS GUI **outside** the browser. **Opt-in only.**

```bash
export XCLAW_DESKTOP_GUI=1   # required
# Linux: install xdotool (or ydotool)
```

```json
{ "name": "xclaw_computer_act", "arguments": { "surface": "desktop", "action": "click", "x": 100, "y": 200 } }
```

| Code | Meaning |
|------|---------|
| DESKTOP_GUI_DISABLED | default — not opted in |
| DESKTOP_GUI_NO_BACKEND | no xdotool/ydotool |
| DESKTOP_GUI_UNSUPPORTED_OS | win/mac stubs |

Prefer **browser CDP** for web UIs. Desktop is last resort.
