# XClaw Hook System

Dynamic registration and execution of custom functions at key points in the
agent's lifecycle. Hooks let you observe, annotate, transform, or veto agent
runs **without touching core code** — failure-isolated, permission-tiered, and
config-gated.

Implementation: `src/hooks/manager.mjs` · examples: `src/hooks/examples.mjs` ·
wiring: `src/agent/loop.mjs` (search for `── Hook:`).

## Lifecycle points (categories)

| Category        | Fires                                        | Context fields                                             | Mutable (tier ≥ trusted) |
|-----------------|----------------------------------------------|------------------------------------------------------------|--------------------------|
| `pre_process`   | before the conversation is assembled          | `message, sessionKey, channel, userId, workingDir, cfg*`   | `message`                |
| `on_request`    | before **every** model request (each turn)    | `turn, model, messageCount, messages*, cfg*`               | — (observe)              |
| `on_response`   | after **every** model response                | `turn, finishReason, hasToolCalls, content (≤2 KB), cfg*`  | — (observe)              |
| `pre_tool_use`  | before every tool call (matcher-scoped)       | `toolName, args, turn, sessionKey, workingDir, cfg*`       | `args` + **decision**    |
| `post_tool_use` | after every tool call (matcher-scoped)        | `toolName, args, resultText, isError, turn, cfg*`          | `resultText`             |
| `on_stop`       | on clean completion — may veto and continue   | `text, turns, stopBlocks, stopHookActive, cfg*`            | — (system `{abort}` vetoes) |
| `post_process`  | after the final text is produced              | `text, turns, sessionKey, cfg*`                            | `text`                   |
| `on_error`      | when the loop fails (error still propagates)  | `error, turn, sessionKey, cfg*`                            | — (observe)              |

`*` = visible to the `system` tier only.

### Tool decisions (`pre_tool_use`, system tier)

Return `{ decision, reason }` — merged across hooks as **deny > ask > allow**:

- `deny` — the tool call is blocked before dispatch; the model sees
  `Tool <name> blocked by hook: <reason>` as the tool result.
- `ask` — escalates to a **human approval** through the standard approval
  gate, even when policy would auto-approve. Hooks compose with, never
  bypass, the security stack (allowlists and exec patterns still apply).
- `allow` — advisory pre-approval (recorded; never bypasses allowlists).

Returning `{ args: {...} }` rewrites the tool input before the security
plan is bound (system/trusted).

### Matchers

Any hook may carry `matcher` — pipe-separated tool patterns with `*`
wildcards, checked against the tool name for the tool categories:
`"xclaw_bash|bash"`, `"mcp__github__*"`, empty = all. `once: true` hooks
self-remove after their first execution.

### `on_stop` block cycle

A **system** `on_stop` hook returning `{ abort: "reason" }` on a clean
completion injects `[stop-hook] Not finished: <reason>` as a user turn and
re-enters the loop — goal-enforcement, Claude-Code-Stop-hook-style. The hook
receives `stopHookActive: true` on re-entries (return nothing then, or you'll
loop); cycles are capped by `hooks.stopBlockCap` (default 2). Never fires on
guard stops, pending approvals, budget stops, or aborts.

`post_process` runs **before** the transcript save, so transformations (e.g.
redaction) persist everywhere the text goes.

## Permission tiers

Tiers describe **capability**, and are assigned by whoever registers the hook
— for config-loaded modules, by the **operator's config entry**, never by the
module itself (self-elevation is clamped and logged).

| Tier      | Context                                   | May mutate | May abort a run |
|-----------|-------------------------------------------|------------|-----------------|
| `system`  | full — includes `cfg` and live `messages` | yes        | yes (`{abort}`) |
| `trusted` | redacted — no `cfg`, no `messages`        | yes        | no (ignored + logged) |
| `user`    | read-only sanitized **copy**              | no (returns ignored) | no    |

A `system` hook returning `{ abort: "reason" }` from `pre_process` stops the
run before any model call; the agent answers
`Run blocked by hook: <reason>` and later hooks in the chain do not run.

## API

```js
import { HookManager, createHookManager, getSharedHookManager } from "./src/hooks/manager.mjs";

const hooks = new HookManager({ cfg });          // or createHookManager({cfg})

// register — returns an id
const id = hooks.registerHook("pre_process", (ctx) => {
  return { message: ctx.message + " (be concise)" };
}, { name: "concise", tier: "trusted" });

hooks.listHooks();                 // [{id, category, name, tier}]
hooks.removeHook(id);              // by id
hooks.removeHook("pre_process", "concise"); // or by category+name
hooks.history(50);                 // execution log (ring buffer, last 200)

// execute (the loop does this for you at each lifecycle point)
const { context, abort, results } = await hooks.executeAll(
  "pre_process", { message: "hi" }, { mutable: ["message"] }
);
```

