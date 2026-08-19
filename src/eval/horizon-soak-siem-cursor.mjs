/**
 * Cursor lease so only one soak SIEM exporter runs.
 */
import fs from "node:fs";
import path from "node:path";

export function siemCursorPath(opts = {}) {
  return path.resolve(
    opts.base || process.cwd(),
    ".xclaw",
    "soak-siem",
    "cursor-lease.json"
  );
}

export function acquireSiemCursorLease(opts = {}) {
  const owner = opts.owner || `siem-${process.pid}`;
  const ttl = Number(opts.ttlMs ?? 15_000);
  const fp = siemCursorPath(opts);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  let cur = null;
  try {
    cur = JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    cur = null;
  }
  const now = Date.now();
  if (cur && cur.owner !== owner && now - (cur.at || 0) < (cur.ttl || ttl)) {
    return { ok: false, code: "CURSOR_LEASE_HELD", owner: cur.owner };
  }
  const next = { owner, at: now, ttl, cursor: cur?.cursor || opts.cursor || "" };
  fs.writeFileSync(fp + ".tmp", JSON.stringify(next) + "\n");
  fs.renameSync(fp + ".tmp", fp);
  return { ok: true, owner, cursor: next.cursor };
}

export function releaseSiemCursorLease(opts = {}) {
  const owner = opts.owner || `siem-${process.pid}`;
  const fp = siemCursorPath(opts);
  try {
    const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (cur.owner !== owner) return { ok: false, code: "NOT_OWNER" };
    if (opts.cursor != null) {
      fs.writeFileSync(
        fp,
        JSON.stringify({
          owner: null,
          at: 0,
          ttl: cur.ttl,
          cursor: opts.cursor,
        }) + "\n"
      );
    } else {
      fs.unlinkSync(fp);
    }
  } catch {
    /* ok */
  }
  return { ok: true, released: true };
}

export default { acquireSiemCursorLease, releaseSiemCursorLease };
