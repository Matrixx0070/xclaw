/**
 * XClaw M0/M1 — MITM proxy lifecycle (opt-in only).
 *
 * Feature gate (same idea as CUA_DD_MITMPROXY):
 *   XCLAW_MITM=true|1   OR config browser.mitm.enabled
 *
 * M1: start/stop mitmdump as a supervised child.
 * Default listen: 127.0.0.1:4444
 *
 * Confdir layout:
 *   ~/.xclaw/mitm/          (or XCLAW_MITM_CONFDIR / package mitm-confdir)
 *     addons.py
 *     flows.jsonl
 *     mitm.pid
 *     mitm.log
 *     (mitmproxy CA generated on first run)
 */

import { spawn, execFile } from "node:child_process";
import { isPidAlive } from "../shared/pid-alive.mjs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_CONFDIR = path.join(__dirname, "mitm-confdir");
const HOME = process.env.HOME || os.homedir();
const DEFAULT_CONFDIR = path.join(HOME, ".xclaw", "mitm");
const DEFAULT_PORT = 4444;

/** @returns {boolean} */
export function isMitmEnabled(cfg = null) {
  const env = process.env.XCLAW_MITM;
  if (env === "0" || env === "false" || env === "off") return false;
  if (env === "1" || env === "true" || env === "on" || env === "yes") return true;
  if (cfg?.browser?.mitm?.enabled === true) return true;
  if (cfg?.browser?.mitm?.enabled === false) return false;
  return false; // off by default — never silent MITM
}

