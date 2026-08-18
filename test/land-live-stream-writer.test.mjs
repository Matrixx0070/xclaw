import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveStreamWriter } from "../src/gateway/sse-live.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land createLiveStreamWriter", () => {
  it("patch swaps agent/swarm/webchat writers", () => {
    const patch = fs.readFileSync(path.join(root, "patches/init-live-sse-streams.patch"), "utf8");
    assert.ok(patch.includes("sse-live.mjs"));
    assert.ok(patch.includes('prefix: "agent"'));
    assert.ok(patch.includes('prefix: "swarm"'));
    assert.ok(patch.includes('prefix: "webchat"'));
  });

  it("createLiveStreamWriter is exported", () => {
    assert.equal(typeof createLiveStreamWriter, "function");
  });
});
