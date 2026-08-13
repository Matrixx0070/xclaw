/**
 * xclaw providers — configure EVERY provider independently (API key, OAuth,
 * base URL each) and pick the active provider/model interactively.
 *
 * Subcommands:
 *   providers [list]                          table of all providers + status
 *   providers set --provider X [--base-url U] [--api-key K] [--reset-url]
 *   providers oauth --provider X [--name N]   provider's OAuth login flow
 *   providers use [X] [model]                 set active (no args → TUI picker)
 *   providers setup                           sequential wizard over ALL providers
 *
 * Secrets go to the auth-profile store (src/auth/profiles.mjs); endpoints and
 * the active selection go to xclaw.json — all via src/providers/manage.mjs so
 * the gateway/control-UI panel behaves identically.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, getConfigPath } from "../config/load.mjs";
import {
  providerInventory,
  setProviderBaseUrl,
  setActiveProvider,
  manageableProviderIds,
} from "../providers/manage.mjs";
import { loginApiKey, loginOAuthTokens, listProfiles, setAuthOrder } from "../auth/profiles.mjs";

/**
 * Credential profiles are kept SEPARATE per mechanism so an API key and an
 * OAuth token coexist for the same provider:
 *   <provider>:apikey  ← loginApiKey
 *   <provider>:oauth   ← OAuth flows
 * The auth order (setAuthOrder) decides which one resolveProviderToken — and
 * therefore live model discovery + the agent — actually uses.
 */
const APIKEY_PROFILE = "apikey";
const OAUTH_PROFILE = "oauth";

/** Put one profile id first in the provider's auth order (rest keep order). */
async function preferProfile(cfg, provider, profileId) {
  try {
    const all = await listProfiles(cfg, provider);
    const rest = all.map((p) => p.id).filter((id) => id !== profileId);
    await setAuthOrder(cfg, provider, [profileId, ...rest]);
  } catch {
    /* preference is best-effort — resolution still works via defaults */
  }
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};
const color = (on) => (code, s) => (on ? `${code}${s}${ANSI.reset}` : s);

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const NON_TTY_MSG =
  "Interactive mode needs a terminal. Run in an interactive terminal, or use `xclaw providers set --provider X --api-key ... --base-url ...` / `xclaw providers use X model`.";

/** Render the provider table (pure — returns lines, used by list + tests). */
export function renderProviderTable(inv, { ansi = true } = {}) {
  const c = color(ansi);
  const lines = [];
  lines.push(
    c(ANSI.bold, "  provider     endpoint                                   key  oauth    active")
  );
  for (const p of inv.providers) {
    const marker = p.isActive ? c(ANSI.green, "*") : " ";
    const base = `${p.baseUrl || "-"}${p.baseUrlCustom ? " [custom]" : ""}`;
    const key = p.hasKey ? c(ANSI.green, "Y") : "-";
    const oauth = p.hasOAuth
      ? p.oauthExpired
        ? c(ANSI.yellow, "expired")
        : c(ANSI.green, "Y")
      : "-";
    const active = p.isActive ? c(ANSI.green, inv.active.model || p.defaultModel || "") : "";
    const row = `${marker} ${p.id.padEnd(12)} ${base.padEnd(42)} ${key.padEnd(
      ansi ? 12 : 4
    )} ${oauth.padEnd(ansi ? 16 : 8)} ${active}`;
    lines.push(p.configured ? row : c(ANSI.dim, row));
    // Both credential kinds can coexist (<provider>:apikey + <provider>:oauth);
    // show them with the preferred (auth-order-first) one starred.
    if ((p.profiles || []).length) {
      const creds = p.profiles
        .map(
          (pr) =>
            `${pr.id}(${pr.mode || "key"}${pr.expired ? ",expired" : ""})${pr.orderIndex === 0 ? "★" : ""}`
        )
        .join("  ");
      lines.push(c(ANSI.dim, `    creds: ${creds}`));
    }
  }
  lines.push("");
  lines.push(
    c(
      ANSI.dim,
      `config: ${getConfigPath()} · secrets: auth-profile store · "xclaw providers setup" walks every provider`
    )
  );
  return lines;
}

