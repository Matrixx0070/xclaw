# XClaw

**Self-hosted multi-LLM agent gateway** with a real computer (tools + optional full CDP), swarm DAG + receipts, and production-minded guards.

Not a thin chat wrapper: agents can **run tools**, **verify work**, **merge worktrees**, and **prove** outcomes with evals and soak scripts.

> Honest scope: competitive with serious open agent platforms. Not “one year ahead of the entire industry.” See [MILESTONE-2026-08-12.md](./MILESTONE-2026-08-12.md).

## Requirements

- **Node.js ≥ 22**
- An API key for live runs (`XAI_API_KEY`, or other providers via config)

## Quick start

```bash
git clone https://github.com/Matrixx0070/xclaw.git
cd xclaw

export XAI_API_KEY=xai-...
export XCLAW_PROFILE=lab          # auto-approve tools (lab)
export XCLAW_MODEL=xai/grok-4.5   # example

# optional: doctor / health
node bin/xclaw.mjs doctor
node bin/xclaw.mjs gateway        # WebChat + agent API

# one-shot agent turn
node bin/xclaw.mjs agent "Create /tmp/hello.txt with content ok"
```

| Surface | Default |
|---------|---------|
| Gateway | http://127.0.0.1:18790 |
| WebChat | http://127.0.0.1:18790/chat/ |
| Control | http://127.0.0.1:18790/control/ |
| Computer | http://127.0.0.1:4243 (auto-started) |

Config: `~/.xclaw/xclaw.json`

More detail: **[INSTALL.md](./INSTALL.md)** · **[OPS.md](./OPS.md)** · **[docs/](./docs/)**

## What you get

| Area | Capability |
|------|------------|
| **Agent** | Multi-provider loop, tools, loop guards, role routing |
| **Computer** | Bash / files / browser tools; thin lab server or full **~16MB** CDP runtime |
| **Strategy C** | Modules are source; bundle is runtime — `npm run build:computer` |
| **Swarm** | DAG tasks, receipts, early worktree→main merge, merge error codes |
| **Jobs / eval** | Verified jobs, eval suite, release-gate scripts |
| **Ops** | `/health`, `/ready`, `/metrics`, profiles lab/dev/prod |
| **Security** | Approvals, optional gateway token, sandbox-minded paths |

## Computer engines (Strategy C)

| Engine | Entry | When |
|--------|--------|------|
| **native** (default lab) | `src/computer/thin-server.mjs` | Fast, module-editable tools |
| **generated** | `src/computer/generated/computer-server.mjs` | esbuild from modules (`npm run build:computer`) |
| **bundle** | `src/computer/xclaw-server.mjs` (~16MB) | Full CDP / BrowserService — **do not hand-edit** |

```bash
npm run build:computer
XCLAW_COMPUTER_ENGINE=generated   # modules-built
XCLAW_COMPUTER_ENGINE=bundle      # full CDP
```

Policy: [src/computer/STRATEGY_C.md](./src/computer/STRATEGY_C.md)

## Profiles

```bash
XCLAW_PROFILE=lab     # auto-approve, higher loop limits
XCLAW_PROFILE=prod    # stricter approvals / guards
```

## Swarm (programmatic)

Implement → early merge → verify is supported via `runSwarmFanOut` (see `src/agents/swarm-run.mjs`).  
Merge candidates are **implement-only** (or `merge: true`); same-tree merges are no-ops; failures carry codes such as `PATCH_CORRUPT`, `PATCH_REJECT`.

## Tests & soak

```bash
node --test test/computer-strategy-c.test.mjs test/computer-c3-generated.test.mjs
node --test test/merge-*.test.mjs test/swarm-early-merge.test.mjs

# short live soak (needs API key)
node scripts/soak-agent.mjs 3
```

Broader gates: `npm run release-gate:quick` · `npm run eval:ci`

## Production sketch

```bash
export XCLAW_PROFILE=prod
export XCLAW_GATEWAY_TOKEN=long-random-secret

# Docker
cd deploy && docker compose up -d --build
```

See **deploy/** and **OPS.md**.

## Docs map

| Doc | Topic |
|-----|--------|
| [INSTALL.md](./INSTALL.md) | Install, verify, troubleshooting |
| [OPS.md](./OPS.md) | Operations, MITM, runtime |
| [MILESTONE-2026-08-12.md](./MILESTONE-2026-08-12.md) | Proven capabilities & gaps |
| [src/computer/STRATEGY_C.md](./src/computer/STRATEGY_C.md) | Computer source vs runtime |
| [docs/API.md](./docs/API.md) | HTTP / gateway API |
| [docs/](./docs/) | Auth, approvals, swarm notes, … |

## License

MIT — see [THIRD_PARTY.md](./THIRD_PARTY.md) for bundled components.

---

**Repo:** https://github.com/Matrixx0070/xclaw
