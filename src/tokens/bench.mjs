/**
 * Benchmark overhead of token probes and counting paths.
 *
 * Measures:
 *  - probeEncodeOnce latency
 *  - full runTokenProbes wall time
 *  - estimateRequestTokens cost
 *  - heuristic vs tiktoken throughput
 *  - amortized cost if probes run on every agent turn (anti-pattern) vs once at start
 */

import { performance } from "node:perf_hooks";
import {
  runTokenProbes,
  probeEncodeOnce,
  DEFAULT_PROBE_SAMPLES,
} from "./probes.mjs";
import {
  countTextTokens,
  estimateRequestTokens,
  resolveTokenizer,
} from "./count.mjs";

/**
 * @param {() => void} fn
 * @param {number} iterations
 */
function timeIt(fn, iterations = 1) {
  // warmup
  try {
    fn();
  } catch {
    /* */
  }
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const t1 = performance.now();
  const totalMs = t1 - t0;
  return {
    iterations,
    totalMs: round(totalMs),
    avgMs: round(totalMs / iterations),
    opsPerSec: totalMs > 0 ? round((iterations / totalMs) * 1000) : null,
  };
}

function round(n, d = 4) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Collect latency samples for a single operation.
 */
function sampleLatencies(fn, samples = 50) {
  const xs = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      fn();
    } catch {
      /* count failed runs still */
    }
    xs.push(performance.now() - t0);
  }
  xs.sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  return {
    samples: xs.length,
    minMs: round(xs[0]),
    maxMs: round(xs[xs.length - 1]),
    avgMs: round(sum / xs.length),
    p50Ms: round(percentile(xs, 50)),
    p95Ms: round(percentile(xs, 95)),
    p99Ms: round(percentile(xs, 99)),
  };
}

/**
 * Run overhead benchmarks.
 *
 * @param {object} opts
 * @param {object} [opts.cfg]
 * @param {string} [opts.model]
 * @param {number} [opts.iterations]  default 100 for microbenches
 * @param {number} [opts.latencySamples] default 40
 */
