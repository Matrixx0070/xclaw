/**
 * XClaw BrowserService — CLEAN editable source
 *
 * Extracted from the Grok/XClaw computer server bundle (`xclaw-server.mjs`).
 * This is the maintainable module for Chrome launch + CDP session ownership.
 *
 * Edit THIS file for Horizon A2+ (hooks, humanize, profile, fabric).
 * Runtime wiring: still inlined in xclaw-server.mjs until sync/import is enabled.
 *
 * @module computer/browser-service
 */

import { spawn, execFileSync, execFile } from "node:child_process";
import { constants, promises as fsP, rmSync } from "node:fs";
import { mkdtemp, rm as rm2, access as access2 } from "node:fs/promises";
import path3 from "node:path";
import os2 from "node:os";
import { createRequire } from "node:module";
import { buildChromeArgs as buildChromeArgsCanonical } from "./chrome-args.mjs";

const require = createRequire(import.meta.url);
const pathMod = path3;

const log_default = {
  info: (...a) => console.error("[xclaw-browser]", ...a),
  warn: (...a) => console.error("[xclaw-browser:warn]", ...a),
  error: (...a) => console.error("[xclaw-browser:error]", ...a),
};

const IS_WINDOWS = process.platform === "win32";

function execFileNoThrow(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        stdout: stdout || "",
        stderr: stderr || "",
      });
    });
  });
}

async function isDocker() {
  try {
    const c = await fsP.readFile("/proc/1/cgroup", "utf8");
    return /docker|kubepods|containerd/i.test(c);
  } catch {
    return false;
  }
}

async function getDefaultChromeProfileDir() {
  const platform = process.platform;
  if (platform === "darwin") {
    return path3.join(os2.homedir(), "Library", "Application Support", "Google", "Chrome", "Default");
  }
  if (platform === "linux") {
    return path3.join(os2.homedir(), ".config", "google-chrome", "Default");
  }
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) return null;
    return path3.join(local, "Google", "Chrome", "User Data", "Default");
  }
  return null;
}

