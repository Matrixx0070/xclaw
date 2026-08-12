/**
 * Git credential helper integration.
 *
 * Uses the standard `git credential` stdin/stdout protocol:
 *   fill    — resolve username/password for a remote description
 *   approve — store after successful use
 *   reject  — erase after failed auth
 *
 * @see https://git-scm.com/docs/git-credential
 */
import { spawn } from "node:child_process";
import { validateGitRemoteUrl } from "./remote-url.mjs";

/**
 * Parse key=value\n credential attributes (blank line ends).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseCredentialAttrs(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (k) out[k] = v;
  }
  return out;
}

/**
 * Serialize attributes for git-credential stdin.
 * @param {Record<string, string>} attrs
 */
export function formatCredentialAttrs(attrs) {
  const lines = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === "") continue;
    // Values must not contain newlines
    if (/[\r\n]/.test(String(v))) {
      throw new Error(`credential attribute ${k} contains newline`);
    }
    lines.push(`${k}=${v}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Build credential description from a remote URL.
 * @param {string} remoteUrl
 * @returns {{ ok: true, attrs: Record<string,string> } | { ok: false, error, code? }}
 */
export function credentialDescriptionFromUrl(remoteUrl) {
  const v = validateGitRemoteUrl(remoteUrl, {
    allowHttp: true,
    allowGitProtocol: true,
    allowFile: true,
  });
  if (!v.ok && v.code !== "REMOTE_URL_HTTP_DENIED" && v.code !== "REMOTE_URL_GIT_PROTOCOL_DENIED") {
    // Still try to parse for credential fill if only policy denied
    if (v.code === "REMOTE_URL_EMPTY" || v.code === "REMOTE_URL_PARSE") {
      return { ok: false, code: v.code, error: v.error };
    }
  }

  const attrs = {};

  // SCP git@host:path
  const scp = String(remoteUrl)
    .trim()
    .match(/^([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):(\/\/)?(.+)$/);
  if (scp && !String(remoteUrl).includes("://")) {
    attrs.protocol = "ssh";
    attrs.host = scp[2];
    attrs.username = scp[1];
    attrs.path = scp[4].replace(/^\//, "");
    return { ok: true, attrs };
  }

  let url;
  try {
    url = new URL(remoteUrl);
  } catch {
    return { ok: false, code: "REMOTE_URL_PARSE", error: "cannot parse remote for credentials" };
  }

  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  attrs.protocol = protocol === "git" ? "git" : protocol;
  if (url.hostname) attrs.host = url.hostname;
  if (url.port) attrs.port = url.port;
  if (url.username) attrs.username = decodeURIComponent(url.username);
  if (url.password) attrs.password = decodeURIComponent(url.password);
  const p = url.pathname?.replace(/^\//, "");
  if (p) attrs.path = p;

  return { ok: true, attrs };
}

function runGitCredential(action, attrs, { timeoutMs = 15_000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn("git", ["credential", action], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        ok: false,
        code: "CREDENTIAL_TIMEOUT",
        error: `git credential ${action} timed out`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({
        ok: false,
        code: "CREDENTIAL_SPAWN",
        error: err.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        resolve({
          ok: false,
          code: "CREDENTIAL_EXIT",
          error: stderr.trim() || `git credential ${action} exited ${code}`,
          exitCode: code,
        });
        return;
      }
      resolve({
        ok: true,
        action,
        attrs: parseCredentialAttrs(stdout),
        raw: stdout,
      });
    });

    try {
      child.stdin.write(formatCredentialAttrs(attrs));
      child.stdin.end();
    } catch (e) {
      clearTimeout(t);
      resolve({ ok: false, code: "CREDENTIAL_WRITE", error: e.message });
    }
  });
}

/**
 * Fill credentials via git credential helpers (+ optional env overrides).
 *
 * Env overrides (non-interactive agents):
 *   XCLAW_GIT_USERNAME / GIT_USERNAME
 *   XCLAW_GIT_PASSWORD / GIT_PASSWORD / XCLAW_GIT_TOKEN / GITHUB_TOKEN / GH_TOKEN
 *
 * @param {string|Record<string,string>} urlOrAttrs
 * @param {{ cwd?: string, useEnv?: boolean, timeoutMs?: number }} [opts]
 */
export async function fillGitCredential(urlOrAttrs, opts = {}) {
  let attrs;
  if (typeof urlOrAttrs === "string") {
    const d = credentialDescriptionFromUrl(urlOrAttrs);
    if (!d.ok) return d;
    attrs = { ...d.attrs };
  } else {
    attrs = { ...urlOrAttrs };
  }

  // Env injection for headless agents (before helper, so helper can still override empty)
  if (opts.useEnv !== false) {
    const user =
      process.env.XCLAW_GIT_USERNAME ||
      process.env.GIT_USERNAME ||
      attrs.username;
    const pass =
      process.env.XCLAW_GIT_PASSWORD ||
      process.env.GIT_PASSWORD ||
      process.env.XCLAW_GIT_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.GITLAB_TOKEN ||
      attrs.password;
    if (user && !attrs.username) attrs.username = user;
    if (pass && !attrs.password) attrs.password = pass;
  }

  // If already complete and skipHelpers
  if (opts.skipHelpers && attrs.username && attrs.password) {
    return { ok: true, attrs, source: "env" };
  }

  const filled = await runGitCredential("fill", attrs, opts);
  if (!filled.ok) {
    // Fall back to env-only if helpers fail but env has secrets
    if (attrs.username && attrs.password) {
      return { ok: true, attrs, source: "env-fallback", helperError: filled.error };
    }
    return filled;
  }

  const merged = { ...attrs, ...filled.attrs };
  if (!merged.username && !merged.password) {
    return {
      ok: false,
      code: "CREDENTIAL_EMPTY",
      error: "git credential fill returned no username/password",
      attrs: merged,
    };
  }
  return { ok: true, attrs: merged, source: "git-credential" };
}

/**
 * Store credentials after successful auth (git credential approve).
 */
export async function approveGitCredential(urlOrAttrs, opts = {}) {
  const attrs =
    typeof urlOrAttrs === "string"
      ? credentialDescriptionFromUrl(urlOrAttrs)
      : { ok: true, attrs: urlOrAttrs };
  if (!attrs.ok) return attrs;
  return runGitCredential("approve", attrs.attrs, opts);
}

/**
 * Erase credentials after failed auth (git credential reject).
 */
export async function rejectGitCredential(urlOrAttrs, opts = {}) {
  const attrs =
    typeof urlOrAttrs === "string"
      ? credentialDescriptionFromUrl(urlOrAttrs)
      : { ok: true, attrs: urlOrAttrs };
  if (!attrs.ok) return attrs;
  return runGitCredential("reject", attrs.attrs, opts);
}

/**
 * Build an HTTPS remote URL embedding userinfo (use carefully; prefer helpers).
 * Never logs password.
 */
export function embedHttpsCredentials(remoteUrl, { username, password }) {
  const u = new URL(remoteUrl);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("embedHttpsCredentials only supports http(s)");
  }
  if (username) u.username = username;
  if (password) u.password = password;
  return u.toString();
}

/**
 * Redact secrets from credential attrs for logging.
 */
export function redactCredentialAttrs(attrs) {
  const out = { ...attrs };
  if (out.password) out.password = "***";
  return out;
}

/**
 * Doctor-style report: is credential.helper configured?
 */
export async function gitCredentialHelperStatus(cwd) {
  return new Promise((resolve) => {
    const child = spawn("git", ["config", "--get-regexp", "^credential"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.on("close", () => {
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf(" ");
          return i === -1 ? { key: l, value: "" } : { key: l.slice(0, i), value: l.slice(i + 1) };
        });
      const helpers = lines.filter((x) => x.key.includes("helper"));
      resolve({
        ok: true,
        configured: helpers.length > 0,
        helpers: helpers.map((h) => h.value),
        entries: lines,
      });
    });
    child.on("error", (err) =>
      resolve({ ok: false, error: err.message, configured: false })
    );
  });
}