export async function benchProbeOverhead(opts = {}) {
  const cfg = opts.cfg || {};
  const model = opts.model || cfg.agent?.model || "gpt-4o-mini";
  const iterations = opts.iterations ?? 100;
  const latencySamples = opts.latencySamples ?? 40;

  const tok = await resolveTokenizer(cfg, model, {
    baseUrl: cfg.agent?.baseUrl,
  });

  const prose = DEFAULT_PROBE_SAMPLES.find((s) => s.id === "prose")?.text || "hello world";
  const code = DEFAULT_PROBE_SAMPLES.find((s) => s.id === "code")?.text || "const x = 1;";
  const messages = [
    { role: "system", content: prose },
    { role: "user", content: "List files in /tmp and summarize." },
  ];
  const tools = [
    {
      type: "function",
      function: {
        name: "xclaw_bash",
        description: "Run a shell command",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    },
  ];

  // --- Micro: heuristic count ---
  const heurProse = timeIt(() => {
    countTextTokens(prose, { mode: "heuristic", charsPerToken: 4 });
  }, iterations);

  const heurCode = timeIt(() => {
    countTextTokens(code, { mode: "heuristic", adaptive: true, codeCharsPerToken: 2.5 });
  }, iterations);

  // --- Micro: tiktoken if available ---
  let tikMicro = null;
  let tikLatency = null;
  if (tok.encodeFn) {
    tikMicro = timeIt(() => {
      probeEncodeOnce(tok.encodeFn, prose);
    }, iterations);
    tikLatency = sampleLatencies(() => {
      tok.encodeFn(prose);
    }, latencySamples);
  }

  // --- Full probe suite (few iterations — heavier) ---
  const probeIters = Math.min(20, Math.max(3, opts.probeIterations ?? 5));
  const fullProbe = timeIt(() => {
    runTokenProbes({
      encodeFn: tok.encodeFn,
      model,
      tokensCfg: cfg.tokens,
      baseUrl: cfg.agent?.baseUrl,
    });
  }, probeIters);

  const fullProbeLatency = sampleLatencies(() => {
    runTokenProbes({
      encodeFn: tok.encodeFn,
      model,
      tokensCfg: cfg.tokens,
    });
  }, Math.min(15, latencySamples));

  // --- estimateRequestTokens ---
  const tokenCfg = {
    tokens: {
      ...(cfg.tokens || {}),
      mode: tok.encodeFn ? "tiktoken" : "heuristic",
      _encodeFn: tok.encodeFn,
    },
  };
  const estimateBench = timeIt(() => {
    estimateRequestTokens({
      messages,
      tools,
      model,
      cfg: tokenCfg,
    });
  }, iterations);

  const estimateLatency = sampleLatencies(() => {
    estimateRequestTokens({ messages, tools, model, cfg: tokenCfg });
  }, latencySamples);

  // --- One-shot full resolve+probe (startup path) ---
  const startupPath = sampleLatencies(() => {
    // resolve is async — approximate by runTokenProbes only here; startup measured separately below
    runTokenProbes({ encodeFn: tok.encodeFn, model, tokensCfg: cfg.tokens });
  }, 10);

  const tResolve0 = performance.now();
  await resolveTokenizer(cfg, model, { baseUrl: cfg.agent?.baseUrl });
  const resolveMs = round(performance.now() - tResolve0);

  const tProbe0 = performance.now();
  const probeReport = runTokenProbes({
    encodeFn: tok.encodeFn,
    model,
    tokensCfg: cfg.tokens,
  });
  const oneProbeMs = round(performance.now() - tProbe0);

  // --- Amortization model ---
  const agentTurnsPerDay = opts.agentTurnsPerDay ?? 500;
  const probeOnceMs = oneProbeMs;
  const estimatePerTurnMs = estimateLatency.avgMs || estimateBench.avgMs || 0;
  const naiveProbeEveryTurnMs = (fullProbeLatency.avgMs || fullProbe.avgMs || 0) * agentTurnsPerDay;
  const recommendedMs = probeOnceMs + estimatePerTurnMs * agentTurnsPerDay;

  return {
    at: Date.now(),
    model,
    tokenizer: {
      mode: tok.mode,
      encoding: tok.encoding || null,
      package: tok.package || null,
      fallback: tok.fallback || null,
    },
    microbench: {
      iterations,
      heuristicProse: heurProse,
      heuristicCode: heurCode,
      tiktokenProse: tikMicro,
      estimateRequest: estimateBench,
      fullProbeSuite: fullProbe,
    },
    latency: {
      samples: latencySamples,
      tiktokenEncode: tikLatency,
      estimateRequest: estimateLatency,
      fullProbeSuite: fullProbeLatency,
    },
    startup: {
      resolveTokenizerMs: resolveMs,
      oneFullProbeMs: oneProbeMs,
      totalStartupProbeMs: round(resolveMs + oneProbeMs),
    },
    amortization: {
      agentTurnsPerDay,
      costIfProbeOnceMs: round(recommendedMs),
      costIfProbeEveryTurnMs: round(naiveProbeEveryTurnMs),
      savingsMs: round(naiveProbeEveryTurnMs - recommendedMs),
      recommendation:
        oneProbeMs < 50
          ? "probe_on_start_cheap"
          : oneProbeMs < 200
            ? "probe_on_start_ok"
            : "probe_on_start_heavy_consider_disable",
    },
    probeSummary: {
      ok: probeReport.ok,
      recommendation: probeReport.recommendation,
      sampleCount: probeReport.samples?.length ?? 0,
    },
  };
}

/**
 * Human-readable summary lines.
 */
export function formatBenchReport(bench) {
  const lines = [];
  lines.push(`Token bench · model=${bench.model} · tokenizer=${bench.tokenizer.mode}`);
  lines.push(
    `  heuristic prose: ${bench.microbench.heuristicProse.avgMs} ms/op (${bench.microbench.heuristicProse.opsPerSec} ops/s)`
  );
  if (bench.microbench.tiktokenProse) {
    lines.push(
      `  tiktoken prose:  ${bench.microbench.tiktokenProse.avgMs} ms/op (${bench.microbench.tiktokenProse.opsPerSec} ops/s)`
    );
  } else {
    lines.push(`  tiktoken prose:  n/a`);
  }
  lines.push(
    `  estimateRequest: ${bench.microbench.estimateRequest.avgMs} ms/op · p95=${bench.latency.estimateRequest?.p95Ms} ms`
  );
  lines.push(
    `  full probe suite: ${bench.microbench.fullProbeSuite.avgMs} ms/op · p95=${bench.latency.fullProbeSuite?.p95Ms} ms`
  );
  lines.push(
    `  startup: resolve ${bench.startup.resolveTokenizerMs} ms + probe ${bench.startup.oneFullProbeMs} ms = ${bench.startup.totalStartupProbeMs} ms`
  );
  lines.push(
    `  amortization (${bench.amortization.agentTurnsPerDay} turns/day): once=${bench.amortization.costIfProbeOnceMs} ms vs every-turn=${bench.amortization.costIfProbeEveryTurnMs} ms · ${bench.amortization.recommendation}`
  );
  return lines.join("\n");
}
