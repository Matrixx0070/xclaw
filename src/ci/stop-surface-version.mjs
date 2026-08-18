/**
 * Stamp kill-switch surface revision into release evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const FILES = [
  "src/gateway/stop-route.mjs",
  "src/gateway/stop-auth.mjs",
  "src/gateway/ws-stop-control.mjs",
  "src/gateway/sse-stop-control.mjs",
  "src/cli/stop-help.mjs",
  "docs/STOP.md",
  "docs/openapi-stop.yaml",
];

export function computeStopSurfaceVersion(root = process.cwd()) {
  const h = createHash("sha256");
  const present = [];
  for (const rel of FILES) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const body = fs.readFileSync(fp);
    h.update(rel);
    h.update("\0");
    h.update(body);
    present.push(rel);
  }
  return {
    version: h.digest("hex").slice(0, 16),
    files: present,
    at: new Date().toISOString(),
  };
}

export function stampStopSurfaceOnEvidence(evidence, root) {
  const stamp = computeStopSurfaceVersion(root);
  if (evidence && typeof evidence === "object") {
    evidence.stopSurface = stamp;
  }
  return stamp;
}

export default { computeStopSurfaceVersion, stampStopSurfaceOnEvidence };
