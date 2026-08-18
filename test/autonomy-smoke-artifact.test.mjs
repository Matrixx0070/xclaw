import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeAutonomySmokeArtifact,
  smokeArtifactPath,
} from "../src/eval/autonomy-smoke-artifact.mjs";

describe("autonomy smoke artifact", () => {
  it("writes last-smoke.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-asmoke-"));
    const { path: fp, payload } = writeAutonomySmokeArtifact(root, {
      status: 0,
      tests: ["test/autonomy-harness-offline.test.mjs"],
    });
    assert.equal(fp, smokeArtifactPath(root));
    assert.equal(payload.ok, true);
    const disk = JSON.parse(fs.readFileSync(fp, "utf8"));
    assert.equal(disk.mode, "offline");
    assert.ok(disk.at);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ok false on nonzero status", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-asmoke2-"));
    const { payload } = writeAutonomySmokeArtifact(root, { status: 1 });
    assert.equal(payload.ok, false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
