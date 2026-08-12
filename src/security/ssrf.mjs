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
 * @returns {Promise<{ ok: true, addresses: string[] } | { ok: false, error: string }>}
 */
export async function assertUrlAllowed(rawUrl, cfg = {}) {
  const policy = getSsrfPolicy(cfg);
  if (policy.mode === "off") return { ok: true, addresses: [] };

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
  if (policy.allowHosts.includes(host)) return { ok: true, addresses: [] };
  if (policy.allowPrivate) return { ok: true, addresses: [] };

  // Literal IP in the URL — classify directly (no DNS needed).
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      return { ok: false, error: `blocked private/loopback address ${host}` };
    }
    return { ok: true, addresses: [host] };
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
  return { ok: true, addresses: addrs };
}

/**
 * SSRF-safe fetch: validates the URL and every redirect hop.
 * Signature mirrors global fetch minus automatic redirect following.
 * @param {string} rawUrl
 * @param {RequestInit} [init]
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
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), current).toString();
      current = next;
      continue;
    }
    return res;
  }
  const e = new Error(`SSRF blocked: too many redirects (>${policy.maxRedirects})`);
  e.code = "SSRF_BLOCKED";
  throw e;
}

export default { getSsrfPolicy, isPrivateIp, assertUrlAllowed, safeFetch };
