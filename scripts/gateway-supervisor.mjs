#!/usr/bin/env node
/**
 * XClaw gateway supervisor — keeps gateway + Telegram alive.
 *
 * - Ensures ~/.xclaw/xclaw.json has telegram token + API key (from env)
 * - Health-checks GET /gateway/info
 * - Restarts gateway when dead or telegram not polling
 * - Clears stale telegram writer lock when restarting
 *
 * Usage:
 *   node scripts/gateway-supervisor.mjs
 *   XCLAW_API_KEY=... TELEGRAM_BOT_TOKEN=... node scripts/gateway-supervisor.mjs
 *
 * Env:
 *   XCLAW_SUPERVISOR_INTERVAL_MS  (default 15000)
 *   XCLAW_SUPERVISOR_PORT         (default 18790)
 *   XCLAW_API_KEY / XAI_API_KEY
 *   TELEGRAM_BOT_TOKEN / XCLAW_TELEGRAM_TOKEN
 *   XCLAW_TELEGRAM_OWNER_CHAT_ID
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { startDaemon, stopDaemon, isPidAlive, readPid } from "../src/cli/daemon.mjs";
import { fileURLToPath } from "node:url";
import {
  isMitmEnabled,
  startMitm,
  stopMitm,
  isMitmRunning,
  mitmPort,
  waitForMitmReady,
  mitmEnvFromConfig,
  ensureMitmCa,
  mitmStatus,
  mitmConfdir,
} from "../src/browser/mitm.mjs";
import { rotateFileIfLarge, horizon0Checklist } from "../src/browser/horizon0.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOME = process.env.HOME || os.homedir();
const CONFIG = path.join(HOME, ".xclaw", "xclaw.json");
const LOCK = path.join(HOME, ".xclaw", "locks", "telegram-writer.lock");
const PID_FILE = process.env.XCLAW_PID_PATH || path.join(HOME, ".xclaw", "gateway.pid");
const SUPER_PID = process.env.XCLAW_SUPERVISOR_PID || path.join(HOME, ".xclaw", "supervisor.pid");
const LOG = process.env.XCLAW_LOG_PATH || path.join(HOME, ".xclaw", "gateway.log");
const PORT = Number(process.env.XCLAW_SUPERVISOR_PORT || process.env.XCLAW_GATEWAY_PORT || 18790);
const INTERVAL = Math.max(5000, Number(process.env.XCLAW_SUPERVISOR_INTERVAL_MS) || 15_000);
const INFO_URL = `http://127.0.0.1:${PORT}/gateway/info`;

const API_KEY =
  process.env.XCLAW_API_KEY ||
  process.env.XAI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";
const TG_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.XCLAW_TELEGRAM_TOKEN ||
  "";
const OWNER =
  process.env.XCLAW_TELEGRAM_OWNER_CHAT_ID ||
  process.env.TELEGRAM_OWNER_CHAT_ID ||
  "";

function log(...args) {
  const line = `[supervisor ${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(path.join(HOME, ".xclaw", "supervisor.log"), line + "\n");
  } catch {
    /* */
  }
}

