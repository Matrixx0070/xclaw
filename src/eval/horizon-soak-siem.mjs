/**
 * Append-only HMAC-signed soak SIEM events + incremental bundle export.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";

const hmacFail = { total: 0 };
const exportCount = { total: 0 };

export function incSoakSiemHmacFail() {
  hmacFail.total += 1;
  return hmacFail.total;
}
export function getSoakSiemHmacFailTotal() {
  return hmacFail.total;
}
export function resetSoakSiemHmacFail() {
  hmacFail.total = 0;
}
export function incSoakSiemExport(n = 1) {
  exportCount.total += n;
  return exportCount.total;
}
export function getSoakSiemExportTotal() {
  return exportCount.total;
}
export function resetSoakSiemExport() {
  exportCount.total = 0;
}
export function renderSoakSiemMetrics() {
  return (
    `xclaw_horizon_soak_siem_export_total ${exportCount.total}\n` +
    `xclaw_horizon_soak_siem_hmac_fail_total ${hmacFail.total}\n`
  );
}

export function soakSiemSecrets(cfg = {}) {
  const list = cfg?.soak?.hmacSecrets;
  if (Array.isArray(list) && list.length) return list.filter(Boolean);
  const cur =
    cfg?.soak?.hmacSecret ||
    process.env.XCLAW_SOAK_HMAC_SECRET ||
    process.env.XCLAW_AUDIT_HMAC_SECRET ||
    "xclaw-dev-soak-hmac";
  const prev =
    cfg?.soak?.hmacSecretPrevious ||
    process.env.XCLAW_SOAK_HMAC_SECRET_PREVIOUS ||
    process.env.XCLAW_AUDIT_HMAC_SECRET_PREVIOUS ||
    "";
  return [cur, prev].filter(Boolean);
}

export function soakSiemLogPath(opts = {}) {
  return path.resolve(
    opts.base || process.cwd(),
    ".xclaw",
    "soak-siem",
    "events.jsonl"
  );
}

function bodyOf(event) {
  const { sig, ...rest } = event;
  return JSON.stringify({
    at: rest.at || "",
    type: rest.type || "",
    jobId: rest.jobId || "",
    owner: rest.owner || "",
    code: rest.code || "",
  });
}

export function signSoakEvent(event = {}, cfg = {}) {
  const secrets = soakSiemSecrets(cfg);
  if (!secrets.length) return { ...event, sig: null };
  const sig = createHmac("sha256", secrets[0]).update(bodyOf(event)).digest("hex");
  return { ...event, sig };
}

export function verifySoakEvent(event = {}, cfg = {}) {
  const secrets = soakSiemSecrets(cfg);
  if (!event?.sig) {
    incSoakSiemHmacFail();
    return { ok: false, code: "NO_SIG" };
  }
  const body = bodyOf(event);
  const want = Buffer.from(String(event.sig), "hex");
  for (const s of secrets) {
    const got = Buffer.from(
      createHmac("sha256", s).update(body).digest("hex"),
      "hex"
    );
    if (want.length === got.length && timingSafeEqual(want, got)) {
      return { ok: true };
    }
  }
  incSoakSiemHmacFail();
  return { ok: false, code: "HMAC_MISMATCH" };
}

export async function appendSoakEvent(event = {}, opts = {}) {
  const rec = signSoakEvent(
    {
      at: new Date().toISOString(),
      type: event.type || "unknown",
      jobId: event.jobId || "",
      owner: event.owner || "",
      code: event.code || "",
      ...event,
    },
    opts.cfg
  );
  const fp = soakSiemLogPath(opts);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.appendFile(fp, JSON.stringify(rec) + "\n", "utf8");
  return rec;
}

export async function readSoakEvents(opts = {}) {
  const fp = soakSiemLogPath(opts);
  try {
    const raw = await fsp.readFile(fp, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
}

export function signBundleHeader(header, cfg = {}) {
  const secrets = soakSiemSecrets(cfg);
  const body = JSON.stringify({
    from: header.from || "",
    to: header.to || "",
    count: header.count ?? 0,
  });
  const sig = secrets.length
    ? createHmac("sha256", secrets[0]).update(body).digest("hex")
    : null;
  return { ...header, sig };
}

export async function exportSoakSiemBundle(opts = {}) {
  const events = await readSoakEvents(opts);
  const from = opts.from || events[0]?.at || "";
  const to = opts.to || events.at(-1)?.at || "";
  const sliced = events.filter((e) => {
    if (opts.from && e.at < opts.from) return false;
    if (opts.to && e.at > opts.to) return false;
    return true;
  });
  const header = signBundleHeader({ from, to, count: sliced.length }, opts.cfg);
  incSoakSiemExport();
  return { header, events: sliced };
}

export default {
  appendSoakEvent,
  readSoakEvents,
  signSoakEvent,
  verifySoakEvent,
  exportSoakSiemBundle,
  renderSoakSiemMetrics,
};
