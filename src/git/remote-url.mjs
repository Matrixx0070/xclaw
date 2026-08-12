/**
 * Validate git remote URLs (clone/fetch targets).
 *
 * Accepts common forms:
 *   - https://host/path.git
 *   - http://host/path (warned as insecure unless allowHttp)
 *   - git@host:path/repo.git
 *   - ssh://git@host/path.git
 *   - git://host/path.git (warned; often unauthenticated)
 *   - file:///path or /absolute/path/.git (local, optional)
 *   - relative paths for local repos (optional)
 */

const DANGEROUS_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "blob",
]);

/**
 * @typedef {object} RemoteUrlValidation
 * @property {boolean} ok
 * @property {string} [normalized]
 * @property {string} [scheme]  https | http | ssh | git | file | path | scp | unknown
 * @property {string} [host]
 * @property {string} [error]
 * @property {string} [code]
 * @property {string[]} [warnings]
 */

/**
 * Validate a single remote URL string.
 * @param {string} input
 * @param {{
 *   allowHttp?: boolean,
 *   allowGitProtocol?: boolean,
 *   allowFile?: boolean,
 *   allowRelativePath?: boolean,
 *   allowedHosts?: string[] | null,
 * }} [opts]
 * @returns {RemoteUrlValidation}
 */
export function validateGitRemoteUrl(input, opts = {}) {
  const warnings = [];
  if (input == null || typeof input !== "string") {
    return {
      ok: false,
      code: "REMOTE_URL_EMPTY",
      error: "remote URL must be a non-empty string",
    };
  }
  const raw = input.trim();
  if (!raw) {
    return {
      ok: false,
      code: "REMOTE_URL_EMPTY",
      error: "remote URL is empty",
    };
  }
  if (raw.length > 2048) {
    return {
      ok: false,
      code: "REMOTE_URL_TOO_LONG",
      error: "remote URL exceeds 2048 characters",
    };
  }
  // Block control chars / null
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return {
      ok: false,
      code: "REMOTE_URL_CONTROL_CHARS",
      error: "remote URL contains control characters",
    };
  }

  // SCP-like: git@host:path/repo.git  (not a normal URL)
  const scp = raw.match(
    /^([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):(\/\/)?(.+)$/
  );
  if (scp && !raw.includes("://")) {
    const user = scp[1];
    const host = scp[2];
    const repoPath = scp[4];
    if (!host || !repoPath) {
      return {
        ok: false,
        code: "REMOTE_URL_SCP_INVALID",
        error: "invalid scp-style git remote",
      };
    }
    if (opts.allowedHosts?.length && !hostAllowed(host, opts.allowedHosts)) {
      return {
        ok: false,
        code: "REMOTE_URL_HOST_NOT_ALLOWED",
        error: `host not in allowlist: ${host}`,
        host,
        scheme: "scp",
      };
    }
    return {
      ok: true,
      scheme: "scp",
      host,
      normalized: `${user}@${host}:${repoPath}`,
      warnings,
    };
  }

  // file:// or absolute/relative local path
  if (raw.startsWith("file://") || raw.startsWith("file:")) {
    if (opts.allowFile === false) {
      return {
        ok: false,
        code: "REMOTE_URL_FILE_DENIED",
        error: "file:// remotes are not allowed",
      };
    }
    let pathPart = raw.replace(/^file:\/\//, "").replace(/^file:/, "");
    if (!pathPart) {
      return {
        ok: false,
        code: "REMOTE_URL_FILE_EMPTY",
        error: "file:// remote has empty path",
      };
    }
    warnings.push("file remote is local-only and not shared across machines");
    return {
      ok: true,
      scheme: "file",
      normalized: raw,
      warnings,
    };
  }

  // Absolute or relative filesystem path (local remote)
  if (
    raw.startsWith("/") ||
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(raw)
  ) {
    if (opts.allowFile === false || opts.allowRelativePath === false) {
      return {
        ok: false,
        code: "REMOTE_URL_PATH_DENIED",
        error: "path-style remotes are not allowed",
      };
    }
    warnings.push("path remote is local-only");
    return {
      ok: true,
      scheme: "path",
      normalized: raw,
      warnings,
    };
  }

  // Standard URL with scheme
  let url;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      code: "REMOTE_URL_PARSE",
      error: `cannot parse remote URL: ${raw.slice(0, 120)}`,
    };
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (DANGEROUS_SCHEMES.has(scheme)) {
    return {
      ok: false,
      code: "REMOTE_URL_SCHEME_DANGEROUS",
      error: `refusing dangerous URL scheme: ${scheme}`,
      scheme,
    };
  }

  if (!["https", "http", "ssh", "git"].includes(scheme)) {
    return {
      ok: false,
      code: "REMOTE_URL_SCHEME_UNSUPPORTED",
      error: `unsupported remote scheme: ${scheme}`,
      scheme,
    };
  }

  if (scheme === "http" && opts.allowHttp !== true) {
    return {
      ok: false,
      code: "REMOTE_URL_HTTP_DENIED",
      error: "http:// remotes are insecure; use https:// or set allowHttp",
      scheme: "http",
      host: url.hostname || undefined,
    };
  }
  if (scheme === "http") {
    warnings.push("http remote is unencrypted");
  }

  if (scheme === "git" && opts.allowGitProtocol !== true) {
    return {
      ok: false,
      code: "REMOTE_URL_GIT_PROTOCOL_DENIED",
      error: "git:// protocol is unauthenticated; prefer https or ssh",
      scheme: "git",
      host: url.hostname || undefined,
    };
  }
  if (scheme === "git") {
    warnings.push("git:// has no auth and is often blocked");
  }

  const host = url.hostname || "";
  if (!host && scheme !== "file") {
    return {
      ok: false,
      code: "REMOTE_URL_NO_HOST",
      error: "remote URL missing host",
      scheme,
    };
  }

  // Basic host sanity
  if (host && !/^[a-zA-Z0-9._~-]+$/.test(host) && !host.includes(":")) {
    // IPv6 in URL hostname may include brackets — URL parser strips them
    if (!/^[0-9a-fA-F:]+$/.test(host)) {
      return {
        ok: false,
        code: "REMOTE_URL_HOST_INVALID",
        error: `invalid remote host: ${host}`,
        scheme,
        host,
      };
    }
  }

  if (opts.allowedHosts?.length && host && !hostAllowed(host, opts.allowedHosts)) {
    return {
      ok: false,
      code: "REMOTE_URL_HOST_NOT_ALLOWED",
      error: `host not in allowlist: ${host}`,
      scheme,
      host,
    };
  }

  // Empty path is suspicious for https github-style
  if (!url.pathname || url.pathname === "/") {
    warnings.push("remote URL has empty path (no repo name)");
  }

  return {
    ok: true,
    scheme,
    host: host || undefined,
    normalized: url.toString(),
    warnings,
  };
}

