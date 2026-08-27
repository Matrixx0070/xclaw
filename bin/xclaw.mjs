#!/usr/bin/env node
/**
 * XClaw CLI — Phase 4
 */
import { describeRuntime, runtimeCompatBanner } from "../src/runtime/host-compat.mjs";

let bunSqlite;
if (process.versions.bun) {
  const { detectLoadedLibVersion } = await import("../src/persist/engine-load.mjs");
  bunSqlite = detectLoadedLibVersion();
}
const host = describeRuntime({ sqlite: bunSqlite });
if (!host.allowed) {
  process.stderr.write(runtimeCompatBanner(host) + "\n");
  process.exit(1);
}

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const cmd = args[0] || "help";

// Long-running CLI cron entrypoints (doctor-schedule, live-e2e-schedule,
// eval-schedule) arm the durable ledger. Close it cleanly on teardown so the
// WAL keeper can TRUNCATE-checkpoint. Idempotent — safe to call per branch.
let cronShutdownInstalled = false;
function installCronShutdown(stopCron) {
  if (cronShutdownInstalled) return;
  cronShutdownInstalled = true;
  const close = () => { try { stopCron(); } catch { /* already closed */ } };
  process.once("SIGTERM", () => { close(); process.exit(0); });
  process.once("SIGINT", () => { close(); process.exit(0); });
  process.on("beforeExit", close);
}

