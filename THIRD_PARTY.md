# Third-party notices

## OpenClaw

Portions of tool-loop detection under `src/agent/openclaw-loop/` are adapted from
[OpenClaw](https://github.com/openclaw/openclaw) (MIT License).

Copyright (c) OpenClaw contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## OpenClaw allow-from

`src/channels/allow-from.mjs` adapted from OpenClaw `src/channels/allow-from.ts` (MIT).


## OpenClaw tool-allowlist-guard + exec-allowlist-pattern

- `src/security/tool-allowlist-guard.mjs` ← `src/agents/tool-allowlist-guard.ts`
- `src/security/exec-allowlist-pattern.mjs` ← `src/infra/exec-allowlist-pattern.ts`


## OpenClaw session keys

- `src/sessions/session-key.mjs` ← session-key-utils / routing patterns
- `src/sessions/session-target.mjs` ← cron/session-target.ts


## OpenClaw MCP patterns

- `src/mcp/shared.mjs`, `handlers.mjs`, `server.mjs` adapted from OpenClaw mcp channel-tools / tools-stdio-server patterns (MIT).


## OpenClaw cron

- `src/cron/delivery.mjs`, `schedule.mjs`, `scheduler.mjs` adapted from OpenClaw cron delivery/session-target patterns (MIT).


## OpenClaw daemon

- `src/shared/pid-alive.mjs` ← pid-alive.ts
- `src/daemon/systemd-unit.mjs` ← systemd-unit.ts


## OpenClaw media

- `src/media/provider-registry.mjs`, `openai-image.mjs`, `runtime.mjs` adapted from OpenClaw media-generation patterns (MIT).


## OpenClaw pairing

- `src/pairing/pairing-store.mjs` adapted from OpenClaw pairing-store / pairing-messages (MIT).

