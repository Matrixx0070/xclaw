/**
 * NATS subscriber adapter skeleton for signed generation gossip.
 */
import { verifyGossip, signGossip } from "./gossip-hmac.mjs";
import { mergeGossip } from "./gossip-watermark.mjs";

export function natsEnabled(cfg = {}) {
  return (
    process.env.XCLAW_GOSSIP_TRANSPORT === "nats" ||
    cfg?.cluster?.gossipTransport === "nats"
  );
}

export function natsSubject(cfg = {}) {
  const account = cfg?.tokens?.account || cfg?.cluster?.account || "default";
  return cfg?.cluster?.natsSubject || `xclaw.generation.${account}`;
}

export async function publishNatsGossip(cfg, payload) {
  if (!natsEnabled(cfg)) return { ok: true, skipped: true };
  const nc = cfg.nats || cfg.natsClient;
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireNats === true;
  if (!nc || typeof nc.publish !== "function") {
    return { ok: false, code: "NATS_UNAVAILABLE", failClosed: prod };
  }
  try {
    const signed = signGossip(payload, cfg);
    await nc.publish(natsSubject(cfg), JSON.stringify(signed));
    return { ok: true, backend: "nats" };
  } catch (e) {
    return {
      ok: false,
      code: "NATS_ERROR",
      error: String(e.message || e),
      failClosed: prod,
    };
  }
}

export function attachNatsSubscriber(cfg) {
  const nc = cfg.nats || cfg.natsClient;
  if (!nc || typeof nc.subscribe !== "function") {
    return { ok: false, code: "NATS_UNAVAILABLE" };
  }
  const sub = nc.subscribe(natsSubject(cfg), (raw) => {
    try {
      const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
      const v = verifyGossip(msg, cfg);
      if (!v.ok) return;
      mergeGossip(cfg, {
        generation: msg.generation,
        region: msg.region,
        owner: msg.owner,
      });
    } catch {
      /* */
    }
  });
  return { ok: true, sub };
}

export default { natsEnabled, publishNatsGossip, attachNatsSubscriber, natsSubject };
