/**
 * Runtime token-counting probes for XClaw
 *
 * - Validate encodeFn works
 * - Compare tiktoken vs heuristic on sample corpus
 * - Optionally calibrate charsPerToken from probe ratios
 * - Safe: never throws to callers (returns structured results)
 */

import {
  countTextTokens,
  heuristicCount,
  isCodeHeavy,
} from "./count.mjs";
import { selectEncoding, isTiktokenEncoding } from "./encoding.mjs";

/** Built-in sample corpus spanning prose, code, JSON, paths */
export const DEFAULT_PROBE_SAMPLES = [
  {
    id: "short",
    text: "Hello, world!",
  },
  {
    id: "prose",
    text:
      "XClaw is a personal AI assistant with a real computer sandbox. " +
      "It can run shell commands, read and write files, and control a browser.",
  },
  {
    id: "code",
    text: `export function add(a, b) {
  return a + b;
}
const tools = [{ name: "xclaw_bash", parameters: { type: "object" } }];
if (tools.length > 0) { console.log(JSON.stringify(tools)); }
`,
  },
  {
    id: "json",
    text: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "List files in /tmp" },
      ],
      tools: [{ type: "function", function: { name: "xclaw_bash" } }],
    }),
  },
  {
    id: "paths",
    text: "/home/user/projects/xclaw/src/tokens/count.mjs\n~/.xclaw/skills/example-shell/SKILL.md",
  },
  {
    id: "unicode",
    text: "Emoji 🦞 and 中文 tokens — café naïve",
  },
];

/**
 * Probe a single encode function with one string.
 * @returns {{ ok: boolean, tokens?: number, ms?: number, error?: string }}
 */
export function probeEncodeOnce(encodeFn, text) {
  const start = performance.now();
  try {
    if (typeof encodeFn !== "function") {
      return { ok: false, error: "encodeFn_not_function" };
    }
    const encoded = encodeFn(text);
    const n = Array.isArray(encoded)
      ? encoded.length
      : typeof encoded?.length === "number"
        ? encoded.length
        : null;
    const ms = performance.now() - start;
    if (n == null || !Number.isFinite(n) || n < 0) {
      return { ok: false, error: "invalid_encode_result", ms };
    }
    return { ok: true, tokens: n, ms };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      ms: performance.now() - start,
    };
  }
}

/**
 * Run full probe suite against an encodeFn and/or heuristic.
 *
 * @param {object} opts
 * @param {((s: string) => unknown) | null} [opts.encodeFn]
 * @param {string} [opts.model]
 * @param {object} [opts.tokensCfg]
 * @param {string} [opts.baseUrl]
 * @param {Array<{id: string, text: string}>} [opts.samples]
 * @returns {object} probe report
 */
