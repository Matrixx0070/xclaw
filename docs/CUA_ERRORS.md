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
| `CDP_ATTACH_FAILED` | cdp | Chrome down / wrong port |
| `CDP_NO_PAGE` | cdp | No page target — open tab / navigate |
| `CDP_NOT_LOOPBACK` | cdp | Host not 127.0.0.1 |
| `CDP_SOCKET_CLOSED` | cdp | WS closed mid-command |
| `CDP_TIMEOUT` | cdp | HTTP/WS timeout |
| `CDP_HTTP_FAILED` | cdp | /json/* failed |
| `CDP_WS_FAILED` | cdp | WebSocket upgrade failed |
| `CDP_EVAL_FAILED` | cdp | Runtime.evaluate error |
| `CDP_NAVIGATE_FAILED` | cdp | Page.navigate failed |
| `CDP_SCREENSHOT_FAILED` | cdp | captureScreenshot failed |
| `CDP_INPUT_FAILED` | cdp | Input.dispatch* failed |
| `CUA_ACT_NEED_URL` | cdp | navigate needs url |
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

## Retry policy

Transient failures are retried with exponential backoff (`src/computer/cua-retry.mjs`).

| Env | Default | Meaning |
|-----|---------|---------|
| `XCLAW_CUA_RETRIES` | `2` | max retries after first attempt |
| `XCLAW_CUA_RETRY_BASE_MS` | `100`–`120` | base delay |
| `XCLAW_CUA_RETRY_MAX_MS` | `2000`–`3000` | cap |

**Retried:** `CDP_ATTACH_FAILED`, `CUA_ACT_EXEC_FAILED`, `*_EXEC_FAILED`, empty helper, brief registry blips.

**Not retried:** `DESKTOP_GUI_DISABLED`, `CUA_ACT_REQUIRES_BUNDLE`, `*_NEED_*`, `CUA_ACT_UNKNOWN`, `AX_TCC_REQUIRED`, missing installs.

Successful retries set `retried: true` and `retries: N` on the result.

## Retry metrics

In-process counters + optional JSONL:

```bash
node scripts/cua-retry-metrics.mjs demo   # force sample retries
node scripts/cua-retry-metrics.mjs show
node scripts/cua-retry-metrics.mjs tail   # ~/.xclaw/metrics/cua-retry.jsonl
node scripts/cua-doctor.mjs               # includes retryMetrics
```

| Field | Meaning |
|-------|---------|
| `attempts` | withCuaRetry invocations |
| `retries` | backoff sleeps |
| `retriedSuccesses` | success after ≥1 retry |
| `byCode` | per-code retry / finalOk / finalFail |
| `avgDelayMs` / `delayMsMax` | backoff timing |

Disable JSONL: `XCLAW_CUA_METRICS=0`. Custom dir: `XCLAW_CUA_METRICS_DIR`.

## classifyCdpError

```js
import { classifyCdpError, lookupCuaError } from "../src/computer/cua-errors.mjs";
const code = classifyCdpError(err);
const { recovery } = lookupCuaError(code);
```
