# xclaw_bash result codes

Native / generated engines return a stable `code` on foreground (and background start) results.

| Code | ok | Meaning | Agent recovery |
|------|-----|---------|----------------|
| `BASH_OK` | true | Exit 0, output not truncated | Continue |
| `BASH_BG_STARTED` | true | `background: true`; see `pid`, `logFile` | Poll with `kill -0`; `tail` log; see [BASH_BACKGROUND.md](./BASH_BACKGROUND.md) |
| `BASH_EMPTY_COMMAND` | false | Missing command | Fix args |
| `BASH_SPAWN_DENIED` | false | Plan/spawn enforce | Do not retry without plan change |
| `BASH_SANDBOX_DENIED` | false | OS sandbox deny | Do not retry without sandbox change |
| `BASH_SPAWN_FAILED` | false | `spawn` error (e.g. missing binary) | Check environment |
| `BASH_TIMEOUT` | false | Hit timeout (max 120s) | Shorten work, raise timeout ≤120, or `background: true` |
| `BASH_ABORTED` | false | AbortSignal | Caller cancelled |
| `BASH_EXIT_NONZERO` | false | Process exited ≠ 0 | Read stderr; fix command |
| `BASH_SIGNAL` | false | Died from signal without timeout/abort classification | Inspect `signal` |
| `BASH_OUTPUT_TRUNCATED` | true* | Exit 0 but stdout/stderr hit 2MB cap | Use fewer logs, files, or `background` + logFile |

\* `ok` stays true on truncate-only so partial stdout remains usable; always check `outputTruncated` / `code`.

## Related fields

- `timedOut`, `interrupted`, `signal`, `stopForced`
- `outputTruncated`, `truncated: { stdout, stderr, maxChars }`
- `spawnEnforced`, `osSandboxed`, `netIsolated`, `envPolicy`

## Signals

Foreground stop uses process-group **SIGTERM**, then **SIGKILL** after grace (`security.bashTerminateGraceMs`, default 2000ms).
