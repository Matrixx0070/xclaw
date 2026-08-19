import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordLastDrain, getLastDrain, withSwarmId } from "../src/gateway/last-drain.mjs";

describe("lastDrain swarmId", () => {
  it("records swarmId on drain", () => {
    const d = withSwarmId({ sessionsKilled: 1, channel: "ws", authMethod: "hmac" }, "swarm-9");
    recordLastDrain(d);
    assert.equal(getLastDrain().swarmId, "swarm-9");
  });
});
