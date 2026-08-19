import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutonomySmokeArtifact } from "../src/eval/autonomy-smoke-artifact.mjs";

describe("smoke artifact lastDrain", () => {
  it("persists lastDrain when provided", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-smoke-"));
    const { payload } = writeAutonomySmokeArtifact(root, {
      ok: true,
      status: 0,
      lastDrain: { channel: "sse", authMethod: "hmac" },
      quotaEscalate: { jobs: 0, hardBlocks: 0, hardBlockRate: 0 },
    });
    assert.equal(payload.lastDrain.channel, "sse");
  });
});
