# Mission federation — remote workers

Dispatch missions from one xclaw gateway (the **coordinator**) to others
(**workers**), and drive them from a single Mission Control. A worker is any
reachable xclaw gateway with missions enabled; its OWN evidence gate,
approval story, and operator-token auth apply unchanged on its host.
`repoDir` in a remote mission is always a path **on the worker**.

## Worker setup (on the worker host)

```sh
xclaw workers token          # ensure this gateway has an operator token
xclaw workers join-command   # prints the exact add-command for the coordinator
# → xclaw workers add my-worker http://127.0.0.1:18790 --token xclaw_…
```

`join-command --url https://worker.example.com` substitutes the public
endpoint. Restart the gateway after the first `token` run so auth is
enforced.

## Coordinator setup

```sh
xclaw workers add build-box https://build-box.example.com --token xclaw_…
xclaw workers list           # includes reachability + version + computer health
xclaw workers ping build-box
xclaw workers remove build-box
```

The same registry backs the Control-UI "Remote workers" card and the
launch-target selector; dispatch via UI or:

```sh
curl -X POST -H "x-xclaw-token: $TOKEN" -H "content-type: application/json" \
  -d '{"worker":"build-box","goal":"…","repoDir":"/srv/app"}' \
  http://127.0.0.1:18790/missions/remote
```

## TLS — required beyond loopback

URL policy: `https://` anywhere; plain `http://` only to loopback. The
`--allow-insecure` escape hatch exists for trusted lab LANs and nothing
else — the worker token rides every request header, so an unencrypted
non-loopback link leaks an operator credential with bash-level power on
the worker.

xclaw does not terminate TLS itself; put a reverse proxy in front of the
worker gateway:

```caddy
# Caddyfile — automatic Let's Encrypt
worker.example.com {
    reverse_proxy 127.0.0.1:18790
}
```

```nginx
server {
    listen 443 ssl;
    server_name worker.example.com;
    ssl_certificate     /etc/ssl/worker.pem;
    ssl_certificate_key /etc/ssl/worker.key;
    location / { proxy_pass http://127.0.0.1:18790; }
}
```

Keep the gateway itself bound to loopback (`gateway.host: 127.0.0.1`, the
default) so the proxy is the only way in. bind-guard refuses non-loopback
binds without a token in any case.

## Semantics worth knowing

- Coordinator and workers can run different providers/models.
- Remote merge/rollback proxy to the worker's gated endpoints — the
  coordinator never touches the worker's repo directly.
- Worker tokens live in the coordinator's `~/.xclaw/xclaw.json` (0600) and
  are redacted from every listing and API response.
- Never share an anthropic OAuth credential store between gateways —
  refresh-token rotation in one store invalidates the other. Give workers
  their own credentials (API keys, their own OAuth login, or a local
  provider).
