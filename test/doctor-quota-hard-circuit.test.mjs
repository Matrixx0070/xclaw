import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  summarizeHardCircuits,
  pushQuotaHardCircuitChecks,
} from "../src/cli/doctor-quota-hard-circuit.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

/** A root whose reports/jobs/index.jsonl holds the given receipts. */
function withReceipts(receipts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dqhc-"));
  roots.push(root);
  const dir = path.join(root, "reports", "jobs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.jsonl"),
    receipts.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
  return root;
}

function probe(root) {
  const checks = [];
  pushQuotaHardCircuitChecks(
    (id, status, message, extra) => checks.push({ id, status, message, extra }),
    root
  );
  return checks[0];
}

describe("doctor ops.quota_hard_circuit", () => {
  it("summarizes trip rate", () => {
    const s = summarizeHardCircuits([
      { quotaHardCircuit: { tripped: true, hardBlocks: 3 } },
      { quotaHardCircuit: { tripped: true, hardBlocks: 3 } },
      {},
    ]);
    assert.equal(s.tripped, 2);
    assert.ok(s.tripRate > 0.5);
    assert.equal(s.jobs, 3);
  });

  it("THE REGRESSION: no receipts is nothing to measure, not a fault", () => {
    // The live host has no reports/jobs/index.jsonl at all, so this branch was
    // the only one it ever took — permanently warn.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dqhc-empty-"));
    roots.push(root);
    const c = probe(root);
    assert.equal(c.id, "ops.quota_hard_circuit");
    assert.equal(c.status, "info");
    assert.equal(c.extra.noData, true);
  });

  it("names the absent artifact instead of printing a rate over nothing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dqhc-empty2-"));
    roots.push(root);
    const c = probe(root);
    assert.match(c.message, /index\.jsonl/);
    assert.doesNotMatch(c.message, /trips=/);
  });

  it("receipts with no trips read ok, and say so over a real denominator", () => {
    const c = probe(withReceipts([{}, {}, {}]));
    assert.equal(c.status, "ok");
    assert.match(c.message, /trips=0\/3/);
  });

  it("a trip under the rate ceiling is still a warn", () => {
    const receipts = [{ quotaHardCircuit: { tripped: true, hardBlocks: 2 } }];
    while (receipts.length < 20) receipts.push({});
    const c = probe(withReceipts(receipts)); // 1/20 = 0.05, under the 0.1 default
    assert.equal(c.status, "warn");
    assert.match(c.message, /trips=1\/20 hardBlocks=2/);
  });

  it("a trip rate over the ceiling escalates to error", () => {
    const c = probe(
      withReceipts([
        { quotaHardCircuit: { tripped: true, hardBlocks: 1 } },
        { quotaHardCircuit: { tripped: true, hardBlocks: 1 } },
      ])
    );
    assert.equal(c.status, "error");
  });
});
