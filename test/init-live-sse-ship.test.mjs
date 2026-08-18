import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("init-live-sse-streams ship patch", () => {
  it("is registered", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("init-live-sse-streams.patch"));
    assert.ok(src.includes("createLiveStreamWriter"));
  });

  it("patch rewires all three stream writers", () => {
    const p = fs.readFileSync(path.join(root, "patches/init-live-sse-streams.patch"), "utf8");
    assert.ok(p.includes("createLiveStreamWriter"));
    assert.ok(p.includes('prefix: "agent"'));
    assert.ok(p.includes('prefix: "swarm"'));
    assert.ok(p.includes('prefix: "chat"'));
  });
});