/** Provider-specific OAuth dispatch — mirrors `models auth login --method oauth`. */
async function oauthLoginForProvider(cfg, provider, { name = OAUTH_PROFILE, mode, code } = {}) {
  const { canStartOAuth, getAuthPolicy } = await import("../auth/oauth-policy.mjs");
  const gate = canStartOAuth(provider);
  if (!gate.ok) {
    return { ok: false, error: gate.reason, policy: getAuthPolicy(provider) };
  }
  if (provider === "anthropic" || provider === "claude") {
    const { loginAnthropicOAuth } = await import("../auth/anthropic-oauth.mjs");
    return loginAnthropicOAuth(cfg, {
      name,
      mode: mode || process.env.XCLAW_ANTHROPIC_OAUTH_MODE || "max",
      code: code || undefined,
    });
  }
  if (provider === "xai") {
    const { loginWithOAuth, loadCredentials } = await import("../auth/xai.mjs");
    const out = await loginWithOAuth(cfg);
    if (out.ok) {
      try {
        const creds = await loadCredentials(cfg);
        if (creds.accessToken) {
          await loginOAuthTokens(cfg, {
            provider: "xai",
            name,
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            expiresAt: creds.expiresAt,
            meta: creds.oauth || {},
          });
        }
      } catch {
        /* profile store best-effort; xai store already holds the creds */
      }
    }
    return out;
  }
  if (provider === "openai") {
    const { loginOpenAICodex } = await import("../auth/openai-codex.mjs");
    return loginOpenAICodex(cfg, { name });
  }
  return {
    ok: false,
    error: `OAuth not implemented for ${provider}. Use \`xclaw providers set --provider ${provider} --api-key ...\` (recommended: ${gate.policy?.recommended || "api-key"}).`,
  };
}

/** Numbered menu over items; returns index or -1 on quit. Re-prompts on bad input. */
async function pickFromMenu(rl, title, labels, { allowQuit = true } = {}) {
  console.log(`\n${title}`);
  labels.forEach((l, i) => console.log(`  [${i + 1}] ${l}`));
  if (allowQuit) console.log("  [q] cancel");
  for (;;) {
    const ans = (await rl.question("> ")).trim().toLowerCase();
    if (allowQuit && (ans === "q" || ans === "quit")) return -1;
    const n = Number(ans);
    if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
    console.log(`Enter 1-${labels.length}${allowQuit ? " or q" : ""}.`);
  }
}

const MODEL_MENU_MAX = 30;

/**
 * Credential-first model discovery: hit the provider's real /models endpoint
 * with the just-stored credential and let the user pick from what is ACTUALLY
 * available. Falls back to the static registry list (then free text) when live
 * discovery fails, printing why.
 * @returns {Promise<string|null>} chosen model id, or null on cancel
 */
async function pickModelForProvider(rl, cfg, prov) {
  let liveModels = [];
  let liveError = null;
  try {
    const { fetchLiveModels } = await import("../providers/discovery.mjs");
    const res = await fetchLiveModels(cfg, prov.id, { force: true });
    if (res.ok && Array.isArray(res.models) && res.models.length) {
      liveModels = res.models.map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
      console.log(`\n${prov.id}: ${liveModels.length} model(s) available on the live endpoint.`);
    } else {
      liveError = res.error || "no models returned";
    }
  } catch (e) {
    liveError = e.message || String(e);
  }

  let pool = liveModels;
  if (!pool.length) {
    console.log(
      `\n${prov.id}: live model discovery failed (${liveError}) — falling back to the built-in list.`
    );
    pool = prov.models || [];
  }

  if (pool.length) {
    const shown = pool.slice(0, MODEL_MENU_MAX);
    const labels = shown.map((m) => `${m}${m === prov.defaultModel ? "  (default)" : ""}`);
    labels.push(
      pool.length > shown.length
        ? `other (${pool.length - shown.length} more — type a model id)`
        : "other (type a model id)"
    );
    const mi = await pickFromMenu(rl, `Pick a model for ${prov.id}:`, labels);
    if (mi < 0) return undefined; // explicit cancel
    if (mi === labels.length - 1) {
      return (await rl.question("Model id: ")).trim() || null; // empty = provider default
    }
    return shown[mi];
  }
  return (await rl.question(`Model id for ${prov.id} (empty = provider default): `)).trim() || null;
}

/** Live-first model pick + activate; shared by `use`, `setup`, and post-credential hooks. */
async function pickAndActivate(rl, cfg, prov) {
  const model = await pickModelForProvider(rl, cfg, prov);
  if (model === undefined) {
    console.log("(cancelled — active provider unchanged)");
    return 1;
  }
  // "use default" must mean THIS provider's default — pass it explicitly so a
  // stale agent.model from the previous provider can't leak through.
  const chosen = model === null ? prov.defaultModel || null : model;
  const out = await setActiveProvider(cfg, { provider: prov.id, model: chosen });
  console.log(`Active: ${out.provider} / ${out.model || "(provider default)"}`);
  return 0;
}

