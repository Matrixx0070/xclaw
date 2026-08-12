import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gracefulShutdown } from "../src/gateway/shutdown.mjs";
import { pauseQueue } from "../src/jobs/queue.mjs";

describe("gracefulShutdown", () => {
  it("completes quickly when queue empty", async () => {
    pauseQueue();
    const r = await gracefulShutdown(
      { paths: { configDir: "/tmp/xclaw-shutdown-test" }, queue: { concurrency: 1 } },
      { timeoutMs: 2000, onLog: () => {} }
    );
    assert.equal(r.ok, true);
  });
});
