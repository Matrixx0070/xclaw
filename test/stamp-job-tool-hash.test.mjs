import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stampJobToolHash } from "../src/jobs/stamp-tool-hash.mjs";
import { buildToolHashChain } from "../src/agent/tool-hash-chain.mjs";

describe("stampJobToolHash", () => {
  it("fills tip from toolTrace before recordJob", () => {
    const toolTrace = [{ name: "bash", args: { command: "ls" }, result: "ok" }];
    const job = stampJobToolHash({ id: "j1", toolTrace });
    const expected = buildToolHashChain(toolTrace);
    assert.equal(job.toolHashTip, expected.tip);
    assert.equal(job.toolHashVersion, expected.version);
  });

  it("keeps an existing tip", () => {
    const job = stampJobToolHash({
      toolHashTip: "abc",
      toolHashVersion: 1,
      toolTrace: [{ name: "x" }],
    });
    assert.equal(job.toolHashTip, "abc");
  });
});
