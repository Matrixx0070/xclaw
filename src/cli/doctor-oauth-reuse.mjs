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
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.gateway?.requireAuth === true;
  push(
    "auth.oauthRefreshRegistry",
    "ok",
    `oauth refresh registry active=${active.length} retired=${retired.length}`,
    { path: fp, active: active.length, retired: retired.length, prod }
  );
}

export default { pushOAuthReuseChecks };
