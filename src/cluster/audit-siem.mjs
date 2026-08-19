/**
 * Incremental signed SIEM audit bundle.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHmac, timingSafeEqual } from "node:crypto";
import { auditPath } from "./compact-audit.mjs";
import { auditSecrets } from "./compact-audit-hmac.mjs";

const stats = { export_total: 0 };

export function getAuditExportTotal() {
  return stats.export_total;
}

export function cursorPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "audit-siem-cursor.json");
}

export function readCursor(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(cursorPath(cfg), "utf8"));
  } catch {
    return { offset: 0 };
  }
}

export function writeCursor(cfg, cursor) {
  const fp = cursorPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(cursor));
}

function signHeader(header, cfg) {
  const secrets = auditSecrets(cfg);
  if (!secrets.length) return { ...header, sig: null };
  const body = JSON.stringify({ count: header.count, from: header.from, to: header.to });
  const sig = createHmac("sha256", secrets[0]).update(body).digest("hex");
  return { ...header, sig };
}

export function verifySiemHeader(header, cfg) {
  const secrets = auditSecrets(cfg);
  if (!secrets.length) return { ok: true, authMethod: "lab" };
  const body = JSON.stringify({ count: header.count, from: header.from, to: header.to });
  const a = Buffer.from(String(header.sig || ""));
  for (const s of secrets) {
    const b = Buffer.from(createHmac("sha256", s).update(body).digest("hex"));
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
  }
  return { ok: false, code: "SIEM_HMAC_INVALID" };
}

export function exportSiemBundle(cfg = {}, { maxLines = 100 } = {}) {
  const fp = auditPath(cfg);
  let txt = "";
  try {
    txt = fs.readFileSync(fp, "utf8");
  } catch {
    return {
      ok: true,
      count: 0,
      lines: [],
      header: signHeader({ from: 0, to: 0, count: 0 }, cfg),
    };
  }
  const all = txt.split("\n").filter(Boolean);
  const cur = readCursor(cfg);
  const from = Number(cur.offset) || 0;
  const slice = all.slice(from, from + maxLines);
  const to = from + slice.length;
  const header = signHeader({ from, to, count: slice.length }, cfg);
  writeCursor(cfg, { offset: to, at: new Date().toISOString() });
  stats.export_total += 1;
  return { ok: true, header, lines: slice, count: slice.length };
}

export default { exportSiemBundle, verifySiemHeader, readCursor, getAuditExportTotal };
