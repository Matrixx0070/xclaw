import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordLastDrain, getLastDrain } from "../src/gateway/last-drain.mjs";
import { assertLastDrainChannel } from "../src/eval/stop-channel-assert.mjs";

describe("lastDrain channel completeness", () => {
  for (const ch of ["http", "ws", "sse"]) {
    it(`accepts ${ch}`, () => {
      recordLastDrain({ sessionsKilled: 0, channel: ch, authMethod: "token" });
      const r = assertLastDrainChannel(getLastDrain());
      assert.equal(r.ok, true);
      assert.equal(r.channel, ch);
    });
  }
});
