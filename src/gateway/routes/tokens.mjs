/**
 * Gateway token-economics HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   POST /tokens/cache-by-tool · /tokens/estimate
 *   GET  /tokens/cost · GET|POST /tokens/bench · GET|POST /tokens/probe
 *   GET  /events/eviction        (the SSE /events/eviction/stream stays inline)
 */
import { estimateRequestTokens, resolveTokenizer } from "../../tokens/count.mjs";
import { probeTokenizerRuntime, applyProbeCalibration } from "../../tokens/probes.mjs";
import { benchProbeOverhead, formatBenchReport } from "../../tokens/bench.mjs";
import { readCostLedger, defaultLedgerPath } from "../../tokens/usage-tracker.mjs";
import { analyzeCacheByTool, formatCacheByToolReport } from "../../tokens/cache-by-tool.mjs";
import { listEvictionEvents, evictionListenerCount } from "../eviction-events.mjs";

/**
 * @param {object} args — standard route args
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleTokensRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (p === "/tokens/cache-by-tool" && method === "POST") {
    const body = await readBody(req);
    const analysis = analyzeCacheByTool({
      usageTurns: body.usageTurns || body.usage?.turns || [],
      toolTrace: body.toolTrace || [],
      events: body.events || [],
    });
    json(res, 200, {
      ok: true,
      summary: formatCacheByToolReport(analysis),
      analysis,
    });
    return true;
  }

  if (p === "/events/eviction" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 50);
    json(res, 200, {
      events: listEvictionEvents({ limit }),
      listeners: evictionListenerCount(),
    });
    return true;
  }

  // Cost governor (daily soft/hard USD caps + spend pause). The control UI's
  // governor card and Pause/Resume buttons called these since day one — the
  // routes never existed ("Cost governor: not found" in the panel).
  if (p === "/cost" && method === "GET") {
    const { getCostGovernorStatus } = await import("../../tokens/cost-governor.mjs");
    json(res, 200, await getCostGovernorStatus(cfg));
    return true;
  }
  if (p === "/cost/pause" && method === "POST") {
    const body = await readBody(req);
    const { setCostGovernorPaused, getCostGovernorStatus } = await import(
      "../../tokens/cost-governor.mjs"
    );
    await setCostGovernorPaused(cfg, body.paused !== false);
    json(res, 200, { ok: true, ...(await getCostGovernorStatus(cfg)) });
    return true;
  }

  // Per-provider Usage & Logs (control UI). Provider filtering is first-class:
  // every response is scoped to exactly one provider (or explicitly "all").
  if (p === "/usage/dashboard" && method === "GET") {
    const { buildUsageDashboard } = await import("../../tokens/usage-analytics.mjs");
    json(res, 200, await buildUsageDashboard(cfg, {
      days: url.searchParams.get("days") || 7,
    }));
    return true;
  }
  if (p === "/usage" && method === "GET") {
    const { usageSummary } = await import("../../tokens/usage-analytics.mjs");
    json(res, 200, await usageSummary(cfg, {
      provider: url.searchParams.get("provider") || "all",
      days: url.searchParams.get("days") || 7,
    }));
    return true;
  }
  if (p === "/logs" && method === "GET") {
    const { requestLogs } = await import("../../tokens/usage-analytics.mjs");
    json(res, 200, await requestLogs(cfg, {
      provider: url.searchParams.get("provider") || "all",
      limit: url.searchParams.get("limit") || 50,
      model: url.searchParams.get("model") || null,
      q: url.searchParams.get("q") || null,
    }));
    return true;
  }
  if (p === "/logs/run" && method === "GET") {
    const { requestLogDetail } = await import("../../tokens/usage-analytics.mjs");
    const out = await requestLogDetail(cfg, url.searchParams.get("id") || "");
    json(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (p === "/tokens/cost" && method === "GET") {
    const ledger = cfg.tokens?.ledgerPath || defaultLedgerPath();
    const since = url.searchParams.get("since");
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw == null ? 50 : Number(limitRaw);
    const agg = await readCostLedger(ledger, { since, limit: Number.isFinite(limit) ? limit : 50 });
    json(res, 200, { ok: true, ...agg });
    return true;
  }

  if (p === "/tokens/bench" && (method === "GET" || method === "POST")) {
    const body = method === "POST" ? await readBody(req).catch(() => ({})) : {};
    const model = body.model || url.searchParams.get("model") || cfg.agent?.model || "gpt-4o-mini";
    const iterations = Number(body.iterations || url.searchParams.get("iterations") || 100);
    const bench = await benchProbeOverhead({
      cfg,
      model,
      iterations: Number.isFinite(iterations) ? iterations : 100,
      latencySamples: Number(body.latencySamples || 40),
      probeIterations: Number(body.probeIterations || 5),
      agentTurnsPerDay: Number(body.agentTurnsPerDay || 500),
    });
    json(res, 200, {
      ok: true,
      summary: formatBenchReport(bench),
      bench,
    });
    return true;
  }

  if (p === "/tokens/probe" && (method === "GET" || method === "POST")) {
    const body = method === "POST" ? await readBody(req).catch(() => ({})) : {};
    const model = body.model || url.searchParams.get("model") || cfg.agent?.model || "gpt-4o-mini";
    const calibrate = body.calibrate === true || url.searchParams.get("calibrate") === "1";
    const result = await probeTokenizerRuntime(cfg, model, {
      baseUrl: cfg.agent?.baseUrl,
    });
    let calibrated = null;
    if (calibrate && result.probe?.calibration?.suggested) {
      const { cfg: newTok, applied } = applyProbeCalibration(cfg.tokens, result.probe);
      if (applied) {
        calibrated = newTok;
        // runtime only — does not persist to disk
        cfg.tokens = { ...cfg.tokens, ...newTok };
      }
    }
    json(res, 200, {
      ok: result.probe.ok,
      ...result,
      calibrated,
    });
    return true;
  }

  if (p === "/tokens/estimate" && method === "POST") {
    const body = await readBody(req);
    const model = body.model || cfg.agent?.model || "gpt-4o-mini";
    const tok = await resolveTokenizer(cfg, model);
    const cfgTok = {
      tokens: {
        ...(cfg.tokens || {}),
        mode: tok.encodeFn ? "tiktoken" : "heuristic",
        _encodeFn: tok.encodeFn,
      },
    };
    const messages = body.messages || [
      { role: "user", content: body.text || body.message || "" },
    ];
    const est = estimateRequestTokens({
      messages,
      tools: body.tools,
      model,
      cfg: cfgTok,
    });
    json(res, 200, { ok: true, tokenizer: tok.mode, package: tok.package || null, ...est });
    return true;
  }

  return false;
}

export default { tryHandleTokensRoute };
