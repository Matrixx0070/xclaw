# Background bash — status & kill examples

Native `xclaw_bash` with `background: true` returns immediately:

```json
{
  "ok": true,
  "code": "BASH_BG_STARTED",
  "pid": 12345,
  "logFile": "/tmp/xclaw-bash-bg/a1b2c3.log"
}
```

There is no separate status/kill tool. Use **follow-up `xclaw_bash`** (or file read) as below.

## Status (alive + recent log)

Tool call:

```json
{
  "name": "xclaw_bash",
  "arguments": {
    "command": "PID=12345; LOG=/tmp/xclaw-bash-bg/a1b2c3.log; if kill -0 \"$PID\" 2>/dev/null; then echo STATUS=ALIVE; else echo STATUS=DEAD; fi; echo \"--- log (tail) ---\"; tail -n 40 \"$LOG\" 2>/dev/null || echo \"(no log)\"",
    "timeout": 15
  }
}
```

Shorter form:

```bash
kill -0 12345 2>/dev/null && echo ALIVE || echo DEAD
tail -n 40 /tmp/xclaw-bash-bg/a1b2c3.log
```

## Kill (graceful then force)

```json
{
  "name": "xclaw_bash",
  "arguments": {
    "command": "PID=12345; kill \"$PID\" 2>/dev/null; sleep 1; if kill -0 \"$PID\" 2>/dev/null; then kill -9 \"$PID\"; echo KILLED=force; else echo KILLED=graceful_or_gone; fi",
    "timeout": 15
  }
}
```

## Read full log via file tool

```json
{
  "name": "xclaw_file_read",
  "arguments": { "path": "/tmp/xclaw-bash-bg/a1b2c3.log" }
}
```

## Agent pattern

1. `xclaw_bash` `{ command, background: true }` → save `pid` + `logFile`
2. Poll status with the status command above
3. When `STATUS=DEAD`, read log for results
4. If stuck, use the kill example

## Limits

- Native background jobs are **not** bound to computer session lifecycle
- Foreground timeout (max 120s) does **not** apply after detach
- Bundle engine adds process health probes and session `bgLogFiles`; native is fire-and-forget + log file