function ensureConfig() {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.mkdirSync(path.join(HOME, ".xclaw", "locks"), { recursive: true });
  fs.mkdirSync(path.join(HOME, ".xclaw", "logs"), { recursive: true });

  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    cfg = { version: 1, profile: "lab" };
  }

  cfg.version = cfg.version || 1;
  cfg.profile = cfg.profile || "lab";
  cfg.agent = cfg.agent || {};
  if (API_KEY) cfg.agent.apiKey = API_KEY;
  cfg.agent.provider = cfg.agent.provider || "xai";
  cfg.agent.model = cfg.agent.model || "grok-4.3";
  cfg.agent.maxTurns = cfg.agent.maxTurns || 15;

  cfg.gateway = cfg.gateway || {};
  cfg.gateway.host = cfg.gateway.host || "127.0.0.1";
  cfg.gateway.port = cfg.gateway.port || PORT;
  cfg.gateway.authStrict = false;
  cfg.gateway.publicUi = true;

  cfg.computer = cfg.computer || {};
  cfg.computer.host = cfg.computer.host || "127.0.0.1";
  cfg.computer.port = cfg.computer.port || 4243;
  cfg.computer.autoStart = true;

  cfg.security = cfg.security || {};
  if (cfg.security.autoApprove == null) cfg.security.autoApprove = true;

  cfg.channels = cfg.channels || {};
  cfg.channels.webchat = cfg.channels.webchat || { enabled: true };
  cfg.channels.telegram = cfg.channels.telegram || {};
  if (TG_TOKEN) {
    cfg.channels.telegram.enabled = true;
    cfg.channels.telegram.token = TG_TOKEN;
    cfg.channels.telegram.transport = "poll";
    cfg.channels.telegram.dmPolicy = cfg.channels.telegram.dmPolicy || "open";
    cfg.channels.telegram.stream = cfg.channels.telegram.stream || {
      enabled: true,
      partialText: true,
      showTools: true,
      minEditIntervalMs: 1200,
    };
  }
  if (OWNER) cfg.channels.telegram.ownerChatId = Number(OWNER) || OWNER;

  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
  return cfg;
}



async function health() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(INFO_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const j = await res.json();
    const tg = (j.channels?.messaging || []).find((x) => x.name === "telegram");
    const needTg = Boolean(TG_TOKEN);
    const tgOk =
      !needTg ||
      (tg?.enabled && tg?.running && tg?.loopAlive !== false);
    return {
      ok: true,
      gateway: true,
      api: Boolean(j.agent?.hasApiKey),
      computer: Boolean(j.computer?.healthy),
      telegram: tgOk,
      tgDetail: tg
        ? {
            user: tg.username,
            running: tg.running,
            alive: tg.loopAlive,
            err: tg.lastError,
          }
        : null,
    };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

function clearTelegramLock() {
  try {
    if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
  } catch {
    /* */
  }
}

function stopGateway() {
  try {
    stopDaemon(PID_FILE, { signal: "SIGTERM", timeoutMs: 5000 });
  } catch {
    /* */
  }
  clearTelegramLock();
}

function loadMitmCfg() {
  const configDir = path.dirname(CONFIG);
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    if (!raw.paths) raw.paths = {};
    if (!raw.paths.configDir) raw.paths.configDir = configDir;
    return raw;
  } catch {
    return { paths: { configDir } };
  }
}

async function ensureMitm() {
  const cfg = loadMitmCfg();
  if (!isMitmEnabled(cfg)) {
    if (isMitmRunning(cfg)) {
      log("XCLAW_MITM off — stopping leftover mitmdump");
      await stopMitm(cfg, { log });
    }
    return { ok: false, reason: "disabled" };
  }
  // Ensure CA exists before/while proxy is up (SPKI for Chrome)
  const ca = await ensureMitmCa(cfg, { log });
  if (!ca.ok) {
    log(`mitm CA: ${ca.reason || ca.code}`);
  } else {
    log(`mitm CA ok created=${Boolean(ca.created)} path=${ca.certPath}`);
  }
  const r = await startMitm(cfg, { log });
  if (!r.ok) {
    log(`mitm not started: ${r.reason || r.code}`);
    return r;
  }
  if (r.already) {
    log(`mitm already up pid=${r.pid} port=${r.port} listening=${r.listening}`);
  } else {
    log(`mitm started pid=${r.pid} port=${r.port} listening=${r.listening}`);
  }
  // Startup order: wait for listen + CA/ready before gateway/browser need proxy
  const w = await waitForMitmReady(cfg, { timeoutMs: 12_000, needCa: true });
  if (w.ok) {
    log(`mitm ready listening=${w.listening} ca=${Boolean(w.caPath)} readyFile=${w.ready} waited=${w.waitedMs}ms`);
  } else {
    log(`mitm wait incomplete: ${w.reason} listening=${w.listening} ca=${Boolean(w.caPath)} — browser may need XCLAW_MITM_INSECURE_CERTS=1 once`);
  }
  return { ...r, wait: w };
}

