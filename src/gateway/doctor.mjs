/**
 * Deep health / doctor report for XClaw gateway.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listJobs, status as cronStatus } from "../cron/scheduler.mjs";
import { listSessions } from "../sessions/router.mjs";
import { createPairingStore } from "../pairing/pairing-store.mjs";
import { resolveProviderRoute } from "../providers/router.mjs";
import { listImageProviders } from "../media/canvas.mjs";
import { loadAllSkills } from "../skills/loader.mjs";
import { defaultSessionsPath } from "../sessions/persist.mjs";
import { wsClientCount } from "./ws-hub.mjs";
import { evictionBufferMetrics, evictionListenerCount } from "./eviction-events.mjs";
import { streamRegistryStats } from "./stream-resume.mjs";
import { runningVersion } from "./build-version.mjs";
import { computerBaseUrl } from "../computer/manager.mjs";

/**
 * @returns {Promise<object>}
 */
export async function buildDoctorReport({ cfg, channelManager, isComputerRunning }) {
  const checks = [];
  const push = (name, ok, detail = {}) => {
    const severity = ok ? "ok" : detail.severity || "error";
    checks.push({ name, ok, severity, ...detail });
  };

  // computer
  try {
    const computerOk = await isComputerRunning(cfg);
    push("computer", computerOk, {
      summary: computerOk ? "reachable" : "down",
      url: computerBaseUrl(cfg),
      hint: computerOk
        ? null
        : "Start with: node bin/xclaw.mjs computer",
    });
  } catch (err) {
    push("computer", false, {
      summary: "error",
      error: err.message,
      hint: "Check computer.host/port in config",
    });
  }

  // provider
  const route = resolveProviderRoute(cfg, {});
  const local =
    Boolean(route.baseUrl?.includes("localhost")) ||
    Boolean(cfg.agent?.baseUrl?.includes("localhost"));
  const providerOk = route.hasKey || local;
  push("provider", providerOk, {
    summary: providerOk
      ? `${route.provider} · ${route.model || "default"}`
      : "no API key",
    provider: route.provider,
    model: route.model,
    baseUrl: route.baseUrl,
    hasKey: route.hasKey,
    hint: providerOk
      ? null
      : "Set XCLAW_API_KEY / OPENAI_API_KEY / XAI_API_KEY or agent.apiKey",
  });

  // channels
  const chStatus = channelManager?.status?.() || [];
  if (!chStatus.length) {
    push("channels", true, {
      summary: "none configured",
      severity: "warn",
    });
  }
  for (const ch of chStatus) {
    const enabled = ch.enabled === true;
    push(`channel:${ch.name}`, true, {
      summary: enabled
        ? `enabled${ch.username ? " @" + ch.username : ""}${ch.connected != null ? (ch.connected ? " · connected" : " · disconnected") : ""}`
        : "disabled",
      severity: enabled ? "ok" : "info",
      ...ch,
    });
  }

  // sessions — same resolver as configureSessionPersist so doctor cannot
  // miss the live file (or report the operator's home file).
  const sessPath = defaultSessionsPath(cfg);
  let sessExists = false;
  try {
    sessExists = fs.existsSync(sessPath);
  } catch {}
  const sessCount = listSessions().length;
  push("sessions", true, {
    summary: `${sessCount} in memory · disk ${sessExists ? "yes" : "no"}`,
    path: sessPath,
    exists: sessExists,
    count: sessCount,
  });

  
  // Telegram deep posture
  try {
    const conf = cfg.channels?.telegram || {};
    const token = conf.token || process.env.TELEGRAM_BOT_TOKEN || process.env.XCLAW_TELEGRAM_TOKEN;
    const tgLive = (Array.isArray(chStatus) ? chStatus : []).find((c) => c.name === "telegram");
    const allow = conf.allowedChatIds || conf.allowFrom || [];
    const dmPolicy = conf.dmPolicy || "pairing";
    const profile = String(cfg.profile || process.env.XCLAW_PROFILE || "lab").toLowerCase();
    if (conf.enabled === true && !token) {
      push("telegram.token", false, { summary: "NO_TELEGRAM_TOKEN", severity: "error" });
    } else if (token) {
      push("telegram.token", true, { summary: "configured" });
    }
    if (token || conf.enabled) {
      let polOk = true;
      let polSummary = `dmPolicy=${dmPolicy} allowFrom=${Array.isArray(allow) ? allow.length : 0}`;
      let sev = "ok";
      if (profile === "prod" && dmPolicy === "open") {
        polOk = false;
        sev = "error";
        polSummary = "prod dmPolicy=open is unsafe";
      } else if (dmPolicy === "open") {
        sev = "warn";
        polSummary = "dmPolicy=open";
      }
      push("telegram.policy", polOk || sev === "warn", {
        summary: polSummary,
        severity: sev === "ok" ? undefined : sev,
        dmPolicy,
        allowFromCount: Array.isArray(allow) ? allow.length : 0,
      });
      if (tgLive?.lastError) {
        push("telegram.lastError", true, {
          summary: String(tgLive.lastError).slice(0, 200),
          severity: "warn",
          lastError: tgLive.lastError,
          running: tgLive.running,
        });
      } else if (tgLive) {
        push("telegram.runtime", true, {
          summary: `running=${Boolean(tgLive.running)} lock=${Boolean(tgLive.writerLock)} @${tgLive.username || "?"}`,
          ...tgLive,
        });
      }
    }
  } catch (err) {
    push("telegram.channel", true, { summary: err.message || String(err), severity: "warn" });
  }

// pairing
  const pairing = createPairingStore({ cfg });
  const tgP = pairing.listPending("telegram").length;
  const tgA = pairing.listApproved("telegram").length;
  const dcP = pairing.listPending("discord").length;
  const dcA = pairing.listApproved("discord").length;
  push("pairing", true, {
    summary: `tg ${tgA} approved/${tgP} pending · dc ${dcA}/${dcP}`,
    path: pairing.storePath,
    telegramPending: tgP,
    telegramApproved: tgA,
    discordPending: dcP,
    discordApproved: dcA,
    hint: tgP || dcP ? "Approve: xclaw pairing approve <channel> <code>" : null,
  });

  // cron
  const cs = cronStatus();
  push("cron", true, {
    summary: `${cs.enabled || 0} enabled / ${cs.jobs || 0} total`,
    ...cs,
    nextRunAt: cs.nextRunAt
      ? new Date(cs.nextRunAt).toISOString()
      : null,
  });

  // skills
  try {
    const skills = await loadAllSkills({
      configDir: cfg.paths?.configDir,
      cwd: process.cwd(),
      cfg,
    });
    push("skills", true, {
      summary: skills.length
        ? skills.map((s) => s.name).join(", ")
        : "none loaded",
      count: skills.length,
      names: skills.map((s) => s.name),
    });
  } catch (err) {
    push("skills", false, {
      summary: "load failed",
      error: err.message,
    });
  }

  // media
  const providers = listImageProviders();
  push("media", true, {
    summary: providers.length
      ? providers.map((p) => p.id).join(", ")
      : "no image providers",
    providers,
  });

  // pagerduty
  {
    const pd = cfg.alerting?.pagerduty || {};
    const rk = pd.routingKey || process.env.PAGERDUTY_ROUTING_KEY;
    push("pagerduty", true, {
      summary: rk
        ? `events key set${pd.escalationPolicyId ? " · policy " + pd.escalationPolicyId : ""}`
        : "not configured",
      severity: rk ? "ok" : "info",
      hasRoutingKey: Boolean(rk),
      hasApiToken: Boolean(pd.apiToken || process.env.PAGERDUTY_API_TOKEN),
      escalationPolicyId: pd.escalationPolicyId || null,
      serviceId: pd.serviceId || null,
      hint: rk
        ? null
        : "Optional: set PAGERDUTY_ROUTING_KEY for on-call escalation",
    });
  }

  // gateway auth
  const tokenConfigured = Boolean(
    cfg.gateway?.token ||
      cfg.gateway?.authToken ||
      process.env.XCLAW_GATEWAY_TOKEN
  );
  const requireAuth =
    cfg.gateway?.requireAuth === true ||
    cfg.profile === "prod" ||
    process.env.XCLAW_GATEWAY_REQUIRE_AUTH === "1";
  const authOk = !requireAuth || tokenConfigured;
  push("gateway_auth", authOk, {
    summary: tokenConfigured
      ? "token configured"
      : requireAuth
        ? "FAIL: prod/requireAuth but no XCLAW_GATEWAY_TOKEN"
        : "open (lab — no token)",
    severity: authOk ? (tokenConfigured ? "ok" : "info") : "error",
    tokenConfigured,
    requireAuth,
    profile: cfg.profile || null,
  });

  // config home
  const home = path.join(os.homedir(), ".xclaw");
  push("config_home", true, {
    summary: fs.existsSync(home) ? home : `${home} (missing)`,
    path: home,
    exists: fs.existsSync(home),
  });

  // agent metrics (in-process)
  try {
    const { getAgentMetricsSnapshot } = await import("../agent/agent-metrics.mjs");
    const m = getAgentMetricsSnapshot();
    const statusSummary =
      Object.entries(m.toolStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") || "no tools yet";
    push("agent_tools", true, {
      summary: m.turns
        ? `${m.turns} turns · ${statusSummary}`
        : "no turns yet",
      severity: "info",
      turns: m.turns,
      toolStatus: m.toolStatus,
      toolOutcome: m.toolOutcome,
      lastTurn: m.lastTurn,
    });
    push("agent_suggestions", true, {
      summary: m.turns
        ? `shown=${m.suggestionsShown} tapped=${m.suggestionsTapped} suppressed=${m.suggestionsSuppressed} tapRate=${(m.suggestionTapRate || 0).toFixed(2)}`
        : "no suggestion data",
      severity: "info",
      ...m,
    });
    push("agent_closure", true, {
      summary: `closed=${m.closureClosed} open=${m.closureOpen}`,
      severity: "info",
      closureClosed: m.closureClosed,
      closureOpen: m.closureOpen,
    });
    const phaseSummary =
      Object.entries(m.turnPhase || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") || "none";
    push("agent_turn_phase", true, {
      summary: phaseSummary,
      severity: "info",
      turnPhase: m.turnPhase || {},
    });
  } catch (err) {
    push("agent_metrics", false, {
      summary: "unavailable",
      error: err.message,
      severity: "warn",
    });
  }

  // durable suggestion feedback on disk
  try {
    const fb = await import("../agent/suggestion-feedback.mjs");
    const store = await fb.loadSuggestionFeedback(cfg);
    const st = fb.suggestionFeedbackStats(store);
    const fp = fb.suggestionFeedbackPath(cfg);
    push("suggestion_feedback", true, {
      summary: st.shown
        ? `shown=${st.shown} tapped=${st.tapped} rate=${(st.tapRate || 0).toFixed(2)} · ${fp}`
        : `no durable events yet · ${fp}`,
      severity: "info",
      ...st,
      path: fp,
    });
  } catch (err) {
    push("suggestion_feedback", true, {
      summary: "unavailable",
      error: err.message,
      severity: "warn",
    });
  }

  // node
  // realtime buffers (bounded queues)
  try {
    let ws = { clients: wsClientCount(), enqueued: 0, dropped: 0, written: 0 };
    try {
      const mod = await import("./ws-hub.mjs");
      if (typeof mod.wsOutboundStats === "function") ws = mod.wsOutboundStats();
    } catch {
      /* outbound stats optional until hub exports it */
    }
    const dropRate = ws.enqueued ? ws.dropped / ws.enqueued : 0;
    const wsOk = dropRate < 0.25;
    push("ws.outbound", wsOk, {
      summary: `clients=${ws.clients || wsClientCount()} enqueued=${ws.enqueued || 0} dropped=${ws.dropped || 0} written=${ws.written || 0}`,
      severity: wsOk ? "ok" : "warn",
      ...ws,
      hint: wsOk
        ? null
        : "High WS outbound drop rate — slow subscribers or flood; raise outboundMax or reduce broadcast volume",
    });
  } catch (err) {
    push("ws.outbound", true, {
      summary: "unavailable",
      severity: "info",
      error: err.message,
    });
  }

  try {
    const ev = evictionBufferMetrics();
    const listeners = evictionListenerCount();
    push("eviction.buffer", true, {
      summary: `buffered=${ev.depth ?? "?"} dropped=${ev.dropped} listeners=${listeners}`,
      severity: "ok",
      metrics: ev,
      listeners,
    });
  } catch (err) {
    push("eviction.buffer", true, {
      summary: "unavailable",
      severity: "info",
      error: err.message,
    });
  }

  try {
    const st = streamRegistryStats();
    push("stream.buffers", true, {
      summary: `streams=${st.streams} events=${st.events} dropped=${st.dropped} subs=${st.subscribers}`,
      severity: st.dropped > 0 && st.received && st.dropped / st.received > 0.1 ? "warn" : "ok",
      ...st,
      hint:
        st.dropped > 0
          ? "Stream resume buffers dropped events under capacity — raise stream.capacity if clients need longer replay"
          : null,
    });
  } catch (err) {
    push("stream.buffers", true, {
      summary: "unavailable",
      severity: "info",
      error: err.message,
    });
  }

  // Autonomy + prod hardening (parity with CLI doctor)
  try {
    const { autonomyPolicySummary } = await import("../config/autonomy-policy.mjs");
    const sum = autonomyPolicySummary(cfg);
    push("autonomy.level", true, {
      summary: `level=${sum.level} autoApprove=${sum.autoApprove} policy=${sum.approvalPolicy} maxTurns=${sum.maxTurns} heartbeat=${sum.heartbeatEnabled}`,
      ...sum,
    });
  } catch (err) {
    push("autonomy.level", true, {
      summary: err.message || String(err),
      severity: "warn",
    });
  }
  try {
    if (String(cfg.profile || "").toLowerCase() === "prod") {
      const actions = cfg._prodHardening || [];
      push("prod.hardening", true, {
        summary: actions.length
          ? `applied: ${actions.join("; ")}`
          : "no overrides needed (config already prod-safe)",
        actions,
      });
    }
  } catch (err) {
    push("prod.hardening", true, {
      summary: err.message || String(err),
      severity: "warn",
    });
  }
  try {
    const { canInstallSkills } = await import("../skills/propose.mjs");
    const gate = canInstallSkills(cfg);
    const prof = String(cfg.profile || process.env.XCLAW_PROFILE || "lab").toLowerCase();
    if (prof === "prod" && gate.ok && cfg.skills?.allowInstall) {
      push("skills.install", true, {
        summary: "prod allowInstall=true — auto skill writeback enabled (owner-aware)",
        severity: "warn",
        ...gate,
      });
    } else if (!gate.ok) {
      push("skills.install", true, {
        summary: `gated (${gate.reason}) — proposals only; xclaw skills install --owner-approved`,
        ...gate,
      });
    } else {
      push("skills.install", true, {
        summary: `install allowed (${gate.reason})`,
        ...gate,
      });
    }
  } catch (err) {
    push("skills.install", true, {
      summary: err.message || String(err),
      severity: "warn",
    });
  }

  push("runtime", true, {
    summary: `node ${process.version} · ${process.platform}/${process.arch}`,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    cwd: process.cwd(),
  });

  const failed = checks.filter((c) => c.ok === false);
  const warnings = checks.filter((c) => c.severity === "warn");
  // A report produced BY this gateway must be stamped with the build that
  // produced it. Read off disk, a stale process labelled its own diagnosis
  // with the version it had failed to pick up.
  const version = runningVersion();
  return {
    ok: failed.length === 0,
    service: "XClaw",
    version,
    phase: 7,
    checkedAt: new Date().toISOString(),
    checks,
    failed: failed.map((c) => c.name),
    warnings: warnings.map((c) => c.name),
  };
}

/**
 * Human-readable CLI/doctor text.
 */
export function formatDoctorReport(report, { color = true } = {}) {
  const useColor = color && process.stdout.isTTY;
  const green = (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
  const yellow = (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
  const dim = (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);

  const lines = [];
  lines.push(bold(`XClaw doctor  ${report.version || ""}  phase ${report.phase || ""}`));
  lines.push(dim(report.checkedAt || ""));
  lines.push("");

  const mark = (c) => {
    if (!c.ok) return red("FAIL");
    if (c.severity === "warn") return yellow("WARN");
    if (c.severity === "info") return dim("INFO");
    return green(" OK ");
  };

  const nameWidth = Math.max(12, ...report.checks.map((c) => c.name.length));
  for (const c of report.checks) {
    const label = c.name.padEnd(nameWidth);
    const summary = c.summary || (c.ok ? "ok" : c.error || "failed");
    lines.push(`  ${mark(c)}  ${label}  ${summary}`);
    if (c.hint) {
      lines.push(dim(`         → ${c.hint}`));
    }
    if (!c.ok && c.error) {
      lines.push(dim(`         ${c.error}`));
    }
  }

  lines.push("");
  if (report.ok) {
    lines.push(green(bold("All critical checks passed.")));
  } else {
    lines.push(red(bold(`Failed: ${report.failed.join(", ")}`)));
  }
  if (report.warnings?.length) {
    lines.push(yellow(`Warnings: ${report.warnings.join(", ")}`));
  }
  lines.push("");
  lines.push(dim("Tip: xclaw doctor --json  ·  xclaw self-test  ·  GET /doctor"));
  return lines.join("\n");
}
