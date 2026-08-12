/**
 * Gateway CORS policy.
 *
 * Old behavior was a blanket `Access-Control-Allow-Origin: *` on every
 * response — any web page the operator visits could read gateway responses
 * from loopback (drive-by exfil of /sessions, /config, etc. on tokenless lab
 * setups). Default now:
 *   - no Origin header (same-origin, curl, native clients) → no CORS header
 *   - loopback origins (127.0.0.1 / localhost / ::1, any port/scheme) → reflected
 *   - anything else → no CORS header (browser blocks the read)
 * Operator override: cfg.gateway.corsOrigin = "*" | "https://app.example" |
 * [list of origins].
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** @returns {string|null} value for Access-Control-Allow-Origin, or null to omit */
export function corsOriginFor(req, cfg = {}) {
  const origin = req?.headers?.origin;
  if (!origin) return null;
  const conf = cfg?.gateway?.corsOrigin;
  if (conf === "*") return "*";
  if (Array.isArray(conf)) {
    if (conf.includes(origin)) return origin;
  } else if (typeof conf === "string" && conf && conf === origin) {
    return origin;
  }
  try {
    const u = new URL(origin);
    if (LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return origin;
  } catch {
    /* malformed origin → no header */
  }
  return null;
}

/** Set CORS headers once per request; later writeHead calls must not set ACAO. */
export function applyCors(req, res, cfg = {}) {
  const allowed = corsOriginFor(req, cfg);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    if (allowed !== "*") res.setHeader("Vary", "Origin");
  }
  return allowed;
}

export default { corsOriginFor, applyCors };