export function mitmPort(cfg = null) {
  const fromEnv = Number(process.env.XCLAW_MITM_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromCfg = Number(cfg?.browser?.mitm?.port);
  if (Number.isFinite(fromCfg) && fromCfg > 0) return fromCfg;
  return DEFAULT_PORT;
}

export function mitmConfdir(cfg = null) {
  return (
    process.env.XCLAW_MITM_CONFDIR ||
    cfg?.browser?.mitm?.confdir ||
    DEFAULT_CONFDIR
  );
}

export function mitmPidPath(cfg = null) {
  return path.join(mitmConfdir(cfg), "mitm.pid");
}

export function mitmLogPath(cfg = null) {
  return path.join(mitmConfdir(cfg), "mitm.log");
}

export function mitmFlowsPath(cfg = null) {
  return path.join(mitmConfdir(cfg), "flows.jsonl");
}

/**
 * Ensure confdir exists and has addons.py (copy from package if missing).
 * Mirrors CUA pattern: copy defaults unless mounted/pre-provisioned.
 */
export async function ensureMitmConfdir(cfg = null) {
  const confdir = mitmConfdir(cfg);
  await fsp.mkdir(confdir, { recursive: true });

  const destAddon = path.join(confdir, "addons.py");
  const srcAddon = path.join(PACKAGE_CONFDIR, "addons.py");
  const forceSync = process.env.XCLAW_MITM_SYNC_ADDON === "1" || process.env.XCLAW_MITM_SYNC_ADDON === "true";
  let needCopy = forceSync;
  if (!needCopy) {
    try {
      await fsp.access(destAddon);
    } catch {
      needCopy = true;
    }
  }
  if (needCopy) {
    try {
      await fsp.copyFile(srcAddon, destAddon);
    } catch (e) {
      // write inline fallback if package copy fails
      await fsp.writeFile(
        destAddon,
        `# XClaw minimal addon fallback\nfrom mitmproxy import ctx\nclass A:\n  def load(self, loader): ctx.log.info("XClaw MITM")\naddons=[A()]\n`
      );
    }
  }

  // marker
  try {
    await fsp.writeFile(
      path.join(confdir, ".xclaw-mitm"),
      `xclaw-mitm\ncreated=${new Date().toISOString()}\n`,
      { flag: "wx" }
    );
  } catch {
    /* exists */
  }

  return confdir;
}

export function readMitmPid(cfg = null) {
  try {
    const raw = fs.readFileSync(mitmPidPath(cfg), "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isMitmRunning(cfg = null) {
  const pid = readMitmPid(cfg);
  return isPidAlive(pid);
}

/** Probe whether something accepts TCP on host:port */
export function probePort(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const t = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.on("connect", () => {
      clearTimeout(t);
      sock.end();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/**
 * Locate mitmdump binary.
 * @returns {Promise<string|null>}
 */
export async function findMitmdump() {
  // Explicit override is exclusive — do not fall through if missing
  if (process.env.XCLAW_MITMDUMP) {
    const forced = process.env.XCLAW_MITMDUMP;
    try {
      await fsp.access(forced);
      return forced;
    } catch {
      return null;
    }
  }
  const candidates = [
    path.join(HOME, ".local", "bin", "mitmdump"),
    "/usr/local/bin/mitmdump",
    "/usr/bin/mitmdump",
    "mitmdump",
  ];
  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    try {
      if (c === "mitmdump" || !String(c).includes(path.sep)) {
        const pathEnv =
          (process.env.PATH || "") +
          path.delimiter +
          path.join(HOME, ".local", "bin") +
          path.delimiter +
          "/usr/local/bin";
        const resolved = await new Promise((res, rej) => {
          execFile(
            "which",
            [c],
            { env: { ...process.env, PATH: pathEnv } },
            (err, stdout) =>
              err || !stdout.trim() ? rej(err || new Error("not found")) : res(stdout.trim())
          );
        });
        return resolved;
      }
      await fsp.access(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Env vars to inject into computer/gateway children so Chrome M2 sees MITM.
 * Bridges config browser.mitm.enabled → process env (bundle only reads env).
 */
export function mitmEnvFromConfig(cfg = null) {
  const env = {};
  if (!isMitmEnabled(cfg)) return env;
  env.XCLAW_MITM = process.env.XCLAW_MITM || "true";
  env.XCLAW_MITM_PORT = String(mitmPort(cfg));
  env.XCLAW_MITM_CONFDIR = mitmConfdir(cfg);
  if (process.env.XCLAW_MITMDUMP) env.XCLAW_MITMDUMP = process.env.XCLAW_MITMDUMP;
  if (process.env.XCLAW_MITM_INSECURE_CERTS) {
    env.XCLAW_MITM_INSECURE_CERTS = process.env.XCLAW_MITM_INSECURE_CERTS;
  }
  if (process.env.XCLAW_MITM_ALLOWLIST) {
    env.XCLAW_MITM_ALLOWLIST = process.env.XCLAW_MITM_ALLOWLIST;
  } else if (cfg?.browser?.mitm?.allowlist?.length) {
    env.XCLAW_MITM_ALLOWLIST = cfg.browser.mitm.allowlist.join(",");
  }
  if (cfg?.browser?.mitm?.sslInsecure === false) {
    env.XCLAW_MITM_SSL_VERIFY = "1";
  }
  // Precomputed chrome flags for any consumer that reads the env
  env.XCLAW_CHROME_MITM_ARGS = [
    `--proxy-server=http://127.0.0.1:${mitmPort(cfg)}`,
    "--proxy-bypass-list=<-loopback>",
  ].join(" ");
  return env;
}

/**
 * Wait until mitmdump listens and (optionally) CA / ready file exist.
 */
export async function waitForMitmReady(cfg = null, { timeoutMs = 15_000, needCa = true } = {}) {
  if (!isMitmEnabled(cfg)) {
    return { ok: false, reason: "disabled" };
  }
  const port = mitmPort(cfg);
  const confdir = mitmConfdir(cfg);
  const start = Date.now();
  let listening = false;
  let ready = false;
  let ca = null;
  while (Date.now() - start < timeoutMs) {
    listening = await probePort(port);
    try {
      await fsp.access(path.join(confdir, "ready"));
      ready = true;
    } catch {
      ready = false;
    }
    ca = await findMitmCaCert(cfg);
    if (listening && (!needCa || ca) && ready) {
      return { ok: true, listening, ready, caPath: ca, waitedMs: Date.now() - start };
    }
    // listening without ready is still useful after a few seconds
    if (listening && (!needCa || ca) && Date.now() - start > 3000) {
      return { ok: true, listening, ready, caPath: ca, waitedMs: Date.now() - start, partial: !ready };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    ok: false,
    reason: "timeout",
    listening,
    ready,
    caPath: ca,
    waitedMs: Date.now() - start,
  };
}

/**
 * Start mitmdump if enabled and not already running.
 * Returns status object; does not throw when disabled.
 */
export async function startMitm(cfg = null, { log = console.log } = {}) {
  if (!isMitmEnabled(cfg)) {
    return { ok: false, reason: "disabled", code: "MITM_DISABLED" };
  }

  if (isMitmRunning(cfg)) {
    const pid = readMitmPid(cfg);
    const port = mitmPort(cfg);
    const up = await probePort(port);
    return { ok: true, already: true, pid, port, listening: up };
  }

  const bin = await findMitmdump();
  if (!bin) {
    return {
      ok: false,
      reason: "mitmdump not found — install mitmproxy or set XCLAW_MITMDUMP",
      code: "MITMDUMP_MISSING",
    };
  }

  const confdir = await ensureMitmConfdir(cfg);
  const port = mitmPort(cfg);
  const addon = path.join(confdir, "addons.py");
  const logPath = mitmLogPath(cfg);
  const pidPath = mitmPidPath(cfg);

  // H0: rotate oversized flow log before attach (disk resilience)
  try {
    const flowsPath = path.join(confdir, "flows.jsonl");
    const { rotateFileIfLarge } = await import("./horizon0.mjs");
    const rot = await rotateFileIfLarge(flowsPath, {
      maxBytes: Number(process.env.XCLAW_MITM_FLOWS_MAX_BYTES) || 50 * 1024 * 1024,
      keep: 3,
    });
    if (rot.rotated) log(`[mitm] rotated flows → ${rot.archive}`);
  } catch {
    /* */
  }

  await fsp.mkdir(path.dirname(logPath), { recursive: true });

  const args = [
    "--listen-host",
    "127.0.0.1",
    "-p",
    String(port),
    "--set",
    `confdir=${confdir}`,
    "-s",
    addon,
    "-q",
  ];
  // Lab convenience (matches CUA --ssl-insecure for broken chains). Opt-out with XCLAW_MITM_SSL_VERIFY=1
  if (process.env.XCLAW_MITM_SSL_VERIFY !== "1") {
    args.push("--ssl-insecure");
  }

  const out = fs.openSync(logPath, "a");
  let child;
  try {
    child = spawn(bin, args, {
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        XCLAW_MITM_CONFDIR: confdir,
        XCLAW_MITM_ALLOWLIST: process.env.XCLAW_MITM_ALLOWLIST || cfg?.browser?.mitm?.allowlist?.join?.(",") || "",
      },
    });
  } catch (e) {
    try { fs.closeSync(out); } catch { /* */ }
    return {
      ok: false,
      reason: e?.message || String(e),
      code: e?.code === "ENOENT" ? "MITMDUMP_MISSING" : "SPAWN_FAILED",
    };
  }
  child.on("error", (e) => {
    log(`[mitm] spawn error: ${e?.message || e}`);
  });
  child.unref();

  // If spawn fails async (ENOENT), pid may be undefined — wait a tick
  await new Promise((r) => setTimeout(r, 50));
  if (typeof child.pid !== "number") {
    try { fs.closeSync(out); } catch { /* */ }
    return { ok: false, reason: "spawn produced no pid", code: "MITMDUMP_MISSING" };
  }

  await fsp.writeFile(pidPath, String(child.pid));

  // wait briefly for listen
  let listening = false;
  for (let i = 0; i < 20; i++) {
    listening = await probePort(port);
    if (listening) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  log(`[mitm] started pid=${child.pid} port=${port} confdir=${confdir} listening=${listening}`);

  return {
    ok: true,
    pid: child.pid,
    port,
    confdir,
    listening,
    proxyUrl: `http://127.0.0.1:${port}`,
  };
}

/**
 * Stop mitmdump child if we own the pid file.
 */
export async function stopMitm(cfg = null, { log = console.log } = {}) {
  const pid = readMitmPid(cfg);
  const pidPath = mitmPidPath(cfg);
  if (!pid) {
    try {
      await fsp.unlink(pidPath);
    } catch {
      /* */
    }
    return { ok: true, stopped: false };
  }
  if (isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 400));
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* */
      }
    }
  }
  try {
    await fsp.unlink(pidPath);
  } catch {
    /* */
  }
  log(`[mitm] stopped pid=${pid}`);
  return { ok: true, stopped: true, pid };
}

/**
 * Locate mitmproxy CA cert (generated on first mitmdump start).
 * @returns {Promise<string|null>} path to .pem
 */
export async function findMitmCaCert(cfg = null) {
  const confdir = mitmConfdir(cfg);
  // An explicitly configured confdir is authoritative — never fall back to
  // the operator's personal ~/.mitmproxy CA (host leakage, non-hermetic).
  const explicit = Boolean(
    process.env.XCLAW_MITM_CONFDIR || cfg?.browser?.mitm?.confdir
  );
  const candidates = [
    path.join(confdir, "mitmproxy-ca-cert.pem"),
    path.join(confdir, "mitmproxy-ca.pem"),
    ...(explicit
      ? []
      : [
          path.join(HOME, ".mitmproxy", "mitmproxy-ca-cert.pem"),
          path.join(HOME, ".mitmproxy", "mitmproxy-ca.pem"),
        ]),
  ];
  for (const c of candidates) {
    try {
      await fsp.access(c);
      return c;
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * openssl x509 metadata for the MITM CA.
 * @returns {Promise<object|null>}
 */
export async function getMitmCaInfo(cfg = null) {
  const certPath = await findMitmCaCert(cfg);
  if (!certPath) return null;
  const safe = String(certPath).replace(/'/g, "'\\''");
  const fields = await new Promise((resolve) => {
    const cmd =
      "openssl x509 -in '" +
      safe +
      "' -noout -subject -issuer -dates -fingerprint -sha256 2>/dev/null";
    execFile("bash", ["-c", cmd], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve({});
      const out = {};
      for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (t.startsWith("subject=")) out.subject = t.slice(8).trim();
        else if (t.startsWith("issuer=")) out.issuer = t.slice(7).trim();
        else if (t.startsWith("notBefore=")) out.notBefore = t.slice(10).trim();
        else if (t.startsWith("notAfter=")) out.notAfter = t.slice(9).trim();
        else if (/Fingerprint=/i.test(t)) out.fingerprintSha256 = t.split("=").slice(1).join("=").trim();
      }
      resolve(out);
    });
  });
  const spki = await mitmCaSpkiHash(certPath);
  let pem = null;
  try {
    pem = await fsp.readFile(certPath, "utf8");
  } catch {
    /* */
  }
  const confdir = mitmConfdir(cfg);
  return {
    certPath,
    confdir,
    spki,
    spkiChromeFlag: spki ? `--ignore-certificate-errors-spki-list=${spki}` : null,
    ...fields,
    pemLength: pem ? pem.length : 0,
    hasKey: await fileExists(path.join(confdir, "mitmproxy-ca.pem")),
    p12Path: (await fileExists(path.join(confdir, "mitmproxy-ca.p12")))
      ? path.join(confdir, "mitmproxy-ca.p12")
      : null,
  };
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure MITM CA exists in confdir. If missing, start mitmdump briefly to generate it.
 * @returns {Promise<{ok:boolean, created?:boolean, certPath?:string, reason?:string}>}
 */
export async function ensureMitmCa(cfg = null, { log = console.log, timeoutMs = 20_000 } = {}) {
  let certPath = await findMitmCaCert(cfg);
  if (certPath) {
    return { ok: true, created: false, certPath };
  }

  // Need mitmdump to materialize CA into confdir
  const confdir = await ensureMitmConfdir(cfg);
  const bin = await findMitmdump();
  if (!bin) {
    return {
      ok: false,
      reason: "mitmdump not found — cannot generate CA without mitmproxy",
      code: "MITMDUMP_MISSING",
    };
  }

  // If proxy already running, wait for CA file
  if (isMitmRunning(cfg)) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      certPath = await findMitmCaCert(cfg);
      if (certPath) return { ok: true, created: true, certPath };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, reason: "timeout waiting for CA from running mitmdump" };
  }

  // One-shot: start, wait for CA, leave running if XCLAW_MITM enabled else stop
  const wasEnabled = isMitmEnabled(cfg);
  // Temporarily force-enable start path by setting env if needed
  const prev = process.env.XCLAW_MITM;
  if (!wasEnabled) process.env.XCLAW_MITM = "true";
  try {
    const started = await startMitm(cfg, { log });
    if (!started.ok && started.code !== "MITM_DISABLED") {
      // startMitm respects gate — if still disabled somehow
      if (started.code === "MITMDUMP_MISSING") return started;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      certPath = await findMitmCaCert(cfg);
      if (certPath) {
        if (!wasEnabled) {
          await stopMitm(cfg, { log });
        }
        return { ok: true, created: true, certPath, leftRunning: wasEnabled };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!wasEnabled) await stopMitm(cfg, { log });
    return { ok: false, reason: "timeout generating CA" };
  } finally {
    if (prev === undefined) delete process.env.XCLAW_MITM;
    else process.env.XCLAW_MITM = prev;
  }
}

/**
 * Copy CA PEM (and optional p12) to destDir or dest file path.
 */
export async function exportMitmCa(cfg = null, dest = null) {
  const certPath = await findMitmCaCert(cfg);
  if (!certPath) {
    return { ok: false, reason: "no_ca", hint: "call ensureMitmCa() or start mitmdump once" };
  }
  const confdir = mitmConfdir(cfg);
  const outDir = dest
    ? (dest.endsWith(".pem") ? path.dirname(dest) : dest)
    : path.join(confdir, "export");
  await fsp.mkdir(outDir, { recursive: true });
  const outPem = dest && dest.endsWith(".pem") ? dest : path.join(outDir, "xclaw-mitmproxy-ca-cert.pem");
  await fsp.copyFile(certPath, outPem);
  const result = { ok: true, certPath: outPem, source: certPath };
  const p12 = path.join(confdir, "mitmproxy-ca.p12");
  try {
    await fsp.access(p12);
    const outP12 = path.join(path.dirname(outPem), "xclaw-mitmproxy-ca.p12");
    await fsp.copyFile(p12, outP12);
    result.p12Path = outP12;
  } catch {
    /* no p12 */
  }
  // Also write SPKI sidecar for Chrome flags
  const spki = await mitmCaSpkiHash(certPath);
  if (spki) {
    const spkiPath = path.join(path.dirname(outPem), "xclaw-mitmproxy-ca.spki");
    await fsp.writeFile(spkiPath, spki + "\n");
    result.spki = spki;
    result.spkiPath = spkiPath;
    result.chromeFlag = `--ignore-certificate-errors-spki-list=${spki}`;
  }
  return result;
}

/**
 * Full CA management status for agent / doctor.
 */
export async function mitmCaStatus(cfg = null) {
  const info = await getMitmCaInfo(cfg);
  if (!info) {
    return {
      present: false,
      confdir: mitmConfdir(cfg),
      hint: "Run ensureMitmCa or start mitmdump once to generate mitmproxy-ca-cert.pem",
    };
  }
  let expired = false;
  if (info.notAfter) {
    try {
      expired = Date.parse(info.notAfter) < Date.now();
    } catch {
      /* */
    }
  }
  return {
    present: true,
    expired,
    ...info,
    trustMethods: [
      "chrome --ignore-certificate-errors-spki-list=<spki>",
      "certutil -d sql:PROFILE -A -t C,, -n xclaw-mitmproxy-ca -i cert.pem",
      "CDP Security.setIgnoreCertificateErrors (lab session)",
      "XCLAW_MITM_INSECURE_CERTS=1 (lab only)",
    ],
  };
}

/**
 * SPKI SHA-256 (base64) of a PEM cert — for Chromium
 * --ignore-certificate-errors-spki-list
 */
export async function mitmCaSpkiHash(certPath) {
  if (!certPath) return null;
  return new Promise((resolve) => {
    // shell-escape single quotes in path
    const safe = String(certPath).replace(/'/g, "'\\''");
    const cmd =
      "openssl x509 -in '" +
      safe +
      "' -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256 -binary 2>/dev/null | openssl enc -base64 2>/dev/null";
    execFile(
      "bash",
      ["-c", cmd],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout?.trim()) return resolve(null);
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * Import CA into Chromium NSS DB under userDataDir when certutil is available.
 * Returns { ok, method }.
 */
export async function trustMitmCaInProfile(userDataDir, cfg = null) {
  const certPath = await findMitmCaCert(cfg);
  if (!certPath || !userDataDir) {
    return { ok: false, method: "none", reason: "no_ca_or_profile" };
  }

  try {
    await fsp.mkdir(userDataDir, { recursive: true });
  } catch {
    /* */
  }

  const certutil = await new Promise((res) => {
    execFile("which", ["certutil"], (err, stdout) =>
      res(err || !stdout.trim() ? null : stdout.trim())
    );
  });

  if (!certutil) {
    // H3: NSS is preferred; SPKI remains the portable fallback (caller adds flag)
    return {
      ok: false,
      method: "none",
      reason: "certutil_missing",
      certPath,
      fallback: "spki",
      hint: "Install libnss3-tools for profile-native CA trust",
    };
  }

  // Horizon 3: prefer Chromium profile NSS DB (sql:userDataDir).
  // Also ensure a dedicated nssdb dir exists for tooling/debugging.
  const nssDir = path.join(userDataDir, "nssdb");
  try {
    await fsp.mkdir(nssDir, { recursive: true });
  } catch {
    /* */
  }

  const importOnce = (dbPath) =>
    new Promise((resolve) => {
      execFile(
        certutil,
        [
          "-d",
          `sql:${dbPath}`,
          "-A",
          "-t",
          "C,,",
          "-n",
          "xclaw-mitmproxy-ca",
          "-i",
          certPath,
        ],
        { timeout: 8000 },
        (err, _stdout, stderr) => {
          if (err) {
            const msg = String(stderr || err.message || "");
            if (/already exists|SEC_ERROR_PKCS11/i.test(msg)) {
              return resolve({ ok: true, method: "certutil", certPath, note: "already_present", dbPath });
            }
            return resolve({ ok: false, method: "certutil", reason: msg.slice(0, 200), dbPath });
          }
          resolve({ ok: true, method: "certutil", certPath, dbPath });
        }
      );
    });

  // Primary: Chromium user-data-dir NSS (where Chrome looks)
  const primary = await importOnce(userDataDir);
  // Secondary: dedicated nssdb/ (ops/debug)
  const secondary = await importOnce(nssDir).catch(() => ({ ok: false }));

  if (primary.ok) {
    return {
      ...primary,
      secondaryOk: Boolean(secondary?.ok),
      trustOrder: ["nss-profile", "spki", "cdp-ignore", "insecure-flag"],
    };
  }
  if (secondary?.ok) {
    return {
      ...secondary,
      note: "profile_db_failed_nssdb_ok",
      trustOrder: ["nss-nssdb", "spki", "cdp-ignore", "insecure-flag"],
    };
  }
  return {
    ok: false,
    method: "certutil",
    reason: primary.reason || secondary?.reason || "import_failed",
    certPath,
    fallback: "spki",
    trustOrder: ["spki", "cdp-ignore", "insecure-flag"],
  };
}

/**
 * Chrome / Chromium launch args when MITM is active (M2).
 * - Always: --proxy-server
 * - Prefer: --ignore-certificate-errors-spki-list=<hash> when CA is known
 * - Lab fallback: --ignore-certificate-errors if XCLAW_MITM_INSECURE_CERTS=1
 */
export function chromeProxyArgs(cfg = null) {
  if (!isMitmEnabled(cfg)) return [];
  const port = mitmPort(cfg);
  return [`--proxy-server=http://127.0.0.1:${port}`];
}

/**
 * Full M2 arg list (async — may hash CA).
 * @returns {Promise<string[]>}
 */
export async function chromeMitmArgs(cfg = null, { userDataDir = null } = {}) {
  if (!isMitmEnabled(cfg)) return [];

  const args = [...chromeProxyArgs(cfg)];
  const port = mitmPort(cfg);

  // Prefer scoped SPKI ignore over blanket --ignore-certificate-errors
  const certPath = await findMitmCaCert(cfg);
  if (certPath) {
    const spki = await mitmCaSpkiHash(certPath);
    if (spki) {
      args.push(`--ignore-certificate-errors-spki-list=${spki}`);
    }
    if (userDataDir) {
      await trustMitmCaInProfile(userDataDir, cfg);
    }
  }

  // Explicit lab escape hatch only (do not confuse with -spki-list flag)
  if (process.env.XCLAW_MITM_INSECURE_CERTS === "1" || process.env.XCLAW_MITM_INSECURE_CERTS === "true") {
    if (!args.includes("--ignore-certificate-errors")) {
      args.push("--ignore-certificate-errors");
    }
  }

  // Avoid proxy for localhost (CDP / computer sidecar)
  args.push("--proxy-bypass-list=<-loopback>");

  return args;
}

/**
 * Read recent redacted flow summaries (M3 — filterable).
 * @param {object|null} cfg
 * @param {{
 *   limit?: number,
 *   host?: string,
 *   method?: string,
 *   status?: number|string,
 *   statusMin?: number,
 *   statusMax?: number,
 *   urlContains?: string,
 *   sinceTs?: number,
 * }} [opts]
 */
export async function readMitmFlows(cfg = null, opts = {}) {
  const {
    limit = 50,
    host,
    method,
    status,
    statusMin,
    statusMax,
    urlContains,
    sinceTs,
  } = opts || {};
  const p = mitmFlowsPath(cfg);
  let rows = [];
  try {
    const text = await fsp.readFile(p, "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    rows = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
  } catch {
    return [];
  }

  const hostLc = host ? String(host).toLowerCase() : null;
  const methodUc = method ? String(method).toUpperCase() : null;
  const urlSub = urlContains ? String(urlContains).toLowerCase() : null;
  const statusNum = status !== undefined && status !== null && status !== ""
    ? Number(status)
    : null;

  const filtered = rows.filter((f) => {
    if (!f || f.raw) return false;
    if (hostLc) {
      const h = String(f.host || "").toLowerCase();
      if (h !== hostLc && !h.endsWith("." + hostLc) && !h.includes(hostLc)) return false;
    }
    if (methodUc && String(f.method || "").toUpperCase() !== methodUc) return false;
    if (statusNum !== null && Number.isFinite(statusNum) && Number(f.status) !== statusNum) return false;
    if (statusMin !== undefined && statusMin !== null && Number(f.status) < Number(statusMin)) return false;
    if (statusMax !== undefined && statusMax !== null && Number(f.status) > Number(statusMax)) return false;
    if (urlSub) {
      const u = String(f.url || "").toLowerCase();
      if (!u.includes(urlSub)) return false;
    }
    if (sinceTs !== undefined && sinceTs !== null && Number(f.ts) < Number(sinceTs)) return false;
    return true;
  });

  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  return filtered.slice(-lim);
}

/**
 * Aggregate status for agent / doctor (M3).
 */
export async function mitmStatus(cfg = null) {
  const enabled = isMitmEnabled(cfg);
  const running = isMitmRunning(cfg);
  const port = mitmPort(cfg);
  const confdir = mitmConfdir(cfg);
  const pid = readMitmPid(cfg);
  const listening = enabled ? await probePort(port) : false;
  const ca = await findMitmCaCert(cfg);
  let flowCount = 0;
  let lastFlowTs = null;
  try {
    const text = await fsp.readFile(mitmFlowsPath(cfg), "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    flowCount = lines.length;
    if (lines.length) {
      try {
        lastFlowTs = JSON.parse(lines[lines.length - 1]).ts ?? null;
      } catch {
        /* */
      }
    }
  } catch {
    /* no flows yet */
  }
  // Addon running() writes confdir/ready; stats.json holds counters
  let ready = false;
  let readyMeta = null;
  let stats = null;
  try {
    const raw = await fsp.readFile(path.join(confdir, "ready"), "utf8");
    ready = true;
    try {
      readyMeta = JSON.parse(raw.trim());
    } catch {
      readyMeta = { raw: raw.trim() };
    }
  } catch {
    /* no ready file */
  }
  try {
    stats = JSON.parse(await fsp.readFile(path.join(confdir, "stats.json"), "utf8"));
  } catch {
    /* */
  }
  const bin = await findMitmdump();
  return {
    enabled,
    running,
    listening,
    ready,
    readyMeta,
    pid,
    port,
    confdir,
    proxyUrl: enabled ? `http://127.0.0.1:${port}` : null,
    caPath: ca,
    caPresent: Boolean(ca),
    mitmdump: bin,
    flowCount,
    lastFlowTs,
    flowsPath: mitmFlowsPath(cfg),
    stats,
    errors: stats?.errors ?? 0,
    blocked: stats?.blocked ?? 0,
    tlsFailClient: stats?.tls_fail_client ?? 0,
    tlsFailServer: stats?.tls_fail_server ?? 0,
  };
}

export async function clearMitmFlows(cfg = null) {
  const p = mitmFlowsPath(cfg);
  try {
    await fsp.writeFile(p, "");
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, path: p, error: e?.message || String(e) };
  }
}

/**
 * Format flows for agent-readable text.
 */
export function formatMitmFlows(flows, { max = 40 } = {}) {
  if (!flows?.length) return "(no matching flows)";
  const slice = flows.slice(-max);
  return slice
    .map((f, i) => {
      const t = f.ts ? new Date(f.ts * 1000).toISOString() : "?";
      return `${i + 1}. [${t}] ${f.method || "?"} ${f.status ?? "—"} ${f.host || ""} ${String(f.url || "").slice(0, 120)} size=${f.size ?? "?"}`;
    })
    .join("\n");
}

export default {
  isMitmEnabled,
  mitmPort,
  mitmConfdir,
  ensureMitmConfdir,
  findMitmdump,
  startMitm,
  stopMitm,
  isMitmRunning,
  readMitmPid,
  chromeProxyArgs,
  chromeMitmArgs,
  findMitmCaCert,
  getMitmCaInfo,
  ensureMitmCa,
  exportMitmCa,
  mitmCaStatus,
  mitmCaSpkiHash,
  trustMitmCaInProfile,
  readMitmFlows,
  mitmStatus,
  clearMitmFlows,
  formatMitmFlows,
  mitmEnvFromConfig,
  waitForMitmReady,
  probePort,
};
