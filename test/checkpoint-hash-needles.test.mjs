import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  checkpointHashNeedles,
  checkCheckpointHashNeedles,
} from "../src/jobs/checkpoint-hash-needles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cp = path.join(root, "src/jobs/checkpoint.mjs");

describe("checkpoint hash-verify needles", () => {
  it("detects missing needles", () => {
    assert.equal(checkpointHashNeedles("nope").ok, false);
  });

  it("main checkpoint is wired or patches apply in order", () => {
    const r = checkCheckpointHashNeedles(cp);
    if (r.ok) return;
    const hash = spawnSync("git", ["apply", "--check", "patches/checkpoint-hash-verify-wire.patch"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(hash.status, 0, hash.stderr);
  });
});
