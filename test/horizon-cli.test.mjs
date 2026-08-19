import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/eval/horizon-cli.mjs";

describe("horizon cli", () => {
  it("runs offline suite via main", async () => {
    const r = await main(["--offline"]);
    assert.equal(r.offline, true);
    assert.equal(r.ok, true);
  });
});