function hostAllowed(host, allowList) {
  const h = host.toLowerCase();
  return allowList.some((a) => {
    const x = String(a).toLowerCase();
    return h === x || h.endsWith("." + x);
  });
}

/**
 * Validate many remotes; returns aggregate result.
 * @param {Record<string, string> | { name: string, url: string }[]} remotes
 */
export function validateGitRemotes(remotes, opts = {}) {
  const list = Array.isArray(remotes)
    ? remotes
    : Object.entries(remotes || {}).map(([name, url]) => ({ name, url }));

  const results = [];
  for (const r of list) {
    const name = r.name || r[0];
    const url = r.url ?? r[1];
    const v = validateGitRemoteUrl(url, opts);
    results.push({ name, url, ...v });
  }
  const ok = results.every((r) => r.ok);
  return {
    ok,
    results,
    errors: results.filter((r) => !r.ok),
    warnings: results.flatMap((r) =>
      (r.warnings || []).map((w) => ({ name: r.name, warning: w }))
    ),
  };
}

/**
 * Parse `git remote -v` stdout into { name, url, purpose }[].
 */
export function parseGitRemoteV(stdout) {
  const out = [];
  for (const line of String(stdout || "").split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (m) out.push({ name: m[1], url: m[2], purpose: m[3] });
  }
  return out;
}
