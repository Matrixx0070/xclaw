/**
 * Gateway ops/observability HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET  /report · /status/report · /dashboard · /profile
 *   POST /config/reload
 *   *    /routes · /version · /metrics · /ready · /readiness
 *   *    /health · /gateway/health · /gateway/info · /info
 *   *    /computer/health · GET /channels/status · * /gateway
 */
import { isComputerRunning } from "../../computer/manager.mjs";

/**
 * @param {object} args — standard route args + root, webchatEnabled,
 *   channelManager (live), version {XCLAW_VERSION, XCLAW_PHASE}
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleOpsRoute({
  p,
  method,
  req,
  res,
  url,
  cfg,
  json,
  root,
  webchatEnabled,
  channelManager,
  XCLAW_VERSION,
  XCLAW_PHASE,
}) {
  if ((p === "/report" || p === "/status/report") && method === "GET") {
    const { buildStatusReport } = await import("../report.mjs");
    const rep = await buildStatusReport(cfg);
    if (url.searchParams.get("format") === "json") {
      json(res, 200, rep);
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(rep.markdown);
    return true;
  }
  if (p === "/config/reload" && method === "POST") {
    const { softReloadConfig } = await import("../../config/reload.mjs");
    try {
      const r = await softReloadConfig(cfg);
      json(res, 200, r);
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
    }
    return true;
  }
  if (p === "/dashboard" && method === "GET") {
    const { buildDashboard } = await import("../dashboard.mjs");
    json(res, 200, await buildDashboard(cfg));
    return true;
  }
  if (p === "/profile" && method === "GET") {
    const { listProfiles } = await import("../../config/profiles.mjs");
    json(res, 200, {
      active: cfg.profile || "dev",
      autoApprove: cfg.security?.autoApprove,
      maxTurns: cfg.agent?.maxTurns,
      evalCron: cfg.eval?.cron,
      profiles: listProfiles(),
    });
    return true;
  }

  if (p === "/routes") {
    const { listRoutes } = await import("../routes-map.mjs");
    const routes = listRoutes();
    json(res, 200, { count: routes.length, routes });
    return true;
  }
  if (p === "/version") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { uptimeInfo } = await import("../uptime.mjs");
    let version = "0.0.0";
    try {
      version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    } catch {}
    json(res, 200, {
      name: "xclaw",
      version,
      profile: cfg.profile || "dev",
      ...uptimeInfo(),
    });
    return true;
  }
  if (p === "/metrics") {
    const { renderMetrics } = await import("../metrics.mjs");
    const text = await renderMetrics(cfg);
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(text);
    return true;
  }
  if (p === "/ready" || p === "/readiness") {
    const { checkReadiness } = await import("../readiness.mjs");
    const r = await checkReadiness(cfg);
    json(res, r.status, r.body);
    return true;
  }
  if (p === "/health" || p === "/gateway/health") {
    const computerOk = await isComputerRunning(cfg);
    json(res, 200, {
      status: "healthy",
      service: "XClaw-Gateway",
      version: XCLAW_VERSION,
      phase: XCLAW_PHASE,
      computer: computerOk ? "up" : "down",
      computerUrl: `http://${cfg.computer.host}:${cfg.computer.port}`,
      webchat: webchatEnabled,
      sse: true,
    });
    return true;
  }

  if (p === "/gateway/info" || p === "/info") {
    json(res, 200, {
      name: "XClaw Gateway",
      version: XCLAW_VERSION,
      phase: XCLAW_PHASE,
      // Sanitized subset — this route is intentionally reachable without a
      // token (the UIs poll it for status chips), so it must never include
      // one. It used to dump cfg.gateway verbatim, WITH the operator token:
      // any unauthenticated loopback caller got the key to every gate.
      gateway: {
        host: cfg.gateway?.host,
        port: cfg.gateway?.port,
        authStrict: Boolean(cfg.gateway?.authStrict),
        requireAuth: Boolean(cfg.gateway?.requireAuth),
        tokenSet: Boolean(cfg.gateway?.token),
        publicUi: cfg.gateway?.publicUi !== false,
      },
      computer: {
        host: cfg.computer.host,
        port: cfg.computer.port,
        healthy: await isComputerRunning(cfg),
      },
      agent: {
        provider: cfg.agent?.provider,
        model: cfg.agent?.model,
        maxTurns: cfg.agent?.maxTurns,
        hasApiKey: Boolean(
          cfg.agent?.apiKey ||
            process.env.OPENAI_API_KEY ||
            process.env.XCLAW_API_KEY
        ),
      },
      // Non-secret eviction/context summary for the control UI (the old
      // /config route this card used was dropped in a refactor; a raw
      // config dump would leak secrets anyway).
      eviction: (() => {
        const e = cfg.tokens?.eviction || cfg.eviction || {};
        const lru = e.lru || {};
        return {
          policy: e.policy || "hybrid",
          maxMessages: e.maxMessages ?? null,
          maxChars: e.maxChars ?? null,
          toolMaxChars: e.toolMaxChars ?? e.maxToolResultChars ?? null,
          lruMode: lru.mode || "size_weighted",
          lruDynamic: Boolean(lru.dynamic),
        };
      })(),
      channels: {
        webchat: { enabled: webchatEnabled, path: "/chat/", sse: true },
        messaging: channelManager.status(),
      },
      paths: cfg.paths,
    });
    return true;
  }

  if (p === "/computer/health") {
    try {
      const u = `http://${cfg.computer.host}:${cfg.computer.port}/health`;
      const r = await fetch(u);
      const body = await r.json();
      json(res, r.status, body);
    } catch (e) {
      json(res, 502, { error: "computer unreachable", detail: e.message });
    }
    return true;
  }

  if (p === "/channels/status" && method === "GET") {
    json(res, 200, {
      webchat: { enabled: webchatEnabled },
      messaging: channelManager.status(),
    });
    return true;
  }

  if (p === "/gateway") {
    json(res, 200, {
      message: "XClaw Gateway Phase 7",
      endpoints: [
        "GET  /health",
        "GET  /gateway/info",
        "POST /agent/run",
        "POST /agent/run/stream          (SSE or NDJSON via Accept)",
        "POST /swarm/run",
        "POST /swarm/run/stream       (SSE or NDJSON via Accept)",
        "GET  /swarm",
        "GET  /swarm/:id",
        "GET  /swarm/merges",
        "POST /swarm/merges/:id/approve",
        "POST /swarm/merges/:id/reject",
        "GET  /xclaw/jwks.json",
        "GET  /control/",
        "GET  /chat/",
        "POST /channel/webchat/message",
        "POST /channel/webchat/message/stream  (SSE or NDJSON via Accept)",
        "GET  /channel/webchat/history?sessionId=",
        "GET  /channel/webchat/sessions",
        "GET  /channels/status",
        "GET  /events/eviction",
        "GET  /events/eviction/stream  (SSE)",
        "WS   /ws/events                 (WebSocket JSON)",
        "GET  /tokens/cost",
        "GET  /tokens/bench",
        "GET  /tokens/probe",
        "POST /tokens/probe",
        "GET  /skills",
        "GET  /memory?cwd=",
      ],
    });
    return true;
  }


  // --- One-off context reads (moved from routes/api.mjs) ---
  if (p === "/skills" && method === "GET") {
    const { loadAllSkills } = await import("../../skills/loader.mjs");
    const skills = await loadAllSkills({
      configDir: cfg.paths?.configDir,
      cwd: process.cwd(),
    });
    json(res, 200, {
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        path: s.path,
      })),
    });
    return true;
  }
  if (p === "/memory" && method === "GET") {
    const { loadMemoryFiles } = await import("../../skills/loader.mjs");
    const cwd = new URL(req.url, "http://x").searchParams.get("cwd") || process.cwd();
    const files = await loadMemoryFiles(cwd);
    json(res, 200, {
      files: files.map((f) => ({
        name: f.name,
        path: f.path,
        chars: f.body.length,
        preview: f.body.slice(0, 200),
      })),
    });
    return true;
  }
  if (p === "/providers/route" && method === "GET") {
    const { resolveProviderRoute } = await import("../../providers/router.mjs");
    const model = url.searchParams.get("model") || undefined;
    json(res, 200, resolveProviderRoute(cfg, { model }));
    return true;
  }

  return false;
}

export default { tryHandleOpsRoute };