**Validation at registration:** the category must exist, the hook must be a
function taking a **single context argument** (arity ≤ 1), and the tier must
be one of `system|trusted|user`. Violations throw immediately.

**Error isolation at execution:** each hook runs inside its own try/catch and
a per-hook timeout (`cfg.hooks.timeoutMs`, default 2000 ms). A throwing or
hanging hook is recorded in `results[i].error` and logged — it never crashes
the agent, and `executeAll` never rejects.

**Logging:** every registration/execution/removal is appended to an in-memory
history and emitted through the logger (stdout by default, silence with
`hooks.log: false`). Execution records carry `{category, name, tier, ok, ms,
mutated?, error?}`.

## Configuration (`xclaw.json` → `hooks`)

```jsonc
{
  "hooks": {
    "enabled": true,                    // global kill-switch
    "categories": { "on_request": false }, // disable one category
    "timeoutMs": 2000,                  // per-hook budget
    "log": true,                        // stdout execution log
    "modules": [                        // loaded once at first agent run
      { "path": "/root/.xclaw/hooks/my-hooks.mjs", "tier": "trusted" }
    ]
  }
}
```

A module exports `register(manager)` and may register any number of hooks;
every registration is **capped at the tier assigned in the config entry**
(default `user`):

```js
// /root/.xclaw/hooks/my-hooks.mjs
export function register(manager) {
  manager.registerHook("post_process", (ctx) => {
    if (ctx.text.length > 4000) return { text: ctx.text.slice(0, 4000) + " …" };
  }, { name: "clamp-output", tier: "trusted" });
}
```

Programmatic embedders can also pass `hookManager` directly to
`runAgentLoop({ ..., hookManager })`.

## Command hooks (out-of-process — the isolation story)

`hooks.commands[]` entries run as **separate processes**, so the script has no
access to gateway memory regardless of tier — any language works:

```jsonc
{
  "hooks": {
    "commands": [{
      "name": "no-rm",
      "event": "pre_tool_use",
      "matcher": "xclaw_bash|bash",
      "tier": "system",
      "command": "/root/.xclaw/hooks/no-rm.sh",
      "timeoutMs": 5000
    }]
  }
}
```

Protocol: the (tier-filtered) context arrives as **JSON on stdin**; stdout may
be a JSON verdict (`{"decision":"deny","reason":"…"}` or mutable fields);
**exit 2 blocks** with stderr as the reason (works for `pre_process` abort,
`pre_tool_use` deny, and `on_stop` veto alike); any other non-zero exit is a
contained failure. Manage them live from the **Control UI → Hooks** section or
`POST/DELETE /hooks/commands` (changes persist to config and hot-apply).

## Runtime management

- `GET /hooks` — registered hooks, command/module inventory, category state
- `GET /hooks/history` — execution log
- `POST /hooks/toggle` — `{enabled}` or `{category, enabled}` (persisted)
- `POST /hooks/commands` / `DELETE /hooks/commands` — command-hook CRUD
- Control UI → **Hooks**: category toggles, hook table, history, command editor

## Example hooks (one per tier — `src/hooks/examples.mjs`)

- **system · `redact-secrets`** (`post_process`) — scrubs credential-shaped
  strings (`sk-ant-…`, `xai-…`, `xclaw_…`, `gh*_…`, `Bearer …`) from the final
  output before any channel sees it.
- **trusted · `timestamp-context`** (`pre_process`) — appends the current ISO
  time to the user message so the model knows "now" without a tool call;
  idempotent (never double-annotates).
- **user · `timing-logger`** (`on_request`/`on_response`) — logs model
  round-trip latency per turn; pure observer, return value ignored.

Register them all:

```js
import { registerExampleHooks } from "./src/hooks/examples.mjs";
registerExampleHooks(getSharedHookManager(cfg));
```

## Tests

`test/hooks-manager.test.mjs` (validation, tiers, mutation whitelist, abort
semantics, module tier-capping, isolation, timeout, logging, config gates) and
`test/hooks-loop.test.mjs` (end-to-end through `runAgentLoop` with an injected
provider: ordering, mutation flow, abort short-circuit, crash isolation,
`on_error`, global disable).
