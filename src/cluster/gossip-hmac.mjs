/**
 * HMAC-signed gossip payloads.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { acceptSeq } from "./gossip-seq.mjs";
import { acceptNonce } from "./gossip-bloom.mjs";

const reject = {
  gossip_reject_total: 0,
  reasons: { invalid: 0, required: 0, replay: 0, seq: 0, nonce: 0 },
};

export function incGossipReject(n = 1, reason = "invalid") {
  reject.gossip_reject_total += n;
  const k = ["required", "replay", "seq", "nonce"].includes(reason) ? reason : "invalid";
  reject.reasons[k] = (reject.reasons[k] || 0) + n;
  return reject.gossip_reject_total;
}

export function getGossipRejectReasons() {
  return { ...reject.reasons };
}

export function getGossipRejectTotal() {
  return reject.gossip_reject_total;
}

export function resetGossipReject() {
  reject.gossip_reject_total = 0;
  reject.reasons = { invalid: 0, required: 0, replay: 0, seq: 0, nonce: 0 };
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

export function gossipHmacSecrets(cfg = {}) {
  const list = cfg?.cluster?.gossipHmacSecrets;
  if (Array.isArray(list) && list.length) return list.filter(Boolean);
  const one = gossipHmacSecret(cfg);
  const prev =
    cfg?.cluster?.gossipHmacSecretPrevious || process.env.XCLAW_GOSSIP_HMAC_SECRET_PREVIOUS || "";
  return [one, prev].filter(Boolean);
}

function stablePayload({ generation, owner, region, at, seq, nonce }) {
  return JSON.stringify({
    at: at || "",
    generation: Number(generation) || 0,
    nonce: nonce || null,
    owner: owner || null,
    region: region || "local",
    seq: seq == null ? null : Number(seq),
  });
}

export function signGossip(payload = {}, cfg = {}) {
  const secrets = gossipHmacSecrets(cfg);
  const secret = secrets[0] || gossipHmacSecret(cfg);
  const body = stablePayload(payload);
  if (!secret) return { ...payload, body, sig: null };
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return { ...payload, body, sig };
}

export function replayWindowMs(cfg = {}) {
  const n = Number(
    cfg?.cluster?.gossipReplayWindowMs ?? process.env.XCLAW_GOSSIP_REPLAY_MS ?? 300_000
  );
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

export function verifyGossip(payload = {}, cfg = {}) {
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireGossipHmac === true;
  const at = payload.at ? Date.parse(payload.at) : NaN;
  if (payload.at && Number.isFinite(at)) {
    const age = Date.now() - at;
    if (age > replayWindowMs(cfg) || age < -replayWindowMs(cfg)) {
      incGossipReject(1, "replay");
      return { ok: false, code: "GOSSIP_REPLAY", reason: "replay" };
    }
  }
  const secrets = gossipHmacSecrets(cfg);
  const secret = secrets[0] || gossipHmacSecret(cfg);
  if (!secret) {
    if (prod) {
      incGossipReject(1, "required");
      return { ok: false, code: "GOSSIP_HMAC_REQUIRED", reason: "required" };
    }
    return { ok: true, authMethod: "lab" };
  }
  const body = payload.body || stablePayload(payload);
  const sig = String(payload.sig || payload.signature || "");
  const a = Buffer.from(sig);
  const trySecrets = secrets.length ? secrets : [secret];
  for (let i = 0; i < trySecrets.length; i++) {
    const expected = createHmac("sha256", trySecrets[i]).update(body).digest("hex");
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (payload.seq != null) {
        const seqr = acceptSeq(cfg, {
          owner: payload.owner || payload.region || "local",
          seq: payload.seq,
        });
        if (!seqr.ok) {
          incGossipReject(1, "seq");
          return { ok: false, ...seqr };
        }
      }
      if (payload.nonce) {
        const nr = acceptNonce(payload.nonce);
        if (!nr.ok) {
          incGossipReject(1, "nonce");
          return { ok: false, ...nr };
        }
      }
      return { ok: true, authMethod: "hmac", rotated: i > 0 };
    }
  }
  incGossipReject(1, "invalid");
  return { ok: false, code: "GOSSIP_HMAC_INVALID", reason: "invalid" };
}

export default {
  signGossip,
  verifyGossip,
  gossipHmacSecret,
  gossipHmacSecrets,
  getGossipRejectTotal,
  getGossipRejectReasons,
};
