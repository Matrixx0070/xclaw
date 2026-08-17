/**
 * Bounded in-memory queue with explicit drop policy and metrics.
 * Use for telemetry, SSE fan-out, tool-result buffers — never unbounded RAM.
 *
 * Policies:
 *   drop_oldest — freshest-wins (live views)
 *   drop_newest — preserve backlog
 *   block       — backpressure (sync only; avoid on hot event loops)
 */

export const DropPolicy = {
  DROP_OLDEST: "drop_oldest",
  DROP_NEWEST: "drop_newest",
  BLOCK: "block",
};

export function createBoundedQueue({ maxsize = 1024, policy = DropPolicy.DROP_OLDEST } = {}) {
  if (maxsize < 1) throw new Error("maxsize must be >= 1");
  const buf = [];
  const metrics = {
    received: 0,
    enqueued: 0,
    dropped: 0,
    dequeued: 0,
    maxDepth: 0,
    lastDropAt: null,
  };

  function touch() {
    if (buf.length > metrics.maxDepth) metrics.maxDepth = buf.length;
  }

  function dropOne() {
    metrics.dropped += 1;
    metrics.lastDropAt = Date.now();
  }

  return {
    get size() {
      return buf.length;
    },
    get metrics() {
      return {
        ...metrics,
        depth: buf.length,
        dropRate: metrics.received ? metrics.dropped / metrics.received : 0,
      };
    },
    push(item) {
      metrics.received += 1;
      if (policy === DropPolicy.BLOCK) {
        if (buf.length >= maxsize) {
          dropOne();
          return false;
        }
        buf.push(item);
        metrics.enqueued += 1;
        touch();
        return true;
      }
      if (buf.length < maxsize) {
        buf.push(item);
        metrics.enqueued += 1;
        touch();
        return true;
      }
      if (policy === DropPolicy.DROP_NEWEST) {
        dropOne();
        return false;
      }
      buf.shift();
      dropOne();
      buf.push(item);
      metrics.enqueued += 1;
      touch();
      return true;
    },
    shift() {
      if (!buf.length) return undefined;
      metrics.dequeued += 1;
      return buf.shift();
    },
    peek() {
      return buf[0];
    },
    clear() {
      buf.length = 0;
    },
    toArray() {
      return buf.slice();
    },
  };
}
