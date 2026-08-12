# Sandbox / host persistence (P3.6)

Ephemeral containers lose the gateway process on restart. Run XClaw as a supervised service.

## systemd unit

```ini
# /etc/systemd/system/xclaw.service
[Unit]
Description=XClaw gateway
After=network.target

[Service]
Type=simple
User=xclaw
WorkingDirectory=/opt/xclaw
Environment=NODE_ENV=production
EnvironmentFile=-/etc/xclaw/env
ExecStart=/usr/bin/node /opt/xclaw/bin/xclaw.mjs gateway
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now xclaw
sudo journalctl -u xclaw -f
```

## Docker Compose

```yaml
services:
  xclaw:
    image: node:22-bookworm
    working_dir: /app
    volumes:
      - ./:/app
      - xclaw-data:/root/.xclaw
    command: node bin/xclaw.mjs gateway
    ports:
      - "4243:4243"
    environment:
      - XAI_API_KEY=${XAI_API_KEY}
      - XCLAW_SERVER_PORT=4243
    restart: unless-stopped
volumes:
  xclaw-data:
```

## Health watchdog

```bash
scripts/watchdog.sh   # curl /health or /ready; restart if down
```

Cron example:

```cron
* * * * * /opt/xclaw/scripts/watchdog.sh >> /var/log/xclaw-watchdog.log 2>&1
```
