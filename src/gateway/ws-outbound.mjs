/**
 * Optional per-client outbound bounded queue for WS hub.
 * Used when ws-hub wires enqueueFrame into broadcast.
 */
import { createBoundedQueue, DropPolicy } from "../shared/bounded-queue.mjs";

export const DEFAULT_OUTBOUND_MAX = 64;
export const outboundStats = { dropped: 0, enqueued: 0, written: 0 };

export function enqueueFrame(client, frame) {
  if (!client.outbound) {
    client.outbound = createBoundedQueue({
      maxsize: client.outboundMax || DEFAULT_OUTBOUND_MAX,
      policy: DropPolicy.DROP_OLDEST,
    });
  }
  const before = client.outbound.metrics.dropped;
  const ok = client.outbound.push(frame);
  outboundStats.enqueued += 1;
  const after = client.outbound.metrics.dropped;
  if (after > before) outboundStats.dropped += after - before;
  flushOutbound(client);
  return ok;
}

export function flushOutbound(client) {
  if (!client?.socket || client.socket.destroyed || !client.outbound) return;
  while (client.outbound.size > 0) {
    const frame = client.outbound.peek();
    try {
      const wrote = client.socket.write(frame);
      client.outbound.shift();
      outboundStats.written += 1;
      if (!wrote) {
        if (!client._drainBound) {
          client._drainBound = true;
          client.socket.once("drain", () => {
            client._drainBound = false;
            flushOutbound(client);
          });
        }
        break;
      }
    } catch {
      break;
    }
  }
}

export function wsOutboundStats() {
  return { ...outboundStats };
}
