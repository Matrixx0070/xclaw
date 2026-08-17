import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBoundedQueue, DropPolicy } from "../src/shared/bounded-queue.mjs";

describe("createBoundedQueue", () => {
  it("drop_oldest keeps freshest", () => {
    const q = createBoundedQueue({ maxsize: 2, policy: DropPolicy.DROP_OLDEST });
    assert.equal(q.push("a"), true);
    assert.equal(q.push("b"), true);
    assert.equal(q.push("c"), true);
    assert.deepEqual(q.toArray(), ["b", "c"]);
    assert.equal(q.metrics.dropped, 1);
  });

  it("drop_newest rejects incoming", () => {
    const q = createBoundedQueue({ maxsize: 2, policy: DropPolicy.DROP_NEWEST });
    q.push("a");
    q.push("b");
    assert.equal(q.push("c"), false);
    assert.deepEqual(q.toArray(), ["a", "b"]);
    assert.equal(q.metrics.dropped, 1);
  });

  it("shift drains", () => {
    const q = createBoundedQueue({ maxsize: 4 });
    q.push(1);
    q.push(2);
    assert.equal(q.shift(), 1);
    assert.equal(q.metrics.dequeued, 1);
  });
});
