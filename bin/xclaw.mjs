#!/usr/bin/env node
/**
 * XClaw CLI — Phase 4
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const cmd = args[0] || "help";

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
      const { start: startCron, listJobs } = await import("../src/cron/scheduler.mjs");
      const cfg = await loadConfig();
      const everyMs = Number(args[1]) || cfg.doctor?.cron?.everyMs || 3600000;
      startCron();
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
      const { start: startCron, listJobs } = await import("../src/cron/scheduler.mjs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const root = process.env.XCLAW_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const cfg = await loadConfig({ strict: false });
      const everyMs = Number(args[1]) || cfg.liveE2e?.cron?.everyMs || 86_400_000;
      startCron();
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
      const check = (name, fn) => {
        try {
          const r = fn();
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
      check("front-matter", () => {
        const { meta } = parseFrontMatter("---\nname: t\npriority: 1\n---\nbody");
        if (meta.name !== "t") throw new Error("meta");
      });
      check("rate-limit", () => {
        const rl = createRateLimiter({ max: 1, windowMs: 5000 });
        if (!rl.allow("a").ok || rl.allow("a").ok) throw new Error("rl");
      });
      check("pairing", () => {
        const store = createPairingStore({ storePath: "/tmp/xclaw-selftest-pair.json" });
        const u = store.upsertPairingRequest({ channel: "telegram", id: "1" });
        if (!u.code) throw new Error("code");
      });
      check("provider-route", () => {
        const r = resolveProviderRoute({}, { model: "grok-3" });
        if (r.provider !== "xai") throw new Error(r.provider);
      });
      check("loop-guard", () => {
        const g = createLoopGuard({ warningThreshold: 2, criticalThreshold: 5 });
        g.record("t", { x: 1 }, "a");
        g.record("t", { x: 1 }, "a");
        const d = g.detect("t", { x: 1 });
        if (!d.stuck) throw new Error("expected stuck");
      });
      check("cron-schedule", () => {
        const n = computeNextRun({ kind: "every", everyMs: 1000 }, 0);
        if (n !== 1000) throw new Error(String(n));
      });
      check("session-key", () => {
        const k = buildSessionKey({ channel: "telegram", peerKind: "dm", peerId: "9" });
        if (parseSessionKey(k).peerId !== "9") throw new Error(k);
      });
      const failed = tests.filter((x) => !x.ok);
      console.log(JSON.stringify({ ok: failed.length === 0, tests }, null, 2));
      process.exit(failed.length ? 1 : 0);
      break;
    }

    case "mcp": {
      const { runMcpStdio } = await import("../src/mcp/stdio.mjs");
      await runMcpStdio({});
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
        await startComputer({
          root,
          foreground: fg,
          args: args.slice(sub === "start" ? 2 : 1).filter((a) => a !== "--bg"),
        });
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

      const message = args.slice(1).join(" ").trim();
      if (!message) {
        console.error("Usage: xclaw agent <message>");
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
      const result = await runAgentLoop({
        userMessage: message,
        cfg,
        onEvent: (e) => {
          if (e.type === "tool" && e.phase === "start") {
            console.log(`  → tool ${e.name}`, JSON.stringify(e.args || {}).slice(0, 100));
          } else if (e.type === "tool" && e.phase === "end") {
            console.log(`  ← ${e.preview?.slice(0, 120) || "ok"}`);
          } else if (e.type === "guard") {
            console.log(`  ! guard [${e.level}] ${e.message}`);
          } else if (e.type === "lifecycle" && e.phase === "start") {
            console.log("  … running");
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
      await printStatus({ root });
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
      const { start: startCron } = await import("../src/cron/scheduler.mjs");
      const cfg = await loadConfig();
      startCron();
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
      const { resumeJobFromCheckpoint, listCheckpoints } = await import("../src/jobs/checkpoint.mjs");
      const cfg = await loadConfig();
      if (!args[1] || args[1] === "list") {
        console.log(JSON.stringify(await listCheckpoints(cfg), null, 2));
        break;
      }
      const job = await resumeJobFromCheckpoint(cfg, args[1]);
      console.log(JSON.stringify({ id: job.id, status: job.status, pass: job.pass, turns: job.turns, resumedFrom: job.resumedFrom }, null, 2));
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
      if (sub === "proposals") {
        console.log(JSON.stringify(await listProposals(cfg), null, 2));
        break;
      }
      if (sub === "install") {
        const file = args[2];
        if (!file) { console.error("Usage: xclaw skills install <proposal.md>"); process.exit(1); }
        const out = await installProposal(cfg, file, { force: args.includes("--force") });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      if (sub === "reject") {
        const file = args[2];
        if (!file) { console.error("Usage: xclaw skills reject <proposal.md> [reason]"); process.exit(1); }
        console.log(JSON.stringify(await rejectProposal(cfg, file, args.slice(3).join(" ")), null, 2));
        break;
      }
      console.error("Usage: xclaw skills [list|proposals|install|reject]");
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
      const out = {
        version,
        profile: cfg.profile || "dev",
        model: cfg.agent?.model,
        ready: ready.ready,
        computer: ready.body?.checks?.computer,
        queue: { queued: q.queued, running: q.running, failed: q.failed, deadLetter: q.deadLetter },
        gateway: `http://${cfg.gateway?.host}:${cfg.gateway?.port}`,
      };
      if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`XClaw ${out.version} · profile=${out.profile} · model=${out.model}`);
        console.log(`ready=${out.ready} · computer=${out.computer?.ok ? "UP" : "DOWN"} · gateway ${out.gateway}`);
        console.log(`queue queued=${out.queue.queued||0} running=${out.queue.running||0} failed=${out.queue.failed||0} dead=${out.queue.deadLetter||0}`);
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
XClaw — personal AI assistant gateway (Phase 7)

Usage:
  xclaw <command> [options]

Commands:
  gateway, start    Start Gateway (Computer + Agent + WebChat + Telegram/Discord)
  computer          Start Computer server only
  agent <message>   Run one agent turn (CLI)
  run <message>     Stream via gateway (--ndjson, --resume)
  status            Gateway + Computer health
  eval              Run autonomy eval suite (--tag smoke|autonomy|grounding, --mock, --json)
  job <goal>        Run one verified job in a temp workspace
  tokens-bench      Benchmark token probe overhead
  cost              Show accumulated xAI/API cost ledger
  version           Print version
  info              Version + ready + queue summary
  wait-ready        Poll until ready (starts computer by default)
  routes            List gateway routes
  help              Show help

Examples:
  xclaw gateway
  # open http://127.0.0.1:18790/chat/

  xclaw agent "List files in /tmp"
  xclaw run --ndjson "List files in /tmp"
  xclaw run --resume <streamId> --last-event-id <id>

  curl -X POST http://127.0.0.1:18790/channel/webchat/message \\
    -H 'Content-Type: application/json' \\
    -d '{"message":"echo hello from webchat"}'

Config: ~/.xclaw/xclaw.json
Env:    OPENAI_API_KEY / XCLAW_API_KEY, XCLAW_MODEL, XCLAW_API_BASE
        TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN
`);
      if (!["help", "-h", "--help"].includes(cmd)) process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("xclaw error:", err?.message || err);
  process.exit(1);
});
