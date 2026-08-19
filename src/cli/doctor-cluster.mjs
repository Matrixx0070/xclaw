/**
 * Doctor: cluster role + auth + generation posture.
 */
import { isCoordinator, coordinatorUrl } from "../cluster/coordinator.mjs";
import { clusterToken, clusterHmacSecret } from "../cluster/cluster-auth.mjs";
import { readGeneration } from "../cluster/generation.mjs";

export function pushClusterChecks(push, cfg = {}) {
  const role = isCoordinator(cfg) ? "coordinator" : "follower";
  const url = coordinatorUrl(cfg);
  const token = Boolean(clusterToken(cfg));
  const hmac = Boolean(clusterHmacSecret(cfg));
  const gen = readGeneration(cfg);
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuth === true;
  let status = "ok";
  if (prod && !token && !hmac) status = "error";
  else if (role === "follower" && !url) status = "warn";
  if (prod && role === "coordinator" && !(Number(gen.generation) > 0)) {
    status = "error";
  }
  push(
    "cluster.role",
    status,
    `cluster role=${role} gen=${gen.generation || 0} auth=${token || hmac ? "configured" : "none"}` +
      (prod && role === "coordinator" && !(Number(gen.generation) > 0) ? " MISSING_GENERATION" : ""),
    { role, token, hmac, coordinatorUrlSet: Boolean(url), generation: gen }
  );
}

export default { pushClusterChecks };
