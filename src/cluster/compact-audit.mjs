/**
 * Append-only compact audit log with 10MB rotate.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX = 10 * 1024 * 1024;

export function auditPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "compact-audit.jsonl");
}

export function appendCompactAudit(cfg = {}, event = {}) {
  const fp = auditPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  try {
    const st = fs.statSync(fp);
    if (st.size >= MAX) fs.renameSync(fp, fp + ".1");
  } catch {
    /* */
  }
  const line = JSON.stringify({
    at: new Date().toISOString(),
    region: event.region || "local",
    owner: event.owner || null,
    fence: event.fence ?? null,
    compacted: event.compacted ?? false,
    dropped: event.dropped ?? 0,
  });
  fs.appendFileSync(fp, line + "\n");
  return fp;
}

export function readLastAudit(cfg = {}) {
  try {
    const txt = fs.readFileSync(auditPath(cfg), "utf8").trim();
    if (!txt) return null;
    const lines = txt.split("\n");
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

export function countAuditLines(cfg = {}) {
  try {
    const txt = fs.readFileSync(auditPath(cfg), "utf8");
    return txt.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

export default { appendCompactAudit, readLastAudit, countAuditLines, auditPath };