/** Interactive provider→model picker; rl is owned by the caller. */
async function usePickerWithRl(rl, cfg) {
  const inv = await providerInventory(cfg);
  const configured = inv.providers.filter((p) => p.hasKey || p.hasOAuth);
  if (!configured.length) {
    console.log("No configured providers yet — run `xclaw providers setup` first.");
    return 1;
  }
  const pi = await pickFromMenu(
    rl,
    "Pick the active provider:",
    configured.map(
      (p) => `${p.id.padEnd(12)} ${p.hasOAuth ? "[oauth]" : ""}${p.hasKey ? "[key]" : ""}${p.isActive ? "  (current)" : ""}`
    )
  );
  if (pi < 0) return 1;
  const prov = configured[pi];
  // Multiple stored credentials (e.g. apikey + oauth) → pick WHICH one first;
  // live model discovery then resolves with the chosen credential.
  if ((prov.profiles || []).length > 1) {
    const labels = prov.profiles.map(
      (pr) =>
        `${pr.id}  (${pr.mode || "key"}${pr.expired ? ", expired" : ""}${pr.orderIndex === 0 ? ", current preference" : ""})`
    );
    const ci = await pickFromMenu(rl, `Which ${prov.id} credential should be used?`, labels);
    if (ci < 0) return 1;
    await preferProfile(cfg, prov.id, prov.profiles[ci].id);
    console.log(`Preferred credential: ${prov.profiles[ci].id}`);
  }
  return pickAndActivate(rl, cfg, prov);
}

async function cmdList() {
  const cfg = await loadConfig();
  const inv = await providerInventory(cfg);
  for (const line of renderProviderTable(inv, { ansi: Boolean(process.stdout.isTTY) })) {
    console.log(line);
  }
  return 0;
}

async function cmdSet(args) {
  const provider = flag(args, "--provider") || args[1];
  const baseUrl = flag(args, "--base-url") || flag(args, "--url");
  const apiKey = flag(args, "--api-key") || flag(args, "--key");
  const resetUrl = args.includes("--reset-url");
  const name = flag(args, "--name") || APIKEY_PROFILE;
  if (!provider || provider.startsWith("--")) {
    console.error("Usage: xclaw providers set --provider X [--base-url URL] [--api-key KEY] [--reset-url]");
    return 1;
  }
  if (!baseUrl && !apiKey && !resetUrl) {
    console.error("Nothing to set — pass --base-url, --api-key, and/or --reset-url.");
    return 1;
  }
  const cfg = await loadConfig();
  if (!manageableProviderIds(cfg).includes(provider)) {
    console.error(`Unknown provider: ${provider} (known: ${manageableProviderIds(cfg).join(", ")})`);
    return 1;
  }
  if (resetUrl) {
    const r = await setProviderBaseUrl(provider, null);
    console.log(`${provider}: base URL reset to default`);
    void r;
  }
  if (baseUrl) {
    const r = await setProviderBaseUrl(provider, baseUrl);
    console.log(`${provider}: base URL → ${r.baseUrl}`);
  }
  if (apiKey) {
    const p = await loginApiKey(cfg, { provider, name, apiKey });
    const pid = p?.id || `${provider}:${name}`;
    await preferProfile(cfg, provider, pid);
    console.log(`${provider}: API key stored (profile ${pid}, now preferred)`);
    return afterCredentialStored(cfg, provider);
  }
  return 0;
}

/**
 * Credential-first follow-through: with a fresh key/token, discover the LIVE
 * model list. Interactive → numbered picker + activate; non-TTY → print the
 * discovered ids so the user can `providers use X <model>`.
 */
async function afterCredentialStored(cfg, providerId) {
  const inv = await providerInventory(cfg);
  const prov = inv.providers.find((r) => r.id === providerId);
  if (!prov) return 0;
  if (isInteractive()) {
    const rl = readline.createInterface({ input, output });
    try {
      const activate = (await rl.question(`Make ${providerId} the active provider now? [Y/n] `))
        .trim()
        .toLowerCase();
      if (activate !== "n" && activate !== "no") return await pickAndActivate(rl, cfg, prov);
      return 0;
    } finally {
      rl.close();
    }
  }
  // Non-interactive: still prove the credential by listing live models.
  if (process.env.XCLAW_NO_LIVE_MODELS === "1") return 0; // tests/offline
  try {
    const { fetchLiveModels } = await import("../providers/discovery.mjs");
    const res = await fetchLiveModels(cfg, providerId, { force: true });
    if (res.ok && res.models?.length) {
      console.log(`${providerId}: ${res.models.length} live model(s) available:`);
      for (const m of res.models.slice(0, 20)) console.log(`  ${typeof m === "string" ? m : m.id}`);
      if (res.models.length > 20) console.log(`  … ${res.models.length - 20} more`);
      console.log(`Activate one with: xclaw providers use ${providerId} <model>`);
    } else {
      console.log(`${providerId}: live model discovery failed (${res.error || "no models"}).`);
    }
  } catch (e) {
    console.log(`${providerId}: live model discovery failed (${e.message || e}).`);
  }
  return 0;
}

