import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildExtractiveSummary,
  offloadToolResults,
  foldAgedTurns,
  compactMessages,
} from "../src/tokens/compaction.mjs";

describe("compaction", () => {
  it("buildExtractiveSummary includes tools and intent", () => {
    const s = buildExtractiveSummary([
      { role: "user", content: "Refactor the auth module" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            function: { name: "xclaw_bash", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "1",
        content: "error ENOENT /tmp/missing.txt",
      },
    ]);
    assert.match(s, /Refactor the auth/);
    assert.match(s, /xclaw_bash/);
    assert.match(s, /ENOENT|Errors/);
  });

  it("offloadToolResults writes file and stubs content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-off-"));
    const big = "x".repeat(5000);
    const { messages, report } = await offloadToolResults(
      [
        { role: "system", content: "sys" },
        { role: "tool", tool_call_id: "tc1", content: big },
      ],
      { dir, thresholdChars: 1000, previewChars: 50 }
    );
    assert.equal(report.offloaded, 1);
    assert.match(messages[1].content, /\[xclaw-offload\]/);
    assert.match(messages[1].content, /path:/);
    const p = messages[1]._offloadPath;
    const body = await fs.readFile(p, "utf8");
    assert.equal(body.length, 5000);
  });

  it("foldAgedTurns keeps system and recent", async () => {
    const msgs = [{ role: "system", content: "ATTEST system" }];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: "user", content: `u${i}` });
      msgs.push({ role: "assistant", content: `a${i}` });
    }
    const { messages, report } = await foldAgedTurns(msgs, {
      keepRecent: 4,
      minAgeToFold: 4,
    });
    assert.equal(report.folded, true);
    assert.equal(messages[0].content, "ATTEST system");
    assert.match(messages[1].content, /\[xclaw-compaction\]/);
    assert.ok(messages.length < msgs.length);
  });

  it("compactMessages no-ops below pressure", async () => {
    const { report } = await compactMessages(
      [
        { role: "system", content: "s" },
        { role: "user", content: "hi" },
      ],
      { triggerPressure: 0.9, maxChars: 1_000_000 }
    );
    assert.equal(report.skipped, true);
  });
});
