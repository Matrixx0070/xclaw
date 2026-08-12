
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildScoreboard } from "../src/eval/scoreboard.mjs";

describe("scoreboard", () => {
  it("builds without throw", async () => {
    const s = await buildScoreboard(
      { paths: { configDir: "/tmp/xclaw-sb-missing" } },
      { root: process.cwd() }
    );
    assert.ok(s.at);
    assert.ok(s.releaseGate);
    assert.ok(s.hardPack);
    assert.ok(s.longPack);
  });
});