async function copySessionData(srcDefault, destRoot) {
  const names = ["Cookies", "Cookies-journal", "Local Storage", "IndexedDB"];
  for (const n of names) {
    try {
      await fsP.cp(path3.join(srcDefault, n), path3.join(destRoot, "Default", n), {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    } catch {
      /* best-effort seed */
    }
  }
}

let _cri = null;
async function loadCRI() {
  if (_cri) return _cri;
  try {
    _cri = (await import("chrome-remote-interface")).default;
  } catch {
    _cri = require("chrome-remote-interface");
  }
  return _cri;
}

/** CDP browser connect — replaces inlined chrome-remote-interface calls in bundle. */
async function connectCRI(opts) {
  const cri = await loadCRI();
  return cri(opts);
}

export class BrowserService {
  chromePort = null;
  browserProcess = null;
  isBrowserRunning = false;
  browserClient = null;
  openTabs = /* @__PURE__ */ new Map();
  networkDataPerTab = /* @__PURE__ */ new Map();
  nextShortId = 1;
  chromeUserDataDir = null;
  headless = true;
  constructor(headless = true) {
    this.headless = headless;
  }
  static async getChromePath() {
    const platform = process.platform;
    if (process.env.CHROME_PATH) {
      return process.env.CHROME_PATH;
    }
    let paths = [];
    if (platform === "darwin") {
      paths = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    } else if (platform === "win32") {
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        paths.push(`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`);
      }
      paths.push(`${programFiles}\\Google\\Chrome\\Application\\chrome.exe`);
      paths.push(`${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`);
    } else if (platform === "linux") {
      const result = await execFileNoThrow("which", ["google-chrome"]);
      if (result.code === 0 && result.stdout) {
        return result.stdout.trim();
      }
      paths = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
      ];
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    for (const path12 of paths) {
      try {
        await access2(path12, constants.F_OK);
        return path12;
      } catch {
      }
    }
    throw new Error("Google Chrome not found on this system. Please set CHROME_PATH environment variable.");
  }
  async ensureRunning() {
    if (!this.isBrowserRunning) {
      const chromePath = await BrowserService.getChromePath();
      // B0: durable profile vault via XCLAW_BROWSER_PROFILE_DIR, else ephemeral mkdtemp
      const profileEnv = process.env.XCLAW_BROWSER_PROFILE_DIR;
      if (profileEnv && profileEnv !== "tmp" && profileEnv !== "ephemeral") {
        const pathMod = path3;
        const fsP = await import("fs/promises");
        this.chromeUserDataDir = pathMod.resolve(profileEnv);
        await fsP.mkdir(pathMod.join(this.chromeUserDataDir, "Default"), { recursive: true });
        // H0: exclusive profile lock (prevent dual Chrome on same user-data-dir)
        try {
          const lockPath = pathMod.join(this.chromeUserDataDir, ".xclaw-profile.lock");
          const fh = await fsP.open(lockPath, "wx").catch(async (e) => {
            if (e && e.code === "EEXIST") {
              // stale lock? if pid dead, reclaim
              try {
                const prev = (await fsP.readFile(lockPath, "utf8")).trim();
                const pid = Number(prev);
                if (pid && !isNaN(pid)) {
                  try { process.kill(pid, 0); throw e; } catch (k) {
                    if (k === e) throw e;
                    // ESRCH — reclaim
                    await fsP.unlink(lockPath).catch(() => {});
                    return await fsP.open(lockPath, "wx");
                  }
                }
              } catch (inner) {
                if (inner === e) throw new Error(`H0 profile locked: ${lockPath} (another Chrome may be using this profile)`);
                throw inner;
              }
              throw new Error(`H0 profile locked: ${lockPath}`);
            }
            throw e;
          });
          await fh.writeFile(String(process.pid));
          await fh.close();
          this._profileLockPath = lockPath;
        } catch (le) {
          if (/profile locked/i.test(String(le?.message || le))) throw le;
          log_default.warn(`H0 profile lock: ${le?.message || le}`);
        }
        log_default.info(`H0 durable profile: ${this.chromeUserDataDir}`);
      } else {
        this.chromeUserDataDir = await mkdtemp(path3.join(os2.tmpdir(), "xclaw-chrome-"));
        const defaultProfileDir = await getDefaultChromeProfileDir();
        if (defaultProfileDir) {
          await copySessionData(defaultProfileDir, this.chromeUserDataDir);
        }
      }
      // B0: headed mode override — XCLAW_BROWSER_HEADED=1|true forces visible window
      const forceHeaded = process.env.XCLAW_BROWSER_HEADED === "1" || process.env.XCLAW_BROWSER_HEADED === "true";
      const useHeadless = forceHeaded ? false : this.headless;
      // H0 production chrome flags (container-safe, CDP-safe, human-headed)
      let args = [
        "--remote-debugging-port=0",
        "--remote-allow-origins=*",
        "--disable-dev-shm-usage",
        "--disable-crash-reporter",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${this.chromeUserDataDir}`
      ];
      if (useHeadless) {
        args.unshift("--headless=new");
      } else {
        const win = process.env.XCLAW_BROWSER_WINDOW_SIZE || "1280,720";
        const scale = process.env.XCLAW_BROWSER_SCALE || "1";
        args.push(`--window-size=${win}`);
        args.push(`--window-position=0,0`);
        args.push(`--force-device-scale-factor=${scale}`);
        log_default.info(`H0 headed Chromium window=${win} scale=${scale}`);
      }
      if (process.env.XCLAW_BROWSER_UA) {
        args.push(`--user-agent=${process.env.XCLAW_BROWSER_UA}`);
      }
      if (process.env.XCLAW_BROWSER_NO_SANDBOX === "1" || process.env.XCLAW_BROWSER_NO_SANDBOX === "true" || process.env.CI === "true") {
        args.push("--no-sandbox");
        args.push("--test-type");
      }
      // M2: MITM proxy + CA trust (opt-in via XCLAW_MITM)
      const mitmOn = process.env.XCLAW_MITM === "1" || process.env.XCLAW_MITM === "true" || process.env.XCLAW_MITM === "on" || process.env.XCLAW_MITM === "yes" || Boolean(process.env.XCLAW_CHROME_MITM_ARGS);
      if (mitmOn) {
        const mitmPort = Number(process.env.XCLAW_MITM_PORT) || 4444;
        args.push(`--proxy-server=http://127.0.0.1:${mitmPort}`);
        args.push("--proxy-bypass-list=<-loopback>");
        log_default.info(`M2 MITM proxy http://127.0.0.1:${mitmPort}`);
        // Prefer scoped SPKI trust when CA is available
        try {
          const { execFileSync } = await import("child_process");
          const { access: accessMitm, constants: cMitm } = await import("fs/promises");
          const home = os2.homedir();
          const confdir = process.env.XCLAW_MITM_CONFDIR || path3.join(home, ".xclaw", "mitm");
          const caCandidates = [
            path3.join(confdir, "mitmproxy-ca-cert.pem"),
            path3.join(confdir, "mitmproxy-ca.pem"),
            path3.join(home, ".mitmproxy", "mitmproxy-ca-cert.pem"),
            path3.join(home, ".mitmproxy", "mitmproxy-ca.pem")
          ];
          let caPath = null;
          for (const c of caCandidates) {
            try {
              await accessMitm(c, cMitm.F_OK);
              caPath = c;
              break;
            } catch {
            }
          }
          if (caPath) {
            const safe = String(caPath).replace(/'/g, "'\\''");
            const cmd = "openssl x509 -in '" + safe + "' -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256 -binary 2>/dev/null | openssl enc -base64 2>/dev/null";
            try {
              const spki = execFileSync("bash", ["-c", cmd], { encoding: "utf8", timeout: 5000 }).trim();
              if (spki) {
                args.push(`--ignore-certificate-errors-spki-list=${spki}`);
                log_default.info(`M2 MITM CA SPKI trust (${caPath})`);
              }
            } catch (e) {
              log_default.warn(`M2 SPKI hash failed: ${e?.message || e}`);
            }
            // Optional certutil import into profile NSS DB
            try {
              execFileSync("which", ["certutil"], { encoding: "utf8", timeout: 2000 });
              try {
                execFileSync("certutil", ["-d", `sql:${this.chromeUserDataDir}`, "-A", "-t", "C,,", "-n", "xclaw-mitmproxy-ca", "-i", caPath], { timeout: 8000 });
                log_default.info("M2 MITM CA imported via certutil");
              } catch (ce) {
                const msg = String(ce?.stderr || ce?.message || "");
                if (!/already exists|SEC_ERROR/i.test(msg)) {
                  log_default.warn(`M2 certutil: ${msg.slice(0, 120)}`);
                }
              }
            } catch {
              /* certutil not installed */
            }
          } else {
            log_default.warn("M2 MITM CA not found — start mitmdump once to generate, or set XCLAW_MITM_INSECURE_CERTS=1 for lab");
          }
        } catch (e) {
          log_default.warn(`M2 MITM CA setup: ${e?.message || e}`);
        }
        if (process.env.XCLAW_MITM_INSECURE_CERTS === "1" || process.env.XCLAW_MITM_INSECURE_CERTS === "true") {
          args.push("--ignore-certificate-errors");
          log_default.info("M2 MITM lab insecure-certs flag");
        }
        // Shared flags from mitmEnvFromConfig (avoid drift)
        if (process.env.XCLAW_CHROME_MITM_ARGS) {
          for (const a of process.env.XCLAW_CHROME_MITM_ARGS.split(/\s+/).filter(Boolean)) {
            if (!args.includes(a)) args.push(a);
          }
        }
      }
      if (process.env.CHROMIUM_FLAGS) {
        args = [...args, ...process.env.CHROMIUM_FLAGS.split(" ")];
      }
      if (await env2.getIsDocker()) {
        if (!args.includes("--no-sandbox")) args.push("--no-sandbox");
        if (!args.includes("--disable-gpu")) args.push("--disable-gpu");
        if (!args.includes("--test-type")) args.push("--test-type");
      }
      // A5: canonical argv from chrome-args.mjs
      try {
        args = buildChromeArgsCanonical({
          userDataDir: this.chromeUserDataDir,
          headless: useHeadless,
          cdpPort: 0,
          mitm: process.env.XCLAW_MITM === "1" || process.env.XCLAW_MITM === "true",
        });
      } catch (_e) {
        /* keep locally built args */
      }
      const browserProc = spawn(chromePath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: !IS_WINDOWS,
        windowsHide: IS_WINDOWS
      });
      browserProc.on("error", (err2) => {
        this.isBrowserRunning = false;
        log_default.error(err2);
      });
      browserProc.on("exit", () => {
        this.isBrowserRunning = false;
        this.browserProcess = null;
        this.browserClient = null;
        this.openTabs.clear();
        this.nextShortId = 1;
        this.chromePort = null;
        // H0: release durable profile lock
        if (this._profileLockPath) {
          import("fs/promises").then((fsP) => fsP.unlink(this._profileLockPath).catch(() => {})).catch(() => {});
          this._profileLockPath = null;
        }
      });
      const portPromise = new Promise((resolve6, reject2) => {
        let settled = false;
        const timeoutMs = Number(process.env.XCLAW_BROWSER_PORT_TIMEOUT_MS) || 30_000;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { browserProc.kill("SIGKILL"); } catch {}
          reject2(new Error(`H0 Chrome CDP port not ready within ${timeoutMs}ms`));
        }, timeoutMs);
        const onData = (data) => {
          const line = data.toString();
          const match2 = line.match(/DevTools listening on ws:\/\/.*:(\d+)\/devtools\/browser\/.*/);
          if (match2) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            browserProc.stderr.off("data", onData);
            resolve6(parseInt(match2[1], 10));
          }
        };
        browserProc.stderr.on("data", onData);
        browserProc.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject2(err);
        });
        browserProc.on("exit", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject2(new Error("Browser exited before getting port"));
        });
      });
      this.chromePort = await portPromise;
      log_default.info(`Using chrome port: ${this.chromePort}`);
      this.browserProcess = browserProc;
      this.browserClient = await this.connectBrowserClient();
      // M2: runtime CDP cert ignore when MITM is on (belt-and-suspenders with SPKI)
      {
        const mitmOn2 = process.env.XCLAW_MITM === "1" || process.env.XCLAW_MITM === "true" || process.env.XCLAW_MITM === "on" || process.env.XCLAW_MITM === "yes";
        if (mitmOn2 && this.browserClient) {
          try {
            await this.browserClient.Security.enable();
            await this.browserClient.Security.setIgnoreCertificateErrors({ ignore: true });
            log_default.info("M2 CDP Security.setIgnoreCertificateErrors(true)");
          } catch (se) {
            log_default.warn(`M2 CDP Security: ${se?.message || se}`);
          }
        }
      }
      this.isBrowserRunning = true;
    }
    if (!this.browserClient) {
      this.browserClient = await this.connectBrowserClient();
    }
    return this.browserClient;
  }
  /**
   * Open a CDP connection at the browser level with a bounded retry
   * loop. Used by both the initial bring-up branch and the cache-miss
   * reconnect branch in `ensureRunning()`.
   *
   * Retries on every error class — Chrome's debug port is up before
   * any default tab exists, so the first attempts can throw `No
   * inspectable targets` from `defaultTargetFactory`. They succeed
   * once a tab materialises (usually < 1s).
   */
  async connectBrowserClient() {
    const maxWaitMs = 5e3;
    const pollIntervalMs = 500;
    const startTime = Date.now();
    let lastErr;
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const client = await (0, import_chrome_remote_interface.default)({
          host: "127.0.0.1",
          port: this.chromePort
        });
        client.on("disconnect", () => {
          this.browserClient = null;
        });
        return client;
      } catch (err2) {
        lastErr = err2;
        await new Promise((resolve6) => setTimeout(resolve6, pollIntervalMs));
      }
    }
    if (lastErr instanceof Error)
      throw lastErr;
    throw new Error(`Browser failed to start within ${maxWaitMs / 1e3}s`);
  }
  /** Allocate a short, session-local tab id ("t1", "t2", ...). */
  allocateTabId() {
    return `t${this.nextShortId++}`;
  }
  /**
   * Resolve a model-supplied tab id to its `openTabs` key. Accepts the
   * short id we returned ("t1") OR the raw Chrome GUID for backwards
   * compatibility with in-flight conversations from before the
   * short-id change.
   */
  resolveTabId(input) {
    if (this.openTabs.has(input))
      return input;
    for (const [shortId, rec] of this.openTabs.entries()) {
      if (rec.chromeTargetId === input)
        return shortId;
    }
    return void 0;
  }
  async withTab(tabId, callback, closeAfter = true) {
    const client = await this.ensureRunning();
    let shortId;
    let chromeTargetId;
    let created = false;
    if (!tabId) {
      const { targetId } = await client.Target.createTarget({
        url: "about:blank"
      });
      chromeTargetId = targetId;
      shortId = this.allocateTabId();
      this.openTabs.set(shortId, {
        url: "about:blank",
        createdAt: /* @__PURE__ */ new Date(),
        chromeTargetId
      });
      created = true;
      closeAfter = true;
    } else {
      const resolved = this.resolveTabId(tabId);
      if (!resolved)
        throw new Error(`Tab ${tabId} not found`);
      shortId = resolved;
      chromeTargetId = this.openTabs.get(shortId).chromeTargetId;
    }
    const tabClient = await (0, import_chrome_remote_interface.default)({
      host: "127.0.0.1",
      port: this.chromePort,
      target: chromeTargetId
    });
    try {
      return await callback(tabClient, shortId);
    } finally {
      await tabClient.close();
      if (closeAfter) {
        await client.Target.closeTarget({ targetId: chromeTargetId });
        if (!created)
          this.openTabs.delete(shortId);
      }
    }
  }
  async stop() {
    if (this.isBrowserRunning) {
      if (this.browserClient) {
        for (const rec of this.openTabs.values()) {
          try {
            await this.browserClient.Target.closeTarget({
              targetId: rec.chromeTargetId
            });
          } catch {
          }
        }
        this.openTabs.clear();
        this.nextShortId = 1;
        this.networkDataPerTab.clear();
        await this.browserClient.close();
        this.browserClient = null;
      }
      if (this.browserProcess) {
        if (typeof this.browserProcess.pid === "number") {
          killProcessTree(this.browserProcess.pid);
        } else {
          this.browserProcess.kill("SIGKILL");
        }
        this.browserProcess = null;
        if (this._profileLockPath) {
          try {
            const fsP = await import("fs/promises");
            await fsP.unlink(this._profileLockPath);
          } catch {}
          this._profileLockPath = null;
        }
        if (this.chromeUserDataDir) {
          // H0: never wipe durable profile vault
          const durable = process.env.XCLAW_BROWSER_PROFILE_DIR &&
            this.chromeUserDataDir === path3.resolve(process.env.XCLAW_BROWSER_PROFILE_DIR);
          if (!durable) {
            try {
              await rm2(this.chromeUserDataDir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100
              });
            } catch (error) {
              log_default.error(`Failed to remove Chrome user data directory: ${error}`);
            }
          } else {
            log_default.info(`B0 preserving durable profile: ${this.chromeUserDataDir}`);
          }
          this.chromeUserDataDir = null;
        }
      }
      this.chromePort = null;
      this.isBrowserRunning = false;
    }
  }
  stopSync() {
    if (this.browserProcess) {
      if (typeof this.browserProcess.pid === "number") {
        killProcessTree(this.browserProcess.pid);
      } else {
        this.browserProcess.kill("SIGKILL");
      }
      if (this._profileLockPath) {
        try { rmSync(this._profileLockPath, { force: true }); } catch {}
        this._profileLockPath = null;
      }
      if (this.chromeUserDataDir) {
        const durable = process.env.XCLAW_BROWSER_PROFILE_DIR &&
          this.chromeUserDataDir === path3.resolve(process.env.XCLAW_BROWSER_PROFILE_DIR);
        if (!durable) {
          try {
            rmSync(this.chromeUserDataDir, {
              recursive: true,
              force: true,
              maxRetries: 10,
              retryDelay: 100
            });
          } catch {
          }
        }
        this.chromeUserDataDir = null;
      }
    }
    this.openTabs.clear();
    this.nextShortId = 1;
    this.networkDataPerTab.clear();
    this.isBrowserRunning = false;
    this.browserClient = null;
    this.browserProcess = null;
    this.chromePort = null;
  }
  /**
   * Kill Chrome processes + remove user-data-dirs from a dead predecessor.
   * Safe at server startup: we haven't spawned anything yet so every
   * xclaw-chrome- fingerprint is an orphan.
   */
  static async cleanupOrphanedChromesOnStartup() {
    const killedPids = [];
    const removedDirs = [];
    let pids = [];
    try {
      if (IS_WINDOWS) {
        const filter2 = `Name='chrome.exe' AND CommandLine LIKE '%${CHROME_TMPDIR_PREFIX}%'`;
        const cmd = `Get-CimInstance Win32_Process -Filter "${filter2}" | Select-Object -ExpandProperty ProcessId`;
        const res = await execFileNoThrow("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], void 0, void 0, 1e4);
        pids = res.stdout.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
      } else {
        const res = await execFileNoThrow("pgrep", ["-f", CHROME_TMPDIR_PREFIX], void 0, void 0, 5e3);
        pids = res.stdout.split("\n").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
      }
    } catch {
    }
    for (const pid of pids) {
      try {
        killProcessTree(pid);
        killedPids.push(pid);
      } catch {
      }
    }
    if (killedPids.length > 0) {
      log_default.info(`cleanupOrphanedChromesOnStartup: killed ${killedPids.length} orphan Chrome pids`);
    }
    try {
      const tmp = os2.tmpdir();
      const entries = await readdir2(tmp);
      for (const entry of entries) {
        if (!entry.startsWith(CHROME_TMPDIR_PREFIX))
          continue;
        const fullPath = path3.join(tmp, entry);
        try {
          await rm2(fullPath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100
          });
          removedDirs.push(fullPath);
        } catch {
        }
      }
    } catch {
    }
    if (removedDirs.length > 0) {
      log_default.info(`cleanupOrphanedChromesOnStartup: removed ${removedDirs.length} leftover Chrome dirs`);
    }
    return { killedPids, removedDirs };
  }
  /**
   * Sync variant for emergency-exit handlers. Reaps dirs but doesn't kill
   * processes (no sync pgrep + we'd block the event loop on a 200 MB rm).
   */
  static cleanupOrphanedChromesOnStartupSync() {
    if (IS_WINDOWS)
      return 0;
    let killed = 0;
    try {
      const tmp = os2.tmpdir();
      const entries = readdirSync(tmp);
      for (const entry of entries) {
        if (!entry.startsWith(CHROME_TMPDIR_PREFIX))
          continue;
        try {
          rmSync(path3.join(tmp, entry), {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50
          });
          killed++;
        } catch {
        }
      }
    } catch {
    }
    return killed;
  }
}

export default BrowserService;
