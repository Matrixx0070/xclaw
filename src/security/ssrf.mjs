/**
 * SSRF guard for agent-controlled server-side fetches (e.g. web_fetch).
 *
 * The agent picks the URL, so a prompt-injected page can aim it at cloud
 * metadata (169.254.169.254), loopback internal services, or private LAN
 * hosts. Defenses:
 *   1. scheme allowlist (http/https only)
 *   2. DNS-resolve the host and block if ANY resolved IP is private/loopback/
 *      link-local/ULA/metadata (getaddrinfo canonicalizes decimal/hex/octal
 *      host encodings, so 2130706433 → 127.0.0.1 is caught)
 *   3. manual redirect following, re-validating every hop (a public host can
 *      302 to http://169.254.169.254 — redirect: "follow" would walk right in)
 *
 * Config:
 *   security.ssrf.mode: "block" (default) | "off"
 *   security.ssrf.allowPrivate: true to permit private/loopback (lab dev only)
 *   security.ssrf.allowHosts: string[] hostnames exempt from IP checks
 *   security.ssrf.maxRedirects: default 5
 * Env: XCLAW_SSRF=off|block
 */
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const DEFAULT_MAX_REDIRECTS = 5;

export function getSsrfPolicy(cfg = {}) {
  const s = cfg?.security?.ssrf || {};
  const env = String(process.env.XCLAW_SSRF || "").toLowerCase();
  let mode = env || String(s.mode || "").toLowerCase() || "block";
  if (!["block", "off"].includes(mode)) mode = "block";
  return {
    mode,
    allowPrivate: s.allowPrivate === true,
    allowHosts: (s.allowHosts || []).map((h) => String(h).toLowerCase()),
    maxRedirects: Number.isFinite(s.maxRedirects) ? s.maxRedirects : DEFAULT_MAX_REDIRECTS,
  };
}

/** Parse an IPv4 dotted string to a 32-bit int, or null. */
function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

/** True when an IP literal is loopback/private/link-local/ULA/metadata/etc. */
export function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true; // unparseable → treat as unsafe
    const inRange = (a, bits) => (n >>> (32 - bits)) === (ipv4ToInt(a) >>> (32 - bits));
    return (
      inRange("0.0.0.0", 8) || // "this host"
      inRange("10.0.0.0", 8) ||
      inRange("100.64.0.0", 10) || // CGNAT
      inRange("127.0.0.0", 8) || // loopback
      inRange("169.254.0.0", 16) || // link-local + cloud metadata
      inRange("172.16.0.0", 12) ||
      inRange("192.0.0.0", 24) ||
      inRange("192.168.0.0", 16) ||
      inRange("198.18.0.0", 15) || // benchmarking
      n >= (ipv4ToInt("224.0.0.0") >>> 0) // multicast + reserved + broadcast
    );
  }
  if (fam === 6) {
    let v = ip.toLowerCase();
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local, ULA
    // IPv4-mapped/compat (::ffff:a.b.c.d or ::a.b.c.d) → check the embedded v4
    const m = v.match(/(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/i);
    if (m) return isPrivateIp(m[1]);
    if (v.startsWith("2002:")) return true; // 6to4 — can wrap private v4
    return false;
  }
  return true; // not a valid IP literal → unsafe
}

/**
 * Validate a single URL against the SSRF policy (scheme + DNS→IP checks).
 * `pinIp` is the exact validated address the connection should be pinned to
 * (closes the DNS-rebind window between validation and connect); it is null
 * when the guard is bypassed (off / allowPrivate / allowHosts) and the caller
 * should fall back to normal resolution.
 * @returns {Promise<{ ok: true, addresses: string[], pinIp: string|null } | { ok: false, error: string }>}
 */
