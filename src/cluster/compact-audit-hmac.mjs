/**
 * HMAC-signed compact audit lines.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const fail = { audit_hmac_fail_total: 0 };

export function incAuditHmacFail() {
  fail.audit_hmac_fail_total += 1;
  return fail.audit_hmac_fail_total;
}

export function getAuditHmacFailTotal() {
  return fail.audit_hmac_fail_total;
}

export function resetAuditHmacFail() {
  fail.audit_hmac_fail_total = 0;
}

export function auditSecrets(cfg = {}) {
  const list = cfg?.cluster?.auditHmacSecrets;
  if (Array.isArray(list) && list.length) return list.filter(Boolean);
  const cur = cfg?.cluster?.auditHmacSecret || process.env.XCLAW_AUDIT_HMAC_SECRET || "";
  const prev =
    cfg?.cluster?.auditHmacSecretPrevious || process.env.XCLAW_AUDIT_HMAC_SECRET_PREVIOUS || "";
  return [cur, prev].filter(Boolean);
}

function bodyOf(event) {
  const { sig, ...rest } = event;
  return JSON.stringify({
    at: rest.at || "",
    compacted: !!rest.compacted,
    dropped: rest.dropped ?? 0,
    fence: rest.fence ?? null,
    owner: rest.owner || null,
    region: rest.region || "local",
  });
}

export function signAuditEvent(event = {}, cfg = {}) {
  const secrets = auditSecrets(cfg);
  if (!secrets.length) return { ...event, sig: null };
  const sig = createHmac("sha256", secrets[0]).update(bodyOf(event)).digest("hex");
  return { ...event, sig };
}

export function verifyAuditEvent(event = {}, cfg = {}) {
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuditHmac === true;
  const secrets = auditSecrets(cfg);
  if (!secrets.length) {
    if (prod) {
      incAuditHmacFail();
      return { ok: false, code: "AUDIT_HMAC_REQUIRED" };
    }
    return { ok: true, authMethod: "lab" };
  }
  const sig = String(event.sig || "");
  const a = Buffer.from(sig);
  const body = bodyOf(event);
  for (let i = 0; i < secrets.length; i++) {
    const expected = createHmac("sha256", secrets[i]).update(body).digest("hex");
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, rotated: i > 0 };
    }
  }
  incAuditHmacFail();
  return { ok: false, code: "AUDIT_HMAC_INVALID" };
}

export function verifyLastN(lines = [], cfg = {}, n = 10) {
  const slice = lines.slice(-n);
  let ok = 0;
  let failN = 0;
  for (const line of slice) {
    let ev;
    try {
      ev = typeof line === "string" ? JSON.parse(line) : line;
    } catch {
      failN++;
      incAuditHmacFail();
      continue;
    }
    const v = verifyAuditEvent(ev, cfg);
    if (v.ok) ok++;
    else failN++;
  }
  return { ok: failN === 0, checked: slice.length, okCount: ok, fail: failN };
}

export default {
  signAuditEvent,
  verifyAuditEvent,
  verifyLastN,
  auditSecrets,
  getAuditHmacFailTotal,
};
