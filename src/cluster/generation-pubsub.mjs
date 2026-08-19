/**
 * In-process generation pubsub stub.
 */
const subs = new Set();

export function subscribeGeneration(fn) {
  if (typeof fn !== "function") return () => {};
  subs.add(fn);
  return () => subs.delete(fn);
}

export function publishGeneration(payload = {}) {
  const msg = {
    generation: Number(payload.generation) || 0,
    owner: payload.owner || null,
    region: payload.region || "local",
    at: payload.at || new Date().toISOString(),
  };
  for (const fn of subs) {
    try {
      fn(msg);
    } catch {
      /* */
    }
  }
  return msg;
}

export function subscriberCount() {
  return subs.size;
}

export function resetGenerationPubsub() {
  subs.clear();
}

export default {
  subscribeGeneration,
  publishGeneration,
  subscriberCount,
  resetGenerationPubsub,
};
