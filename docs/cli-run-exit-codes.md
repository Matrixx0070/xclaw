# `xclaw run` exit codes

Process exit status for `xclaw run` / `xclaw agent --stream` when streaming via the gateway resume client.

| Exit code | Error code | Retryable | Meaning | What to do |
|-----------|------------|-----------|---------|------------|
| **0** | — | — | Success | — |
| **1** | `UNKNOWN` / other | maybe | Generic or unclassified failure | Check stderr; retry or inspect gateway logs |
| **2** | `STREAM_NOT_FOUND` | no | Stream id unknown to gateway | Start a **new** run (omit `--resume`) |
| **2** | `STREAM_EXPIRED` | no | Buffer TTL elapsed / log GC’d | Start a **new** run |
| **3** | `AUTH` | no | Unauthorized (HTTP 401) | Set `XCLAW_GATEWAY_TOKEN` or fix gateway auth |
| **4** | `FORBIDDEN` | no | Forbidden (HTTP 403) | Use credentials allowed for that stream |
| **5** | `BAD_REQUEST` | no | Invalid request (missing message/goal, bad flags) | Fix CLI flags / body |
| **6** | `MAX_RESUME_CYCLES` | no | Outer resume attempts exhausted | Retry later or raise `--max-resume-cycles` |
| **7** | `NETWORK` | yes | Transport / DNS / connection error | Retry with same `--resume` + `--last-event-id` |
| **7** | `HEARTBEAT_TIMEOUT` | yes | No data/ping within timeout | Retry resume; check gateway health |
| **7** | `SERVER` | yes | HTTP 5xx / transient server | Retry; check `/metrics` and gateway logs |
| **130** | `ABORTED` | no | Interrupted (Ctrl+C / SIGTERM) | Optional: resume with printed `streamId` |

## Shell usage

```bash
xclaw run --ndjson "hello"
echo $?   # 0 on success

xclaw run --resume agent_dead --json-error
echo $?   # 2 if STREAM_NOT_FOUND
```

Machine-readable failure (stderr):

```bash
xclaw run --resume agent_x --json-error 2>/tmp/err.json
# /tmp/err.json includes: code, message, exitCode, retryable, streamId, lastEventId, hints
```

## Mapping source

Implemented in:

- `src/cli/stream-run.mjs` → `exitCodeForResumeError()`
- `src/client/stream-resume-client.mjs` → `ResumeError` / `classifyResumeError()`

```js
import { exitCodeForResumeError } from "../src/cli/stream-run.mjs";
```

## Scripting exit code handling

### Bash: branch on `$?`

```bash
xclaw run --ndjson "hello"
code=$?

case $code in
  0)
    echo "ok"
    ;;
  2)
    echo "stream gone — starting fresh (no --resume)"
    xclaw run --ndjson "hello"
    ;;
  3|4)
    echo "auth problem — check XCLAW_GATEWAY_TOKEN" >&2
    exit "$code"
    ;;
  5)
    echo "bad flags" >&2
    exit 5
    ;;
  6)
    echo "max resume cycles — wait and retry" >&2
    exit 6
    ;;
  7)
    echo "transient — retry with same resume cursor" >&2
    # example: xclaw run --resume "$STREAM_ID" --last-event-id "$LAST_ID"
    exit 7
    ;;
  130)
    echo "interrupted"
    exit 130
    ;;
  *)
    echo "unknown exit $code" >&2
    exit "$code"
    ;;
esac
```

### Sourceable helpers

```bash
source scripts/xclaw-run-lib.sh

xclaw run --resume "$ID" --last-event-id "$LAST" --json-error
code=$?

if xclaw_run_is_success "$code"; then
  exit 0
elif xclaw_run_should_fresh "$code"; then
  xclaw run --ndjson "$ORIGINAL_MESSAGE"
elif xclaw_run_should_retry "$code"; then
  sleep 2
  xclaw run --resume "$ID" --last-event-id "$LAST"
else
  exit "$code"
fi
```

### Retry wrapper script

```bash
# Retries only exit code 7 (transient); fails fast on 2/3/4/5/130
./scripts/xclaw-run-with-retry.sh "list /tmp"

XCLAW_MAX_TRIES=8 XCLAW_JSON_ERROR=1 \
  ./scripts/xclaw-run-with-retry.sh --resume "$STREAM_ID" --last-event-id "$LAST_ID"
```

### CI / `set -e`

```bash
set -euo pipefail

run_or_fresh() {
  local msg="$1"
  set +e
  out=$(xclaw run --ndjson "$msg" 2>err.txt)
  code=$?
  set -e
  if [[ $code -eq 0 ]]; then
    printf '%s\n' "$out"
    return 0
  fi
  if [[ $code -eq 2 ]]; then
    # Resume cursor invalid in this environment — one fresh attempt
    xclaw run --ndjson "$msg"
    return $?
  fi
  cat err.txt >&2
  return "$code"
}

run_or_fresh "smoke test"
```

### Node / JavaScript

```js
import { spawnSync } from "node:child_process";
import { exitCodeForResumeError } from "../src/cli/stream-run.mjs";

const r = spawnSync("xclaw", ["run", "--ndjson", "hello"], { encoding: "utf8" });
const code = r.status ?? 1;

if (code === 0) {
  console.log(r.stdout);
} else if (code === 2) {
  // STREAM_NOT_FOUND → new run
} else if (code === 7) {
  // transient → backoff + resume
} else {
  process.exit(code);
}
```

### Capture resume cursor from stderr

Human mode prints:

```text
[xclaw] resume: xclaw run --resume <streamId> --last-event-id <id>
```

```bash
err=$(mktemp)
xclaw run --ndjson "hello" 2>"$err" || true
stream_id=$(sed -n 's/.*--resume \([^ ]*\).*/\1/p' "$err" | tail -1)
last_id=$(sed -n 's/.*--last-event-id \([^ ]*\).*/\1/p' "$err" | tail -1)
# later:
# xclaw run --resume "$stream_id" --last-event-id "$last_id"
```

Prefer `--json-error` for reliable automation:

```bash
xclaw run --resume bad --json-error 2>err.json || code=$?
# err.json: { "code", "exitCode", "retryable", "streamId", "hints", ... }
```


## Backoff strategies in retry scripts

See [backoff-strategies.md](./backoff-strategies.md).

```bash
XCLAW_BACKOFF=decorrelated XCLAW_BASE_MS=1000 XCLAW_MAX_MS=30000 \
  ./scripts/xclaw-run-with-retry.sh --resume "$STREAM_ID" --last-event-id "$LAST_ID"
```
