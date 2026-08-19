import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSwarmOfflineSmoke } from "../src/eval/swarm-offline-smoke.mjs";

describe("swarm offline smoke", () => {
  it("parent+2 children pass score", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sm-"));
    const r = await runSwarmOfflineSmoke({ paths: { configDir: dir } });
    assert.equal(r.ok, true, JSON.stringify(r.score));
    assert.equal(r.childCount, 2);
  });
});