function startGateway() {
  ensureConfig();
  clearTelegramLock();
  const mitmCfg = loadMitmCfg();
  const env = {
    XCLAW_API_KEY: API_KEY || process.env.XCLAW_API_KEY || "",
    XAI_API_KEY: API_KEY || process.env.XAI_API_KEY || "",
    TELEGRAM_BOT_TOKEN: TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
    XCLAW_TELEGRAM_TOKEN: TG_TOKEN || process.env.XCLAW_TELEGRAM_TOKEN || "",
    XCLAW_TELEGRAM_OWNER_CHAT_ID: OWNER || process.env.XCLAW_TELEGRAM_OWNER_CHAT_ID || "",
    ...mitmEnvFromConfig(mitmCfg),
  };
  const r = startDaemon({
    cmd: process.execPath,
    args: [path.join(ROOT, "bin/xclaw.mjs"), "gateway"],
    pidPath: PID_FILE,
    logPath: LOG,
    cwd: ROOT,
    env,
    setsid: true,
  });
  if (!r.ok && r.error === "already_running") {
    log(`gateway already running pid=${r.pid}`);
    return r.pid;
  }
  log(`started gateway pid=${r.pid} setsid=${r.setsid}`);
  return r.pid;
}

async function tick() {
  // H0: keep MITM alive; recover if process died; rotate fat flow logs
  try {
    const cfg = loadMitmCfg();
    if (isMitmEnabled(cfg)) {
      const st = await mitmStatus(cfg);
      if (st.enabled && !st.listening) {
        log("mitm was enabled but not listening — recovery restart");
        await stopMitm(cfg, { log }).catch(() => {});
      }
      await ensureMitm();
      // disk hygiene every tick when large
      try {
        const confdir = mitmConfdir(cfg);
        if (confdir) {
          await rotateFileIfLarge(path.join(confdir, "flows.jsonl"), {
            maxBytes: Number(process.env.XCLAW_MITM_FLOWS_MAX_BYTES) || 50 * 1024 * 1024,
            keep: 3,
          });
        }
      } catch {
        /* */
      }
    }
  } catch (e) {
    log("mitm tick error", e?.message || e);
  }
  const h = await health();
  if (h.ok && h.gateway && h.telegram) {
    log(`healthy api=${h.api} computer=${h.computer} tg=${JSON.stringify(h.tgDetail)}`);
    return;
  }
  log(`unhealthy ${JSON.stringify(h)} — restarting`);
  stopGateway();
  // wait briefly for port release
  await new Promise((r) => setTimeout(r, 2000));
  startGateway();
  // wait for boot
  await new Promise((r) => setTimeout(r, 12000));
  const h2 = await health();
  log(`after restart ${JSON.stringify(h2)}`);
}

async function main() {
  fs.mkdirSync(path.join(HOME, ".xclaw"), { recursive: true });
  fs.writeFileSync(SUPER_PID, String(process.pid));
  ensureConfig();
  log(`supervisor start interval=${INTERVAL}ms port=${PORT} root=${ROOT}`);
  log(`apiKey=${Boolean(API_KEY)} telegram=${Boolean(TG_TOKEN)} owner=${OWNER || "—"}`);
  log(`mitmEnabled=${isMitmEnabled(loadMitmCfg())} mitmPort=${mitmPort(loadMitmCfg())}`);
  try {
    for (const ch of horizon0Checklist()) {
      log(`h0.${ch.id} ${ch.warn ? "WARN" : "ok"} ${ch.detail}`);
    }
  } catch {
    /* */
  }

  // M1: opt-in MITM sidecar
  await ensureMitm();

  // initial ensure
  const h0 = await health();
  if (!h0.ok || !h0.telegram) {
    log("initial start");
    stopGateway();
    await new Promise((r) => setTimeout(r, 1500));
    startGateway();
    await new Promise((r) => setTimeout(r, 14000));
  }

  for (;;) {
    try {
      await tick();
    } catch (err) {
      log("tick error", err?.message || err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
