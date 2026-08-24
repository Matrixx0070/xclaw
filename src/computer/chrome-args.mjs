/**
 * Phase A5 — Single Chrome argv builder (source of truth for launch flags).
 *
 * Used by:
 *   - managed headless Chrome launch (chrome-session.mjs)
 *   - hooks.buildChromeArgs (invariants merge)
 *
 * Order: base H0 → headed/window → UA → sandbox → MITM proxy/SPKI → extra → CHROMIUM_FLAGS → docker
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * @param {object} opts
 * @param {string} opts.userDataDir
 * @param {boolean} [opts.headless]
 * @param {number|string} [opts.cdpPort] 0 = OS-assigned
 * @param {string[]} [opts.extra]
 * @param {string|null} [opts.caCertPath] mitm CA pem for SPKI
 * @param {boolean} [opts.mitm] force mitm flags from env if unset
 */
export function buildChromeArgs(opts = {}) {
  const userDataDir = opts.userDataDir;
  if (!userDataDir) throw new Error("chrome-args: userDataDir required");

  const forceHeaded =
    process.env.XCLAW_BROWSER_HEADED === "1" ||
    process.env.XCLAW_BROWSER_HEADED === "true";
  const headless = forceHeaded ? false : opts.headless !== false;

  const cdpPort = opts.cdpPort != null ? opts.cdpPort : 0;

  /** @type {string[]} */
  let args = [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
    "--disable-dev-shm-usage",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
  ];

  if (headless) {
    args.unshift("--headless=new");
  } else {
    const win = process.env.XCLAW_BROWSER_WINDOW_SIZE || "1280,720";
    const scale = process.env.XCLAW_BROWSER_SCALE || "1";
    args.push(`--window-size=${win}`);
    args.push("--window-position=0,0");
    args.push(`--force-device-scale-factor=${scale}`);
  }

  if (process.env.XCLAW_BROWSER_UA) {
    args.push(`--user-agent=${process.env.XCLAW_BROWSER_UA}`);
  }

  const noSandbox =
    process.env.XCLAW_BROWSER_NO_SANDBOX === "1" ||
    process.env.XCLAW_BROWSER_NO_SANDBOX === "true" ||
    process.env.CI === "true" ||
    process.env.XCLAW_IN_DOCKER === "1" ||
    fs.existsSync("/.dockerenv") ||
    // Chrome hard-refuses to start as root without --no-sandbox — on a
    // root-run host the browser exits before the CDP port ever opens.
    (typeof process.getuid === "function" && process.getuid() === 0);
  if (noSandbox) {
    if (!args.includes("--no-sandbox")) args.push("--no-sandbox");
    if (!args.includes("--test-type")) args.push("--test-type");
  }
  if (noSandbox || process.env.XCLAW_BROWSER_DISABLE_GPU === "1") {
    if (!args.includes("--disable-gpu")) args.push("--disable-gpu");
  }

  // MITM
  const mitmOn =
    opts.mitm === true ||
    process.env.XCLAW_MITM === "1" ||
    process.env.XCLAW_MITM === "true";
  if (mitmOn) {
    const mitmPort = process.env.XCLAW_MITM_PORT || "4444";
    args.push(`--proxy-server=http://127.0.0.1:${mitmPort}`);
    args.push("--proxy-bypass-list=<-loopback>");
    const caPath =
      opts.caCertPath ||
      process.env.XCLAW_MITM_CA_PATH ||
      null;
    if (caPath && fs.existsSync(caPath)) {
      const spki = spkiHashFromPem(caPath);
      if (spki) {
        args.push(`--ignore-certificate-errors-spki-list=${spki}`);
      }
    }
    if (
      process.env.XCLAW_MITM_INSECURE_CERTS === "1" ||
      process.env.XCLAW_MITM_INSECURE_CERTS === "true"
    ) {
      if (!args.includes("--ignore-certificate-errors")) {
        args.push("--ignore-certificate-errors");
      }
    }
  }

  if (Array.isArray(opts.extra)) {
    for (const a of opts.extra) {
      if (a && !args.includes(a)) args.push(a);
    }
  }

  if (process.env.CHROMIUM_FLAGS) {
    for (const a of process.env.CHROMIUM_FLAGS.split(/\s+/).filter(Boolean)) {
      if (!args.includes(a)) args.push(a);
    }
  }

  // Docker safety net
  if (noSandbox || isDockerSync()) {
    if (!args.includes("--no-sandbox")) args.push("--no-sandbox");
    if (!args.includes("--disable-gpu")) args.push("--disable-gpu");
    if (!args.includes("--test-type")) args.push("--test-type");
  }

  return args;
}

function isDockerSync() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/** SPKI SHA-256 base64 for Chromium --ignore-certificate-errors-spki-list */
export function spkiHashFromPem(certPath) {
  try {
    const out = execFileSync(
      "openssl",
      ["x509", "-in", certPath, "-pubkey", "-noout"],
      { encoding: "buffer", timeout: 5000 }
    );
    const der = execFileSync(
      "openssl",
      ["pkey", "-pubin", "-outform", "der"],
      { input: out, encoding: "buffer", timeout: 5000 }
    );
    const hash = execFileSync("openssl", ["dgst", "-sha256", "-binary"], {
      input: der,
      encoding: "buffer",
      timeout: 5000,
    });
    return Buffer.from(hash).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Invariants every launch must satisfy (for tests / doctor).
 */
export function chromeArgsInvariants(args) {
  const missing = [];
  for (const must of [
    "--remote-allow-origins=*",
    "--disable-dev-shm-usage",
    "--disable-crash-reporter",
  ]) {
    if (!args.includes(must)) missing.push(must);
  }
  if (!args.some((a) => a.startsWith("--remote-debugging-port="))) {
    missing.push("--remote-debugging-port=*");
  }
  if (!args.some((a) => a.startsWith("--user-data-dir="))) {
    missing.push("--user-data-dir=*");
  }
  return { ok: missing.length === 0, missing };
}

export default { buildChromeArgs, spkiHashFromPem, chromeArgsInvariants };
