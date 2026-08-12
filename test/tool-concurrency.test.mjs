import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isParallelSafeTool,
  partitionToolCalls,
  chunkParallelCalls,
  resolveMaxParallel,
  runToolBatches,
} from "../src/agent/tool-concurrency.mjs";

describe("T2 tool concurrency", () => {
  it("bash is not parallel-safe", () => {
    assert.equal(isParallelSafeTool("xclaw_bash"), false);
  });

  it("file_read is parallel-safe", () => {
    assert.equal(isParallelSafeTool("xclaw_file_read"), true);
  });

  it("partition groups consecutive parallel tools", () => {
    const batches = partitionToolCalls([
      { function: { name: "xclaw_file_read" } },
      { function: { name: "xclaw_file_list" } },
      { function: { name: "xclaw_bash" } },
      { function: { name: "xclaw_file_read" } },
    ]);
    assert.equal(batches.length, 3);
    assert.equal(batches[0].parallel, true);
    assert.equal(batches[0].calls.length, 2);
    assert.equal(batches[1].parallel, false);
    assert.equal(batches[2].parallel, true);
  });

  it("chunkParallelCalls respects maxParallel", () => {
    const calls = [1, 2, 3, 4, 5].map((i) => ({ id: i }));
    const chunks = chunkParallelCalls(calls, 2);
    assert.equal(chunks.length, 3);
    assert.deepEqual(
      chunks.map((c) => c.length),
      [2, 2, 1]
    );
  });

  it("resolveMaxParallel defaults to 4", () => {
    const prev = process.env.XCLAW_TOOLS_MAX_PARALLEL;
    delete process.env.XCLAW_TOOLS_MAX_PARALLEL;
    try {
      assert.equal(resolveMaxParallel({}), 4);
      assert.equal(resolveMaxParallel({ tools: { maxParallel: 8 } }), 8);
    } finally {
      if (prev != null) process.env.XCLAW_TOOLS_MAX_PARALLEL = prev;
    }
  });

  it("runToolBatches runs parallel then serial", async () => {
    const order = [];
    const calls = [
      { function: { name: "xclaw_file_read" }, id: "a" },
      { function: { name: "xclaw_file_list" }, id: "b" },
      { function: { name: "xclaw_bash" }, id: "c" },
    ];
    await runToolBatches(calls, {
      processFn: async (c) => {
        order.push(c.id);
        return null;
      },
      cfg: { tools: { maxParallel: 4 } },
    });
    assert.deepEqual(order.sort(), ["a", "b", "c"]);
    assert.equal(order[2], "c"); // serial after parallel batch
  });

  it("runToolBatches aborts when signal aborted mid-flight", async () => {
    const ac = new AbortController();
    let n = 0;
    await assert.rejects(
      () =>
        runToolBatches(
          [
            { function: { name: "xclaw_bash" }, id: "1" },
            { function: { name: "xclaw_bash" }, id: "2" },
          ],
          {
            processFn: async () => {
              n++;
              ac.abort();
              return null;
            },
            signal: ac.signal,
          }
        ),
      /aborted/
    );
    assert.ok(n >= 1);
  });
});
