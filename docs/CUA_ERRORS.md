# CUA error codes

Stable `code` strings returned by `xclaw_computer_act`, desktop drivers, and helpers.  
Failures also include `recovery` / `hint` when enriched via `enrichCuaError`.

## Shape

```json
{
  "ok": false,
  "code": "CUA_ACT_REQUIRES_BUNDLE",
  "error": "human readable",
  "severity": "error",
  "surface": "cdp",
  "recovery": "what to do next",
  "hint": "same as recovery (compat)"
}
```

## Catalog (summary)

| Code | Surface | Recovery (short) |
|------|---------|------------------|
| `USE_BROWSER_OBSERVE` | browser | Use `browser_tab` observe |
| `CUA_ACT_REQUIRES_BUNDLE` | cdp | Set `XCLAW_CDP_URL` |
| `CUA_ACT_NOT_EXTRACTED` | bundle | CDP or extract BrowserService |
| `CDP_ATTACH_FAILED` | cdp | Chrome debug port / curl version |
| `CUA_ACT_NEED_COORDS` | cdp | Pass x,y or observe ref |
| `CUA_ACT_NEED_KEY` | cdp | Pass key string |
| `CUA_ACT_UNKNOWN` | cdp | click/type/key/scroll/screenshot |
| `CUA_ACT_EXEC_FAILED` | cdp | Retry / re-observe |
| `DESKTOP_GUI_DISABLED` | desktop | `XCLAW_DESKTOP_GUI=1` (lab) |
| `DESKTOP_GUI_UNSUPPORTED_OS` | desktop | Wrong OS for helper |
| `DESKTOP_GUI_NO_BACKEND` | desktop | Install xdotool / pywinauto / pyobjc |
| `DESKTOP_NEED_*` | desktop | Missing x,y / key / name / text |
| `ATSPI_*` | linux | Install pyatspi / session bus |
| `UIA_*` | windows | pywinauto / window name |
| `AX_*` / `AX_TCC_REQUIRED` | macos | pyobjc + Accessibility TCC |

Full map: `src/computer/cua-errors.mjs` (`CUA_ERROR_CATALOG`).

```bash
node -e "import { lookupCuaError } from './src/computer/cua-errors.mjs'; console.log(lookupCuaError('AX_TCC_REQUIRED'))"
node scripts/cua-doctor.mjs
```
