#!/usr/bin/env node
/**
 * L3-lite: mock 3 research results → structuredMajorityVote (join path).
 *   node scripts/prove-vote-join.mjs
 */
import {
  structuredMajorityVote,
  formatVoteReport,
} from "../src/agents/swarm-vote.mjs";

const results = [
  {
    nodeId: "r1",
    role: "research",
    ok: true,
    task: "assess label",
    text: `Findings: modest upside.\n\`\`\`json\n{"label":"buy","risk":"low","confidence":0.72}\n\`\`\``,
  },
  {
    nodeId: "r2",
    role: "research",
    ok: true,
    task: "assess label",
    text: `Findings: similar.\n\`\`\`json\n{"label":"buy","risk":"med","confidence":0.55}\n\`\`\``,
  },
  {
    nodeId: "r3",
    role: "research",
    ok: true,
    task: "assess label",
    text: `Findings: cautious.\n\`\`\`json\n{"label":"hold","risk":"low","confidence":0.8}\n\`\`\``,
  },
];

const vote = structuredMajorityVote(results, {
  roles: ["research"],
  minBallots: 2,
  minShare: 0.5,
  tieBreak: "confidence",
  seed: "prove-vote-join",
});

console.log("=== Mock 3-research join vote ===\n");
console.log(formatVoteReport(vote));
console.log("consensus:", JSON.stringify(vote.consensus, null, 2));
console.log("stats:", vote.stats);
console.log("validBallots:", vote.validBallots, "parseFailures:", vote.parseFailures);

const ok =
  vote.validBallots === 3 &&
  vote.consensus.label === "buy" &&
  vote.consensus.risk === "low";

console.log("\nPROVE RESULT:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