async function cmdOauth(args) {
  const provider = flag(args, "--provider") || args[1];
  if (!provider || provider.startsWith("--")) {
    console.error("Usage: xclaw providers oauth --provider anthropic|xai|openai [--name N]");
    return 1;
  }
  const code = flag(args, "--code");
  if (!isInteractive() && !code) {
    console.error(NON_TTY_MSG);
    return 1;
  }
  const cfg = await loadConfig();
  const name = flag(args, "--name") || OAUTH_PROFILE;
  const out = await oauthLoginForProvider(cfg, provider, {
    name,
    mode: flag(args, "--mode"),
    code,
  });
  console.log(JSON.stringify({ ...out, accessToken: undefined, refreshToken: undefined }, null, 2));
  if (!out.ok) return 1;
  await preferProfile(cfg, provider, out.profileId || `${provider}:${name}`);
  return afterCredentialStored(cfg, provider);
}

async function cmdUse(args) {
  const provider = args[1] && !args[1].startsWith("--") ? args[1] : flag(args, "--provider");
  const model =
    args[2] && !args[2].startsWith("--") ? args[2] : flag(args, "--model") || null;
  const cfg = await loadConfig();
  if (provider) {
    try {
      // No model given → use THAT provider's default, not the stale agent.model.
      let chosen = model;
      if (!chosen) {
        const inv = await providerInventory(cfg);
        chosen = inv.providers.find((r) => r.id === provider)?.defaultModel || null;
      }
      const out = await setActiveProvider(cfg, { provider, model: chosen });
      console.log(`Active: ${out.provider} / ${out.model || "(provider default)"}`);
      return 0;
    } catch (e) {
      console.error(e.message || String(e));
      return 1;
    }
  }
  if (!isInteractive()) {
    console.error(NON_TTY_MSG);
    return 1;
  }
  const rl = readline.createInterface({ input, output });
  try {
    return await usePickerWithRl(rl, cfg);
  } finally {
    rl.close();
  }
}

