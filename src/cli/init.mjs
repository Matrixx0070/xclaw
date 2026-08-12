/**
 * XClaw first-run onboarding (init).
 *
 * Creates ~/.xclaw config, optionally stores an API key, applies profile/model,
 * runs a light doctor pass, and prints the next step to open WebChat.
 *
 * Non-interactive (CI / install scripts):
 *   xclaw init --yes --api-key "$XAI_API_KEY" --profile lab
 *
 * Interactive (TTY):
 *   xclaw init
 */
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, getConfigPath, getConfigDir } from "../config/load.mjs";

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0;
}

function opt(args, name, fallback = null) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (v == null || String(v).startsWith("-")) return fallback;
  return v;
}

function isTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptLine(rl, question, def = "") {
  const suffix = def ? ` [${def}]` : "";
  const ans = (await rl.question(`${question}${suffix}: `)).trim();
  return ans || def;
}

async function writeConfigPatch(patch) {
  const file = getConfigPath();
  let user = {};
  try {
    user = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    user = {};
  }
  const next = { ...user };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && next[k] && typeof next[k] === "object") {
      next[k] = { ...next[k], ...v };
    } else if (v !== undefined) {
      next[k] = v;
    }
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return file;
}

/**
 * @param {string[]} args
 * @returns {Promise<number>} exit code
 */
