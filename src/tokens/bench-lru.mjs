/**
 * Benchmark age-only vs size-weighted tool LRU.
 */
import { applyToolLruByScore, totalChars, collectToolCandidates, scoreCandidates } from "./tool-lru.mjs";

function makeWorkload(kind = "mixed") {
  const messages = [{ role: "system", content: "PREFIX ".repeat(200) }];
  // 15 turns of user/assistant/tool with varying sizes
  for (let i = 0; i < 15; i++) {
    messages.push({ role: "user", content: `do step ${i}` });
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id: `c${i}`, type: "function", function: { name: "xclaw_bash", arguments: "{}" } }],
    });
    let size;
    if (kind === "uniform") size = 3000;
    else if (kind === "giants") size = i % 5 === 0 ? 50000 : 500;
    else {
      // mixed: occasional giants, many medium, few tiny
      if (i % 7 === 0) size = 60000;
      else if (i % 3 === 0) size = 8000;
      else size = 400 + i * 50;
    }
    messages.push({
      role: "tool",
      tool_call_id: `c${i}`,
      content: `result-${i}-` + "X".repeat(size),
    });
  }
  messages.push({ role: "user", content: "finish" });
  messages.push({ role: "assistant", content: "ok" });
  return messages;
}

function summarize(label, beforeChars, result) {
  const freed = beforeChars - result.totalChars;
  return {
    label,
    mode: result.mode,
    beforeChars,
    afterChars: result.totalChars,
    freed,
    freePct: beforeChars ? Number(((100 * freed) / beforeChars).toFixed(2)) : 0,
    truncated: result.truncated,
    stubbed: result.stubbed,
    spliced: result.spliced,
    actions: result.actions.length,
    ms: Number(result.ms.toFixed(4)),
  };
}

export function benchLruModes(opts = {}) {
  const workloads = opts.workloads || ["mixed", "uniform", "giants"];
  const maxChars = opts.maxChars ?? 25000;
  const toolMaxChars = opts.toolMaxChars ?? 2000;
  const protectRecent = opts.protectRecent ?? 4;
  const iterations = opts.iterations ?? 5;

  const rows = [];

  for (const kind of workloads) {
    const base = makeWorkload(kind);
    const before = totalChars(base);

    for (const mode of ["age", "size", "size_weighted"]) {
      let last = null;
      let msSum = 0;
      for (let i = 0; i < iterations; i++) {
        const r = applyToolLruByScore(base.map((m) => ({ ...m })), {
          mode,
          maxChars,
          toolMaxChars,
          protectRecent,
          wAge: 0.35,
          wSize: 0.65,
          sizeTransform: "log",
          allowSplice: true,
        });
        last = r;
        msSum += r.ms;
      }
      const summary = summarize(`${kind}/${mode}`, before, last);
      summary.msAvg = Number((msSum / iterations).toFixed(4));
      rows.push(summary);
    }
  }

  // Ranking quality: on mixed, first truncated index sizes
  const mixed = makeWorkload("mixed");
  const cands = scoreCandidates(collectToolCandidates(mixed, 4), {
    mode: "size_weighted",
    wAge: 0.35,
    wSize: 0.65,
    sizeTransform: "log",
  }).sort((a, b) => b.score - a.score);

  return {
    at: Date.now(),
    params: { maxChars, toolMaxChars, protectRecent, iterations },
    rows,
    topScoresMixed: cands.slice(0, 5).map((c) => ({
      index: c.index,
      age: c.age,
      size: c.size,
      score: Number(c.score.toFixed(4)),
    })),
  };
}

export function formatLruBench(bench) {
  const lines = [];
  lines.push("Tool LRU benchmark: age vs size vs size_weighted");
  lines.push(`params: maxChars=${bench.params.maxChars} toolMaxChars=${bench.params.toolMaxChars}`);
  lines.push("");
  lines.push(
    "workload/mode".padEnd(22) +
      "before".padStart(8) +
      "after".padStart(8) +
      "freed%".padStart(8) +
      "trunc".padStart(6) +
      "stub".padStart(6) +
      "ms".padStart(10)
  );
  for (const r of bench.rows) {
    lines.push(
      r.label.padEnd(22) +
        String(r.beforeChars).padStart(8) +
        String(r.afterChars).padStart(8) +
        String(r.freePct).padStart(8) +
        String(r.truncated).padStart(6) +
        String(r.stubbed).padStart(6) +
        String(r.msAvg).padStart(10)
    );
  }
  lines.push("");
  lines.push("Top size_weighted scores (mixed workload):");
  for (const t of bench.topScoresMixed) {
    lines.push(`  idx=${t.index} age=${t.age} size=${t.size} score=${t.score}`);
  }
  return lines.join("\n");
}
