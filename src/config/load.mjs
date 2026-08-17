import fs from "fs/promises";
import path from "path";
import os from "os";
import { DEFAULT_CONFIG, CONFIG_DIR_NAME, CONFIG_FILE_NAME } from "./defaults.mjs";
import { applyProfile } from "./profiles.mjs";
import { applyAutonomyLevel } from "./autonomy-policy.mjs";

export function getConfigDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

async function ensureDirsAndFile() {
  const dir = getConfigDir();
  const file = getConfigPath();
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "skills"), { recursive: true });
  await fs.mkdir(path.join(dir, "workspaces"), { recursive: true });
  await fs.mkdir(path.join(dir, "logs"), { recursive: true });

  try {
    await fs.access(file);
  } catch {
    const cfg = structuredClone(DEFAULT_CONFIG);
    await fs.writeFile(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    console.log(`[xclaw] Created config at ${file}`);
    if (process.env.XCLAW_QUIET !== "1") {
      console.log(
        `[xclaw] First-run: profile=lab (auto-approve). Prod: XCLAW_PROFILE=prod + XCLAW_GATEWAY_TOKEN. See README.md`
      );
    }
  }
}

function deepMerge(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}


/**
 * Prod must never inherit lab autoApprove from a shared ~/.xclaw/xclaw.json.
 * Opt-out: XCLAW_ALLOW_PROD_AUTO=1 (explicit break-glass).
 */
export function enforceProdHardening(cfg = {}) {
  const profile = String(cfg.profile || process.env.XCLAW_PROFILE || "").toLowerCase();
  if (profile !== "prod") return cfg;
  const allow =
    process.env.XCLAW_ALLOW_PROD_AUTO === "1" ||
    process.env.XCLAW_ALLOW_PROD_AUTO === "true";
  const out = {
    ...cfg,
    security: { ...(cfg.security || {}) },
    autonomy: { ...(cfg.autonomy || {}) },
    swarm: { ...(cfg.swarm || {}) },
  };
  out._prodHardening = out._prodHardening || [];
  if (!allow && out.security.autoApprove === true) {
    out.security.autoApprove = false;
    out._prodHardening.push("forced security.autoApprove=false");
  }
  if (!allow && out.security.approvalPolicy === "never") {
    out.security.approvalPolicy = "risky";
    out._prodHardening.push("forced approvalPolicy=risky");
  }
  // Prod default autonomy: supervised. Env XCLAW_AUTONOMY_LEVEL can raise/lower explicitly.
  if (!process.env.XCLAW_AUTONOMY_LEVEL) {
    if (!out.autonomy.level || out.autonomy.level === "lab" || out.autonomy.level === "full") {
      out.autonomy.level = "supervised";
      out._prodHardening.push("forced autonomy.level=supervised");
    }
  } else {
    out.autonomy.level = String(process.env.XCLAW_AUTONOMY_LEVEL).toLowerCase();
    out._prodHardening.push(`env autonomy.level=${out.autonomy.level}`);
  }
  if (out.autonomy.heartbeat?.enabled && !process.env.XCLAW_AUTONOMY_HEARTBEAT) {
    // keep heartbeat if user enabled, but ensure level is not full-auto tools
  }
  if (out.swarm?.autoMerge === true) {
    out.swarm.autoMerge = false;
    out._prodHardening.push("forced swarm.autoMerge=false");
  }
  if (out.gateway && out.gateway.requireAuth !== true && process.env.XCLAW_GATEWAY_TOKEN) {
    out.gateway = { ...out.gateway, requireAuth: true };
  }
  // Prefer OS sandbox on prod (auto uses bwrap when present and usable)
  if (!out.security.osSandbox || out.security.osSandbox === "off") {
    out.security.osSandbox = "auto";
    out._prodHardening.push("forced security.osSandbox=auto");
  }
  return out;
}


