import fs from "fs/promises";
import path from "path";
import os from "os";
import { DEFAULT_CONFIG, CONFIG_DIR_NAME, CONFIG_FILE_NAME } from "./defaults.mjs";
import { applyProfile } from "./profiles.mjs";
import { applyAutonomyLevel } from "./autonomy-policy.mjs";
import { coupleTailscaleExposure } from "../net/tailscale.mjs";

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

/**
 * Deep-merge a patch into the ON-DISK user config and write it atomically.
 * Only the raw user file is touched (never the profile/env-merged runtime cfg),
 * so writing back never bakes derived defaults into the file. Shared by the CLI
 * (`xclaw providers …`) and the gateway providers routes so both persist the
 * same way. Returns the merged object written.
 */
export async function saveConfigPatch(patch) {
  const file = getConfigPath();
  let user = {};
  try {
    user = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    user = {};
  }
  const next = deepMerge(user, patch || {});
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
  return next;
}

function deepMerge(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) {
      // explicit null clears the key (e.g. reset a per-provider baseUrl)
      out[k] = null;
    } else if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
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
  // bypassApprovals REMOVES the approval gate entirely (every tier,
  // including critical). Prod hardening forced autoApprove off but let
  // bypass through — the stronger flag escaped the weaker flag's fence
  // (audit 2026-08-23 C16). Same explicit break-glass applies.
  if (!allow && out.security.bypassApprovals === true) {
    out.security.bypassApprovals = false;
    out._prodHardening.push("forced security.bypassApprovals=false");
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

  // Telegram: never leave prod on dmPolicy=open (break-glass: XCLAW_TELEGRAM_DM_POLICY)
  const envDm = process.env.XCLAW_TELEGRAM_DM_POLICY
    ? String(process.env.XCLAW_TELEGRAM_DM_POLICY).toLowerCase()
    : null;
  out.channels = { ...(out.channels || {}) };
  out.channels.telegram = { ...(out.channels.telegram || {}) };
  const tg = out.channels.telegram;
  if (envDm === "open" || envDm === "allowlist" || envDm === "pairing") {
    if (tg.dmPolicy !== envDm) {
      tg.dmPolicy = envDm;
      out._prodHardening.push(`env channels.telegram.dmPolicy=${envDm}`);
    }
  } else if (tg.dmPolicy === "open" || !tg.dmPolicy) {
    // Prefer allowlist when allowFrom is configured; otherwise pairing
    const allow = tg.allowedChatIds || tg.allowFrom || [];
    const next =
      Array.isArray(allow) && allow.length > 0 ? "allowlist" : "pairing";
    if (tg.dmPolicy !== next) {
      tg.dmPolicy = next;
      out._prodHardening.push(`forced channels.telegram.dmPolicy=${next}`);
    }
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
  applyEnvBindOverrides(cfg);
  // Tailscale serve/funnel fronts a loopback gateway — force that invariant
  // (bind=loopback, host=127.0.0.1, funnel⇒authStrict) AFTER env overrides so a
  // stray XCLAW_GATEWAY_HOST can never expose the gateway behind a public funnel.
  cfg = coupleTailscaleExposure(cfg);
  return cfg;
}

/**
 * Env bind overrides — env wins over file config, the same convention as
 * XCLAW_MODEL / XCLAW_SSRF.
 *
 * These four were documented in 3.76.0 ("Env bind overrides … so compose-
 * published ports work", CHANGELOG.md:3284 and INSTALL.md), and they are set by
 * deploy/Dockerfile, deploy/docker-compose.yml and deploy/docker-compose.
 * sidecar.yml — but no code ever read them. Every container therefore bound
 * 127.0.0.1 inside its own network namespace, so a published port reached
 * nothing, while the in-container healthcheck (`curl 127.0.0.1:18790/ready`)
 * hit the loopback listener and reported healthy. Green check, dead port.
 *
 * Honouring the host makes the bind guard load-bearing for containers: 0.0.0.0
 * with no token now refuses to start instead of silently binding loopback. That
 * is the documented contract ("Composes with bind-guard: non-loopback binds
 * still require a token"), and both compose files now demand the token.
 *
 * An unusable value is reported, never silently dropped — silent-drop is the
 * failure being fixed here.
 */
function applyEnvBindOverrides(cfg) {
  const targets = [
    ["gateway", "XCLAW_GATEWAY_HOST", "XCLAW_GATEWAY_PORT"],
    ["computer", "XCLAW_COMPUTER_HOST", "XCLAW_COMPUTER_PORT"],
  ];
  for (const [section, hostVar, portVar] of targets) {
    const host = String(process.env[hostVar] ?? "").trim();
    const rawPort = String(process.env[portVar] ?? "").trim();
    if (!host && !rawPort) continue;
    cfg[section] = cfg[section] || {};
    if (host) cfg[section].host = host;
    if (rawPort) {
      const n = Number(rawPort);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) cfg[section].port = n;
      else console.warn(`[xclaw] ignoring ${portVar}=${rawPort} (want an integer 1–65535)`);
    }
  }
}

/** @deprecated use loadConfig */
export async function ensureConfig() {
  return loadConfig();
}
