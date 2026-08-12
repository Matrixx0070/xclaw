import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePriority, PRIORITY_CLASS } from "../src/jobs/queue.mjs";

describe("queue priority", () => {
  it("maps classes", () => {
    assert.equal(resolvePriority({ class: "interactive" }), PRIORITY_CLASS.interactive);
    assert.equal(resolvePriority({ class: "cron" }), PRIORITY_CLASS.cron);
    assert.equal(resolvePriority({ priority: 7 }), 7);
  });
});
