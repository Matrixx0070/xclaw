# Phase G — Live in the operator’s day

## Channel commands
```
/job <goal>
/queue <goal>
/approve <pendingId>
/deny <pendingId>
/pending
/resume <jobId>
```

## Recovery
```bash
xclaw resume list
xclaw resume <jobId>
```

## Prod policy
`XCLAW_PROFILE=prod` — reads auto; write/exec/network need approval.

## Sidecar computer
```bash
export XCLAW_COMPUTER_URL=http://computer-host:4243
# or docker compose -f deploy/docker-compose.sidecar.yml up
```
