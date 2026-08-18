import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";
import {
  compareAutonomySmoke,
  rotateSmokeBaseline,
} from "../src/eval/autonomy-smoke-compare.mjs";

describe("autonomy smoke compare", () => {
  it("first run is ok", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-smc-"));
    writeAutonomySmokeArtifact(root, { status: 0 });
    const c = compareAutonomySmoke(root);
    assert.equal(c.ok, true);
    assert.equal(c.first, true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects regression vs previous ok", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-smc2-"));
    writeAutonomySmokeArtifact(root, { status: 0 });
    rotateSmokeBaseline(root);
    writeAutonomySmokeArtifact(root, { status: 1 });
    const c = compareAutonomySmoke(root);
    assert.equal(c.ok, false);
    assert.equal(c.reason, "regressed");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
