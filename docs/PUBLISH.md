# Publish XClaw (P4.5)

## Docker

```bash
docker build -t xclaw:3.1.0 .
docker run --rm -p 4243:4243 \
  -e XAI_API_KEY \
  -e XCLAW_GATEWAY_TOKEN \
  -v ~/.xclaw:/root/.xclaw \
  xclaw:3.1.0
```

Compose: `deploy/docker-compose.yml`

## Release zip

```bash
npm run package
# or
node scripts/package-release.mjs
```

## Single-node binary (experimental)

```bash
npx pkg bin/xclaw.mjs --targets node22-linux-x64 --output dist/xclaw
```

Prefer Docker for Office/ffmpeg deps.