export async function initMain(args = []) {
  const json = flag(args, "--json");
  const yes = flag(args, "--yes") || flag(args, "-y") || flag(args, "--non-interactive");
  const skipDoctor = flag(args, "--skip-doctor");
  const help = flag(args, "--help") || flag(args, "-h");

  if (help) {
    printHelp();
    return 0;
  }

  // Bootstrap dirs + default config file
  let cfg = await loadConfig({ strict: false });

  let profile = opt(args, "--profile") || process.env.XCLAW_PROFILE || cfg.profile || "lab";
  let provider =
    opt(args, "--provider") ||
    process.env.XCLAW_PROVIDER ||
    (String(cfg.agent?.model || "").startsWith("grok") ? "xai" : cfg.agent?.provider) ||
    "xai";
  let model =
    opt(args, "--model") ||
    process.env.XCLAW_MODEL ||
    cfg.agent?.model ||
    (provider === "xai" ? "xai/grok-4.5" : provider === "openai" ? "openai/gpt-4o-mini" : null);
  let apiKey =
    opt(args, "--api-key") ||
    process.env.XAI_API_KEY ||
    process.env.XCLAW_API_KEY ||
    process.env.OPENAI_API_KEY ||
    null;

  const interactive = !yes && isTty() && !json;

  if (interactive) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log("XClaw init — first-run setup\n");
      console.log(`Config will live at: ${getConfigPath()}\n`);

      profile = await promptLine(rl, "Profile (lab|dev|prod)", profile);
      provider = await promptLine(rl, "Provider (xai|openai|anthropic|compatible)", provider);

      if (!apiKey) {
        const entered = await promptLine(
          rl,
          `API key for ${provider} (leave empty to skip — set env later)`,
          ""
        );
        if (entered) apiKey = entered;
      } else {
        console.log(`API key: present via env/flag (not shown)`);
      }

      const defaultModel =
        model ||
        (provider === "xai"
          ? "xai/grok-4.5"
          : provider === "openai"
            ? "openai/gpt-4o-mini"
            : "");
      model = await promptLine(rl, "Default model", defaultModel);
    } finally {
      rl.close();
    }
  }

  if (!["lab", "dev", "prod"].includes(profile)) {
    console.error(`[xclaw] unknown profile "${profile}" — using lab`);
    profile = "lab";
  }

  const result = {
    ok: true,
    configPath: getConfigPath(),
    configDir: getConfigDir(),
    profile,
    provider,
    model: model || null,
    apiKeyStored: false,
    doctor: null,
    next: [],
  };

  // Persist profile + model into user config (env still wins at runtime)
  try {
    const patch = { profile };
    if (model) {
      patch.agent = { ...(cfg.agent || {}), model, provider };
    } else if (provider) {
      patch.agent = { ...(cfg.agent || {}), provider };
    }
    result.configPath = await writeConfigPatch(patch);
  } catch (err) {
    result.ok = false;
    result.error = `config write failed: ${err.message}`;
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`[xclaw] ${result.error}`);
    }
    return 1;
  }

  // Store API key in auth profiles (preferred) when provided
  if (apiKey) {
    try {
      // Reload after patch so paths/profile are current
      cfg = await loadConfig({ strict: false });
      const { loginApiKey } = await import("../auth/profiles.mjs");
      const authOut = await loginApiKey(cfg, {
        provider,
        name: "default",
        apiKey,
        setDefault: true,
      });
      result.apiKeyStored = true;
      result.authProfileId = authOut?.id || `${provider}:default`;
    } catch (err) {
      result.ok = false;
      result.error = `auth store failed: ${err.message}`;
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`[xclaw] ${result.error}`);
        console.error("[xclaw] You can still export XAI_API_KEY / XCLAW_API_KEY and continue.");
      }
      return 1;
    }
  }

  // Light doctor (config + node + key presence) — skip live probes noise when --skip-doctor
  if (!skipDoctor) {
    try {
      const { runDoctor } = await import("./doctor.mjs");
      const report = await runDoctor({ json: true, quiet: true });
      result.doctor = {
        ok: report.ok,
        exitCode: report.exitCode,
        errors: report.errors,
        warnings: report.warnings,
        // Keep a short subset for humans
        highlights: (report.checks || [])
          .filter((c) => ["config.load", "node", "apiKey", "profile", "bind", "owner.gatewayToken"].includes(c.id))
          .map((c) => ({ id: c.id, status: c.status, message: c.message })),
      };
      if (report.errors > 0) result.ok = false;
    } catch (err) {
      result.doctor = { ok: false, error: err.message };
    }
  }

  const gwPort = cfg.gateway?.port || 18790;
  result.next = [
    apiKey || result.apiKeyStored
      ? null
      : `export XAI_API_KEY=xai-...   # or: xclaw init --api-key xai-...`,
    profile === "prod" && !(cfg.gateway?.token || process.env.XCLAW_GATEWAY_TOKEN)
      ? `export XCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)`
      : null,
    `node bin/xclaw.mjs doctor`,
    `node bin/xclaw.mjs gateway`,
    `open http://127.0.0.1:${gwPort}/chat/`,
  ].filter(Boolean);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("");
    console.log("XClaw init complete");
    console.log("==================");
    console.log(`  config:   ${result.configPath}`);
    console.log(`  profile:  ${profile}`);
    console.log(`  provider: ${provider}`);
    console.log(`  model:    ${model || "(unset)"}`);
    console.log(`  api key:  ${result.apiKeyStored ? "stored in auth profiles" : apiKey ? "provided" : "not set"}`);
    if (result.doctor) {
      console.log(
        `  doctor:   ${result.doctor.ok ? "ok" : "issues"} (${result.doctor.errors || 0} err, ${result.doctor.warnings || 0} warn)`
      );
      for (const h of result.doctor.highlights || []) {
        const tag = h.status === "ok" ? "OK" : h.status === "warn" ? "WARN" : "ERR";
        console.log(`           [${tag}] ${h.id}: ${h.message}`);
      }
    }
    console.log("");
    console.log("Next:");
    for (const line of result.next) console.log(`  ${line}`);
    console.log("");
  }

  if (!result.ok) return result.doctor?.exitCode === 2 ? 2 : 1;
  return 0;
}

function printHelp() {
  console.log(`Usage:
  xclaw init [options]

Options:
  --yes, -y              Non-interactive (use flags/env defaults)
  --profile <lab|dev|prod>
  --provider <xai|openai|anthropic|compatible>
  --model <id>           e.g. xai/grok-4.5
  --api-key <key>        Store provider API key (or set XAI_API_KEY)
  --skip-doctor          Skip post-init doctor checks
  --json                 Machine-readable output
  -h, --help             Show this help

Examples:
  xclaw init
  xclaw init --yes --api-key "$XAI_API_KEY" --profile lab
  xclaw init --yes --provider openai --api-key "$OPENAI_API_KEY" --model openai/gpt-4o-mini

Note: "xclaw onboard" is an alias for init (auth-focused flags still accepted).
`);
}

// Allow: node src/cli/init.mjs --yes
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  initMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