export function runTokenProbes(opts = {}) {
  const samples = opts.samples || DEFAULT_PROBE_SAMPLES;
  const profile = selectEncoding({
    model: opts.model,
    baseUrl: opts.baseUrl,
    provider: opts.provider,
    tokensCfg: opts.tokensCfg,
  });

  const encodeFn = opts.encodeFn || null;
  const hasTiktoken = typeof encodeFn === "function";

  const rows = [];
  let tiktokenOk = 0;
  let tiktokenFail = 0;
  let sumRatio = 0; // chars / tiktoken_tokens for prose-like
  let ratioCount = 0;
  let sumCodeRatio = 0;
  let codeRatioCount = 0;
  let totalTiktokenMs = 0;

  for (const sample of samples) {
    const text = sample.text || "";
    const chars = text.length;
    const heavy = isCodeHeavy(text);

    const heur = heuristicCount(text, {
      charsPerToken: profile.charsPerToken,
      proseCharsPerToken: profile.charsPerToken,
      codeCharsPerToken: profile.codeCharsPerToken,
      adaptive: true,
    });

    let tik = null;
    if (hasTiktoken) {
      const once = probeEncodeOnce(encodeFn, text);
      if (once.ok) {
        tiktokenOk++;
        totalTiktokenMs += once.ms || 0;
        tik = { tokens: once.tokens, ms: once.ms };
        if (once.tokens > 0) {
          const ratio = chars / once.tokens;
          if (heavy) {
            sumCodeRatio += ratio;
            codeRatioCount++;
          } else {
            sumRatio += ratio;
            ratioCount++;
          }
        }
      } else {
        tiktokenFail++;
        tik = { error: once.error, ms: once.ms };
      }
    }

    const row = {
      id: sample.id,
      chars,
      codeHeavy: heavy,
      heuristicTokens: heur.tokens,
      tiktokenTokens: tik?.tokens ?? null,
      tiktokenError: tik?.error ?? null,
      ms: tik?.ms ?? null,
    };

    if (tik?.tokens != null && heur.tokens > 0) {
      row.heuristicVsTiktoken = Number((heur.tokens / tik.tokens).toFixed(3));
    }

    rows.push(row);
  }

  const report = {
    ok: !hasTiktoken || tiktokenFail === 0,
    at: Date.now(),
    model: opts.model || null,
    encoding: profile.encoding,
    family: profile.family,
    provider: profile.provider,
    hasTiktoken,
    tiktokenOk,
    tiktokenFail,
    samples: rows,
    timing: hasTiktoken
      ? { totalMs: Number(totalTiktokenMs.toFixed(3)), avgMs: Number((totalTiktokenMs / Math.max(samples.length, 1)).toFixed(3)) }
      : null,
    calibration: null,
    recommendation: null,
  };

  // Calibrate chars/token from successful tiktoken probes
  if (tiktokenOk > 0) {
    const proseCpt =
      ratioCount > 0 ? Number((sumRatio / ratioCount).toFixed(2)) : null;
    const codeCpt =
      codeRatioCount > 0 ? Number((sumCodeRatio / codeRatioCount).toFixed(2)) : null;

    report.calibration = {
      proseCharsPerToken: proseCpt,
      codeCharsPerToken: codeCpt,
      fromSamples: tiktokenOk,
      // clamp to sane bounds
      suggested: {
        proseCharsPerToken: proseCpt != null ? clamp(proseCpt, 2, 8) : profile.charsPerToken,
        codeCharsPerToken: codeCpt != null ? clamp(codeCpt, 1.5, 5) : profile.codeCharsPerToken,
      },
    };

    const drift = rows
      .filter((r) => r.heuristicVsTiktoken != null)
      .map((r) => Math.abs(1 - r.heuristicVsTiktoken));
    const maxDrift = drift.length ? Math.max(...drift) : 0;
    report.recommendation =
      maxDrift > 0.35
        ? "heuristic_drift_high"
        : maxDrift > 0.15
          ? "heuristic_drift_moderate"
          : "heuristic_aligned";
  } else if (hasTiktoken && tiktokenFail > 0) {
    report.recommendation = "tiktoken_probe_failed_use_heuristic";
  } else if (!hasTiktoken && isTiktokenEncoding(profile.encoding)) {
    report.recommendation = "install_gpt_tokenizer_for_exact_counts";
  } else if (!isTiktokenEncoding(profile.encoding)) {
    report.recommendation = "use_provider_count_api_for_exact";
  } else {
    report.recommendation = "heuristic_only";
  }

  return report;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Apply calibration suggestions onto a tokens config object (pure).
 */
export function applyProbeCalibration(tokensCfg, report) {
  const cfg = { ...(tokensCfg || {}) };
  const sug = report?.calibration?.suggested;
  if (!sug) return { cfg, applied: false };
  return {
    cfg: {
      ...cfg,
      proseCharsPerToken: sug.proseCharsPerToken,
      codeCharsPerToken: sug.codeCharsPerToken,
      charsPerToken: sug.proseCharsPerToken,
      calibratedAt: report.at,
      calibratedEncoding: report.encoding,
    },
    applied: true,
  };
}

/**
 * Convenience: resolve tokenizer then probe.
 */
export async function probeTokenizerRuntime(cfg = {}, model = "", hints = {}) {
  const { resolveTokenizer } = await import("./count.mjs");
  const tok = await resolveTokenizer(cfg, model, hints);
  const report = runTokenProbes({
    encodeFn: tok.encodeFn,
    model,
    baseUrl: hints.baseUrl || cfg.agent?.baseUrl,
    provider: hints.provider || cfg.tokens?.provider,
    tokensCfg: cfg.tokens,
  });
  return {
    tokenizer: {
      mode: tok.mode,
      encoding: tok.encoding,
      package: tok.package || null,
      fallback: tok.fallback || null,
    },
    probe: report,
  };
}
