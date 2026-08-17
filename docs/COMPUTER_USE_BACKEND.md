## Doctor

Error codes: [CUA_ERRORS.md](./CUA_ERRORS.md).


```bash
node scripts/cua-doctor.mjs
# → reports/autonomy/cua-doctor.json
```

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


## Desktop observe — AT-SPI (I5b)

Linux accessibility tree → same shape as browser observe:

```json
{ "name": "xclaw_computer_act", "arguments": { "surface": "desktop", "action": "observe", "app": "Firefox", "max": 40 } }
```

Returns `elements[]` with `ref` (`d1`…), `role`, `name`, `bbox`, `cx`, `cy`.

Requires `python3` + `pyatspi` (or `gir1.2-atspi-2.0`). Helper: `scripts/desktop-atspi-observe.py`.

Not PyAutoGUI — structured a11y, not pixels. Act still needs `XCLAW_DESKTOP_GUI=1` + xdotool.


## I6 — CUA eval suite

Offline long-horizon **policy** suite (no LLM required):

```bash
node scripts/eval-cua-i6.mjs
# or
node --test test/cua-i6.test.mjs
```

Cases in `eval/cases/cua-i6.json`. Report: `reports/autonomy/cua-i6.json`.

Validates: observe structure, act fail-closed, ref cache, desktop disabled, AT-SPI honest errors, reach policy, serial planes, multi-step observe→no silent click chain.


## Windows UIA observe (W1)

```bash
# On Windows host with pywinauto:
pip install pywinauto
```

```json
{ "name": "xclaw_computer_act", "arguments": { "surface": "desktop", "action": "observe", "app": "Notepad", "max": 40 } }
```

Helper: `scripts/desktop-uia-observe.py` → `mode: "uia"`, refs `w1`…

| Code | Meaning |
|------|---------|
| UIA_NOT_INSTALLED | need pywinauto |
| UIA_DESKTOP_FAILED / UIA_WALK_FAILED | COM/UIA error |
| DESKTOP_OBSERVE_UNSUPPORTED_OS | not win32 (helper self-check) |

Act on Windows still stub (`DESKTOP_GUI_UNSUPPORTED_OS`) until W2.


## Windows UIA act (W2)

Opt-in only (`XCLAW_DESKTOP_GUI=1`) on **Windows** with `pywinauto`:

```json
{ "surface": "desktop", "action": "click", "x": 100, "y": 200 }
{ "surface": "desktop", "action": "type", "text": "hello" }
{ "surface": "desktop", "action": "key", "key": "enter" }
{ "surface": "desktop", "action": "invoke", "title": "Untitled", "name": "Save" }
```

Helper: `scripts/desktop-uia-act.py` (mouse/keyboard + UIA invoke by name).

Still prefer browser CDP for web UIs. macOS act remains unsupported.


## macOS AX observe (M1)

```bash
# On macOS:
pip install pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa
# Grant: System Settings → Privacy & Security → Accessibility (to Terminal/node)
```

```json
{ "surface": "desktop", "action": "observe", "app": "Safari", "max": 40 }
```

Helper: `scripts/desktop-ax-observe.py` → `mode: "ax"`, refs `a1`…

| Code | Meaning |
|------|---------|
| AX_NOT_INSTALLED | need pyobjc |
| AX_TCC_REQUIRED | Accessibility permission missing |
| AX_WALK_FAILED | tree walk error |

**M2 done** — act under `XCLAW_DESKTOP_GUI=1`:

```json
{ "surface": "desktop", "action": "click", "x": 100, "y": 200 }
{ "surface": "desktop", "action": "type", "text": "hello" }
{ "surface": "desktop", "action": "key", "key": "cmd+s" }
{ "surface": "desktop", "action": "invoke", "name": "Save", "app": "TextEdit" }
```

Helper: `scripts/desktop-ax-act.py` (CGEvent + AXPress with CGEvent fallback).


Retry: see [CUA_ERRORS.md](./CUA_ERRORS.md#retry-policy).
