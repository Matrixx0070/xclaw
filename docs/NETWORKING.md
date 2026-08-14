# Networking robustness (XClaw)

## Layers (use together)

| Layer | Mechanism | Where |
|-------|-----------|--------|
| 1. Path / half-open | TCP keepalive | `cdp-client` socket `setKeepAlive` |
| 2. Framing liveness | WebSocket ping/pong | `cdp-client` auto-reply + `session.ping()` |
| 3. App heartbeat | Periodic WS ping | `session.startHeartbeat({ intervalMs })` |
| 4. Fail-fast | Reject pending on close | `cdp-client` `markClosed` |
| 5. Recovery | Re-attach / reconnect | Caller: `listPages` → `attach` with backoff |

HTTP/2 PING, WINDOW_UPDATE, and QUIC MAX_STREAM_DATA apply to **h2/h3 API stacks**, not CDP WebSockets.

## CDP client options

```js
const cdp = createCdpClient({
  host: "127.0.0.1",
  port: 9222,
  keepAlive: true,                 // default true
  keepAliveInitialDelayMs: 30_000, // TCP first probe hint
  heartbeatIntervalMs: 30_000,     // 0 = off (default); set for long sessions
  heartbeatTimeoutMs: 5_000,
});

const session = await cdp.attach();
// or manual: session.startHeartbeat({ intervalMs: 30_000, onMiss: () => session.close() });
```

## Recommended defaults

| Environment | TCP keepalive | WS heartbeat |
|-------------|---------------|--------------|
| Loopback CDP | on, 30–60s | optional 30–60s |
| Long agent browser | on, 30s | **on**, 30s, reconnect on miss |
| Short one-shot | on | off |

## Not in scope of cdp-client

- Full BrowserService / multi-tab Network domain (bundle)
- HTTP/2 or QUIC flow control (Node/fetch stack)
- Maglev / multi-gateway routing
