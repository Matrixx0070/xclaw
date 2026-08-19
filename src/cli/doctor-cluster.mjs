/**
 * Doctor: cluster role + auth posture.
 */
import { isCoordinator, coordinatorUrl } from "../cluster/coordinator.mjs";
import { clusterToken, clusterHmacSecret } from "../cluster/cluster-auth.mjs";
import { readGeneration } from "../cluster/generation.mjs";

export function pushClusterChecks(push, cfg = {}) {
  const role = isCoordinator(cfg) ? "coordinator" : "follower";
  const url = coordinatorUrl(cfg);
  const token = Boolean(clusterToken(cfg));
  const hmac = Boolean(clusterHmacSecret(cfg));
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuth === true;
  let status = "ok";
  if (prod && !token && !hmac) status = "error";
  else if (role === "follower" && !url) status = "warn";
  push(
    "cluster.role",
    status,
    `cluster role=${role} auth=${token || hmac ? "configured" : "none"}` +
      (url ? " coordinatorUrl=set" : ""),
    { role, token, hmac, coordinatorUrlSet: Boolean(url), generation: readGeneration(cfg) }
  );
}

export default { pushClusterChecks };
