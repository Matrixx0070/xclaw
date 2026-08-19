/**
 * SIEM sink selector: file | https | s3.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const fail = { sink_fail_total: 0 };
let lastResult = null;

export function getSinkFailTotal() {
  return fail.sink_fail_total;
}

export function lastSinkResult() {
  return lastResult;
}

export function sinkKind(cfg = {}) {
  return cfg?.cluster?.auditSink || process.env.XCLAW_AUDIT_SINK || "file";
}

function sinkDir(cfg) {
  return cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR || path.join(os.homedir(), ".xclaw");
}

export async function deliverSiemBundle(cfg, bundle) {
  const kind = sinkKind(cfg);
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.cluster?.requireAuditSink === true;
  try {
    if (kind === "https") {
      const post = cfg.httpsPost || cfg.fetch;
      if (typeof post !== "function") {
        fail.sink_fail_total += 1;
        lastResult = { ok: false, code: "SINK_UNAVAILABLE", kind, failClosed: prod };
        return lastResult;
      }
      await post(cfg.cluster?.auditSinkUrl || "", bundle);
      lastResult = { ok: true, kind };
      return lastResult;
    }
    if (kind === "s3") {
      const put = cfg.s3Put;
      if (typeof put !== "function") {
        fail.sink_fail_total += 1;
        lastResult = { ok: false, code: "SINK_UNAVAILABLE", kind, failClosed: prod };
        return lastResult;
      }
      await put(bundle);
      lastResult = { ok: true, kind };
      return lastResult;
    }
    const dir = path.join(sinkDir(cfg), "siem-export");
    fs.mkdirSync(dir, { recursive: true });
    const to = bundle?.header?.to ?? Date.now();
    const fp = path.join(dir, `audit-${to}.json`);
    fs.writeFileSync(fp, JSON.stringify(bundle, null, 2));
    lastResult = { ok: true, kind: "file", path: fp };
    return lastResult;
  } catch (e) {
    fail.sink_fail_total += 1;
    lastResult = {
      ok: false,
      code: "SINK_ERROR",
      error: String(e.message || e),
      failClosed: prod,
    };
    return lastResult;
  }
}

export default { deliverSiemBundle, sinkKind, lastSinkResult, getSinkFailTotal };
