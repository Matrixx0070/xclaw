# Tool planes (honest status)

## What this sandbox has
Separate gateways: browse / search / code / bash as parallel planes.

## What XClaw has
**Single agent loop** + **computer plane** (tools via HTTP/native modules):

| Plane | XClaw surface |
|-------|----------------|
| Bash | `xclaw_bash` + spawn enforce + optional bwrap |
| Files | `xclaw_file_*` modules |
| Browser | `xclaw_browser_tab` (native) + optional **bundle CDP** (`XCLAW_COMPUTER_ENGINE=bundle`) |
| Network details | `browser-network-details` (extracted / MITM flows) |
| Search / web | Via browser tools or model tools — not a separate search gateway |
| Code | Agent edits via file tools + bash; no isolated “code worker” process |

## Parallel tool gateway
Not implemented as separate OS processes. Parallelism today:

- Tool concurrency in agent loop (parallel-safe reads vs serial writes)
- Optional swarm multi-node

A true multi-plane gateway (browse ∥ search ∥ code ∥ bash) is a **product architecture bet**, not a skill copy. Prefer shipping after real multi-tool latency pain.

## Full CDP
- **native** thin server: tab/navigate/snapshot style tools  
- **bundle** `xclaw-server.mjs`: full BrowserService / CDP — use when needed, do not hand-edit (Strategy C)
