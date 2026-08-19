/**
 * Doctor: OAuth refresh reuse detection posture.
 */
import fs from "node:fs";
import { rotationRegistryPath } from "../seats/oauth-rotation.mjs";

export function pushOAuthReuseChecks(push, cfg = {}) {
  const fp = rotationRegistryPath(cfg);
  let tokens = {};
  try {
    tokens = JSON.parse(fs.readFileSync(fp, "utf8")).tokens || {};
  } catch {
    push("auth.oauthRefreshRegistry", "ok", "no oauth refresh registry yet", { path: fp });
    return;
  }
  const active = Object.entries(tokens).filter(([, v]) => v && !v.retired);
  const retired = Object.entries(tokens).filter(([, v]) => v && v.retired);
  const reusedFlag = Object.values(tokens).some((v) => v && v.reused);
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.gateway?.requireAuth === true;
  let status = "ok";
  if (reusedFlag && prod) status = "error";
  else if (reusedFlag) status = "warn";
  push(
    "auth.oauthRefreshRegistry",
    status,
    `oauth refresh registry active=${active.length} retired=${retired.length}` +
      (reusedFlag ? " REUSE_DETECTED" : ""),
    { path: fp, active: active.length, retired: retired.length, prod, reused: reusedFlag }
  );
}

export default { pushOAuthReuseChecks };
