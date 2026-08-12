#!/usr/bin/env node
/**
 * Live L3 vote — 3 research nodes through full runSwarmFanOut join path.
 *
 * Modes:
 *   --mock     (default) inject spawnSubagent with fixed JSON ballots (no API $)
 *   --live     real spawnSubagent (needs XAI_API_KEY / XCLAW_API_KEY / OPENAI_API_KEY)
 *
 *   node scripts/live-l3-vote.mjs
 *   node scripts/live-l3-vote.mjs --live
 *   node scripts/live-l3-vote.mjs --mock --json
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runSwarmFanOut } from "../src/agents/swarm-run.mjs";
import { getSwarmRun } from "../src/agents/swarm-store.mjs";

const live = process.argv.includes("--live");
const jsonOut = process.argv.includes("--json");

/** Mock: different ballots so majority is meaningful */
function mockSpawnVote() {
  const byNode = {
    r1: {
      ok: true,
      text: `Research notes: signal looks constructive.\n\`\`\`json\n{"label":"buy","risk":"low","confidence":0.74}\n\`\`\``,
    },
    r2: {
      ok: true,
      text: `Research notes: similar conclusion.\n\`\`\`json\n{"label":"buy","risk":"med","confidence":0.61}\n\`\`\``,
    },
    r3: {
      ok: true,
      text: `Research notes: prefer caution.\n\`\`\`json\n{"label":"hold","risk":"low","confidence":0.88}\n\`\`\``,
    },
  };
  let seq = 0;
  return async (opts) => {
    const id = `l3-mock-${++seq}`;
    const m = String(opts.task || "").match(/Subtask \(([^)]+)\):/);
    const nodeId = m?.[1] || "r1";
    const pack = byNode[nodeId] || byNode.r1;
    // Ensure research prompt / ballot instruction was injected
    const hasBallotHint = /JSON ballot|confidence/i.test(opts.task || "");
    return {
      ok: pack.ok,
      id,
      status: "done",
      result: {
        text: pack.text + (hasBallotHint ? "" : "\n"),
        turns: 1,
        workspace: null,
        meta: { hasBallotHint },
      },
    };
  };
}

async function main() {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-l3-vote-"));
  const cfg = {
    paths: { configDir },
    profile: "lab",
    swarm: {
      enabled: true,
      maxParallel: 3,
      mergeEnabled: false,
      voteEnabled: true,
      voteTieBreak: "confidence",
      voteMinBallots: 2,
      voteMinShare: 0.5,
      voteRoles: ["research"],
    },
    agent: {
      apiKey:
        process.env.XCLAW_API_KEY ||
        process.env.XAI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        undefined,
    },
  };

  const goal =
    "Classify the stance as buy, hold, or sell. Each research agent MUST end with a JSON ballot: " +
    '{"label":"buy|hold|sell","risk":"low|med|high","confidence":0.0-1.0}';

  const tasks = [
    { id: "r1", role: "research", task: "Independent assessment A — emit JSON ballot only at the end." },
    { id: "r2", role: "research", task: "Independent assessment B — emit JSON ballot only at the end." },
    { id: "r3", role: "research", task: "Independent assessment C — emit JSON ballot only at the end." },
  ];

  if (live) {
    const key = cfg.agent.apiKey;
    if (!key) {
      console.error(
        "LIVE mode requires XCLAW_API_KEY or XAI_API_KEY or OPENAI_API_KEY"
      );
      process.exit(2);
    }
    console.log("Mode: LIVE (real subagents)\n");
  } else {
    console.log("Mode: MOCK spawn through full runSwarmFanOut join path\n");
  }

  const input = {
    goal,
    tasks,
    spawnSubagent: live ? undefined : mockSpawnVote(),
  };

  const out = await runSwarmFanOut(cfg, input);

  const persisted = out.swarmId
    ? await getSwarmRun(cfg, out.swarmId)
    : null;

  const report = {
    mode: live ? "live" : "mock",
    ok: out.ok,
    status: out.status,
    swarmId: out.swarmId,
    vote: out.vote
      ? {
          ok: out.vote.ok,
          consensus: out.vote.consensus,
          stats: out.vote.stats,
          validBallots: out.vote.validBallots,
          parseFailures: out.vote.parseFailures,
          tieBreak: out.vote.tieBreak,
          fields: Object.fromEntries(
            Object.entries(out.vote.fields || {}).map(([k, f]) => [
              k,
              {
                winner: f.winner,
                tie: f.tie,
                tiedBroken: f.tiedBroken,
                share: f.share,
                consensus: f.consensus,
              },
            ])
          ),
        }
      : null,
    persistedVote: persisted?.vote || null,
    summaryHasVoteSection: String(out.summary || "").includes(
      "Structured majority vote"
    ),
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("swarmId:", out.swarmId);
    console.log("status:", out.status, "ok:", out.ok);
    console.log("vote.consensus:", JSON.stringify(out.vote?.consensus, null, 2));
    console.log("vote.stats:", out.vote?.stats);
    console.log("validBallots:", out.vote?.validBallots);
    console.log("summary has vote section:", report.summaryHasVoteSection);
    if (out.summary) {
      const idx = out.summary.indexOf("## Structured majority vote");
      if (idx >= 0) {
        console.log("\n--- vote section ---\n");
        console.log(out.summary.slice(idx, idx + 1200));
      }
    }
  }

  // Pass criteria (mock has deterministic consensus)
  const passMock =
    !live &&
    out.ok &&
    report.summaryHasVoteSection &&
    out.vote?.consensus?.label === "buy" &&
    out.vote?.consensus?.risk === "low" &&
    (out.vote?.validBallots || 0) >= 2;

  const passLive =
    live &&
    out.ok &&
    report.summaryHasVoteSection &&
    (out.vote?.validBallots || 0) >= 1;

  const pass = live ? passLive : passMock;
  console.log("\nL3 VOTE RESULT:", pass ? "PASS" : "FAIL");
  if (!pass && live) {
    console.log(
      "Live tip: if parseFailures high, agents skipped JSON — tighten goal/prompt."
    );
  }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
