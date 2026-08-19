/**
 * HMAC-signed gossip payloads.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const reject = { gossip_reject_total: 0 };

export function incGossipReject(n = 1) {
  reject.gossip_reject_total += n;
  return reject.gossip_reject_total;
}

export function getGossipRejectTotal() {
  return reject.gossip_reject_total;
}

export function resetGossipReject() {
  reject.gossip_reject_total = 0;
}

export function gossipHmacSecret(cfg = {}) {
  return (
    cfg?.cluster?.gossipHmacSecret ||
    process.env.XCLAW_GOSSIP_HMAC_SECRET ||
    cfg?.cluster?.hmacSecret ||
    process.env.XCLAW_CLUSTER_HMAC_SECRET ||
    ""
  );
}

function stablePayload({ generation, owner, region, at }) {
  return JSON.stringify({
    at: at || "",
    generation: Number(generation) || 0,
    owner: owner || null,
    region: region || "local",
  });
}

export function signGossip(payload = {}, cfg = {}) {
  const secret = gossipHmacSecret(cfg);
  const body = stablePayload(payload);
  if (!secret) return { ...payload, body, sig: null };
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return { ...payload, body, sig };
}

export function verifyGossip(payload = {}, cfg = {}) {
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireGossipHmac === true;
  const secret = gossipHmacSecret(cfg);
  if (!secret) {
    if (prod) {
      incGossipReject();
      return { ok: false, code: "GOSSIP_HMAC_REQUIRED" };
    }
    return { ok: true, authMethod: "lab" };
  }
  const body = payload.body || stablePayload(payload);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const sig = String(payload.sig || payload.signature || "");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    incGossipReject();
    return { ok: false, code: "GOSSIP_HMAC_INVALID" };
  }
  return { ok: true, authMethod: "hmac" };
}

export default { signGossip, verifyGossip, gossipHmacSecret, getGossipRejectTotal };