async function main() {
  switch (cmd) {
    case "gateway":
    case "start": {
      const { startGateway } = await import("../src/gateway/index.mjs");
      await startGateway({ root, args: args.slice(1) });
      break;
    }

    case "auth": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runAuthCli } = await import("../src/cli/auth-cli.mjs");
      const cfg = await loadConfig();
      const code = await runAuthCli(cfg, args.slice(1));
      process.exit(code);
      break;
    }




    case "alerts": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { resetSharedAlerter } = await import("../src/alerting/alerts.mjs");
      const cfg = await loadConfig();
      const alerter = resetSharedAlerter(cfg);
      const sub = args[1] || "status";
      if (sub === "status") {
        console.log(JSON.stringify(alerter.status(), null, 2));
        break;
      }
      if (sub === "history") {
        console.log(JSON.stringify(alerter.history(20), null, 2));
        break;
      }
      if (sub === "test") {
        const out = await alerter.send({
          title: args[2] || "Test alert",
          body: args.slice(3).join(" ") || "CLI test",
          severity: "error",
          key: `test:${Date.now()}`,
        });
        console.log(JSON.stringify(out, null, 2));
        process.exit(out.sent || out.skipped ? 0 : 1);
        break;
      }
      if (sub === "pd-resolve" || sub === "pd-ack") {
        const { sendPagerDutyEvent, pagerDutyDedupKey } = await import("../src/alerting/pagerduty.mjs");
        const dedup = args[2];
        if (!dedup) {
          console.error("Usage: xclaw alerts pd-resolve <dedupKey>");
          process.exit(1);
        }
        const out = await sendPagerDutyEvent({
          routingKey: cfg.alerting?.pagerduty?.routingKey || process.env.PAGERDUTY_ROUTING_KEY,
          eventAction: sub === "pd-ack" ? "acknowledge" : "resolve",
          dedupKey: pagerDutyDedupKey(dedup),
        });
        console.log(JSON.stringify(out, null, 2));
        process.exit(out.ok ? 0 : 1);
        break;
      }
      if (sub === "pd-setup") {
        const { pagerDutySetupReport } = await import("../src/alerting/pagerduty-rest.mjs");
        const report = await pagerDutySetupReport(cfg);
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      if (sub === "pd-webhooks") {
        const { listRecentPagerDutyWebhooks, getPagerDutyWebhookHistoryPath } = await import("../src/alerting/pagerduty-webhooks.mjs");
        console.log(JSON.stringify({
          path: getPagerDutyWebhookHistoryPath(),
          recent: listRecentPagerDutyWebhooks(20),
        }, null, 2));
        break;
      }
      if (sub === "pd-levels") {
        const action = args[2] || "preview";
        const mod = await import("../src/alerting/escalation-levels.mjs");
        if (action === "preview") {
          console.log(JSON.stringify(mod.previewEscalationLevels(cfg), null, 2));
          break;
        }
        if (action === "diff") {
          console.log(JSON.stringify(await mod.diffEscalationLevels(cfg), null, 2));
          break;
        }
        if (action === "apply") {
          const out = await mod.applyEscalationLevels(cfg);
          console.log(JSON.stringify(out, null, 2));
          process.exit(out.ok ? 0 : 1);
          break;
        }
        if (action === "template") {
          console.log(JSON.stringify({ levels: mod.defaultLevelsTemplate() }, null, 2));
          break;
        }
        console.error("Usage: xclaw alerts pd-levels <preview|diff|apply|template>");
        process.exit(1);
        break;
      }
      if (sub === "pd-policies") {
        const { listEscalationPolicies } = await import("../src/alerting/pagerduty-rest.mjs");
        const out = await listEscalationPolicies({ query: args[2] }, cfg);
        console.log(JSON.stringify(out, null, 2));
        process.exit(out.ok ? 0 : 1);
        break;
      }
      if (sub === "pd-services") {
        const { listServices } = await import("../src/alerting/pagerduty-rest.mjs");
        const out = await listServices({}, cfg);
        console.log(JSON.stringify(out, null, 2));
        process.exit(out.ok ? 0 : 1);
        break;
      }
      console.error("Usage: xclaw alerts <status|history|test|pd-resolve|pd-ack|pd-setup|pd-policies|pd-services|pd-levels>");
      process.exit(1);
      break;
    }
    case "cron-logs": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { monitorCronLogs, formatCronMonitor, doctorLogPath } = await import("../src/cron/logs.mjs");
      const cfg = await loadConfig();
      const follow = args.includes("--follow") || args.includes("-f");
      const jsonMode = args.includes("--json");
      const lines = Number(args.find((a, i) => args[i - 1] === "--lines")) || 40;
      const snap = monitorCronLogs(cfg, { lines });
      if (jsonMode) {
        console.log(JSON.stringify(snap, null, 2));
      } else {
        console.log(formatCronMonitor(snap));
      }
      if (follow) {
        const fp = doctorLogPath(cfg);
        let pos = 0;
        try {
          pos = (await import("node:fs")).statSync(fp).size;
        } catch {}
        console.log("\n(following doctor log — Ctrl+C to stop)\n");
        const fs = await import("node:fs");
        const iv = setInterval(() => {
          try {
            const st = fs.statSync(fp);
            if (st.size > pos) {
              const buf = Buffer.alloc(st.size - pos);
              const fd = fs.openSync(fp, "r");
              fs.readSync(fd, buf, 0, buf.length, pos);
              fs.closeSync(fd);
              process.stdout.write(buf.toString("utf8"));
              pos = st.size;
            }
          } catch {}
        }, 1000);
        await new Promise(() => {});
      }
      break;
    }
    case "doctor-schedule": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { createChannelManager } = await import("../src/channels/manager.mjs");
      const { isComputerRunning } = await import("../src/computer/manager.mjs");
      const { ensureDoctorCronJob } = await import("../src/cron/doctor-job.mjs");
      const { start: startCron, stop: stopCron, listJobs } = await import("../src/cron/scheduler.mjs");
      const cfg = await loadConfig();
      const everyMs = Number(args[1]) || cfg.doctor?.cron?.everyMs || 3600000;
      startCron();
      installCronShutdown(stopCron);
      const job = ensureDoctorCronJob({
        cfg,
        channelManager: createChannelManager(cfg),
        isComputerRunning,
        everyMs,
        delivery: cfg.doctor?.cron?.delivery || null,
      });
      console.log(JSON.stringify({ id: job.id, everyMs, jobs: listJobs().filter(j => j.name === "doctor") }, null, 2));
      break;
    }

    case "live-e2e": {
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const root = process.env.XCLAW_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const { runLiveE2eCheck } = await import("../src/cron/live-e2e-job.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig({ strict: false });
      const r = await runLiveE2eCheck({ cfg, root, strict: args.includes("--strict") });
      process.exitCode = r.ok ? 0 : 2;
      break;
    }

    case "live-e2e-schedule": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { ensureLiveE2eCronJob } = await import("../src/cron/live-e2e-job.mjs");
      const { start: startCron, stop: stopCron, listJobs } = await import("../src/cron/scheduler.mjs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const root = process.env.XCLAW_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const cfg = await loadConfig({ strict: false });
      const everyMs = Number(args[1]) || cfg.liveE2e?.cron?.everyMs || 86_400_000;
      startCron();
      installCronShutdown(stopCron);
      const job = ensureLiveE2eCronJob({
        cfg,
        root,
        everyMs,
        delivery: cfg.liveE2e?.cron?.delivery || null,
        strict: cfg.liveE2e?.cron?.strict === true,
      });
      console.log(JSON.stringify({
        id: job.id,
        everyMs,
        everyHours: +(everyMs / 3600000).toFixed(2),
        jobs: listJobs().filter((j) => j.name === "live-e2e"),
      }, null, 2));
      break;
    }

    case "release-gate": {
      const { spawn } = await import("node:child_process");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const extra = args.slice(1);
      const child = spawn(
        process.execPath,
        [path.join(root, "scripts/release-gate.mjs"), ...extra],
        { stdio: "inherit", cwd: root }
      );
      child.on("exit", (code) => process.exit(code ?? 1));
      break;
    }
    case "seats": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        listSeatsStatus,
        resetSeatDay,
        setSeatPaused,
        checkSeatBudget,
        seatsEnabled,
        resolveSeat,
      } = await import("../src/seats/manager.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "status";
      if (sub === "status" || sub === "list") {
        console.log(JSON.stringify(await listSeatsStatus(cfg), null, 2));
        break;
      }
      if (sub === "check") {
        const peer = args[2] || "default";
        const parts = String(peer).includes(":") ? peer.split(":") : ["local", peer];
        console.log(JSON.stringify(await checkSeatBudget(cfg, { channel: parts[0], id: parts.slice(1).join(":") }), null, 2));
        break;
      }
      if (sub === "reset") {
        const id = args[2] || null;
        console.log(JSON.stringify(await resetSeatDay(cfg, id), null, 2));
        break;
      }
      if (sub === "pause" || sub === "unpause") {
        const id = args[2];
        if (!id) {
          console.error("Usage: xclaw seats pause <seatId>");
          process.exit(1);
        }
        console.log(JSON.stringify(await setSeatPaused(cfg, id, sub === "pause"), null, 2));
        break;
      }
      if (sub === "resolve") {
        const peer = args[2] || "default";
        const parts = String(peer).includes(":") ? peer.split(":") : ["local", peer];
        console.log(JSON.stringify(resolveSeat(cfg, { channel: parts[0], id: parts.slice(1).join(":") }), null, 2));
        break;
      }
      console.error(`Usage:
  xclaw seats status
  xclaw seats check telegram:111
  xclaw seats reset [seatId]
  xclaw seats pause <seatId>
  xclaw seats resolve telegram:111

Enable with seats.enabled: true in config`);
      process.exit(1);
      break;
    }
    case "onboard": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const choice = args.includes("--auth-choice")
        ? args[args.indexOf("--auth-choice") + 1]
        : "xai-api-key";
      const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
      if (choice === "xai-api-key" || choice === "openai-api-key" || choice === "api-key") {
        const provider = choice.startsWith("openai") ? "openai" : (get("--provider") || "xai");
        const key =
          get("--api-key") ||
          process.env[provider === "openai" ? "OPENAI_API_KEY" : "XAI_API_KEY"] ||
          process.env.XCLAW_API_KEY;
        if (!key) {
          console.error("Provide --api-key or set XAI_API_KEY / OPENAI_API_KEY");
          process.exit(1);
        }
        const { loginApiKey } = await import("../src/auth/profiles.mjs");
        const out = await loginApiKey(cfg, { provider, apiKey: key });
        const model = get("--model") || (provider === "xai" ? "xai/grok-4.3" : "openai/gpt-4o-mini");
        console.log(JSON.stringify({
          ok: true,
          auth: out,
          suggestedModel: model,
          next: `Set agent.model to ${model} or export XCLAW_PROVIDER=${provider}`,
        }, null, 2));
        break;
      }
      if (choice === "custom-api-key") {
        const base = get("--custom-base-url") || get("--base-url");
        const model = get("--custom-model-id") || get("--model") || "local-model";
        const key = get("--custom-api-key") || get("--api-key") || process.env.XCLAW_API_KEY || "local";
        if (!base) {
          console.error("Usage: xclaw onboard --auth-choice custom-api-key --custom-base-url http://127.0.0.1:8080/v1 --custom-model-id my-model");
          process.exit(1);
        }
        const { loginApiKey } = await import("../src/auth/profiles.mjs");
        await loginApiKey(cfg, { provider: "compatible", apiKey: key });
        console.log(JSON.stringify({
          ok: true,
          provider: "compatible",
          baseUrl: base,
          model,
          hint: "Set cfg.agent.baseUrl and cfg.agent.model, or XCLAW_API_BASE / XCLAW_MODEL",
          env: { XCLAW_API_BASE: base, XCLAW_MODEL: model, XCLAW_PROVIDER: "compatible" },
        }, null, 2));
        break;
      }
      console.error(`Usage:
  xclaw onboard --auth-choice xai-api-key --api-key xai-...
  xclaw onboard --auth-choice openai-api-key --api-key sk-...
  xclaw onboard --auth-choice custom-api-key --custom-base-url http://127.0.0.1:8080/v1 --custom-model-id local-model`);
      process.exit(1);
      break;
    }
    case "providers": {
      const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
      await runProvidersCli(args.slice(1), { root });
      break;
    }
    case "channels": {
      // 3.78.x runtime ops (status snapshot, telegram status/test DM) — routed
      // ahead of the channels manager CLI, which owns list/setup/set/enable/disable.
      if (args[1] === "status" || args[1] === "telegram") {
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "status";
      if (sub === "status") {
        const { createChannelManager } = await import("../src/channels/manager.mjs");
        const m = createChannelManager(cfg);
        console.log(JSON.stringify(m.status?.() || m, null, 2));
        break;
      }
      if (sub === "telegram") {
        const action = args[2] || "status";
        const conf = cfg.channels?.telegram || {};
        const token = conf.token || process.env.TELEGRAM_BOT_TOKEN || process.env.XCLAW_TELEGRAM_TOKEN;
        if (action === "test") {
          const to = args[3] || conf.testChatId || conf.ownerChatId || (conf.allowedChatIds || [])[0];
          if (!token) {
            console.error(JSON.stringify({ ok: false, code: "NO_TELEGRAM_TOKEN" }));
            process.exitCode = 1;
            break;
          }
          if (!to) {
            console.error(JSON.stringify({ ok: false, code: "NO_CHAT_ID", message: "pass chat id: xclaw channels telegram test <chatId>" }));
            process.exitCode = 1;
            break;
          }
          const { deliverToChannel } = await import("../src/cron/channel-deliver.mjs");
          const out = await deliverToChannel(
            { mode: "announce", channel: "telegram", to: String(to), text: "XClaw telegram test ✅" },
            cfg
          );
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        console.log(JSON.stringify({
          enabled: conf.enabled !== false && Boolean(token),
          dmPolicy: conf.dmPolicy || "pairing",
          hasToken: Boolean(token),
          rateLimit: conf.rateLimit || cfg.channels?.rateLimit || null,
          allowedChatIds: conf.allowedChatIds || conf.allowFrom || [],
        }, null, 2));
        break;
      }
      console.error("Usage: xclaw channels [status|telegram [status|test <chatId>]]");
      process.exit(1);
      break;
      }
      const { runChannelsCli } = await import("../src/cli/channels-cli.mjs");
      await runChannelsCli(args.slice(1), { root });
      break;
    }
    case "models": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "status";
      if (sub === "status") {
        const { modelsAuthStatus } = await import("../src/auth/profiles.mjs");
        const { resolveProviderRoute, listModels } = await import("../src/providers/registry.mjs");
        const provider = args.includes("--provider")
          ? args[args.indexOf("--provider") + 1]
          : null;
        const auth = await modelsAuthStatus(cfg, provider);
        const route = resolveProviderRoute(cfg);
        console.log(JSON.stringify({ route, auth, models: listModels(cfg, provider) }, null, 2));
        break;
      }
      if (sub === "list") {
        const { listModelsRich } = await import("../src/providers/discovery.mjs");
        const { listModels: listStatic } = await import("../src/providers/registry.mjs");
        const provider = args.includes("--provider")
          ? args[args.indexOf("--provider") + 1]
          : null;
        const live = args.includes("--live");
        const force = args.includes("--force");
        const includeAll = args.includes("--all");
        if (live || force) {
          const rich = await listModelsRich(cfg, provider, {
            live: true,
            force,
            includeAll,
          });
          console.log(JSON.stringify(rich, null, 2));
        } else {
          console.log(JSON.stringify(listStatic(cfg, provider), null, 2));
        }
        break;
      }
      if (sub === "refresh") {
        const { refreshModelCache, listModelsRich } = await import("../src/providers/discovery.mjs");
        const provider = args.includes("--provider")
          ? args[args.indexOf("--provider") + 1]
          : null;
        const includeAll = args.includes("--all");
        const refreshed = await refreshModelCache(cfg, provider, { includeAll });
        const rich = await listModelsRich(cfg, provider, {
          live: true,
          force: false,
          includeAll,
        });
        console.log(JSON.stringify({ refreshed, catalog: rich.counts, discovery: rich.discovery }, null, 2));
        break;
      }
      if (sub === "cache-clear") {
        const { clearModelCache } = await import("../src/providers/discovery.mjs");
        console.log(JSON.stringify(await clearModelCache(cfg), null, 2));
        break;
      }
      if (sub === "providers") {
        const { listProviders } = await import("../src/providers/registry.mjs");
        const all = listProviders(cfg);
        console.log(JSON.stringify(Object.values(all).map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          defaultModel: p.defaultModel,
          envKey: p.envKey,
          custom: Boolean(p.custom),
          models: (p.models || []).map((m) => (typeof m === "string" ? m : m.id)),
        })), null, 2));
        break;
      }
      if (sub === "route") {
        const { resolveProviderRoute, resolveProviderRouteAsync } = await import("../src/providers/registry.mjs");
        const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
        const route = await resolveProviderRouteAsync(cfg, { model });
        console.log(JSON.stringify({ ...route, apiKey: route.apiKey ? "[set]" : null }, null, 2));
        break;
      }
      if (sub === "auth") {
        const {
          loginApiKey,
          loginToken,
          loginOAuthTokens,
          listProfiles,
          removeProfile,
          setAuthOrder,
          getAuthOrder,
          modelsAuthStatus,
          resolveProviderToken,
          makeProfileId,
        } = await import("../src/auth/profiles.mjs");
        const action = args[2] || "status";
        const get = (flag) => {
          const i = args.indexOf(flag);
          return i >= 0 ? args[i + 1] : null;
        };
        if (action === "status" || action === "list") {
          const provider = get("--provider");
          if (action === "list") {
            console.log(JSON.stringify(await listProfiles(cfg, provider), null, 2));
          } else {
            console.log(JSON.stringify(await modelsAuthStatus(cfg, provider), null, 2));
          }
          break;
        }
        if (action === "login") {
          const provider = get("--provider") || "xai";
          const name = get("--name") || get("--profile") || "default";
          const method = get("--method") || (args.includes("--oauth") ? "oauth" : "api-key");
          if (method === "api-key" || method === "api_key") {
            const key = get("--api-key") || get("--key");
            if (!key) {
              console.error("Usage: xclaw models auth login --provider xai --method api-key --api-key xai-...");
              process.exit(1);
            }
            console.log(JSON.stringify(await loginApiKey(cfg, { provider, name, apiKey: key }), null, 2));
            break;
          }
          if (method === "token") {
            const token = get("--token");
            if (!token) {
              console.error("Usage: xclaw models auth login --provider anthropic --method token --token ...");
              process.exit(1);
            }
            console.log(JSON.stringify(await loginToken(cfg, { provider, name, token }), null, 2));
            break;
          }
          if (method === "oauth") {
            const { canStartOAuth, getAuthPolicy } = await import("../src/auth/oauth-policy.mjs");
            const gate = canStartOAuth(provider);
            if (!gate.ok) {
              console.error(gate.reason);
              console.error(JSON.stringify({ provider, policy: getAuthPolicy(provider) }, null, 2));
              process.exit(1);
            }
            if (provider === "openai") {
              const { loginOpenAICodex } = await import("../src/auth/openai-codex.mjs");
              const out = await loginOpenAICodex(cfg, { name });
              console.log(JSON.stringify(out, null, 2));
              process.exitCode = out.ok ? 0 : 1;
              break;
            }
            if (provider === "xai") {
              try {
                const { loginWithOAuth, loadCredentials } = await import("../src/auth/xai.mjs");
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
                    /* */
                  }
                }
                console.log(JSON.stringify(out, null, 2));
              } catch (err) {
                console.error(err.message);
                process.exit(1);
              }
              break;
            }
            if (provider === "anthropic" || provider === "claude") {
              try {
                const { loginAnthropicOAuth } = await import("../src/auth/anthropic-oauth.mjs");
                const out = await loginAnthropicOAuth(cfg, {
                  name,
                  mode: get("--mode") || process.env.XCLAW_ANTHROPIC_OAUTH_MODE || "max",
                  code: get("--code") || undefined,
                });
                console.log(JSON.stringify(out, null, 2));
                if (!out.ok) process.exit(1);
              } catch (err) {
                console.error(err.message);
                process.exit(1);
              }
              break;
            }
            console.error(`OAuth not implemented for ${provider}. Recommended: ${gate.policy.recommended}`);
            process.exit(1);
          }
          if (method === "import-claude" || method === "import-claude-code") {
            try {
              const { importClaudeCodeCredentials } = await import("../src/auth/anthropic-oauth.mjs");
              const out = await importClaudeCodeCredentials(cfg, { name });
              console.log(JSON.stringify(out, null, 2));
              if (!out.ok) process.exit(1);
            } catch (err) {
              console.error(err.message);
              process.exit(1);
            }
            break;
          }
          console.error("Unknown method. Use api-key | token | oauth | import-claude-code");
          process.exit(1);
        }
        if (action === "logout" || action === "remove") {
          const id = get("--profile-id") || get("--id") || args[3];
          if (!id) {
            console.error("Usage: xclaw models auth logout --profile-id xai:default");
            process.exit(1);
          }
          console.log(JSON.stringify(await removeProfile(cfg, id), null, 2));
          break;
        }
        if (action === "order") {
          const provider = get("--provider") || args[3];
          if (!provider) {
            console.error("Usage: xclaw models auth order --provider xai [profileIds...]");
            process.exit(1);
          }
          const ids = args.slice(args.indexOf(provider) + 1).filter((a) => !a.startsWith("--"));
          if (ids.length === 0) {
            console.log(JSON.stringify(await getAuthOrder(cfg, provider), null, 2));
          } else {
            console.log(JSON.stringify(await setAuthOrder(cfg, provider, ids), null, 2));
          }
          break;
        }
        if (action === "policy") {
          const { authPolicyReport, getAuthPolicy } = await import("../src/auth/oauth-policy.mjs");
          const provider = get("--provider");
          if (provider) console.log(JSON.stringify(getAuthPolicy(provider), null, 2));
          else console.log(JSON.stringify(authPolicyReport(), null, 2));
          break;
        }
        if (action === "resolve" || action === "token") {
          const provider = get("--provider") || "xai";
          const r = await resolveProviderToken(cfg, provider, {
            profileId: get("--profile-id"),
          });
          console.log(JSON.stringify({ hasToken: Boolean(r.token), source: r.source, mode: r.mode, profileId: r.profileId, error: r.error || null }, null, 2));
          break;
        }
        console.error(`Usage:
  xclaw models status
  xclaw models auth status [--provider xai]
  xclaw models auth list [--provider xai]
  xclaw models auth login --provider xai --method api-key --api-key xai-...
  xclaw models auth login --provider anthropic --method token --token ...
  xclaw models auth login --provider xai --method oauth
  xclaw models auth order --provider xai xai:work xai:default
  xclaw models auth logout --profile-id xai:default
  xclaw models auth resolve --provider xai`);
        process.exit(1);
      }
      console.error(`Usage:
  xclaw models status
  xclaw models list [--provider xai]
  xclaw models list --live [--provider xai] [--all] [--force]
  xclaw models refresh [--provider xai] [--all]
  xclaw models cache-clear
  xclaw models providers
  xclaw models route [--model xai/grok-4.5]
  xclaw models auth ...`);
      process.exit(1);
      break;
    }

    case "auth": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        loginWithApiKey,
        loginWithOAuth,
        logout,
        authStatus,
        resolveXaiToken,
      } = await import("../src/auth/xai.mjs");
      const cfg = await loadConfig();
      const get = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith("-")
          ? args[i + 1]
          : undefined;
      };
      const sub = args[1] || "status";
      if (sub === "status") {
        console.log(JSON.stringify(await authStatus(cfg), null, 2));
        break;
      }
      if (sub === "logout") {
        console.log(JSON.stringify(await logout(cfg), null, 2));
        break;
      }
      if (sub === "login") {
        const connectedIdx = args.indexOf("--connected");
        if (connectedIdx >= 0) {
          const app = args[connectedIdx + 1] || get("--app");
          if (!app || app.startsWith("--")) {
            console.error("Usage: xclaw auth login --connected github");
            process.exit(1);
          }
          const { loginConnectedOAuth } = await import("../src/connected/oauth-login.mjs");
          const out = await loginConnectedOAuth(cfg, app, {
            scope: get("--scope") || undefined,
            redirectPort: get("--port") ? Number(get("--port")) : undefined,
          });
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        const keyIdx = args.indexOf("--api-key");
        if (keyIdx >= 0 && args[keyIdx + 1]) {
          const out = await loginWithApiKey(cfg, args[keyIdx + 1]);
          try {
            const { loginApiKey } = await import("../src/auth/profiles.mjs");
            await loginApiKey(cfg, { provider: "xai", apiKey: args[keyIdx + 1] });
          } catch {}
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        if (args.includes("--oauth")) {
          console.log(JSON.stringify(await loginWithOAuth(cfg), null, 2));
          break;
        }
        console.error(`Usage:
  xclaw auth login --api-key xai-...     # xAI API key
  xclaw auth login --oauth               # xAI experimental OIDC
  xclaw auth login --connected <app>     # browser OAuth (github|google)
  xclaw auth connected list|status|login|refresh
  xclaw auth status
  xclaw auth logout

Note: xAI public API uses API keys. Connected OAuth uses PKCE loopback.`);
        process.exit(1);
      }
      if (sub === "connected") {
        const action = args[2] || "status";
        const {
          loginConnectedOAuth,
          refreshConnectedOAuth,
          connectedAuthStatus,
        } = await import("../src/connected/oauth-login.mjs");
        const { listConnectedOAuthProviders } = await import("../src/connected/oauth-providers.mjs");
        if (action === "list" || action === "providers") {
          console.log(JSON.stringify({ providers: listConnectedOAuthProviders() }, null, 2));
          break;
        }
        if (action === "status") {
          console.log(JSON.stringify(await connectedAuthStatus(cfg), null, 2));
          break;
        }
        if (action === "login") {
          const app = args[3] || get("--app") || get("--provider");
          if (!app) {
            console.error("Usage: xclaw auth connected login <github|google>");
            console.error("Set XCLAW_GITHUB_OAUTH_CLIENT_ID (and optional SECRET)");
            process.exit(1);
          }
          const scope = get("--scope");
          const port = get("--port") ? Number(get("--port")) : undefined;
          const out = await loginConnectedOAuth(cfg, app, { scope, redirectPort: port });
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        if (action === "refresh") {
          const app = args[3] || get("--app");
          if (!app) {
            console.error("Usage: xclaw auth connected refresh <github|google>");
            process.exit(1);
          }
          const out = await refreshConnectedOAuth(cfg, app);
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        if (action === "logout") {
          const { logoutConnected } = await import("../src/connected/oauth-login.mjs");
          const app = args[3] || get("--app") || "all";
          const out = await logoutConnected(cfg, app);
          console.log(JSON.stringify(out, null, 2));
          break;
        }
        if (action === "vault") {
          const { vaultListUsers, vaultListApps, vaultSetApp, vaultDeleteApp, vaultLoad } = await import("../src/connected/vault.mjs");
          const vact = args[3] || "list-users";
          if (vact === "list-users") {
            console.log(JSON.stringify({ users: await vaultListUsers(cfg) }, null, 2));
            break;
          }
          if (vact === "list") {
            const user = args[4] || get("--user") || "default";
            console.log(JSON.stringify({ user, apps: await vaultListApps(cfg, user) }, null, 2));
            break;
          }
          if (vact === "delete") {
            const user = get("--user") || args[4];
            const app = get("--app") || args[5];
            if (!user || !app) {
              console.error("Usage: xclaw auth connected vault delete --user U --app github");
              process.exit(1);
            }
            console.log(JSON.stringify(await vaultDeleteApp(cfg, user, app), null, 2));
            break;
          }
          console.error("Usage: xclaw auth connected vault [list-users|list|delete]");
          process.exit(1);
        }
        console.error("Usage: xclaw auth connected [list|status|login|refresh|logout|vault]");
        process.exit(1);
      }
      // shorthand: xclaw auth login --connected github
      if (sub === "login" && false) {
        /* handled above */
      }
      if (sub === "token") {
        const r = await resolveXaiToken(cfg);
        console.log(JSON.stringify({ hasToken: Boolean(r.token), source: r.source }, null, 2));
        break;
      }
      if (sub === "accounts") {
        const {
          listAccounts,
          linkIdentities,
          linkIdentity,
          unlinkIdentity,
          createAccount,
          normalizeChannelUserId,
          resolveVaultUserId,
        } = await import("../src/connected/account-links.mjs");
        const action = args[2] || "list";
        if (action === "list") {
          console.log(JSON.stringify(await listAccounts(cfg), null, 2));
          break;
        }
        if (action === "normalize") {
          const channel = get("--channel") || args[3];
          const user = get("--user") || args[4];
          console.log(JSON.stringify({
            identity: normalizeChannelUserId({ channel, userId: user }),
            vaultUserId: await resolveVaultUserId(cfg, { channel, userId: user }),
          }, null, 2));
          break;
        }
        if (action === "link") {
          const from = get("--from") || args[3];
          const to = get("--to") || args[4];
          if (!from || !to) {
            console.error("Usage: xclaw auth accounts link --from slack:U01 --to telegram:123");
            process.exit(1);
          }
          const out = await linkIdentities(cfg, from, to);
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        if (action === "unlink") {
          const id = get("--identity") || args[3];
          if (!id) {
            console.error("Usage: xclaw auth accounts unlink slack:U01");
            process.exit(1);
          }
          console.log(JSON.stringify(await unlinkIdentity(cfg, id), null, 2));
          break;
        }
        if (action === "create") {
          const primary = get("--primary") || args[3];
          console.log(JSON.stringify(await createAccount(cfg, { primaryIdentity: primary, label: get("--label") }), null, 2));
          break;
        }
        if (action === "migrate") {
          const { migrateAccountVault } = await import("../src/connected/account-links.mjs");
          const id = get("--account") || args[3];
          if (!id) {
            console.error("Usage: xclaw auth accounts migrate <accountId>");
            console.error("Example: xclaw auth accounts migrate acc_fe213ec004c5daf443b28cc4");
            console.error("Tip:     xclaw auth accounts list   # copy id from accounts[].id");
            process.exit(1);
          }
          const out = await migrateAccountVault(cfg, id);
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        console.error("Usage: xclaw auth accounts [list|link|unlink|create|normalize|migrate]");
        process.exit(1);
      }
      console.error("Usage: xclaw auth [status|login|logout|token|connected]");
      process.exit(1);
      break;
    }
    case "security-audit": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runSecurityAudit } = await import("../src/security/audit.mjs");
      const cfg = await loadConfig();
      const audit = runSecurityAudit(cfg);
      console.log(JSON.stringify(audit, null, 2));
      process.exitCode = audit.ok ? 0 : 2;
      break;
    }
    case "swarm": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { swarmCliMain } = await import("../src/cli/swarm-cli.mjs");
      const cfg = await loadConfig();
      const code = await swarmCliMain(cfg, args.slice(1));
      process.exitCode = code;
      break;
    }
    case "merge": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { mergeCliMain } = await import("../src/cli/swarm-cli.mjs");
      const cfg = await loadConfig();
      const code = await mergeCliMain(cfg, args.slice(1));
      process.exitCode = code;
      break;
    }
    case "sweep-tmp": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { sweepStaleTmp } = await import("../src/ops/tmp-sweeper.mjs");
      const cfg = await loadConfig();
      let dryRun = false, maxAgeMs;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--dry-run") dryRun = true;
        else if (args[i] === "--max-age-h" && args[i + 1]) maxAgeMs = Number(args[++i]) * 3600 * 1000;
      }
      const r = await sweepStaleTmp(cfg, { dryRun, maxAgeMs });
      console.log(JSON.stringify({
        dryRun,
        removed: r.removed.length,
        keptFresh: r.kept,
        skippedReferenced: r.skippedReferenced,
        errors: r.errors,
        sample: r.removed.slice(0, 10),
      }, null, 2));
      break;
    }
    case "browser": {
      // Dedicated UI browser with singleton-lock self-healing (pm2-friendly:
      // runs Chrome in the foreground; exits with its code).
      const { launchDedicatedBrowser } = await import("../src/browser/dedicated.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      let port = 9224, profileDir = null, url = null, display = null, app = true, checkOnly = false, force = false, binary = null;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--port" && args[i + 1]) port = Number(args[++i]);
        else if (args[i] === "--profile" && args[i + 1]) profileDir = args[++i];
        else if (args[i] === "--url" && args[i + 1]) url = args[++i];
        else if (args[i] === "--display" && args[i + 1]) display = args[++i];
        else if (args[i] === "--bin" && args[i + 1]) binary = args[++i];
        else if (args[i] === "--no-app") app = false;
        else if (args[i] === "--check") checkOnly = true;
        else if (args[i] === "--force") force = true;
      }
      if (!url) {
        const gwPort = cfg.gateway?.port || 18790;
        url = `http://127.0.0.1:${gwPort}/control/`;
      }
      const r = await launchDedicatedBrowser({ port, profileDir, url, display, app, checkOnly, force, binary });
      if (!r.ok) {
        console.error(JSON.stringify(r, null, 2));
        process.exit(1);
      }
      if (r.alreadyRunning || checkOnly) {
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      if (r.healed?.length) console.error(`[xclaw:browser] healed stale locks: ${r.healed.join(", ")}`);
      console.error(`[xclaw:browser] ${r.binary} pid=${r.pid} cdp=:${r.port} profile=${r.profileDir}`);
      process.exit((await r.wait()) ?? 0);
    }
    case "lsp": {
      // Language Server Protocol over stdio — editor-agnostic completions
      // backed by the repo-aware completion service. Point any LSP client at
      // `xclaw lsp` (see docs/COMPLETION.md).
      const { runLspStdio } = await import("../src/completion/lsp.mjs");
      runLspStdio();
      // keep the process alive on stdin
      return;
    }
    case "workers": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const wcli = await import("../src/missions/workers-cli.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "list";
      if (sub === "list") {
        const workers = wcli.listWorkers(cfg);
        const pings = await wcli.pingAllWorkers(cfg);
        console.log(JSON.stringify(
          workers.map((w) => ({ ...w, ping: pings.find((p) => p.name === w.name) || null })),
          null, 2
        ));
        break;
      }
      if (sub === "add") {
        const name = args[2];
        const url = args[3];
        let token = null, allowInsecure = false;
        for (let i = 4; i < args.length; i++) {
          if (args[i] === "--token" && args[i + 1]) token = args[++i];
          else if (args[i] === "--allow-insecure") allowInsecure = true;
        }
        if (!name || !url) {
          console.error("Usage: xclaw workers add <name> <url> [--token t] [--allow-insecure]");
          process.exit(1);
        }
        const r = await wcli.addWorkerEntry(cfg, { name, url, token, allowInsecure });
        console.log(JSON.stringify(r, null, 2));
        process.exitCode = r.ok ? 0 : 1;
        break;
      }
      if (sub === "remove") {
        if (!args[2]) { console.error("Usage: xclaw workers remove <name>"); process.exit(1); }
        console.log(JSON.stringify(await wcli.removeWorkerEntry(cfg, args[2]), null, 2));
        break;
      }
      if (sub === "ping") {
        const pings = await wcli.pingAllWorkers(cfg);
        console.log(JSON.stringify(args[2] ? pings.filter((p) => p.name === args[2]) : pings, null, 2));
        break;
      }
      if (sub === "token") {
        const r = await wcli.ensureGatewayToken(cfg);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      if (sub === "join-command") {
        let name = null, publicUrl = null;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--name" && args[i + 1]) name = args[++i];
          else if (args[i] === "--url" && args[i + 1]) publicUrl = args[++i];
        }
        const r = await wcli.buildJoinCommand(cfg, { name, publicUrl });
        console.log(r.command);
        if (r.note) console.error(`note: ${r.note}`);
        if (r.tokenGenerated) console.error("note: gateway token was just generated — restart the gateway to enforce it");
        break;
      }
      console.error("Usage: xclaw workers [list|add|remove|ping|token|join-command]");
      process.exit(1);
      break;
    }
    case "complete": {
      // Repo-aware code completion: prefix on stdin → completion on stdout.
      //   echo -n "function add(" | xclaw complete src/x.js --repo /path [--suffix ")"] [--lang js]
      const { loadConfig } = await import("../src/config/load.mjs");
      const { completeCode } = await import("../src/completion/service.mjs");
      const cfg = await loadConfig();
      let file = null, repoDir = null, suffix = "", language = null;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--repo" && args[i + 1]) { repoDir = args[++i]; continue; }
        if (args[i] === "--suffix" && args[i + 1]) { suffix = args[++i]; continue; }
        if (args[i] === "--lang" && args[i + 1]) { language = args[++i]; continue; }
        if (!file && !args[i].startsWith("--")) file = args[i];
      }
      const prefix = await new Promise((resolve) => {
        let d = "";
        process.stdin.on("data", (c) => (d += c));
        process.stdin.on("end", () => resolve(d));
      });
      if (!prefix.trim()) {
        console.error("Usage: echo -n '<code prefix>' | xclaw complete [file] [--repo dir] [--suffix code] [--lang js]");
        process.exit(1);
      }
      const out = await completeCode(cfg, { prefix, suffix, file, repoDir, language });
      process.stdout.write(out.completion + "\n");
      break;
    }
    case "voice": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        probeLocalVoiceStack,
        localSpeak,
        localTranscribe,
        localThink,
      } = await import("../src/voice/providers/local.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "probe";
      if (sub === "probe" || sub === "status") {
        console.log(JSON.stringify(await probeLocalVoiceStack(cfg), null, 2));
        break;
      }
      if (sub === "speak") {
        const text = args.slice(2).join(" ").trim() || "Hello from XClaw.";
        const out = await localSpeak(text, cfg);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      if (sub === "transcribe" || sub === "stt") {
        const file = args[2];
        if (!file) {
          console.error("Usage: xclaw voice transcribe <audio.wav|ogg|mp3>");
          process.exit(1);
        }
        const out = await localTranscribe(file, cfg);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      if (sub === "once") {
        const prompt = args.slice(2).join(" ").trim() || "Say a short greeting.";
        const thought = await localThink(prompt, cfg, { history: [] });
        const spoken = thought.text ? await localSpeak(thought.text, cfg) : { ok: false };
        console.log(JSON.stringify({ thought, spoken }, null, 2));
        break;
      }
      if (sub === "tui") {
        const { runVoiceTui } = await import("../src/voice/tui-session.mjs");
        await runVoiceTui(cfg, { args: args.slice(2) });
        break;
      }
      if (sub === "metrics") {
        const {
          voiceMetricsSnapshot,
          resetVoiceMetrics,
          voiceMetricsReport,
        } = await import("../src/voice/metrics.mjs");
        if (args[2] === "reset") {
          resetVoiceMetrics();
          console.log(JSON.stringify({ ok: true, reset: true }));
          break;
        }
        if (args.includes("--chart") || args[2] === "chart") {
          console.log(voiceMetricsReport());
          break;
        }
        console.log(JSON.stringify(voiceMetricsSnapshot(), null, 2));
        break;
      }
      if (sub === "webrtc") {
        const { probeWebRtc } = await import("../src/voice/webrtc-session.mjs");
        console.log(JSON.stringify(await probeWebRtc(), null, 2));
        break;
      }
      if (sub === "opus") {
        const { probeOpusDecode } = await import("../src/voice/opus-decode.mjs");
        const { probeOpusEncode } = await import("../src/voice/opus-encode.mjs");
        console.log(JSON.stringify({
          decode: await probeOpusDecode(),
          encode: await probeOpusEncode(),
        }, null, 2));
        break;
      }
      if (sub === "vad") {
        const { probeVad, recordUntilEndpoint } = await import("../src/voice/vad.mjs");
        if (args[2] === "once") {
          const out = await recordUntilEndpoint({
            cfg,
            maxMs: Number(args[3]) || 5000,
          });
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.ok ? 0 : 1;
          break;
        }
        console.log(JSON.stringify(probeVad(cfg), null, 2));
        break;
      }
      if (sub === "listen") {
        const { runVoiceListen } = await import("../src/voice/wake/listen.mjs");
        const noSpeak = args.includes("--no-speak");
        const noAgent = args.includes("--no-agent");
        await runVoiceListen(cfg, {
          speak: !noSpeak,
          agent: !noAgent,
        });
        break;
      }
      if (sub === "wake-probe" || sub === "wake") {
        const {
          probeWakeStack,
          probeWakeOnce,
          probeOpenWakeWordOnce,
        } = await import("../src/voice/wake/index.mjs");
        if (args[2] === "once" || args[2] === "--once") {
          const out = await probeWakeOnce(cfg, {
            forceStt: args.includes("--force-stt"),
          });
          console.log(JSON.stringify(out, null, 2));
          process.exitCode = out.hit ? 0 : 1;
          break;
        }
        if (args[2] === "openwakeword" || args[2] === "oww") {
          console.log(JSON.stringify(await probeOpenWakeWordOnce(), null, 2));
          break;
        }
        const stack = await probeWakeStack(cfg);
        console.log(JSON.stringify(stack, null, 2));
        break;
      }
      console.error("Usage: xclaw voice probe|speak|transcribe|once|tui|listen|wake-probe|vad|metrics|opus|webrtc");
      process.exit(1);
      break;
    }
    case "doctor": {
      // Phase 7.4: prefer lightweight CLI doctor; fall back to gateway doctor
      const wantJson = args.includes("--json") || args.includes("-j");
      const full = args.includes("--full");
      if (!full) {
        const { doctorMain } = await import("../src/cli/doctor.mjs");
        await doctorMain(args.slice(1));
        break;
      }
      const { loadConfig } = await import("../src/config/load.mjs");
      const { createChannelManager } = await import("../src/channels/manager.mjs");
      const { isComputerRunning } = await import("../src/computer/manager.mjs");
      const { buildDoctorReport, formatDoctorReport } = await import("../src/gateway/doctor.mjs");
      const cfg = await loadConfig();
      const channelManager = createChannelManager(cfg);
      const report = await buildDoctorReport({ cfg, channelManager, isComputerRunning });
      if (wantJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDoctorReport(report));
      }
      process.exit(report.ok ? 0 : 1);
      break;
    }
    case "self-test": {
      const tests = [];
      const check = async (name, fn) => {
        try {
          const r = await fn();
          tests.push({ name, ok: true, ...(r && typeof r === "object" ? r : {}) });
        } catch (err) {
          tests.push({ name, ok: false, error: err.message });
        }
      };
      const { parseFrontMatter, isSkillEnabled } = await import("../src/skills/loader.mjs");
      const { createRateLimiter } = await import("../src/channels/rate-limit.mjs");
      const { createPairingStore } = await import("../src/pairing/pairing-store.mjs");
      const { resolveProviderRoute } = await import("../src/providers/router.mjs");
      const { createLoopGuard } = await import("../src/agent/loop-guards.mjs");
      const { computeNextRun } = await import("../src/cron/schedule.mjs");
      const { buildSessionKey, parseSessionKey } = await import("../src/sessions/session-key.mjs");
      await check("front-matter", () => {
        const { meta } = parseFrontMatter("---\nname: t\npriority: 1\n---\nbody");
        if (meta.name !== "t") throw new Error("meta");
      });
      await check("rate-limit", () => {
        const rl = createRateLimiter({ max: 1, windowMs: 5000 });
        if (!rl.allow("a").ok || rl.allow("a").ok) throw new Error("rl");
      });
      await check("pairing", () => {
        const store = createPairingStore({ storePath: "/tmp/xclaw-selftest-pair.json" });
        const u = store.upsertPairingRequest({ channel: "telegram", id: "1" });
        if (!u.code) throw new Error("code");
      });
      await check("provider-route", () => {
        const r = resolveProviderRoute({}, { model: "grok-3" });
        if (r.provider !== "xai") throw new Error(r.provider);
      });
      await check("loop-guard", () => {
        const g = createLoopGuard({ warningThreshold: 2, criticalThreshold: 5 });
        g.record("t", { x: 1 }, "a");
        g.record("t", { x: 1 }, "a");
        const d = g.detect("t", { x: 1 });
        if (!d.stuck) throw new Error("expected stuck");
      });
      await check("cron-schedule", () => {
        const n = computeNextRun({ kind: "every", everyMs: 1000 }, 0);
        if (n !== 1000) throw new Error(String(n));
      });
      await check("session-key", () => {
        const k = buildSessionKey({ channel: "telegram", peerKind: "dm", peerId: "9" });
        if (parseSessionKey(k).peerId !== "9") throw new Error(k);
      });
      // Arc: autonomy / prod / sandbox / fabric
      await check("autonomy-level", async () => {
        const { resolveAutonomyLevel, applyAutonomyLevel } = await import("../src/config/autonomy-policy.mjs");
        const prev = process.env.XCLAW_AUTONOMY_LEVEL;
        delete process.env.XCLAW_AUTONOMY_LEVEL;
        if (resolveAutonomyLevel({ profile: "prod" }) !== "supervised") throw new Error("prod infer");
        const full = applyAutonomyLevel({ autonomy: { level: "full" } });
        if (!full.autonomy.heartbeat?.enabled) throw new Error("full heartbeat");
        if (prev != null) process.env.XCLAW_AUTONOMY_LEVEL = prev;
        else delete process.env.XCLAW_AUTONOMY_LEVEL;
      });
      await check("prod-hardening", async () => {
        const { enforceProdHardening } = await import("../src/config/load.mjs");
        const prev = process.env.XCLAW_ALLOW_PROD_AUTO;
        delete process.env.XCLAW_ALLOW_PROD_AUTO;
        delete process.env.XCLAW_AUTONOMY_LEVEL;
        const cfg = enforceProdHardening({
          profile: "prod",
          security: { autoApprove: true, approvalPolicy: "never" },
          autonomy: { level: "full" },
          swarm: { autoMerge: true },
        });
        if (cfg.security.autoApprove !== false) throw new Error("autoApprove");
        if (cfg.swarm.autoMerge !== false) throw new Error("autoMerge");
        if (cfg.autonomy.level !== "supervised") throw new Error("level");
        if (prev != null) process.env.XCLAW_ALLOW_PROD_AUTO = prev;
      });
      await check("sandbox-tmp-allow", async () => {
        const { getSandboxPolicy, resolveSandboxPath } = await import("../src/security/sandbox.mjs");
        const policy = getSandboxPolicy({ sandbox: { enabled: true, allowPaths: ["/tmp"] } }, "/tmp/xclaw-sub-x");
        const abs = resolveSandboxPath(policy, "/tmp/xclaw-swarm-proof.txt");
        if (abs !== "/tmp/xclaw-swarm-proof.txt") throw new Error(abs);
      });
      await check("commit-sensitive", async () => {
        const { isCommitSensitive } = await import("../src/browser/physics.mjs");
        if (!isCommitSensitive("https://pay.example.com/checkout")) throw new Error("checkout");
        if (isCommitSensitive("https://example.com/about")) throw new Error("about");
      });
      await check("skill-install-gate", async () => {
        const { canInstallSkills } = await import("../src/skills/propose.mjs");
        if (canInstallSkills({ profile: "lab" }).ok !== true) throw new Error("lab");
        if (canInstallSkills({ profile: "prod" }).ok !== false) throw new Error("prod should block");
        if (canInstallSkills({ profile: "prod" }, { ownerApproved: true }).ok !== true) throw new Error("owner");
      });
      await check("host-compat", async () => {
        const { hostPasses } = await import("../src/runtime/host-probe.mjs");
        if (!hostPasses("24.15.0")) throw new Error("24.15.0 should pass");
        if (hostPasses("23.11.0")) throw new Error("23.x should be refused");
        if (hostPasses("24.14.1")) throw new Error("24.14.1 below floor should be refused");
      });
      const failed = tests.filter((x) => !x.ok);
      console.log(JSON.stringify({ ok: failed.length === 0, tests }, null, 2));
      process.exit(failed.length ? 1 : 0);
      break;
    }

    case "mcp": {
      const rest = args.slice(1); // args[0] is "mcp" itself
      const sub = rest[0];
      // bare `xclaw mcp` / `xclaw mcp serve` = stdio MCP server (back-compat:
      // external clients wire this as their server command).
      if (!sub || sub === "serve") {
        const { runMcpStdio } = await import("../src/mcp/stdio.mjs");
        const { loadConfig } = await import("../src/config/load.mjs");
        await runMcpStdio({ cfg: await loadConfig() });
        break;
      }
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const manage = await import("../src/mcp/manage.mjs");
      const flag = (n) => {
        const i = rest.indexOf(`--${n}`);
        return i >= 0 ? rest[i + 1] : undefined;
      };
      if (sub === "list") {
        console.log(JSON.stringify({ servers: manage.listMcpServers(cfg) }, null, 2));
        break;
      }
      if (sub === "add") {
        const name = rest[1];
        const def = {
          name,
          url: flag("url"),
          command: flag("command"),
          args: flag("args") ? flag("args").split(" ") : undefined,
          apiKey: flag("api-key"),
          allowTools: flag("allow") ? flag("allow").split(",") : undefined,
          denyTools: flag("deny") ? flag("deny").split(",") : undefined,
        };
        const out = await manage.addMcpServer(cfg, def, { replace: rest.includes("--replace") });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      if (sub === "remove") {
        console.log(JSON.stringify(await manage.removeMcpServer(cfg, rest[1]), null, 2));
        break;
      }
      if (sub === "test") {
        const out = await manage.testMcpServer(cfg, rest[1]);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      if (sub === "login") {
        // OAuth runs through the gateway (it hosts the browser callback).
        const name = rest[1];
        const base = `http://${cfg.gateway?.host || "127.0.0.1"}:${cfg.gateway?.port || 8790}`;
        const headers = {
          "Content-Type": "application/json",
          ...(cfg.gateway?.token ? { "x-xclaw-token": cfg.gateway.token } : {}),
        };
        const start = await fetch(`${base}/mcp/oauth/start`, {
          method: "POST",
          headers,
          body: JSON.stringify({ server: name }),
        }).then((r) => r.json());
        if (!start.ok) {
          console.error("login start failed:", start.error);
          process.exitCode = 1;
          break;
        }
        console.log(`Open this URL, sign in, approve access:\n\n  ${start.authorizeUrl}\n`);
        console.log("Waiting for the callback to land on the gateway…");
        const until = Date.now() + 5 * 60_000;
        let granted = false;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 2000));
          const st = await fetch(`${base}/mcp/oauth/status`, { headers })
            .then((r) => r.json())
            .catch(() => ({ grants: [] }));
          if (st.grants?.some((g) => g.server === name)) {
            granted = true;
            break;
          }
        }
        console.log(granted ? `authorized: ${name}` : "timed out waiting for authorization");
        process.exitCode = granted ? 0 : 1;
        break;
      }
      if (sub === "logout") {
        const { dropMcpGrant } = await import("../src/mcp/oauth.mjs");
        dropMcpGrant(cfg, rest[1]);
        console.log(JSON.stringify({ ok: true }));
        break;
      }
      console.log(
        "usage: xclaw mcp [serve|list|add <name> --url <u>|--command <c> [--api-key k] [--allow a,b] [--deny x] [--replace]|remove <name>|test <name>|login <name>|logout <name>]"
      );
      break;
    }

    case "pairing": {
      const { createPairingStore } = await import("../src/pairing/pairing-store.mjs");
      const store = createPairingStore({});
      const sub = args[1];
      if (sub === "list") {
        const ch = args[2] || "telegram";
        console.log(JSON.stringify({ approved: store.listApproved(ch), pending: store.listPending(ch) }, null, 2));
        break;
      }
      if (sub === "approve") {
        const ch = args[2];
        const code = args[3];
        if (!ch || !code) {
          console.error("Usage: xclaw pairing approve <channel> <code>");
          process.exit(1);
        }
        console.log(JSON.stringify(store.approve(ch, code), null, 2));
        break;
      }
      if (sub === "revoke") {
        const ch = args[2];
        const id = args[3];
        console.log(JSON.stringify(store.revoke(ch, id), null, 2));
        break;
      }
      console.error("Usage: xclaw pairing <list|approve|revoke> ...");
      process.exit(1);
      break;
    }

    case "supervisor": {
      const { spawn } = await import("node:child_process");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const home = process.env.HOME || os.homedir();
      const script = path.join(root, "scripts/gateway-supervisor.mjs");
      const sub = args[1] || "start";
      const superPid = path.join(home, ".xclaw", "supervisor.pid");
      if (sub === "stop") {
        try {
          const pid = Number(fs.readFileSync(superPid, "utf8").trim());
          process.kill(pid, "SIGTERM");
          fs.unlinkSync(superPid);
          console.log(JSON.stringify({ ok: true, stopped: pid }));
        } catch (e) {
          console.log(JSON.stringify({ ok: false, error: e.message }));
        }
        break;
      }
      if (sub === "status") {
        let pid = null, alive = false;
        try {
          pid = Number(fs.readFileSync(superPid, "utf8").trim());
          process.kill(pid, 0);
          alive = true;
        } catch {}
        console.log(JSON.stringify({ pid, alive, pidPath: superPid }));
        break;
      }
      // start (foreground if --fg, else detach)
      if (args.includes("--fg")) {
        const { pathToFileURL } = await import("node:url");
        await import(pathToFileURL(script).href);
        break;
      }
      fs.mkdirSync(path.dirname(superPid), { recursive: true });
      const log = path.join(home, ".xclaw", "supervisor.log");
      const out = fs.openSync(log, "a");
      const child = spawn(process.execPath, [script], {
        cwd: root,
        env: process.env,
        detached: true,
        stdio: ["ignore", out, out],
      });
      child.unref();
      fs.writeFileSync(superPid, String(child.pid));
      console.log(JSON.stringify({ ok: true, pid: child.pid, log }));
      break;
    }

    case "daemon": {
      const sub = args[1] || "status";
      const { startDaemon, stopDaemon, daemonStatus, systemdUnit } = await import("../src/cli/daemon.mjs");
      const home = process.env.HOME || "/tmp";
      const pidPath = process.env.XCLAW_PID_PATH || `${home}/.xclaw/gateway.pid`;
      const logPath = process.env.XCLAW_LOG_PATH || `${home}/.xclaw/gateway.log`;
      if (sub === "start") {
        // Gate B: refuse to daemonize a long-lived gateway on a WAL-unsafe host.
        const { inspectNodeBinary, formatHostRefusal } = await import("../src/runtime/host-probe.mjs");
        const probed = await inspectNodeBinary(process.execPath);
        if (!probed.ok) {
          console.error(formatHostRefusal(probed));
          process.exit(1);
        }
        const r = startDaemon({
          cmd: process.execPath,
          args: [path.join(root, "bin/xclaw.mjs"), "gateway"],
          pidPath,
          logPath,
          cwd: root,
        });
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.ok ? 0 : 1);
      }
      if (sub === "stop") {
        console.log(JSON.stringify(stopDaemon(pidPath), null, 2));
        break;
      }
      if (sub === "status") {
        console.log(JSON.stringify(daemonStatus(pidPath), null, 2));
        break;
      }
      if (sub === "unit") {
        process.stdout.write(
          systemdUnit({
            workdir: root,
            programArguments: [process.execPath, path.join(root, "bin/xclaw.mjs"), "gateway"],
          })
        );
        break;
      }
      console.error("Usage: xclaw daemon <start|stop|status|unit>");
      process.exit(1);
      break;
    }

    case "computer": {
      const sub = args[1];
      const {
        startComputer,
        stopComputer,
        restartComputer,
        getComputerStatus,
        isComputerRunning,
      } = await import("../src/computer/manager.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      if (!sub || sub === "start" || sub.startsWith("-")) {
        const fg = !args.includes("--bg");
        await startComputer({ root, foreground: fg });
        break;
      }
      if (sub === "status") {
        const cfg = await loadConfig();
        const st = await getComputerStatus(cfg);
        if (args.includes("--json")) console.log(JSON.stringify(st, null, 2));
        else {
          console.log(`Computer: ${st.healthy ? "UP" : "DOWN"}  ${st.url}`);
          console.log(`  pid: ${st.pid ?? "—"} alive=${st.pidAlive} inProcess=${st.inProcess}`);
          console.log(`  log: ${st.logPath}`);
          if (st.meta?.startedAt) console.log(`  started: ${st.meta.startedAt}`);
          if (st.health?.error) console.log(`  probe: ${st.health.error}`);
        }
        process.exitCode = st.healthy ? 0 : 1;
        break;
      }
      if (sub === "stop") {
        const cfg = await loadConfig();
        console.log(JSON.stringify(await stopComputer(cfg), null, 2));
        break;
      }
      if (sub === "restart") {
        const r = await restartComputer({ root });
        console.log(JSON.stringify({ ok: true, pid: r.pid, url: r.url }, null, 2));
        break;
      }
      if (sub === "log") {
        const cfg = await loadConfig();
        const { computerLogPath } = await import("../src/computer/manager.mjs");
        const fs = await import("node:fs");
        const lp = computerLogPath(cfg);
        if (!fs.existsSync(lp)) {
          console.error("no log at", lp);
          process.exitCode = 1;
          break;
        }
        const n = Number(args[2]) || 80;
        const lines = fs.readFileSync(lp, "utf8").trim().split("\n");
        console.log(lines.slice(-n).join("\n"));
        break;
      }
      console.error("Usage: xclaw computer [start|status|stop|restart|log] [--bg] [--json]");
      process.exit(1);
      break;
    }
    case "automations":
    case "automation":
    case "tasks": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const auto = await import("../src/automations/index.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "list";
      const json = args.includes("--json");
      if (sub === "list") {
        const rows = auto.listAutomations(cfg);
        console.log(json ? JSON.stringify(rows, null, 2) : rows.map(a => `${a.enabled ? "ON " : "OFF"} ${a.id.slice(0,8)}  ${a.name}  last=${a.lastStatus || "—"}`).join("\n") || "(none)");
        break;
      }
      if (sub === "add") {
        // xclaw automations add --every 3600000 --name n [--goal [--max-ticks N]] -- prompt words...
        let everyMs, cron, at, name, enabled = true, mode = "prompt", maxTicks;
        const rest = [];
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--every" && args[i+1]) { everyMs = Number(args[++i]); continue; }
          if (args[i] === "--cron" && args[i+1]) { cron = args[++i]; continue; }
          if (args[i] === "--at" && args[i+1]) { at = args[++i]; continue; }
          if (args[i] === "--name" && args[i+1]) { name = args[++i]; continue; }
          if (args[i] === "--disabled") { enabled = false; continue; }
          if (args[i] === "--goal") { mode = "goal"; continue; }
          if (args[i] === "--max-ticks" && args[i+1]) { maxTicks = Number(args[++i]); continue; }
          if (args[i] === "--") { rest.push(...args.slice(i+1)); break; }
          rest.push(args[i]);
        }
        const prompt = rest.join(" ").trim();
        if (!prompt) {
          console.error("Usage: xclaw automations add [--every ms|--cron expr|--at ISO] [--name n] [--goal [--max-ticks N]] <prompt-or-goal>");
          process.exitCode = 1;
          break;
        }
        const r = auto.createAutomation(cfg, { prompt, goal: mode === "goal" ? prompt : undefined, mode, maxTicks, everyMs, cron, at, name, enabled });
        console.log(JSON.stringify(r, null, 2));
        process.exitCode = r.ok ? 0 : 1;
        break;
      }
      if (sub === "pause" || sub === "resume") {
        const id = args[2];
        if (!id) { console.error("Usage: xclaw automations pause|resume <id>"); process.exitCode = 1; break; }
        const r = auto.setEnabled(cfg, id, sub === "resume");
        console.log(JSON.stringify(r, null, 2));
        process.exitCode = r.ok ? 0 : 1;
        break;
      }
      if (sub === "delete" || sub === "rm") {
        const r = auto.deleteAutomation(cfg, args[2]);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      if (sub === "run") {
        const r = await auto.executeAutomation(cfg, args[2], { mode: "manual" });
        console.log(JSON.stringify(r, null, 2));
        process.exitCode = r.ok ? 0 : 1;
        break;
      }
      if (sub === "results") {
        const rows = auto.listResults(cfg, { automationId: args[2] || null, limit: Number(args[3] || 10) });
        console.log(JSON.stringify(rows, null, 2));
        break;
      }
      if (sub === "hydrate") {
        console.log(JSON.stringify(auto.hydrateAutomations(cfg), null, 2));
        break;
      }
      console.error("Usage: xclaw automations <list|add|pause|resume|run|results|delete|hydrate>");
      process.exitCode = 1;
      break;
    }

    case "stop":
    case "stop-sign": {
      // xclaw stop --sign | xclaw stop-sign  → mint X-XClaw-Stop-Sig
      const rest = args.slice(1);
      if (rest.includes("--help") || rest.includes("-h")) {
        const { printStopHelp } = await import("../src/cli/stop-help.mjs");
        printStopHelp();
        break;
      }
      if (cmd === "stop-sign" || rest.includes("--sign") || rest[0] === "sign") {
        const { stopSignMain } = await import("../src/cli/stop-sign.mjs");
        const cleaned = rest.filter((a) => a !== "--sign" && a !== "sign");
        await stopSignMain(cleaned);
        break;
      }
      // default: same as stop-all for convenience
      const { loadConfig } = await import("../src/config/load.mjs");
      const { killAll, listActiveSessions } = await import("../src/agent/session-control.mjs");
      const cfg = await loadConfig();
      const before = listActiveSessions();
      const r = await killAll({ stopComputer: !rest.includes("--keep-computer"), cfg });
      console.log(JSON.stringify({ ...r, before }, null, 2));
      break;
    }
    case "stop-all":
    case "kill-all": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { killAll, listActiveSessions } = await import("../src/agent/session-control.mjs");
      const cfg = await loadConfig();
      const before = listActiveSessions();
      const r = await killAll({ stopComputer: !args.includes("--keep-computer"), cfg });
      console.log(JSON.stringify({ ...r, before }, null, 2));
      break;
    }
    case "sessions-active": {
      const { listActiveSessions } = await import("../src/agent/session-control.mjs");
      console.log(JSON.stringify({ sessions: listActiveSessions() }, null, 2));
      break;
    }

    case "run": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runStreamCli } = await import("../src/cli/stream-run.mjs");
      const cfg = await loadConfig();
      const code = await runStreamCli(cfg, args.slice(1));
      process.exitCode = code;
      break;
    }
    case "self-deploy": {
      const { readIntent, runDeployOnce, runDeployWatch } = await import("../src/self/deploy.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "status";
      if (sub === "status") {
        const intent = await readIntent(cfg);
        console.log(JSON.stringify(intent || { state: "none" }, null, 2));
        break;
      }
      if (sub === "run-once") {
        const out = await runDeployOnce(cfg);
        console.log(out ? `resolved: ${out.state}` : "nothing pending");
        break;
      }
      if (sub === "watch") {
        console.log(`[xclaw] self-deploy watcher — intent file: ${(await import("../src/self/deploy.mjs")).deployIntentPath(cfg)}`);
        await runDeployWatch(cfg, {});
        break;
      }
      console.error("Usage: xclaw self-deploy status | run-once | watch");
      process.exitCode = 1;
      break;
    }
    case "timeline": {
      const tl = await import("../src/git/timeline.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const flag = (name, dflt = null) => {
        const i = args.indexOf(`--${name}`);
        return i >= 0 ? args[i + 1] : dflt;
      };
      const repo = flag("repo", process.cwd());
      const sub = args[1] || "list";
      if (sub === "list") {
        const { ok, states, error } = await tl.listStates(repo);
        if (!ok) {
          console.error(`timeline: ${error}`);
          process.exitCode = 1;
          break;
        }
        if (!states.length) console.log("(no xclaw states — merges before v3.116 carry no refs)");
        for (const s of states) {
          const kind = s.missionId ? `mission ${s.missionId}` : `known-good ${s.knownGood}`;
          console.log(`${s.date}  ${s.sha.slice(0, 10)}  ${kind}  ${s.subject}`);
        }
        break;
      }
      if (sub === "diff") {
        const [a, b] = [args[2], args[3]];
        if (!a || !b) {
          console.error("Usage: xclaw timeline diff <refA> <refB> [--patch] [--repo dir]");
          process.exitCode = 1;
          break;
        }
        const out = await tl.diffStates(repo, a, b, { patch: args.includes("--patch") });
        if (!out.ok) {
          console.error(`timeline diff: ${out.error}`);
          process.exitCode = 1;
          break;
        }
        console.log(out.diff || "(no differences)");
        break;
      }
      if (sub === "revert") {
        const missionId = args[2];
        if (!missionId) {
          console.error("Usage: xclaw timeline revert <missionId> [--repo dir]");
          process.exitCode = 1;
          break;
        }
        const out = await tl.revertMission(repo, missionId);
        if (!out.ok) {
          console.error(`revert: ${out.error}`);
          process.exitCode = 1;
          break;
        }
        console.log(`reverted ${out.reverted.slice(0, 10)} → revert commit ${out.revertCommit.slice(0, 10)}`);
        // honest scope: surface effects git cannot undo (ledger join)
        try {
          const { queryLedger } = await import("../src/ops/ledger.mjs");
          const { events } = await queryLedger(cfg, { missionId, kind: "tool", since: "90d", limit: 1000 });
          const outside = new Set();
          for (const e of events) {
            for (const eff of e.data?.effects || []) {
              if (!["files", "repo", "workspace"].includes(eff)) outside.add(eff);
            }
          }
          if (outside.size) {
            console.log(`note: mission also had non-git effects git revert cannot undo: ${[...outside].join(", ")}`);
          }
        } catch {}
        break;
      }
      if (sub === "known-good" || sub === "mark") {
        const out = await tl.markKnownGood(repo, { sha: args[2] || "HEAD", note: flag("note", "") });
        console.log(out.ok ? `marked ${out.sha.slice(0, 10)} known-good (${out.ref})` : `failed: ${out.error}`);
        if (!out.ok) process.exitCode = 1;
        break;
      }
      if (sub === "attribute" || sub === "who") {
        const target = args[2];
        if (!target) {
          console.error("Usage: xclaw timeline attribute <path> [--repo dir]");
          process.exitCode = 1;
          break;
        }
        const out = await tl.attribute(repo, target);
        for (const c of out.commits || []) {
          console.log(`${c.date}  ${c.sha.slice(0, 10)}  ${c.missionId || "(no mission)"}  ${c.subject}`);
        }
        break;
      }
      console.error("Usage: xclaw timeline list | diff <a> <b> | revert <missionId> | known-good [sha] | attribute <path>  [--repo dir]");
      process.exitCode = 1;
      break;
    }
    case "ledger": {
      const { queryLedger, ledgerStats, whoTouched, compactLedger } = await import("../src/ops/ledger.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "tail";
      const flag = (name, dflt = null) => {
        const i = args.indexOf(`--${name}`);
        return i >= 0 ? args[i + 1] : dflt;
      };
      if (sub === "tail" || sub === "query") {
        const filters = {
          kind: flag("kind"),
          since: flag("since", sub === "tail" ? "1d" : "7d"),
          status: flag("status"),
          artifact: flag("artifact"),
          limit: Number(flag("limit", sub === "tail" ? 30 : 200)),
          sessionId: flag("session"),
          jobId: flag("job"),
          missionId: flag("mission"),
          swarmId: flag("swarm"),
          runId: flag("run"),
        };
        for (const k of Object.keys(filters)) if (filters[k] == null) delete filters[k];
        const { events, malformed } = await queryLedger(cfg, filters);
        for (const e of events) {
          const ids = Object.entries(e.ids || {}).map(([k, v]) => `${k}=${v}`).join(" ");
          const d = e.data || {};
          const summary =
            e.kind === "tool"
              ? `${d.name} ${d.status || ""} ${d.policy ? `[${d.policy.phase}:${d.policy.decision}]` : ""}`
              : e.kind === "policy"
                ? `${d.tool || ""} ${d.decision} (${d.mode})`
                : e.kind === "verify"
                  ? `${d.ok ? "PASS" : "FAIL"} attempt ${d.attempt}`
                  : e.kind === "merge"
                    ? `${(d.files || []).length} files`
                    : JSON.stringify(d).slice(0, 100);
          console.log(`${e.ts} ${e.kind.padEnd(8)} ${summary.trim()}  ${ids}`);
        }
        if (malformed) console.error(`(${malformed} malformed lines skipped)`);
        break;
      }
      if (sub === "who-touched") {
        const target = args[2];
        if (!target) {
          console.error("Usage: xclaw ledger who-touched <path> [--since 30d]");
          process.exitCode = 1;
          break;
        }
        const hits = await whoTouched(cfg, target, { since: flag("since", "30d") });
        console.log(JSON.stringify({ path: target, hits }, null, 2));
        break;
      }
      if (sub === "stats") {
        console.log(JSON.stringify(await ledgerStats(cfg), null, 2));
        break;
      }
      if (sub === "compact") {
        const out = await compactLedger(cfg, { keepDays: flag("keep-days") });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      console.error("Usage: xclaw ledger tail|query [--kind k] [--since 2d] [--mission id] [--session id] [--status fail] | who-touched <path> | stats | compact [--keep-days N]");
      process.exitCode = 1;
      break;
    }
    case "transcripts":
    case "transcript": {
      const { listTranscripts, loadTranscriptHistory, transcriptPath } = await import("../src/sessions/transcript.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "list";
      if (sub === "list") {
        const items = listTranscripts(cfg);
        console.log(JSON.stringify({ count: items.length, transcripts: items }, null, 2));
        break;
      }
      if (sub === "show" || sub === "get") {
        const id = args[2];
        if (!id) {
          console.error("Usage: xclaw transcripts show <sessionId>");
          process.exitCode = 1;
          break;
        }
        const history = loadTranscriptHistory(cfg, id, Number(args[3] || 50));
        console.log(JSON.stringify({ sessionId: id, path: transcriptPath(cfg, id), count: history.length, history }, null, 2));
        break;
      }
      console.error("Usage: xclaw transcripts list | show <sessionId>");
      process.exitCode = 1;
      break;
    }

    case "memory": {
      const { previewProjectMemory } = await import("../src/skills/loader.mjs");
      const cwd = process.cwd();
      const sub = args[1] || "show";
      if (sub === "show" || sub === "preview") {
        const prev = await previewProjectMemory(cwd);
        console.log("XClaw project memory (auto-injected when memory.enabled !== false)");
        console.log("cwd:", cwd);
        if (!prev.files.length) {
          console.log("(none) — add XCLAW.md or AGENTS.md at repo root");
          process.exitCode = 0;
          break;
        }
        for (const f of prev.files) {
          console.log(`- ${f.name}: ${f.path} (${f.body.length} chars)`);
        }
        console.log("\n--- injected section ---\n");
        console.log(prev.sections || "(empty)");
        break;
      }
      console.error("Usage: xclaw memory show");
      process.exitCode = 1;
      break;
    }

    case "agent": {
      // xclaw agent [--session <id>] <message>
      let sessionId = null;
      const msgParts = [];
      for (let i = 1; i < args.length; i++) {
        if ((args[i] === "--session" || args[i] === "--session-id") && args[i + 1]) {
          sessionId = args[++i];
        } else {
          msgParts.push(args[i]);
        }
      }
      const message = msgParts.join(" ").trim();
      if (!message) {
        console.error("Usage: xclaw agent [--session <id>] <message>");
        process.exit(1);
      }
      const { loadConfig } = await import("../src/config/load.mjs");
      const { isComputerRunning, startComputer } = await import("../src/computer/manager.mjs");
      const { runAgentLoop } = await import("../src/agent/loop.mjs");
      const cfg = await loadConfig();
      if (!(await isComputerRunning(cfg))) {
        console.log("[xclaw] Starting Computer…");
        await startComputer({ root, foreground: false });
      }
      console.log(`[xclaw] Agent model: ${cfg.agent?.model || "gpt-4o-mini"}`);
      // Sticky cache: default a session id so multi-invocation CLIs can share
      // via --session; auto-generate when unset (single-run still warms within loop).
      if (!sessionId && cfg.tokens?.autoSession !== false) {
        sessionId = `cli-${Date.now().toString(36)}`;
      }
      if (sessionId) console.log(`[xclaw] session: ${sessionId}`);
      const result = await runAgentLoop({
        userMessage: message,
        cfg,
        chatSessionId: sessionId || null,
        onEvent: (e) => {
          if (e.type === "tool" && e.phase === "start") {
            console.log(`  → tool ${e.name}`, JSON.stringify(e.args || {}).slice(0, 100));
          } else if (e.type === "tool" && e.phase === "end") {
            console.log(`  ← ${e.preview?.slice(0, 120) || "ok"}`);
          } else if (e.type === "guard") {
            console.log(`  ! guard [${e.level}] ${e.message}`);
          } else if (e.type === "lifecycle" && e.phase === "start") {
            console.log("  … running");
          } else if (e.type === "cache" && e.phase === "turn_hit_rate") {
            console.log(`  · cache hit ${e.cacheHitRatePct}% (cached=${e.cachedTokens}/${e.promptTokens})`);
          }
        },
      });
      console.log("\n---\n" + result.text);
      const u = result.usage;
      let usageLine = "";
      if (u?.hasRealUsage) {
        usageLine = ` · tokens in=${u.promptTokens} out=${u.completionTokens} total=${u.totalTokens}`;
        if (u.hasCost) usageLine += ` · ${u.costUsdFormatted || ("$" + u.costUsd)}`;
      } else if (u?.estimatedPromptTokens != null) {
        usageLine = ` · ~promptTokens=${u.estimatedPromptTokens} (${u.mode})`;
      }
      console.log(`\n[${result.turns} turns, model=${result.model}${usageLine}]`);
      break;
    }
    case "soak": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { getSoakSummary, rebuildSoakSummary } = await import("../src/eval/soak.mjs");
      const cfg = await loadConfig();
      if (args[1] === "rebuild") {
        console.log(JSON.stringify(await rebuildSoakSummary(cfg), null, 2));
        break;
      }
      const s = await getSoakSummary(cfg);
      console.log(JSON.stringify(s, null, 2));
      process.exitCode = s.gate?.nightsOk && s.flakeBudgetOk !== false ? 0 : 0; // informational
      break;
    }
    case "quarantine": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { listQuarantined } = await import("../src/eval/quarantine.mjs");
      const cfg = await loadConfig();
      console.log(JSON.stringify({ quarantined: await listQuarantined(cfg) }, null, 2));
      break;
    }
    case "fire-drill": {
      const { spawn } = await import("node:child_process");
      const script = path.join(root, "scripts/fire-drill.mjs");
      const code = await new Promise((resolve) => {
        const c = spawn(process.execPath, [script, args[1] || "all"].filter(Boolean), {
          stdio: "inherit",
          env: process.env,
          cwd: root,
        });
        c.on("exit", (code) => resolve(code ?? 1));
      });
      process.exitCode = code;
      break;
    }
    case "sandbox-redteam": {
      const { spawn } = await import("node:child_process");
      const code = await new Promise((resolve) => {
        const c = spawn(process.execPath, [path.join(root, "scripts/sandbox-redteam.mjs")], {
          stdio: "inherit",
          cwd: root,
        });
        c.on("exit", (cde) => resolve(cde ?? 1));
      });
      process.exitCode = code;
      break;
    }
    case "computer-proxy": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { startComputerAuthProxy } = await import("../src/computer/auth-proxy.mjs");
      const cfg = await loadConfig();
      if (!cfg.computer) cfg.computer = {};
      if (process.env.XCLAW_COMPUTER_TOKEN) cfg.computer.authToken = process.env.XCLAW_COMPUTER_TOKEN;
      const upstream = process.env.XCLAW_COMPUTER_UPSTREAM || `http://127.0.0.1:${cfg.computer.port || 4243}`;
      startComputerAuthProxy({ cfg, upstream, listenPort: Number(process.env.XCLAW_COMPUTER_PROXY_PORT || 4244) });
      console.log("auth proxy running (ctrl+c to stop)");
      await new Promise(() => {});
      break;
    }
    case "slo-check": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { checkAndAlertSLOs } = await import("../src/ops/slo-monitor.mjs");
      const cfg = await loadConfig();
      console.log(JSON.stringify(await checkAndAlertSLOs(cfg), null, 2));
      break;
    }
    case "slo": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { computeSLOs } = await import("../src/ops/slo.mjs");
      const cfg = await loadConfig();
      const s = await computeSLOs(cfg);
      console.log(JSON.stringify(s, null, 2));
      process.exitCode = s.ok ? 0 : 1;
      break;
    }
    case "digest": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { buildApprovalDigest, sendApprovalDigest } = await import("../src/security/approval-digest.mjs");
      const cfg = await loadConfig();
      if (args.includes("--send")) console.log(JSON.stringify(await sendApprovalDigest(cfg), null, 2));
      else console.log(JSON.stringify(buildApprovalDigest(cfg), null, 2));
      break;
    }
    case "cache": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { cacheHitMonitor, formatCacheHitReport } = await import("../src/tokens/usage-analytics.mjs");
      const cfg = await loadConfig();
      const flag = (name, dflt = null) => {
        const i = args.indexOf(`--${name}`);
        return i >= 0 ? args[i + 1] : dflt;
      };
      const mon = await cacheHitMonitor(cfg, {
        days: flag("days", 7),
        recent: flag("recent", 20),
        warnBelowPct: flag("warn-below", 40),
      });
      if (args.includes("--json")) console.log(JSON.stringify(mon, null, 2));
      else console.log(formatCacheHitReport(mon));
      break;
    }
    case "cost": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { readCostLedger, defaultLedgerPath, formatUsd } = await import("../src/tokens/usage-tracker.mjs");
      const cfg = await loadConfig();
      const ledger = cfg.tokens?.ledgerPath || defaultLedgerPath();
      const agg = await readCostLedger(ledger);
      console.log("XClaw cost ledger");
      console.log("=================");
      console.log("Path:   ", agg.path);
      console.log("Runs:   ", agg.runs);
      console.log("Tokens: ", `in=${agg.promptTokens} out=${agg.completionTokens}`);
      console.log("Cost:   ", agg.costUsdFormatted, `(${agg.costUsd})`);
      if (agg.rows.length) {
        console.log("\nRecent:");
        for (const r of agg.rows.slice(-10)) {
          console.log(
            `  ${r.at || "?"}  model=${r.model || "?"}  total=${r.totalTokens ?? "?"}  ${r.costUsdFormatted || formatUsd(r.costUsd)}`
          );
        }
      }
      break;
    }
    case "tokens-bench":
    case "bench-tokens": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { benchProbeOverhead, formatBenchReport } = await import("../src/tokens/bench.mjs");
      const cfg = await loadConfig();
      const model = args[1] || cfg.agent?.model || "gpt-4o-mini";
      console.log("[xclaw] Running token probe overhead bench…");
      const bench = await benchProbeOverhead({ cfg, model, iterations: 100 });
      console.log(formatBenchReport(bench));
      break;
    }
    case "status": {
      const { printStatus } = await import("../src/cli/status.mjs");
      await printStatus({ root, json: args.includes("--json") });
      break;
    }
    case "tui": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runTui } = await import("../src/cli/tui.mjs");
      await runTui(await loadConfig(), { args: args.slice(1) });
      break;
    }
    case "queue": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { enqueueJob, listQueue, getQueueItem, startQueueWorker } = await import("../src/jobs/queue.mjs");
      const cfg = await loadConfig();
      startQueueWorker(cfg);
      const sub = args[1];
      if (sub === "list" || !sub) {
        console.log(JSON.stringify(await listQueue(cfg), null, 2));
        break;
      }
      if (sub === "stats") {
        const { queueStats } = await import("../src/jobs/queue.mjs");
        console.log(JSON.stringify(await queueStats(cfg), null, 2));
        break;
      }
      if (sub === "dead") {
        const { listDeadLetter } = await import("../src/jobs/queue.mjs");
        console.log(JSON.stringify(await listDeadLetter(cfg), null, 2));
        break;
      }
      if (sub === "add") {
        const goal = args.slice(2).join(" ");
        if (!goal) { console.error("Usage: xclaw queue add <goal>"); process.exit(1); }
        const item = await enqueueJob(cfg, { goal });
        console.log(JSON.stringify(item, null, 2));
        break;
      }
      if (sub === "get") {
        const item = await getQueueItem(cfg, args[2]);
        console.log(JSON.stringify(item, null, 2));
        break;
      }
      if (sub === "cancel") {
        const { cancelQueueItem } = await import("../src/jobs/queue.mjs");
        const item = await cancelQueueItem(cfg, args[2]);
        console.log(JSON.stringify(item, null, 2));
        process.exitCode = item ? 0 : 1;
        break;
      }
      if (sub === "retry") {
        const { retryFailedQueue } = await import("../src/jobs/queue.mjs");
        console.log(JSON.stringify(await retryFailedQueue(cfg), null, 2));
        break;
      }
      if (sub === "clear") {
        const { clearCompletedQueue } = await import("../src/jobs/queue.mjs");
        console.log(JSON.stringify(await clearCompletedQueue(cfg), null, 2));
        break;
      }
      if (sub === "pause") {
        const { pauseQueue } = await import("../src/jobs/queue.mjs");
        console.log(JSON.stringify(pauseQueue(), null, 2));
        break;
      }
      if (sub === "resume") {
        const { resumeQueue } = await import("../src/jobs/queue.mjs");
        console.log(JSON.stringify(resumeQueue(cfg), null, 2));
        break;
      }
      if (sub === "batch") {
        const file = args[2];
        if (!file) { console.error("Usage: xclaw queue batch <file.json|jsonl>"); process.exit(1); }
        const { enqueueFromFile } = await import("../src/jobs/batch.mjs");
        const out = await enqueueFromFile(cfg, file);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.errors.length ? 1 : 0;
        break;
      }
      console.error("Usage: xclaw queue [list|stats|dead|add|get|batch|cancel|clear|retry|pause|resume]");
      process.exit(1);
      break;
    }
    case "eval-schedule": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { ensureEvalCronJob, evalCronStatus, runScheduledEval } = await import("../src/cron/eval-job.mjs");
      const { start: startCron, stop: stopCron } = await import("../src/cron/scheduler.mjs");
      const cfg = await loadConfig();
      startCron();
      installCronShutdown(stopCron);
      const sub = args[1] || "status";
      if (sub === "status") {
        console.log(JSON.stringify(evalCronStatus(), null, 2));
        break;
      }
      if (sub === "register") {
        const everyMs = Number(args[2]) || cfg.eval?.cron?.everyMs || 86400000;
        const job = ensureEvalCronJob({ cfg, everyMs });
        console.log(JSON.stringify({ id: job.id, everyMs }, null, 2));
        break;
      }
      if (sub === "run") {
        const out = await runScheduledEval({ cfg, tag: args[2] || null });
        console.log(JSON.stringify({ ok: out.ok, passRate: out.report?.passRate, failed: out.report?.failed }, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      console.error("Usage: xclaw eval-schedule [status|register [everyMs]|run [tag]]");
      process.exit(1);
      break;
    }
    case "ready": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { checkReadiness } = await import("../src/gateway/readiness.mjs");
      const cfg = await loadConfig();
      const r = await checkReadiness(cfg);
      console.log(JSON.stringify(r.body, null, 2));
      process.exitCode = r.ready ? 0 : 1;
      break;
    }
    case "report": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { buildStatusReport } = await import("../src/gateway/report.mjs");
      const fs = await import("node:fs/promises");
      const cfg = await loadConfig();
      const rep = await buildStatusReport(cfg);
      const outIdx = args.indexOf("--out");
      const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
      const body = args.includes("--json") ? JSON.stringify(rep, null, 2) : rep.markdown;
      if (outPath) {
        await fs.writeFile(outPath, body + (body.endsWith("\n") ? "" : "\n"));
        console.error(`[xclaw] wrote ${outPath}`);
      } else {
        console.log(body);
      }
      break;
    }
    case "dashboard": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { buildDashboard } = await import("../src/gateway/dashboard.mjs");
      const cfg = await loadConfig();
      console.log(JSON.stringify(await buildDashboard(cfg), null, 2));
      break;
    }
    case "profile": {
      const { listProfiles } = await import("../src/config/profiles.mjs");
      const { loadConfig } = await import("../src/config/load.mjs");
      const sub = args[1] || "list";
      if (sub === "list") {
        console.log(JSON.stringify(listProfiles(), null, 2));
        break;
      }
      if (sub === "show") {
        const cfg = await loadConfig();
        console.log(JSON.stringify({
          profile: cfg.profile,
          autoApprove: cfg.security?.autoApprove,
          maxTurns: cfg.agent?.maxTurns,
          evalCron: cfg.eval?.cron,
          host: cfg.gateway?.host,
        }, null, 2));
        break;
      }
      console.error("Usage: xclaw profile [list|show]");
      process.exit(1);
      break;
    }
    case "merge": {
      const { getSubagent } = await import("../src/agents/spawn.mjs");
      const { mergeSubagentWorktree } = await import("../src/agents/worktree.mjs");
      const id = args[1];
      if (!id) { console.error("Usage: xclaw merge <subagentId> [--check] [--repo path]"); process.exit(1); }
      const rec = getSubagent(id);
      if (!rec) { console.error("subagent not found (in-process registry only)"); process.exit(1); }
      const repoIdx = args.indexOf("--repo");
      const repo = repoIdx >= 0 ? args[repoIdx + 1] : process.cwd();
      const out = await mergeSubagentWorktree(
        { result: rec.result, worktree: rec },
        repo,
        { checkOnly: args.includes("--check") }
      );
      console.log(JSON.stringify(out, null, 2));
      process.exitCode = out.ok ? 0 : 1;
      break;
    }
    case "resume": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        resumeJobFromCheckpoint,
        listCheckpoints,
        pruneCheckpoints,
      } = await import("../src/jobs/checkpoint.mjs");
      const cfg = await loadConfig();
      if (!args[1] || args[1] === "list") {
        console.log(JSON.stringify(await listCheckpoints(cfg), null, 2));
        break;
      }
      if (args[1] === "prune") {
        const dryRun = args.includes("--dry-run");
        const out = await pruneCheckpoints(cfg, { dryRun });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      const jobId = args[1];
      const stratIdx = args.indexOf("--strategy");
      const strategy = stratIdx >= 0 ? args[stratIdx + 1] : undefined;
      const maxIdx = args.indexOf("--max-turns");
      const maxTurns = maxIdx >= 0 ? Number(args[maxIdx + 1]) : undefined;
      const useHarness =
        args.includes("--harness") ? true :
        args.includes("--no-harness") ? false :
        undefined;
      const job = await resumeJobFromCheckpoint(cfg, jobId, {
        strategy,
        maxTurns,
        useHarness,
        force: args.includes("--force"),
      });
      console.log(JSON.stringify({
        id: job.id,
        status: job.status,
        pass: job.pass,
        turns: job.turns,
        resumedFrom: job.resumedFrom,
        recoveryKind: job.recoveryKind,
        recoveryStrategy: job.recoveryStrategy,
        note: job.note,
        code: job.code || null,
        error: job.error || null,
      }, null, 2));
      process.exitCode = job.pass ? 0 : 1;
      break;
    }
    case "skill-ab": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runSkillAB, runSkillABBatch } = await import("../src/skills/loop.mjs");
      const { ensureComputer } = await import("../src/computer/ensure.mjs");
      const cfg = await loadConfig();
      cfg.security = { ...cfg.security, autoApprove: true };
      await ensureComputer(cfg, { root, attempts: 2 });
      const idIdx = args.indexOf("--id");
      const tagIdx = args.indexOf("--tag");
      if (idIdx >= 0) {
        console.log(JSON.stringify(await runSkillAB(cfg, args[idIdx + 1]), null, 2));
      } else if (tagIdx >= 0) {
        const lim = args.indexOf("--limit");
        console.log(JSON.stringify(await runSkillABBatch(cfg, {
          tag: args[tagIdx + 1],
          limit: lim >= 0 ? Number(args[lim + 1]) : 5,
        }), null, 2));
      } else {
        console.error("Usage: xclaw skill-ab --id <case> | --tag <tag> [--limit N]");
        process.exit(1);
      }
      break;
    }
    case "skill-loop": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { readSkillLoopMetrics, recordSkillLoopMetric, computeSkillDelta } = await import("../src/skills/loop.mjs");
      const cfg = await loadConfig();
      if (args[1] === "record") {
        // xclaw skill-loop record --before-pass 0 --after-pass 1 --before-turns 10 --after-turns 4
        const get = (k) => {
          const i = args.indexOf(k);
          return i >= 0 ? args[i + 1] : null;
        };
        const before = { pass: get("--before-pass") === "1", turns: Number(get("--before-turns") || 0) };
        const after = { pass: get("--after-pass") === "1", turns: Number(get("--after-turns") || 0) };
        const delta = computeSkillDelta(before, after);
        await recordSkillLoopMetric(cfg, { ...delta, caseId: get("--case") });
        console.log(JSON.stringify(delta, null, 2));
        break;
      }
      console.log(JSON.stringify(await readSkillLoopMetrics(cfg), null, 2));
      break;
    }
    case "runs":
    case "agent-runs": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        listAgentRuns,
        loadAgentRun,
        deleteAgentRun,
      } = await import("../src/agent/run-store.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "list";
      if (sub === "list") {
        console.log(JSON.stringify({ runs: await listAgentRuns(cfg) }, null, 2));
        break;
      }
      if (sub === "show" || sub === "get") {
        const id = args[2];
        if (!id) { console.error("Usage: xclaw runs show <sessionId>"); process.exit(1); }
        const out = await loadAgentRun(cfg, id);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      if (sub === "delete") {
        const id = args[2];
        if (!id) { console.error("Usage: xclaw runs delete <sessionId>"); process.exit(1); }
        console.log(JSON.stringify(await deleteAgentRun(cfg, id), null, 2));
        break;
      }
      console.error("Usage: xclaw runs [list|show <id>|delete <id>]");
      process.exit(1);
      break;
    }
    case "approvals": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        listPendingApprovals,
        decideApproval,
        getSharedApprovalGate,
      } = await import("../src/security/approvals.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "list";
      if (sub === "list" || sub === "pending") {
        const pending = listPendingApprovals(cfg);
        console.log(JSON.stringify({ count: pending.length, pending }, null, 2));
        break;
      }
      if (sub === "policy") {
        console.log(JSON.stringify(getSharedApprovalGate(cfg).policyInfo(), null, 2));
        break;
      }
      if (sub === "approve") {
        const id = args[2];
        if (!id) { console.error("Usage: xclaw approvals approve <id> [note]"); process.exit(1); }
        const note = args.slice(3).join(" ");
        const out = decideApproval(cfg, id, true, note);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      if (sub === "deny") {
        const id = args[2];
        if (!id) { console.error("Usage: xclaw approvals deny <id> [reason]"); process.exit(1); }
        const note = args.slice(3).join(" ") || "Denied by operator";
        const out = decideApproval(cfg, id, false, note);
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok ? 0 : 1;
        break;
      }
      console.error("Usage: xclaw approvals [list|policy|approve <id>|deny <id>]");
      process.exit(1);
      break;
    }
    case "skills": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        listProposals,
        installProposal,
        rejectProposal,
      } = await import("../src/skills/propose.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "list";
      if (sub === "list" || sub === "loaded") {
        const { loadAllSkills } = await import("../src/skills/loader.mjs");
        const skills = await loadAllSkills({
          configDir: cfg.paths?.configDir,
          cwd: process.cwd(),
          cfg,
        });
        console.log(JSON.stringify({
          count: skills.length,
          skills: skills.map((s) => ({
            name: s.name,
            description: (s.description || "").slice(0, 120),
            path: s.path,
          })),
        }, null, 2));
        break;
      }
      if (sub === "lock" || sub === "verify") {
        const { loadAllSkills } = await import("../src/skills/loader.mjs");
        const integrity = await import("../src/skills/integrity.mjs");
        // Raw discovery — integrity checking off so enforce mode can't hide
        // drifted skills from the very command meant to report them.
        const rawCfg = { ...cfg, skills: { ...(cfg.skills || {}), integrity: "off" } };
        const skills = await loadAllSkills({
          configDir: cfg.paths?.configDir,
          cwd: process.cwd(),
          cfg: rawCfg,
        });
        if (sub === "lock") {
          const data = await integrity.buildLockData(skills);
          const p = await integrity.writeLockfile(process.cwd(), data);
          console.log(JSON.stringify({ ok: true, path: p, skills: Object.keys(data.skills).length }, null, 2));
          break;
        }
        const { path: lockPath, data } = await integrity.readLockfile(process.cwd());
        if (!data) {
          console.error(`No valid ${integrity.LOCKFILE_NAME} at ${lockPath} — run: xclaw skills lock`);
          process.exit(1);
        }
        const { evaluated, missing } = await integrity.evaluateSkills(skills, data);
        const rows = evaluated.map(({ skill, status }) => ({
          name: skill.name,
          status: status === "unmanifested" ? "new" : status === "verified" ? "ok" : status,
          path: skill.path,
        }));
        for (const name of missing) rows.push({ name, status: "missing", path: data.skills[name]?.path || null });
        const drift = rows.filter((r) => r.status !== "ok");
        console.log(JSON.stringify({ ok: drift.length === 0, lockfile: lockPath, drift: drift.length, skills: rows }, null, 2));
        if (drift.length) process.exit(1);
        break;
      }
      if (sub === "proposals") {
        console.log(JSON.stringify(await listProposals(cfg), null, 2));
        break;
      }
      if (sub === "install") {
        const file = args[2];
        if (!file) {
          console.error("Usage: xclaw skills install <proposal.md> [--force] [--owner-approved]");
          process.exit(1);
        }
        const out = await installProposal(cfg, file, {
          force: args.includes("--force"),
          ownerApproved:
            args.includes("--owner-approved") ||
            args.includes("--owner") ||
            process.env.XCLAW_SKILLS_INSTALL === "1",
        });
        console.log(JSON.stringify(out, null, 2));
        process.exitCode = out.ok === false ? 1 : 0;
        break;
      }
      if (sub === "reject") {
        const file = args[2];
        if (!file) { console.error("Usage: xclaw skills reject <proposal.md> [reason]"); process.exit(1); }
        console.log(JSON.stringify(await rejectProposal(cfg, file, args.slice(3).join(" ")), null, 2));
        break;
      }
      console.error("Usage: xclaw skills [list|lock|verify|proposals|install|reject]");
      process.exit(1);
      break;
    }
    case "scoreboard": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { buildScoreboard } = await import("../src/eval/scoreboard.mjs");
      const cfg = await loadConfig();
      const s = await buildScoreboard(cfg, { root });
      console.log(JSON.stringify(s, null, 2));
      process.exitCode = s.releaseGate?.ok === false ? 1 : 0;
      break;
    }
    case "eval-spend": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { summarizeEvalSpend } = await import("../src/eval/spend.mjs");
      const { checkSpendThresholds } = await import("../src/eval/spend-alerts.mjs");
      const cfg = await loadConfig();
      if (args[1] === "check") {
        const r = await checkSpendThresholds(cfg, {});
        console.log(JSON.stringify(r, null, 2));
        process.exitCode = r.ok ? 0 : 1;
        break;
      }
      const s = await summarizeEvalSpend(cfg, { limit: Number(args[1]) || 100 });
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    case "eval": {
      const { evalMain } = await import("../src/eval/cli.mjs");
      await evalMain(args.slice(1));
      break;
    }
    case "goal": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { enqueueJob, listQueue, startQueueWorker } = await import("../src/jobs/queue.mjs");
      const cfg = await loadConfig();
      startQueueWorker(cfg);
      const sub = args[1];
      if (sub === "list") {
        console.log(JSON.stringify({ queue: await listQueue(cfg) }, null, 2));
        break;
      }
      const rest = sub === "add" ? args.slice(2) : args.slice(1);
      const goalParts = [];
      const verify = [];
      let harness = false;
      let maxTurns;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === "--harness") { harness = true; continue; }
        if (a === "--max-turns" && rest[i + 1]) { maxTurns = Number(rest[++i]); continue; }
        if (a === "--exists" && rest[i + 1]) {
          verify.push({ type: "file_exists", path: rest[++i] });
          continue;
        }
        if (a === "--contains" && rest[i + 1]) {
          const pathText = rest[++i];
          const sp = pathText.split(":");
          if (sp.length >= 2) {
            verify.push({ type: "file_contains", path: sp[0], text: sp.slice(1).join(":") });
          }
          continue;
        }
        if (a === "--cmd" && rest[i + 1]) {
          verify.push({ type: "command", cmd: rest[++i], exitCode: 0 });
          continue;
        }
        if (a.startsWith("-")) continue;
        goalParts.push(a);
      }
      const goal = goalParts.join(" ").trim();
      if (!goal) {
        console.error('Usage: xclaw goal "…" [--harness] [--exists path] [--contains path:text] [--cmd "…"] [--max-turns N]');
        process.exit(1);
      }
      if (verify.length) harness = true;
      const item = await enqueueJob(cfg, {
        goal,
        class: "batch",
        harness,
        verify,
        maxTurns,
        groundHard: harness ? true : undefined,
        claimsRequireEvidence: harness ? true : undefined,
        requireStructuredClaims: harness ? true : undefined,
      });
      console.log(JSON.stringify({
        enqueued: true,
        id: item.id,
        goal: item.goal,
        harness: item.harness,
        verify: item.verify,
      }, null, 2));
      break;
    }
    case "evolve": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const {
        handsFreeStatus,
        runEvolutionTick,
        handsFreeConfigOverlay,
      } = await import("../src/autonomy/self-evolve.mjs");
      const cfg = await loadConfig();
      const sub = args[1] || "status";
      if (sub === "status" || sub === "hands-free") {
        console.log(JSON.stringify(await handsFreeStatus(cfg), null, 2));
        break;
      }
      if (sub === "tick") {
        const dryRun = args.includes("--dry-run");
        const autoPromote = args.includes("--promote");
        const r = await runEvolutionTick(cfg, {
          dryRun,
          autoPromote,
          ownerApproved: args.includes("--owner-approved"),
        });
        console.log(JSON.stringify(r, null, 2));
        process.exitCode = r.status?.blockers?.length ? 1 : 0;
        break;
      }
      if (sub === "overlay") {
        console.log(JSON.stringify(handsFreeConfigOverlay(), null, 2));
        break;
      }
      console.error("Usage: xclaw evolve [status|tick|overlay] [--dry-run] [--promote] [--owner-approved]");
      process.exit(1);
      break;
    }
    case "harness": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runLongHarness } = await import("../src/jobs/long-harness.mjs");
      const cfg = await loadConfig();
      const goalParts = [];
      let maxTurns = null;
      let timeoutMs = null;
      let workspace = null;
      const verify = [];
      for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === "--max-turns" && args[i + 1]) { maxTurns = Number(args[++i]); continue; }
        if (a === "--timeout" && args[i + 1]) { timeoutMs = Number(args[++i]); continue; }
        if (a === "--workspace" && args[i + 1]) { workspace = args[++i]; continue; }
        if (a === "--contains" && args[i + 1]) {
          const pathText = args[++i];
          const sp = pathText.split(":");
          if (sp.length >= 2) verify.push({ type: "file_contains", path: sp[0], text: sp.slice(1).join(":") });
          continue;
        }
        if (a === "--exists" && args[i + 1]) {
          verify.push({ type: "file_exists", path: args[++i] });
          continue;
        }
        if (a === "--cmd" && args[i + 1]) {
          verify.push({ type: "command", cmd: args[++i], exitCode: 0 });
          continue;
        }
        if (a.startsWith("-")) continue;
        goalParts.push(a);
      }
      const goal = goalParts.join(" ").trim();
      if (!goal) {
        console.error("Usage: xclaw harness \"goal\" [--exists path] [--contains path:text] [--cmd 'node test'] [--max-turns N] [--timeout ms]");
        process.exit(1);
      }
      const job = await runLongHarness({
        goal,
        cfg,
        verify,
        maxTurns: maxTurns || undefined,
        timeoutMs: timeoutMs || undefined,
        workspace: workspace || undefined,
        onEvent: (e) => {
          if (e.type === "harness" || e.type === "job" || (e.type === "tool" && e.phase === "end")) {
            console.error(JSON.stringify(e));
          }
        },
      });
      console.log(JSON.stringify({
        id: job.id,
        pass: job.pass,
        status: job.status,
        groundingFailed: job.groundingFailed,
        claimScore: job.claimScore,
        verify: job.verify,
        turns: job.turns,
        wallMs: job.wallMs,
        harness: job.harness,
        text: (job.text || "").slice(0, 2000),
        error: job.error,
        workspace: job.workspace,
      }, null, 2));
      process.exitCode = job.pass ? 0 : 1;
      break;
    }
    case "job": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { runJob, saveJobSummary } = await import("../src/jobs/job.mjs");
      const cfg = await loadConfig();
      const goal = args.slice(1).join(" ") || "List files in the workspace";
      const job = await runJob({ goal, cfg, autoApprove: true });
      await saveJobSummary(job);
      console.log(JSON.stringify({ id: job.id, status: job.status, pass: job.pass, turns: job.turns, wallMs: job.wallMs, text: job.text, evidence: job.evidence?.length }, null, 2));
      process.exitCode = job.pass ? 0 : 1;
      break;
    }
    case "wait-ready": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { checkReadiness } = await import("../src/gateway/readiness.mjs");
      const { ensureComputer } = await import("../src/computer/ensure.mjs");
      const timeoutMs = Number(args.find((a, i) => args[i - 1] === "--timeout") || 60000);
      const intervalMs = Number(args.find((a, i) => args[i - 1] === "--interval") || 1000);
      const startComputer = !args.includes("--no-start");
      const cfg = await loadConfig();
      const t0 = Date.now();
      if (startComputer) {
        try {
          await ensureComputer(cfg, { attempts: 2, log: true });
        } catch (e) {
          console.error("[xclaw] ensureComputer:", e.message);
        }
      }
      let last = null;
      while (Date.now() - t0 < timeoutMs) {
        last = await checkReadiness(cfg);
        if (last.ready) {
          console.log(JSON.stringify({ ready: true, waitedMs: Date.now() - t0, ...last.body }));
          process.exitCode = 0;
          break;
        }
        await new Promise((res) => setTimeout(res, intervalMs));
      }
      if (!last?.ready) {
        console.error(JSON.stringify({ ready: false, waitedMs: Date.now() - t0, ...(last?.body || {}) }));
        process.exitCode = 1;
      }
      break;
    }
    case "info": {
      const { loadConfig } = await import("../src/config/load.mjs");
      const { checkReadiness } = await import("../src/gateway/readiness.mjs");
      const { queueStats } = await import("../src/jobs/queue.mjs");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
      const cfg = await loadConfig();
      const ready = await checkReadiness(cfg);
      let q = {};
      try { q = await queueStats(cfg); } catch {}
      let autonomy = null;
      try {
        const { autonomyPolicySummary } = await import("../src/config/autonomy-policy.mjs");
        autonomy = autonomyPolicySummary(cfg);
      } catch {}
      const fabric = {
        commitGates: process.env.XCLAW_COMMIT_GATES === "1" || process.env.XCLAW_COMMIT_GATES === "true",
        fabricEnforce: process.env.XCLAW_FABRIC_ENFORCE === "1" || process.env.XCLAW_FABRIC_ENFORCE === "true",
        prodHardening: cfg._prodHardening || [],
      };
      const out = {
        version,
        profile: cfg.profile || "dev",
        model: cfg.agent?.model,
        ready: ready.ready,
        computer: ready.body?.checks?.computer,
        queue: { queued: q.queued, running: q.running, failed: q.failed, deadLetter: q.deadLetter },
        gateway: `http://${cfg.gateway?.host}:${cfg.gateway?.port}`,
        autonomy,
        fabric,
      };
      if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`XClaw ${out.version} · profile=${out.profile} · model=${out.model}`);
        console.log(`ready=${out.ready} · computer=${out.computer?.ok ? "UP" : "DOWN"} · gateway ${out.gateway}`);
        console.log(`queue queued=${out.queue.queued||0} running=${out.queue.running||0} failed=${out.queue.failed||0} dead=${out.queue.deadLetter||0}`);
        if (autonomy) {
          console.log(`autonomy level=${autonomy.level} autoApprove=${autonomy.autoApprove} heartbeat=${autonomy.heartbeatEnabled}`);
        }
        console.log(`fabric commitGates=${fabric.commitGates} fabricEnforce=${fabric.fabricEnforce}`);
      }
      process.exitCode = out.ready ? 0 : 1;
      break;
    }
    case "routes": {
      const { listRoutes } = await import("../src/gateway/routes-map.mjs");
      const routes = listRoutes();
      if (args.includes("--json")) console.log(JSON.stringify(routes, null, 2));
      else {
        for (const r of routes) {
          console.log(`${r.method.padEnd(6)} ${r.path.padEnd(40)} ${r.group}  ${r.desc}`);
        }
        console.error(`(${routes.length} routes)`);
      }
      break;
    }
    case "version":
    case "-v":
    case "--version": {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
      console.log(`xclaw ${version}`);
      break;
    }
    case "help":
    case "-h":
    case "--help":
    default: {
      console.log(`
XClaw — self-hosted multi-LLM agent gateway

Usage:
  xclaw <command> [options]

Commands:
  gateway, start       Start Gateway (Computer + Agent + WebChat + channels)
  computer             Computer server only (start|status|stop|restart)
  agent <message>      One agent turn (CLI)
  run <message>        Stream via gateway (--ndjson, --resume)
  status [--json]      Gateway + computer + active sessions
  tui [-c|--continue]  Interactive terminal chat (streaming, inline approvals)
  doctor [--json] [--fix]  Health checks (exit 0=ok, 1=warnings, 2=errors); --fix absorbs leftover JSON into SQL
  self-test            Fast unit smoke (autonomy, sandbox, fabric, …)
  stop-all             Abort agent sessions + stop computer
  stop --sign          Mint X-XClaw-Stop-Sig (JSON; add --print-curl)
  stop-sign            Alias of stop --sign
  automations          list|add|pause|resume|run|results|delete
  providers            list | setup (wizard) | set | oauth | use [X] [model]
  channels             list | setup (wizard) | set | enable X | disable X
  sessions-active      List in-process agent sessions
  transcripts          list | show <sessionId>
  ledger               tail | query | who-touched <path> | stats | compact
  timeline             list | diff <a> <b> | revert <missionId> | known-good | attribute <path>
  self-deploy          status | run-once | watch (external deploy executor)
  eval                 Eval suite (--tag, --mock, --json)
  job <goal>           Verified job in a temp workspace
  harness <goal>       Long-run grounded harness (anti-hallucination)
  evolve               status|tick|overlay — self-evolution / hands-free
  skills               list|proposals|install|reject  (prod install needs --owner-approved)
  approvals            list|policy|approve <id>|deny <id>
  version              Print version
  info                 Version + ready + queue summary
  wait-ready           Poll until ready
  routes               List gateway routes
  help                 Show help

Examples:
  xclaw doctor
  xclaw status --json
  xclaw agent "List files in /tmp"
  xclaw gateway
  # open http://127.0.0.1:18790/chat/

  xclaw stop-all
  xclaw run --ndjson "List files in /tmp"

Config: ~/.xclaw/xclaw.json
Env:    XAI_API_KEY / OPENAI_API_KEY / XCLAW_API_KEY, XCLAW_MODEL, XCLAW_PROFILE
        XCLAW_GATEWAY_TOKEN (prod), XCLAW_EGRESS, XCLAW_OS_SANDBOX
        TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN

See README.md for the 15-minute start path.
`);
      if (!["help", "-h", "--help"].includes(cmd)) process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("xclaw error:", err?.message || err);
  process.exit(1);
});
