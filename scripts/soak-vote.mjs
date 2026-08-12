#!/usr/bin/env node
/**
 * Vote soak — synthetic ballots through structuredMajorityVote + tie-break.
 *
 *   node scripts/soak-vote.mjs
 *   node scripts/soak-vote.mjs --scenario all
 *   node scripts/soak-vote.mjs --json
 */
import {
  structuredMajorityVote,
  formatVoteReport,
} from "../src/agents/swarm-vote.mjs";

const jsonOut = process.argv.includes("--json");
const only = (() => {
  const i = process.argv.indexOf("--scenario");
  return i >= 0 ? process.argv[i + 1] : "all";
})();

function ballot(nodeId, obj, role = "research") {
  return {
    nodeId,
    role,
    ok: true,
    text: "```json\n" + JSON.stringify(obj) + "\n```",
  };
}

const SCENARIOS = {
  clear_majority: {
    name: "clear majority",
    results: [
      ballot("r1", { label: "buy", risk: "low", confidence: 0.7 }),
      ballot("r2", { label: "buy", risk: "low", confidence: 0.6 }),
      ballot("r3", { label: "hold", risk: "med", confidence: 0.9 }),
    ],
    opts: { tieBreak: "confidence" },
    expect: (v) =>
      v.consensus.label === "buy" &&
      v.consensus.risk === "low" &&
      v.fields.label.tie === false,
  },
  tie_confidence: {
    name: "tie broken by confidence",
    results: [
      ballot("r1", { label: "a", confidence: 0.4 }),
      ballot("r2", { label: "b", confidence: 0.95 }),
    ],
    opts: { tieBreak: "confidence", minShare: 0.5 },
    expect: (v) =>
      v.fields.label.tie === true &&
      v.fields.label.tiedBroken === true &&
      v.consensus.label === "b",
  },
  tie_none: {
    name: "unbroken tie (strict)",
    results: [
      ballot("r1", { label: "a" }),
      ballot("r2", { label: "b" }),
    ],
    opts: { tieBreak: "none" },
    expect: (v) =>
      v.fields.label.tie === true &&
      v.consensus.label === undefined &&
      v.fields.label.winner == null,
  },
  tie_lexical: {
    name: "tie lexical",
    results: [ballot("r1", { label: "zeta" }), ballot("r2", { label: "alpha" })],
    opts: { tieBreak: "lexical" },
    expect: (v) => v.consensus.label === "alpha",
  },
  parse_mixed: {
    name: "partial parse failures",
    results: [
      ballot("r1", { label: "yes" }),
      {
        nodeId: "r2",
        role: "research",
        ok: true,
        text: "no json here at all",
      },
      ballot("r3", { label: "yes" }),
    ],
    opts: { tieBreak: "first" },
    expect: (v) =>
      v.parseFailures === 1 &&
      v.validBallots === 2 &&
      v.consensus.label === "yes",
  },
  ignore_implement: {
    name: "ignore implement role",
    results: [
      ballot("i1", { label: "hack" }, "implement"),
      ballot("r1", { label: "safe" }),
      ballot("r2", { label: "safe" }),
    ],
    opts: {},
    expect: (v) => v.consensus.label === "safe" && v.validBallots === 2,
  },
  weighted_role: {
    name: "role weight breaks count tie",
    results: [
      ballot("r1", { label: "no" }),
      ballot("r2", { label: "no" }),
      {
        nodeId: "c1",
        role: "critic",
        ok: true,
        text: '```json\n{"label":"yes","confidence":0.5}\n```',
      },
    ],
    opts: {
      roles: ["research", "critic"],
      roleWeights: { research: 1, critic: 3 },
      minShare: 0.5,
      tieBreak: "none",
    },
    expect: (v) => {
      // 2 research "no" weight 2 vs critic "yes" weight 3 → yes wins by weight
      return v.consensus.label === "yes" || v.fields.label.winner === "yes";
    },
  },
};

function runScenario(key, sc) {
  const v = structuredMajorityVote(sc.results, sc.opts);
  const pass = sc.expect(v);
  return { key, name: sc.name, pass, vote: v };
}

const keys =
  only === "all"
    ? Object.keys(SCENARIOS)
    : only.split(",").map((s) => s.trim()).filter(Boolean);

let failed = 0;
const rows = [];
for (const key of keys) {
  const sc = SCENARIOS[key];
  if (!sc) {
    console.error("Unknown scenario:", key);
    failed++;
    continue;
  }
  const row = runScenario(key, sc);
  rows.push(row);
  if (!row.pass) failed++;
  if (!jsonOut) {
    console.log(
      `${row.pass ? "PASS" : "FAIL"}  ${row.key.padEnd(18)}  ${row.name}`
    );
    if (!row.pass) {
      console.log(formatVoteReport(row.vote));
    }
  }
}

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        passed: rows.filter((r) => r.pass).length,
        failed,
        rows: rows.map((r) => ({
          key: r.key,
          pass: r.pass,
          consensus: r.vote.consensus,
          stats: r.vote.stats,
        })),
      },
      null,
      2
    )
  );
} else {
  console.log(
    `\n${rows.length - failed}/${rows.length} scenarios passed`
  );
}

process.exit(failed ? 1 : 0);
