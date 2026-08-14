#!/usr/bin/env node
/**
 * P2 — Swarm receipt path: build receipts, policy gate, summary.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  attachNodeReceipt,
  buildRunReceiptSummary,
  evaluateReceiptPolicy,
  hasReceipt,
} from "../src/agents/swarm-receipt.mjs";
import { topologicalWaves } from "../src/agents/graph-viz.mjs";

const cfg = {
  paths: {
    configDir: await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-p2-swarm-")),
  },
};

const nodesSpec = [
  { id: "prepare", goal: "prepare workspace", dependsOn: [], role: "implement" },
  { id: "finish", goal: "finish task", dependsOn: ["prepare"], role: "verify" },
];
const waves = topologicalWaves(nodesSpec);

const results = [];
for (const n of nodesSpec) {
  const nodeResult = {
    nodeId: n.id,
    id: `spawn_${n.id}`,
    role: n.role,
    ok: true,
    status: "done",
    text: `${n.id} complete`,
    toolTrace: [{ name: "xclaw_bash", ok: true }],
  };
  await attachNodeReceipt(cfg, nodeResult, {
    swarmId: "p2-swarm-demo",
    nodeId: n.id,
    goal: n.goal,
  });
  results.push(nodeResult);
}

const summary = buildRunReceiptSummary(results);
const policy = evaluateReceiptPolicy(results, {
  requireReceipts: true,
  criticalRoles: ["implement", "verify"],
});

const report = {
  ok: policy.ok && summary.withReceipt === 2 && results.every(hasReceipt),
  waves,
  summary,
  policy,
  receiptIds: results.map((r) => r.receiptId),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