export async function assertUrlAllowed(rawUrl, cfg = {}) {
  const policy = getSsrfPolicy(cfg);
  if (policy.mode === "off") return { ok: true, addresses: [], pinIp: null };

  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: `invalid URL: ${rawUrl}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `blocked scheme ${u.protocol} (http/https only)` };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (policy.allowHosts.includes(host)) return { ok: true, addresses: [], pinIp: null };
  if (policy.allowPrivate) return { ok: true, addresses: [], pinIp: null };

  // Literal IP in the URL — classify directly (no DNS needed).
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      return { ok: false, error: `blocked private/loopback address ${host}` };
    }
    return { ok: true, addresses: [host], pinIp: host };
  }

  // Hostname — resolve and block if ANY address is private (DNS-rebind safe).
  let addrs;
  try {
    const results = await dns.lookup(host, { all: true, verbatim: true });
    addrs = results.map((r) => r.address);
  } catch (err) {
    return { ok: false, error: `DNS resolution failed for ${host}: ${err.message}` };
  }
  if (!addrs.length) return { ok: false, error: `no addresses for ${host}` };
  for (const a of addrs) {
    if (isPrivateIp(a)) {
      return { ok: false, error: `${host} resolves to private/loopback ${a} — blocked` };
    }
  }
  // Pin the connection to the first validated address so a rebind after this
  // point can't redirect the socket to a private target.
  return { ok: true, addresses: addrs, pinIp: addrs[0] };
}

/** Wrap a node:http response into the minimal fetch-Response shape callers use. */
function toResponseLike(res, finalUrl, bodyBuf) {
  const h = new Map();
  for (const [k, v] of Object.entries(res.headers)) {
    h.set(k.toLowerCase(), Array.isArray(v) ? v.join(", ") : v);
  }
  return {
    status: res.statusCode,
    ok: res.statusCode >= 200 && res.statusCode < 300,
    url: finalUrl,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
    async text() {
      return decodeBody(res.headers["content-encoding"], bodyBuf).toString("utf8");
    },
    async json() {
      return JSON.parse(decodeBody(res.headers["content-encoding"], bodyBuf).toString("utf8"));
    },
    async arrayBuffer() {
      const b = decodeBody(res.headers["content-encoding"], bodyBuf);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  };
}

/** node:http does not auto-decompress; handle the common encodings. */
function decodeBody(encoding, buf) {
  const enc = String(encoding || "").toLowerCase();
  try {
    if (enc === "gzip") return zlib.gunzipSync(buf);
    if (enc === "deflate") return zlib.inflateSync(buf);
    if (enc === "br") return zlib.brotliDecompressSync(buf);
  } catch {
    /* fall through to raw bytes */
  }
  return buf;
}

/**
 * Single HTTP(S) request pinned to a validated IP. The URL keeps its real
 * hostname (so Host header, TLS SNI, and cert validation use it) while the
 * socket connects to `ip` via the `lookup` override — closing the window where
 * DNS could rebind to a private address between validation and connect.
 * Does NOT follow redirects (safeFetch re-validates each hop).
 * @returns {Promise<object>} fetch-Response-like
 */
export function requestPinned(rawUrl, { method = "GET", headers = {}, signal, ip, timeoutMs = 25_000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(rawUrl);
    } catch (err) {
      return reject(err);
    }
    if (signal?.aborted) return reject(new Error("aborted"));

    const mod = u.protocol === "https:" ? https : http;
    const family = ip ? net.isIP(ip) : 0;
    const lookup = ip
      ? (hostname, opts, cb) => {
          const callback = typeof opts === "function" ? opts : cb;
          if (opts && typeof opts === "object" && opts.all) {
            return callback(null, [{ address: ip, family }]);
          }
          callback(null, ip, family);
        }
      : undefined;

    const reqHeaders = { "Accept-Encoding": "identity", ...headers };
    const req = mod.request(
      u,
      { method, headers: reqHeaders, lookup, servername: u.hostname },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(toResponseLike(res, u.toString(), Buffer.concat(chunks))));
        res.on("error", reject);
      }
    );

    const onAbort = () => {
      req.destroy(new Error("aborted"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    req.end();
  });
}

/**
 * SSRF-safe fetch: validates the URL and every redirect hop, pinning each
 * connection to the exact IP that passed validation (rebind-proof).
 * Returns a fetch-Response-like object ({ status, ok, url, headers.get, text, json }).
 * @param {string} rawUrl
 * @param {{ method?: string, headers?: object, signal?: AbortSignal }} [init]
 * @param {object} [cfg]
 */
export async function safeFetch(rawUrl, init = {}, cfg = {}) {
  const policy = getSsrfPolicy(cfg);
  if (policy.mode === "off") return fetch(rawUrl, init);

  let current = rawUrl;
  for (let hop = 0; hop <= policy.maxRedirects; hop++) {
    const check = await assertUrlAllowed(current, cfg);
    if (!check.ok) {
      const e = new Error(`SSRF blocked: ${check.error}`);
      e.code = "SSRF_BLOCKED";
      throw e;
    }
    const res = await requestPinned(current, {
      method: init.method || "GET",
      headers: init.headers || {},
      signal: init.signal,
      ip: check.pinIp,
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  const e = new Error(`SSRF blocked: too many redirects (>${policy.maxRedirects})`);
  e.code = "SSRF_BLOCKED";
  throw e;
}

export default { getSsrfPolicy, isPrivateIp, assertUrlAllowed, requestPinned, safeFetch };