async function cmdSetup() {
  if (!isInteractive()) {
    console.error(NON_TTY_MSG);
    return 1;
  }
  const cfg = await loadConfig();
  let rl = readline.createInterface({ input, output });
  const reopen = () => {
    rl = readline.createInterface({ input, output });
  };
  try {
    console.log("\nXClaw provider setup — walks every provider; all steps optional, re-runnable.");
    const inv = await providerInventory(cfg);
    let skipAll = false;
    for (const p of inv.providers) {
      if (skipAll) break;
      const status = [
        p.hasKey ? "key ✓" : null,
        p.hasOAuth ? (p.oauthExpired ? "oauth expired" : "oauth ✓") : null,
        p.baseUrlCustom ? "custom URL" : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(
        `\n─ ${p.id} (${p.name}) ${status ? `— ${status}` : "— not configured"}\n  endpoint: ${p.baseUrl || "-"}`
      );
      console.log(
        "  [1] skip  [2] set API key  [3] OAuth login  [4] set custom base URL  [5] reset base URL  [s] skip all remaining  [q] quit"
      );
      let handled = false;
      while (!handled) {
        const ans = (await rl.question("> ")).trim().toLowerCase();
        handled = true;
        if (ans === "" || ans === "1") break;
        if (ans === "q" || ans === "quit") return 0;
        if (ans === "s") {
          skipAll = true;
          break;
        }
        if (ans === "2") {
          const key = (await rl.question(`  ${p.id} API key: `)).trim();
          if (key) {
            const prof = await loginApiKey(cfg, { provider: p.id, name: APIKEY_PROFILE, apiKey: key });
            await preferProfile(cfg, p.id, prof?.id || `${p.id}:${APIKEY_PROFILE}`);
            console.log("  stored. Discovering available models with this key…");
            // Credential-first: show what the key can ACTUALLY reach, live.
            const activate = (await rl.question(`  Make ${p.id} the active provider now? [Y/n] `))
              .trim()
              .toLowerCase();
            if (activate !== "n" && activate !== "no") {
              await pickAndActivate(rl, cfg, p);
            }
          } else console.log("  (empty — skipped)");
          break;
        }
        if (ans === "3") {
          // OAuth flows own stdin (their own readline) — release ours first.
          rl.close();
          const out = await oauthLoginForProvider(cfg, p.id, { name: OAUTH_PROFILE });
          reopen();
          if (out.ok) {
            await preferProfile(cfg, p.id, out.profileId || `${p.id}:${OAUTH_PROFILE}`);
            console.log("  oauth stored. Discovering available models with this token…");
            const activate = (await rl.question(`  Make ${p.id} the active provider now? [Y/n] `))
              .trim()
              .toLowerCase();
            if (activate !== "n" && activate !== "no") {
              await pickAndActivate(rl, cfg, p);
            }
          } else {
            console.log(`  oauth failed: ${out.error || "?"}`);
          }
          break;
        }
        if (ans === "4") {
          const url = (await rl.question(`  base URL for ${p.id} (e.g. ${p.baseUrlDefault || "http://host:port/v1"}): `)).trim();
          if (url) {
            await setProviderBaseUrl(p.id, url);
            console.log("  saved.");
          } else console.log("  (empty — skipped)");
          break;
        }
        if (ans === "5") {
          await setProviderBaseUrl(p.id, null);
          console.log("  reset to default.");
          break;
        }
        handled = false;
        console.log("  enter 1-5, s, or q");
      }
    }
    const pick = (await rl.question("\nPick the active provider now? [y/N] ")).trim().toLowerCase();
    if (pick === "y" || pick === "yes") {
      const freshCfg = await loadConfig();
      return await usePickerWithRl(rl, freshCfg);
    }
    console.log("Done. `xclaw providers use` any time to switch.");
    return 0;
  } finally {
    try {
      rl.close();
    } catch {
      /* already closed */
    }
  }
}

const USAGE = `Usage:
  xclaw providers [list]                     table: endpoint / key / oauth / active per provider
  xclaw providers set --provider X [--base-url URL] [--api-key KEY] [--reset-url]
  xclaw providers oauth --provider anthropic|xai|openai [--name N]
  xclaw providers use [X] [model]            set active (no args = interactive picker)
  xclaw providers setup                      sequential wizard across every provider
  xclaw providers install ollama [--model M] one-command local Ollama (install + serve + pull)`;

/**
 * `xclaw providers install ollama [--model M]` — one-command local Ollama:
 * install the runtime if missing, start the daemon, pull a default model. The
 * SEPARATE Ollama cloud key is added via `providers set --provider ollama
 * --api-key <ollama.com key>` (routes to ollama.com automatically).
 */
async function cmdInstall(args) {
  const target = (args[1] && !args[1].startsWith("--") ? args[1] : "ollama").toLowerCase();
  if (target !== "ollama") {
    console.error(`Only 'ollama' supports one-command install right now (got: ${target}).`);
    return 1;
  }
  const model = flag(args, "--model") || "llama3.2";
  const noPull = args.includes("--no-pull");
  const { oneClickInstall } = await import("../providers/ollama-install.mjs");
  console.log("Installing local Ollama (runtime → daemon → model). Idempotent; safe to re-run.\n");
  const r = await oneClickInstall({ model, pull: !noPull, onLog: (m) => console.log("  • " + m) });
  if (!r.ok) {
    console.error(`\n✗ install failed: ${r.error}`);
    if (r.steps?.install?.out) console.error(r.steps.install.out);
    return 1;
  }
  const s = r.steps;
  console.log(
    `\n✓ Ollama ready — runtime ${s.install.alreadyInstalled ? "already installed" : "installed"}, ` +
      `daemon ${s.daemon.alreadyUp ? "already up" : "started"}${
        s.pull ? (s.pull.ok ? `, model ${model} pulled` : `, model pull skipped (${s.pull.error})`) : ""
      }.`
  );
  console.log(`  local models: ${(r.models || []).join(", ") || "(none yet — `ollama pull <model>`)"}`);
  console.log(`  use local:  xclaw providers use ollama ${model}`);
  console.log(`  cloud:      xclaw providers set --provider ollama-cloud --api-key <ollama.com key>  (separate entry → ollama.com)`);
  return 0;
}

export async function runProvidersCli(args = [], _ctx = {}) {
  const sub = args[0] || "list";
  let code = 1;
  if (sub === "list") code = await cmdList();
  else if (sub === "set") code = await cmdSet(args);
  else if (sub === "oauth") code = await cmdOauth(args);
  else if (sub === "use") code = await cmdUse(args);
  else if (sub === "setup") code = await cmdSetup();
  else if (sub === "install") code = await cmdInstall(args);
  else {
    console.error(USAGE);
    code = sub === "help" ? 0 : 1;
  }
  process.exitCode = code;
  return code;
}

export default { runProvidersCli, renderProviderTable };
