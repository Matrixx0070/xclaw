import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  flagUngroundedClaims,
  groundingShouldFail,
  createEvidenceLog,
} from "../src/jobs/evidence.mjs";
import { truncationOptsFromConfig, truncateToolResult } from "../src/agent/truncate.mjs";

describe("grounding hard mode", () => {
  it("flags action claims without tools", () => {
    const w = flagUngroundedClaims("I created the file hello.txt successfully.", []);
    assert.ok(w.length >= 1);
    assert.equal(groundingShouldFail(w, { hard: true }), true);
  });
  it("ok when tool evidence present", () => {
    const ev = createEvidenceLog();
    ev.add({ source: "tool", summary: "write → ok" });
    const w = flagUngroundedClaims("I created the file.", ev.snapshot());
    assert.equal(w.length, 0);
  });
  it("allows NO_AUDIT style refusal", () => {
    const w = flagUngroundedClaims("NO_AUDIT", [], { hard: true });
    assert.equal(w.length, 0);
  });
});

describe("per-tool truncation", () => {
  it("applies bash larger budget", () => {
    const bash = truncationOptsFromConfig(
      { tokens: { truncate: { perTool: { bash: { maxChars: 100 } }, maxChars: 50 } } },
      "xclaw_bash"
    );
    assert.equal(bash.maxChars, 100);
    const generic = truncationOptsFromConfig(
      { tokens: { truncate: { maxChars: 50 } } },
      "other"
    );
    assert.equal(generic.maxChars, 50);
  });
  it("truncates long text", () => {
    const r = truncateToolResult("x".repeat(5000), { maxChars: 100, headChars: 40, tailChars: 40 });
    assert.equal(r.truncated, true);
    assert.ok(r.text.length < 5000);
  });
});
