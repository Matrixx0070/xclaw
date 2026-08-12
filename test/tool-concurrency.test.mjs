import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isParallelSafeTool,
  partitionToolCalls,
} from "../src/agent/tool-concurrency.mjs";

describe("tool concurrency", () => {
  it("classifies reads parallel and bash serial", () => {
    assert.equal(isParallelSafeTool("xclaw_file_read"), true);
    assert.equal(isParallelSafeTool("xclaw_file_list"), true);
    assert.equal(isParallelSafeTool("xclaw_bash"), false);
    assert.equal(isParallelSafeTool("xclaw_file_write"), false);
    assert.equal(isParallelSafeTool("unknown_tool"), false);
  });

  it("batches consecutive parallel-safe tools together", () => {
    const calls = [
      { function: { name: "xclaw_file_read" } },
      { function: { name: "xclaw_file_list" } },
      { function: { name: "xclaw_bash" } },
      { function: { name: "xclaw_file_read" } },
    ];
    const batches = partitionToolCalls(calls);
    assert.equal(batches.length, 3);
    assert.equal(batches[0].parallel, true);
    assert.equal(batches[0].calls.length, 2);
    assert.equal(batches[1].parallel, false);
    assert.equal(batches[1].calls.length, 1);
    assert.equal(batches[2].parallel, true);
  });
});