export async function loadConfig(opts = {}) {
  await ensureDirsAndFile();
  const raw = await fs.readFile(getConfigPath(), "utf8");
  const user = JSON.parse(raw);
  // Merge order (later wins): DEFAULT → profile pack → user file → env
  // Profile NAME selection: env XCLAW_PROFILE wins over user.profile (ops override).
  // User-explicit security.* still wins over profile pack after merge (Telegram hang fix).
  const defaultProfile = DEFAULT_CONFIG.profile || "lab";
  const envProfile = process.env.XCLAW_PROFILE || null;
  const profileName =
    envProfile || user.profile || defaultProfile || "lab";
  let cfg = deepMerge(structuredClone(DEFAULT_CONFIG), { profile: profileName });
  cfg = applyProfile(cfg); // profile pack for profileName
  cfg = deepMerge(cfg, user); // user file wins on keys present
  // If env selected a different profile than user.profile, re-apply env pack
  // then re-merge user so explicit user keys still win — but profile name stays env.
  if (envProfile && envProfile !== (user.profile || defaultProfile)) {
    cfg.profile = envProfile;
    cfg = applyProfile(cfg);
    cfg = deepMerge(cfg, user);
    cfg.profile = envProfile; // keep env name after user merge
  }
  cfg.paths = {
    configDir: getConfigDir(),
    configFile: getConfigPath(),
    skills: path.join(getConfigDir(), "skills"),
    workspaces: path.join(getConfigDir(), "workspaces"),
    logs: path.join(getConfigDir(), "logs"),
  };
  // Autonomy level fills missing security/agent/heartbeat knobs
  cfg = applyAutonomyLevel(cfg);
  cfg = enforceProdHardening(cfg);
  // Env overrides (do not write back to disk)
  const envKey = process.env.XCLAW_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;
  if (envKey && !cfg.agent.apiKey) cfg.agent.apiKey = envKey;
  if (process.env.XCLAW_MODEL) cfg.agent.model = process.env.XCLAW_MODEL;
  // Stream resume knobs
  if (!cfg.stream) cfg.stream = {};
  if (process.env.XCLAW_STREAM_CAPACITY) {
    const n = Number(process.env.XCLAW_STREAM_CAPACITY);
    if (Number.isFinite(n) && n > 0) cfg.stream.capacity = Math.floor(n);
  }
  if (process.env.XCLAW_STREAM_TTL_MS) {
    const n = Number(process.env.XCLAW_STREAM_TTL_MS);
    if (Number.isFinite(n) && n >= 0) cfg.stream.ttlMs = Math.floor(n);
  }
  if (process.env.XCLAW_STREAM_HEARTBEAT_MS) {
    const n = Number(process.env.XCLAW_STREAM_HEARTBEAT_MS);
    if (Number.isFinite(n) && n >= 0) cfg.stream.heartbeatMs = Math.floor(n);
  }
  if (process.env.XCLAW_STREAM_BACKOFF) {
    cfg.stream.backoff = String(process.env.XCLAW_STREAM_BACKOFF);
  }
  if (process.env.XCLAW_STREAM_BASE_MS) {
    const n = Number(process.env.XCLAW_STREAM_BASE_MS);
    if (Number.isFinite(n) && n > 0) cfg.stream.baseMs = Math.floor(n);
  }
  if (process.env.XCLAW_STREAM_MAX_MS) {
    const n = Number(process.env.XCLAW_STREAM_MAX_MS);
    if (Number.isFinite(n) && n > 0) cfg.stream.maxMs = Math.floor(n);
  }

  if (process.env.XCLAW_API_BASE) cfg.agent.baseUrl = process.env.XCLAW_API_BASE;
  if (envProfile) cfg.profile = envProfile;

  // Prefer xAI when model is grok-* and only XAI key is present
  if (String(cfg.agent?.model || "").startsWith("grok") && !cfg.agent.baseUrl) {
    cfg.agent.baseUrl = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
  }
  if (String(cfg.agent?.model || "").startsWith("grok") && process.env.XAI_API_KEY && !cfg.agent.apiKey) {
    cfg.agent.apiKey = process.env.XAI_API_KEY;
  }

  // Phase 7.2 — validate (warn by default; throw if opts.strict)
  try {
    const { validateConfig } = await import("./validate.mjs");
    const v = validateConfig(cfg);
    for (const w of v.warnings) console.warn(`[xclaw] config: ${w}`);
    if (!v.ok) {
      for (const e of v.errors) console.error(`[xclaw] config error: ${e}`);
      for (const d of v.details || []) {
        if (d.hint) console.error(`[xclaw] config hint (${d.path || d.code}): ${d.hint}`);
        if (d.got !== undefined) {
          console.error(
            `[xclaw] config got (${d.path || d.code}): ${typeof d.got === "object" ? JSON.stringify(d.got) : d.got}`
          );
        }
      }
      if (opts.strict) {
        const err = new Error(`Invalid config: ${v.errors.join("; ")}`);
        err.code = "CONFIG_INVALID";
        err.details = v.details || [];
        throw err;
      }
    }
  } catch (err) {
    if (opts.strict) throw err;
    if (err?.message?.startsWith("Invalid config")) throw err;
  }

    try {
    const { resolveProviderToken } = await import("../auth/profiles.mjs");
    const provider =
      cfg.agent?.provider ||
      process.env.XCLAW_PROVIDER ||
      (String(cfg.agent?.model || "").startsWith("grok") ? "xai" : "xai");
    const resolved = await resolveProviderToken(cfg, provider);
    if (resolved.token && !cfg.agent?.apiKey) {
      cfg.agent = cfg.agent || {};
      cfg.agent.apiKey = resolved.token;
      cfg.agent.authSource = resolved.source;
      cfg.agent.authMode = resolved.mode || null;
      cfg.agent.authProfileId = resolved.profileId || null;
    }
  } catch {
    /* fallback legacy */
    try {
      const { resolveXaiToken } = await import("../auth/xai.mjs");
      const xai = await resolveXaiToken(cfg);
      if (xai.token && !cfg.agent?.apiKey) {
        cfg.agent = cfg.agent || {};
        cfg.agent.apiKey = xai.token;
        cfg.agent.authSource = xai.source;
      }
    } catch {
      /* */
    }
  }

  try {
    const { parseModelRef, resolveProviderRoute } = await import("../providers/registry.mjs");
    if (cfg.agent?.model) {
      const pr = parseModelRef(cfg.agent.model);
      if (pr.provider && !cfg.agent.provider) cfg.agent.provider = pr.provider;
      if (pr.model) cfg.agent.model = pr.model.includes("/") ? pr.model : pr.model;
    }
    const route = resolveProviderRoute(cfg);
    cfg.agent = cfg.agent || {};
    if (!cfg.agent.provider) cfg.agent.provider = route.provider;
    if (!cfg.agent.baseUrl && !cfg.agent.apiBase) cfg.agent.baseUrl = route.baseUrl;
  } catch {
    /* */
  }

  try {
    const { resolveProviderPack } = await import("./providers.mjs");
    const pack = resolveProviderPack(cfg);
    cfg.agent = cfg.agent || {};
    if (!cfg.agent.baseUrl && !cfg.agent.apiBase) cfg.agent.baseUrl = pack.baseUrl;
    if (!cfg.agent.apiBase) cfg.agent.apiBase = pack.baseUrl;
    if (pack.apiKey && !cfg.agent.apiKey) cfg.agent.apiKey = pack.apiKey;
    cfg.agent.providerPack = pack.id;
  } catch {
    /* */
  }

  if (process.env.XCLAW_COMPUTER_URL) {
    cfg.computer = cfg.computer || {};
    cfg.computer.remoteUrl = process.env.XCLAW_COMPUTER_URL;
  }
  return cfg;
}

/** @deprecated use loadConfig */
export async function ensureConfig() {
  return loadConfig();
}
