import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";
import { pushQuotaEscalateChecks } from "../src/cli/doctor-quota-escalate.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function mkroot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `xclaw-dq-${tag}-`));
  roots.push(root);
  return root;
}

function probe(root, opts) {
  const checks = [];
  pushQuotaEscalateChecks(
    (id, status, message, extra) => checks.push({ id, status, message, extra }),
    root,
    opts
  );
  return checks[0];
}

describe("doctor ops.quota_escalate", () => {
  it("errors when hardBlockRate exceeds max", () => {
    const root = mkroot("err");
    writeAutonomySmokeArtifact(root, {
      status: 0,
      quotaEscalate: { jobs: 4, hardBlocks: 3, hardBlockRate: 0.75 },
    });
    const c = probe(root, { maxHardBlockRate: 0.25 });
    assert.equal(c.id, "ops.quota_escalate");
    assert.equal(c.status, "error");
    assert.match(c.message, /hardBlockRate=0\.750 jobs=4 hard=3/);
  });

  it("a measured rate under the ceiling reads ok", () => {
    const root = mkroot("ok");
    writeAutonomySmokeArtifact(root, {
      status: 0,
      quotaEscalate: { jobs: 8, hardBlocks: 1, hardBlockRate: 0.125 },
    });
    const c = probe(root, { maxHardBlockRate: 0.25 });
    assert.equal(c.status, "ok");
    assert.match(c.message, /hardBlockRate=0\.125 jobs=8/);
  });

  it("THE REGRESSION: no artifact never prints a rate it did not measure", () => {
    // reports/autonomy/last-smoke.json is written by nothing in production, so
    // this branch was the permanent live reading — and it used to substitute
    // {jobs:0,hardBlocks:0,hardBlockRate:0} and print hardBlockRate=0.000.
    const c = probe(mkroot("nofile"), { maxHardBlockRate: 0.25 });
    assert.equal(c.status, "info");
    assert.equal(c.extra.noData, true);
    assert.doesNotMatch(c.message, /hardBlockRate/);
    assert.match(c.message, /last-smoke\.json/);
  });

  it("an artifact recording zero jobs is also nothing to measure", () => {
    const root = mkroot("nojobs");
    writeAutonomySmokeArtifact(root, {
      status: 0,
      quotaEscalate: { jobs: 0, hardBlocks: 0, hardBlockRate: 0 },
    });
    const c = probe(root, { maxHardBlockRate: 0.25 });
    assert.equal(c.status, "info");
    assert.equal(c.extra.noData, true);
    assert.doesNotMatch(c.message, /hardBlockRate/);
  });
});
