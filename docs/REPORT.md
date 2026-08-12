# Status report

```bash
xclaw report
xclaw report --out /tmp/xclaw-status.md
xclaw report --json --out /tmp/xclaw-status.json

curl -s http://127.0.0.1:18790/report
curl -s 'http://127.0.0.1:18790/report?format=json'
```

Overnight **eval cron** appends a status report section to `~/.xclaw/eval-cron.log` after each suite.
