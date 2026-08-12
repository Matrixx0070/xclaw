# WebSocket real-time updates

## Endpoint

```
ws://<host>:<port>/ws/events
wss://… when TLS enabled
```

Zero-dependency RFC6455 text hub (`src/gateway/ws-hub.mjs`).

## Client protocol

```js
const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/events`);
ws.onopen = () => ws.send(JSON.stringify({
  type: "subscribe",
  channels: ["admission", "queue", "eviction", "swarm", "all"],
}));
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  // msg.type: ready | subscribed | event | ping | pong
  // msg.channel + msg.data for events
};
```

## Channels

| Channel | Sources |
|---------|---------|
| `admission` | admit / reject / abandon / complete |
| `queue` | enqueued, abandoned |
| `eviction` | KV eviction events |
| `swarm` | (reserved) |
| `ops` | pagerduty webhook hooks |
| `all` | everything |

## Control UI

`/control/` connects automatically and refreshes admission/queue on events; falls back to 8s poll + reconnect backoff.
