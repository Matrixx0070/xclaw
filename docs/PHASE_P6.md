# Phase P6 (v3.3.0)

| Item | Status |
|------|--------|
| Multi-user token vault | `src/connected/vault.mjs` |
| Slack Socket Mode polish | reconnect jitter backoff, envelope ack, status.mode |
| Eval CI (GitHub Actions) | `.github/workflows/eval-regression.yml` |
| Docker publish | `scripts/docker-publish.mjs` |

## Vault CLI

```bash
xclaw auth connected vault list-users
xclaw auth connected vault list alice
xclaw auth connected vault delete --user alice --app github
```

## Docker

```bash
npm run docker:publish
XCLAW_IMAGE=ghcr.io/you/xclaw npm run docker:push
```

## CI

Push to main → unit `eval-regression`. Live job only if `XAI_API_KEY` secret set.
