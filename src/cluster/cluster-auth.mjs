/**
 * Auth for cluster peer routes (token or HMAC).
 */
import crypto from "node:crypto";
import { createHmac } from "node:crypto";

export function clusterToken(cfg = {}) {
  return (
    cfg?.cluster?.token ||
    process.env.XCLAW_CLUSTER_TOKEN ||
    cfg?.gateway?.stopAuthToken ||
    process.env.XCLAW_STOP_AUTH_TOKEN ||
    ""
  );
}

export function clusterHmacSecret(cfg = {}) {
  return (
    cfg?.cluster?.hmacSecret ||
    process.env.XCLAW_CLUSTER_HMAC_SECRET ||
    cfg?.gateway?.stopHmacSecret ||
    process.env.XCLAW_STOP_HMAC_SECRET ||
    ""
  );
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function authorizeCluster(req, cfg = {}, bodyText = "") {
  const token = clusterToken(cfg);
  const secret = clusterHmacSecret(cfg);
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuth === true;

  const authHeader = req?.headers?.authorization || req?.headers?.Authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const headerToken = req?.headers?.["x-xclaw-cluster-token"] || bearer || "";

  if (token && headerToken && timingSafeEqualStr(headerToken, token)) {
    return { ok: true, authMethod: "token" };
  }

  const sig = req?.headers?.["x-xclaw-cluster-signature"] || "";
  if (secret && sig) {
    const expected = createHmac("sha256", secret).update(bodyText || "").digest("hex");
    if (timingSafeEqualStr(sig, expected) || timingSafeEqualStr(sig, `sha256=${expected}`)) {
      return { ok: true, authMethod: "hmac" };
    }
  }

  if (!token && !secret && !prod) {
    return { ok: true, authMethod: "lab" };
  }

  return { ok: false, code: "CLUSTER_AUTH_FAILED", message: "cluster auth required" };
}

export default { authorizeCluster, clusterToken, clusterHmacSecret };
