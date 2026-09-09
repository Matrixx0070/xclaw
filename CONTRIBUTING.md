# Contributing

## Setup

```bash
git clone https://github.com/Matrixx0070/xclaw.git
cd xclaw
npm run install:local
```

Node.js **22.22.3+ (22.x), 24.15+ (24.x), or 25.9+**. Config lives at `~/.xclaw/xclaw.json` (created on first run). Never commit that file or a real `.env`.

## Tests

```bash
npm test
```

Ship-gate is `# fail 0`. Targeted: `node --test test/<file>.test.mjs`.

## Rules

- Do not commit API keys, OAuth tokens, or GitHub PATs. Placeholders: `.env.example`. Hygiene: `docs/SECRETS.md` and `SECURITY.md`.
- Do not `git add -A`. Stage listed files only. Untracked runtime artifacts (swarm python, local logs) stay untracked.
- Do not publish the npm package from a drive-by clone. The registry package is unpublished until the maintainer publishes it.
- Prefer small, reversible commits that still pass `npm test`.

## Docs map

Start at [README.md](./README.md) and [INSTALL.md](./INSTALL.md). Operator notes: [OPS.md](./OPS.md). Security: [SECURITY.md](./SECURITY.md).
