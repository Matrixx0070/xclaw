import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeStop } from "../src/gateway/stop-auth.mjs";
import { drainStats } from "../src/gateway/stop-route.mjs";

describe("stop drain authMethod", () => {
  it("lab when no token", () => {
    const a = authorizeStop({ headers: {} }, {});
    assert.equal(a.ok, true);
    assert.equal(a.authMethod, "lab");
  });

  it("token when token matches", () => {
    const a = authorizeStop(
      { headers: { "x-xclaw-token": "s" }, body: {} },
      { gateway: { token: "s" } }
    );
    assert.equal(a.ok, true);
    assert.equal(a.authMethod, "token");
  });

  it("drainStats shape still works", () => {
    const d = drainStats({ killedSessions: ["a"], ws: { closed: 1, ok: true } }, [1, 2]);
    assert.equal(d.sessionsKilled, 1);
    assert.equal(d.wsClosed, 1);
  });
});
