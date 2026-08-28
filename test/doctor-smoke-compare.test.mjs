import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";
import { rotateSmokeBaseline } from "../src/eval/autonomy-smoke-compare.mjs";
import { pushSmokeCompareChecks } from "../src/cli/doctor-smoke-compare.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function mkroot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `xclaw-dsc-${tag}-`));
  roots.push(root);
  return root;
}

function probe(root) {
  const checks = [];
  pushSmokeCompareChecks(
    (id, status, message, extra) => checks.push({ id, status, message, extra }),
    root
  );
  return checks[0];
}

describe("doctor ops.smoke_compare", () => {
  it("THE REGRESSION: no current smoke is nothing to compare, not a fault", () => {
    // Nothing in production writes the artifact, so a warn here asked the
    // operator to act on a state they cannot leave.
    const c = probe(mkroot("none"));
    assert.equal(c.id, "ops.smoke_compare");
    assert.equal(c.extra.reason, "missing_current");
    assert.equal(c.status, "info");
    assert.equal(c.extra.noData, true);
  });

  it("names the artifact and the command that produces it", () => {
    const c = probe(mkroot("none2"));
    assert.match(c.message, /last-smoke\.json/);
    assert.match(c.message, /autonomy-smoke-offline\.mjs/);
  });

  it("errors on regression", () => {
    const root = mkroot("regress");
    writeAutonomySmokeArtifact(root, { status: 0 });
    rotateSmokeBaseline(root);
    writeAutonomySmokeArtifact(root, { status: 1 });
    const c = probe(root);
    assert.equal(c.status, "error");
    assert.equal(c.extra.reason, "regressed");
  });

  it("a present, passing smoke still reads ok", () => {
    const root = mkroot("stable");
    writeAutonomySmokeArtifact(root, { status: 0 });
    rotateSmokeBaseline(root);
    writeAutonomySmokeArtifact(root, { status: 0 });
    const c = probe(root);
    assert.equal(c.status, "ok");
    assert.notEqual(c.extra.reason, "missing_current");
  });
});
